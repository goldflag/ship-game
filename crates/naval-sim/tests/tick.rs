//! The tick: one phase can run on its own against a fixture, the scratch
//! crosses between phases by hull id, and the phase order is the step.
use naval_sim::{
    battle::{
        Battle, BattleSetup, Orders,
        tick::{Phase, Tick},
    },
    catalog::Catalog,
    gunnery::PlayerGunOrders,
    motion::HelmCommand,
    rules::DT,
    vessel::{CompiledShip, Vessel},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};
type Content = (Arc<Catalog>, BTreeMap<String, Arc<CompiledShip>>);
fn content() -> &'static Content {
    static CONTENT: OnceLock<Content> = OnceLock::new();
    CONTENT.get_or_init(|| {
        let catalog = Arc::new(
            Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap())
                .unwrap(),
        );
        let compiled = ["fletcher"]
            .into_iter()
            .map(|id| (id.to_owned(), Arc::new(catalog.compile(id).unwrap())))
            .collect();
        (catalog, compiled)
    })
}
/// A legacy custom battle: a player-controlled destroyer two kilometres from
/// a static seeded one, in a flat calm.
fn battle() -> Battle {
    let (catalog, compiled) = content();
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships": [
            {"id":"own","presetId":"fletcher","team":"a","controller":"player","aiLevel":"normal","spawn":{"x":0,"z":0,"heading":0}},
            {"id":"enemy","presetId":"fletcher","team":"b","controller":"bot","aiLevel":"static","spawn":{"x":0,"z":-2000,"heading":std::f64::consts::PI}}
        ],
        "seed":54321,"mapId":"north-atlantic","weather":"clear","spawnDistance":16000,"windSpeed":0
    }))
    .unwrap();
    Battle::new(catalog.clone(), compiled, setup).unwrap()
}
fn hull<'a>(battle: &'a Battle, id: &str) -> &'a Vessel {
    battle.actors.iter().find(|a| a.motion.id == id).unwrap()
}
/// A tick opened on `battle` and positioned so that `phase` is the next one
/// to run.
fn tick_before(battle: &Battle, phase: Phase) -> Tick {
    let mut tick = Tick::default();
    tick.begin(battle);
    tick.skip_to(phase);
    tick
}
fn depth_charge_orders(id: &str) -> BTreeMap<String, Orders> {
    BTreeMap::from([(
        id.to_owned(),
        Orders {
            guns: Some(PlayerGunOrders {
                battery: "depth-charge".into(),
                weapon_group_id: None,
                aim: None,
                fire: true,
                ammunition: Default::default(),
            }),
            ..Default::default()
        },
    )])
}

#[test]
fn a_custom_battle_tick_opens_with_every_cadence_on() {
    let battle = battle();
    let mut tick = Tick::default();
    assert_eq!(tick.phase(), Phase::Idle);
    tick.begin(&battle);
    assert_eq!(tick.phase(), Phase::Begun);
    assert_eq!(tick.time, 0.0);
    // No mission, no reports; capability and damage control run every tick.
    assert!(!tick.reports_refresh);
    assert!(tick.capability_sweep);
    assert_eq!(tick.control_step, Some(DT));
}

#[test]
fn the_fight_phase_raises_events_into_the_sink_without_publishing_them() {
    let mut battle = battle();
    let orders = depth_charge_orders("own");
    let mut tick = tick_before(&battle, Phase::Fight);
    battle.fight(&mut tick, &orders);
    assert_eq!(tick.phase(), Phase::Fight);
    // The stern rack fired on the player's order: one charge in the water,
    // known to the records, and its launch raised in the sink.
    assert_eq!(battle.depth_charges.len(), 1);
    let charge = &battle.depth_charges[0];
    assert_eq!(charge.owner_id, "own");
    assert!(battle.records.sources.contains_key(&charge.id));
    assert_eq!(tick.events.len(), 1);
    assert_eq!(tick.events[0].kind, "depth-charge-launch");
    assert_eq!(tick.events[0].ship_id, "own");
    // Nothing is published until the tick settles.
    assert!(battle.events.is_empty());
    assert_eq!(battle.tick, 0);
}

