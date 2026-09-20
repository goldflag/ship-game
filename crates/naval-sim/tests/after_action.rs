//! The after-action report: one hit per projectile per ship, the tallies the
//! results screen reads, and the debrief as the only frame that carries them.
use naval_sim::{
    battle::{Battle, BattleSetup},
    catalog::Catalog,
    impact::{DamageEvent, ImpactRecord, ShellEffect},
    records::{HitOutcome, HitWeapon, Records, WeaponSource},
    rules::TeamId,
    shell::Shell,
    vessel::Vessel,
    weapons::Ammunition,
};
use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

fn catalog() -> Arc<Catalog> {
    static CATALOG: OnceLock<Arc<Catalog>> = OnceLock::new();
    CATALOG
        .get_or_init(|| {
            Arc::new(
                Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap())
                    .unwrap(),
            )
        })
        .clone()
}
fn actors() -> Vec<Vessel> {
    let ship = Arc::new(catalog().compile("bismarck").unwrap());
    vec![
        Vessel::new("own", TeamId::A, ship.clone()),
        Vessel::new("enemy", TeamId::B, ship),
    ]
}
fn impact(id: i64, kind: &str, outcome: &str, name: &str, hull_damage: f64) -> DamageEvent {
    DamageEvent {
        kind: outcome.into(),
        ship_id: "own".into(),
        shell: Some(ShellEffect::from_shell(&Shell {
            id,
            ..Default::default()
        })),
        impact: Some(ImpactRecord {
            shell_id: id,
            ship_id: "own".into(),
            target_id: name.to_lowercase(),
            target_name: name.into(),
            kind: kind.into(),
            outcome: outcome.into(),
            position: [1.0, 2.0, 3.0],
            hull_damage: Some(hull_damage),
            ..Default::default()
        }),
        ..Default::default()
    }
}
fn fired(records: &mut Records, id: i64, owner: &str) {
    records.source(id, || WeaponSource {
        owner_id: owner.into(),
        label: "380 mm AP".into(),
        ammunition: Ammunition::Ap,
        damage: 100.0,
    });
}

#[test]
fn a_shell_is_one_hit_however_many_things_it_meets() {
    let actors = actors();
    let mut records = Records::default();
    records.begin_tick(&actors);
    fired(&mut records, 1, "enemy");
    fired(&mut records, 1, "enemy");
    let mut belt = impact(1, "armor", "penetrated", "Main belt", 0.0);
    {
        let i = belt.impact.as_mut().unwrap();
        i.thickness_mm = Some(320.0);
        i.obliquity_deg = Some(12.0);
    }
    records.event(&belt, 7, &actors);
    let mut engine = impact(1, "module", "destroyed", "Engine", 40.0);
    engine.impact.as_mut().unwrap().damage = Some(90.0);
    records.event(&engine, 7, &actors);
    let mut bulkhead = impact(1, "armor", "stopped", "Torpedo bulkhead", 5.0);
    bulkhead.impact.as_mut().unwrap().thickness_mm = Some(45.0);
    records.event(&bulkhead, 8, &actors);

    let own = &records.after_action.ships["own"];
    assert_eq!(own.hits.len(), 1);
    let hit = &own.hits[0];
    assert_eq!((hit.tick, hit.kind), (7, HitWeapon::Shell));
    assert_eq!(hit.position, [1.0, 2.0, 3.0]);
    assert_eq!(hit.struck, "Main belt");
    assert_eq!(
        hit.outcome,
        HitOutcome::Penetrated,
        "once inside, it stays a penetration"
    );
    assert_eq!(
        hit.plate.as_ref().unwrap().name,
        "Torpedo bulkhead",
        "the plate that stopped it"
    );
    assert_eq!(hit.damage, 45.0);
    assert_eq!((hit.modules.len(), hit.modules[0].destroyed), (1, true));
    assert_eq!(own.damage_taken, 45.0);
    let enemy = &records.after_action.ships["enemy"];
    assert_eq!((enemy.shots_fired, enemy.hits_landed), (1, 1));
    assert_eq!(enemy.dealt_by_weapon["380 mm AP"], 45.0);
    assert_eq!(enemy.dealt_to["own"], 45.0);
}

