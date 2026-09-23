//! The captain seam: a decision can be taken without stepping the battle, and
//! a scripted adapter can stand in for the seeded crew.
use naval_sim::{
    battle::{Battle, BattleSetup, Orders},
    bots::BotState,
    captain::{BotCaptain, Captain, Crew, Decision, Target, Watch},
    catalog::Catalog,
    gunnery::PlayerGunOrders,
    motion::HelmCommand,
    navigation::Movement,
    sensors::Sensors,
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
        let catalog = Catalog::installed();
        let compiled = ["fletcher"]
            .into_iter()
            .map(|id| (id.to_owned(), Arc::new(catalog.compile(id).unwrap())))
            .collect();
        (catalog, compiled)
    })
}
/// A legacy custom battle: one seeded crew two kilometres from a static target.
fn battle() -> Battle {
    let (catalog, compiled) = content();
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships": [
            {"id":"own","presetId":"fletcher","team":"a","controller":"bot","aiLevel":"normal","spawn":{"x":0,"z":0,"heading":0}},
            {"id":"enemy","presetId":"fletcher","team":"b","controller":"bot","aiLevel":"static","spawn":{"x":0,"z":-2000,"heading":std::f64::consts::PI}}
        ],
        "seed":54321,"mapId":"north-atlantic","weather":"clear","spawnDistance":16000,"windSpeed":0
    }))
    .unwrap();
    Battle::new(catalog.clone(), compiled, setup).unwrap()
}
/// Ask the seeded crew of `battle.actors[index]` for its decision directly,
/// the way `Battle::step` does, without advancing the battle.
fn decide(battle: &mut Battle, index: usize, standing: Option<&Orders>) -> (Decision, Crew) {
    let orders = standing
        .map(|o| BTreeMap::from([(battle.actors[index].motion.id.clone(), o.clone())]))
        .unwrap_or_default();
    let mut crew = Crew::lift(&mut battle.actors[index]);
    let watch = Watch {
        fleet: &battle.actors,
        index,
        orders: &orders,
        reports: None,
        islands: &battle.islands,
        terrain: &battle.catalog.terrain,
        trails: &battle.trails,
        torpedoes: &battle.torpedoes,
        tick: battle.tick,
        time: 0.0,
    };
    let decision = BotCaptain.conn(&watch, &mut crew, standing);
    (decision, crew)
}

#[test]
fn a_captain_decision_is_a_value_taken_without_stepping_the_battle() {
    let mut a = battle();
    let (decision, crew) = decide(&mut a, 0, None);
    // The crew engaged the only opponent and put the helm over toward it.
    assert_eq!(decision.target, Target::Engage(Some("enemy".into())));
    assert!(decision.helm.throttle > 0.0);
    assert!(decision.helm.rudder.is_finite());
    let bot = crew.bot.as_ref().unwrap();
    assert_eq!(bot.track.as_ref().unwrap().id, "enemy");
    assert!(bot.opening_fire_at.is_some());
    // Nothing was applied: the battle is untouched until `step` applies it.
    assert_eq!(a.tick, 0);
    assert!(a.actors[0].target_id.is_none());
    assert!(a.actors[0].bot.is_none(), "the crew is still lifted");
    // The same seed, hull and view give the same decision and the same crew.
    let mut b = battle();
    let (again, crew_b) = decide(&mut b, 0, None);
    assert_eq!(again, decision);
    assert_eq!(
        serde_json::to_value(&crew.bot).unwrap(),
        serde_json::to_value(&crew_b.bot).unwrap()
    );
    // The static target ship decides nothing: no target, dead helm.
    let (target_ship, _) = decide(&mut a, 1, None);
    assert_eq!(target_ship.target, Target::Engage(None));
    assert_eq!(target_ship.helm, HelmCommand::default());
}

#[test]
fn standing_orders_take_the_conn_from_the_crew() {
    let helm = HelmCommand {
        throttle: 0.3,
        rudder: -0.5,
        ..Default::default()
    };
    let mut a = battle();
    let (direct, crew) = decide(
        &mut a,
        0,
        Some(&Orders {
            helm: Some(helm),
            ..Default::default()
        }),
    );
    // A direct helm is relayed as given, and the crew still keeps its target
    // and its solution for the guns.
    assert_eq!(direct.helm, helm);
    assert_eq!(direct.target, Target::Engage(Some("enemy".into())));
    assert!(crew.bot.as_ref().unwrap().track.is_some());
    let mut b = battle();
    let (hold, _) = decide(
        &mut b,
        0,
        Some(&Orders {
            movement: Movement::Hold,
            ..Default::default()
        }),
    );
    assert_eq!(hold.helm, HelmCommand::default());
    // A player who is steering and firing needs nothing from the crew, so the
    // vessel keeps whatever target it had.
    let mut c = battle();
    c.actors[0].controller = naval_sim::vessel::Controller::Player;
    let (player, crew) = decide(
        &mut c,
        0,
        Some(&Orders {
            helm: Some(helm),
            guns: Some(PlayerGunOrders {
                battery: "main".into(),
                weapon_group_id: None,
                aim: None,
                fire: false,
                ammunition: BTreeMap::new(),
            }),
            ..Default::default()
        }),
    );
    assert_eq!(player.target, Target::Keep);
    assert!(crew.bot.as_ref().unwrap().track.is_none());
}

/// A captain that does what the script says, for every hull, and never
/// touches the crew memory.
struct Scripted {
    helm: HelmCommand,
    target: Option<String>,
}
impl Captain for Scripted {
    fn conn(&self, _: &Watch<'_>, _: &mut Crew, _: Option<&Orders>) -> Decision {
        Decision {
            helm: self.helm,
            target: Target::Engage(self.target.clone()),
        }
    }
    fn secondary_battery(
        &self,
        _: &Vessel,
        _: &Sensors,
        _: Option<&str>,
        _: u32,
        _: f64,
        _: &mut Option<BotState>,
    ) {
    }
}

#[test]
fn a_scripted_captain_swaps_in_at_the_seam() {
    let scripted = HelmCommand {
        throttle: 0.42,
        rudder: -0.3,
        ..Default::default()
    };
    let mut crew = battle();
    let mut script = battle();
    script.set_captain(Box::new(Scripted {
        helm: scripted,
        target: Some("enemy".into()),
    }));
    let none = BTreeMap::new();
    crew.step(&none);
    script.step(&none);
    // The scripted helm went to every hull and was applied as given, where the
    // seeded crew steered its own course and the static target held still.
    assert_eq!(script.actors[0].helm, scripted);
    assert_eq!(script.actors[1].helm, scripted);
    assert_eq!(script.actors[0].target_id.as_deref(), Some("enemy"));
    assert_eq!(script.actors[1].target_id.as_deref(), Some("enemy"));
    assert_ne!(crew.actors[0].helm, scripted);
    assert_eq!(crew.actors[1].helm, HelmCommand::default());
    assert_eq!(crew.actors[0].target_id.as_deref(), Some("enemy"));
    // The crew memory stayed on the hull, untouched by the script, so the
    // seeded crew resumes from it when it gets the conn back.
    assert!(crew.actors[0].bot.as_ref().unwrap().track.is_some());
    assert!(script.actors[0].bot.as_ref().unwrap().track.is_none());
    script.set_captain(Box::new(BotCaptain));
    script.step(&none);
    assert!(script.actors[0].bot.as_ref().unwrap().track.is_some());
    assert_ne!(script.actors[0].helm, scripted);
}