#[test]
fn the_settle_phase_publishes_the_sink_in_order_and_closes_the_tick() {
    let mut battle = battle();
    let orders = depth_charge_orders("own");
    let mut tick = tick_before(&battle, Phase::Fight);
    battle.fight(&mut tick, &orders);
    tick.skip_to(Phase::Settle);
    battle.settle(&mut tick);
    assert!(tick.events.is_empty(), "the sink drained");
    assert_eq!(battle.events.len(), 1);
    let published = &battle.events[0];
    assert_eq!(published.data.kind, "depth-charge-launch");
    assert_eq!(published.sequence, 1);
    assert_eq!(published.tick, 0, "raised on the tick that just closed");
    assert_eq!(battle.tick, 1, "the counter advanced");
    assert!(battle.outcome.is_none());
    assert_eq!(tick.phase(), Phase::Idle, "ready for the next begin");
}

#[test]
fn the_manoeuvre_phase_applies_the_helm_by_hull_id_whatever_the_fleet_order() {
    let mut battle = battle();
    let ahead = HelmCommand {
        throttle: 1.0,
        rudder: 0.5,
        ..Default::default()
    };
    let astern = HelmCommand {
        throttle: -0.5,
        rudder: 0.0,
        ..Default::default()
    };
    let mut tick = tick_before(&battle, Phase::Manoeuvre);
    tick.set_helm("own", ahead);
    tick.set_helm("enemy", astern);
    // The fleet reorders between the decision and the manoeuvre: an
    // index-keyed helm would now steer the wrong hull.
    battle.actors.swap(0, 1);
    assert_eq!(battle.actors[0].motion.id, "enemy");
    battle.manoeuvre(&mut tick);
    assert_eq!(hull(&battle, "own").helm, ahead);
    assert_eq!(hull(&battle, "enemy").helm, astern);
    assert!(hull(&battle, "own").motion.speed > 0.0, "own went ahead");
    assert!(
        hull(&battle, "enemy").motion.speed < 0.0,
        "enemy went astern"
    );
}

#[test]
#[should_panic(expected = "no helm was decided for enemy")]
fn a_hull_without_a_decision_cannot_manoeuvre() {
    let mut battle = battle();
    let mut tick = tick_before(&battle, Phase::Manoeuvre);
    tick.set_helm("own", HelmCommand::default());
    battle.manoeuvre(&mut tick);
}

#[test]
#[cfg_attr(not(debug_assertions), ignore = "the phase order is a debug assertion")]
#[should_panic(expected = "tick phase Decide entered after Begun")]
fn a_phase_out_of_order_is_refused() {
    let mut battle = battle();
    let mut tick = Tick::default();
    tick.begin(&battle);
    battle.decide(&mut tick, &BTreeMap::new());
}

#[test]
fn the_phase_sequence_is_the_step() {
    let orders = depth_charge_orders("own");
    let mut stepped = battle();
    let mut phased = battle();
    let mut tick = Tick::default();
    for _ in 0..90 {
        stepped.step(&orders);
        tick.begin(&phased);
        phased.observe(&mut tick);
        phased.decide(&mut tick, &orders);
        phased.manoeuvre(&mut tick);
        phased.fight(&mut tick, &orders);
        phased.strike(&mut tick);
        phased.suffer(&mut tick, &orders);
        phased.settle(&mut tick);
    }
    assert_eq!(stepped.tick, phased.tick);
    assert!(
        !stepped.events.is_empty(),
        "the fixture fired something to compare"
    );
    assert_eq!(
        serde_json::to_value(&stepped.actors).unwrap(),
        serde_json::to_value(&phased.actors).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&stepped.events).unwrap(),
        serde_json::to_value(&phased.events).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&stepped.depth_charges).unwrap(),
        serde_json::to_value(&phased.depth_charges).unwrap()
    );
}

#[test]
fn aftermath_keeps_moving_without_changing_the_result() {
    let mut battle = battle();
    battle.actors[1].damage.sunk = true;
    battle.step(&BTreeMap::new());
    assert!(battle.outcome.is_some());
    let outcome = serde_json::to_value(&battle.outcome).unwrap();
    let tick = battle.tick;
    battle.actors[0].motion.speed = 5.0;
    let z = battle.actors[0].motion.z;
    battle.step_aftermath();
    assert_eq!(battle.tick, tick + 1);
    assert_ne!(battle.actors[0].motion.z, z);
    assert_eq!(serde_json::to_value(&battle.outcome).unwrap(), outcome);
    // Even mutual destruction during the aftermath cannot turn victory into a draw.
    battle.actors[0].damage.sunk = true;
    let y = battle.actors[1].motion.y;
    for _ in 0..60 {
        battle.step_aftermath();
    }
    assert_ne!(battle.actors[1].motion.y, y);
    assert_eq!(serde_json::to_value(&battle.outcome).unwrap(), outcome);
}