#[test]
fn stops_and_ricochets_are_hits_but_friendly_fire_and_wreckage_are_not() {
    let actors = actors();
    let mut records = Records::default();
    records.begin_tick(&actors);
    fired(&mut records, 1, "enemy");
    records.event(
        &impact(1, "armor", "ricochet", "Turret face", 0.0),
        1,
        &actors,
    );
    fired(&mut records, 2, "own");
    records.event(&impact(2, "armor", "stopped", "Main belt", 0.0), 1, &actors);
    fired(&mut records, 3, "enemy");
    let mut wreckage = impact(3, "armor", "penetrated", "Main belt", 0.0);
    wreckage.impact.as_mut().unwrap().through_wreckage = Some(true);
    records.event(&wreckage, 1, &actors);
    let own = &records.after_action.ships["own"];
    assert_eq!(own.hits.len(), 1);
    assert_eq!(own.hits[0].outcome, HitOutcome::Ricochet);
    assert_eq!(records.after_action.ships["enemy"].hits_landed, 1);
}

#[test]
fn the_report_rides_the_debrief_and_never_an_active_frame() {
    let catalog = catalog();
    let compiled = ["yamato", "bismarck"]
        .into_iter()
        .map(|id| (id.to_owned(), Arc::new(catalog.compile(id).unwrap())))
        .collect();
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships": [
            {"id":"own","presetId":"yamato","team":"a","controller":"player","aiLevel":"normal","spawn":{"x":0,"z":0,"heading":0}},
            {"id":"enemy","presetId":"bismarck","team":"b","controller":"player","aiLevel":"normal","spawn":{"x":2000,"z":0,"heading":0}}
        ], "seed":54321,"mapId":"north-atlantic","weather":"clear","spawnDistance":5000,"windSpeed":0
    })).unwrap();
    let mut battle = Battle::new(catalog.clone(), &compiled, setup).unwrap();
    let weapon = &catalog.definitions["bismarck"].mounts[0].weapon;
    let position =
        naval_sim::geometry::local_to_world([30.0, 2.0, 0.0], battle.actors[0].motion.pose());
    battle.shells.push(Shell {
        id: 90001,
        owner_id: "enemy".into(),
        position,
        velocity: [-weapon.muzzle_speed, 0.0, 0.0],
        damage: weapon.damage,
        caliber_m: weapon.caliber_m,
        ammunition: Some(Ammunition::Ap),
        penetration_mm: weapon.penetration_mm,
        ap: weapon.ap.clone(),
        ..Default::default()
    });
    for _ in 0..120 {
        battle.step(&BTreeMap::new());
    }
    let report = &battle.records.after_action;
    assert_eq!(report.ships["enemy"].shots_fired, 1);
    let hit = &report.ships["own"].hits[0];
    assert_eq!(hit.source_id, "enemy");
    assert!(
        hit.position[0] > 0.0,
        "struck the starboard side: {:?}",
        hit.position
    );
    assert!(hit.plate.is_some());
    let active = serde_json::to_value(battle.team_frame(TeamId::A, &[]).unwrap()).unwrap();
    assert!(active.get("afterAction").is_none() && active.get("debrief").is_none());
    assert!(active["records"].get("afterAction").is_none());
    let full = serde_json::to_value(battle.full_frame(&[])).unwrap();
    assert!(
        full.get("afterAction").is_none(),
        "an undecided battle carries no report"
    );

    battle.actors[1].damage.integrity = 0.0;
    battle.actors[1].damage.sunk = true;
    for _ in 0..600 {
        battle.step(&BTreeMap::new());
        if battle.outcome.is_some() {
            break;
        }
    }
    assert!(battle.outcome.is_some(), "a sunk enemy decides the battle");
    let decided = serde_json::to_value(battle.team_frame(TeamId::A, &[]).unwrap()).unwrap();
    assert!(decided.get("afterAction").is_none());
    let report = &decided["debrief"]["afterAction"];
    assert_eq!(report["ships"]["own"]["hits"][0]["sourceId"], "enemy");
    assert!(report["ships"]["enemy"]["lostTick"].is_u64());
    assert!(!report["timeline"].as_array().unwrap().is_empty());
    // A custom battle plays from the full frame, which is its own debrief.
    let full = serde_json::to_value(battle.full_frame(&[])).unwrap();
    assert_eq!(full["afterAction"], *report);
}
