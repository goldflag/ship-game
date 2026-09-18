use naval_sim::{
    battle::{Battle, BattleSetup},
    catalog::Catalog,
    contacts::{ContactKind, ShipContact},
    damage::HULL_HP_SCALE,
    impact::{DamageEvent, ImpactRecord, ShellEffect, resolve_ship_contact},
    records::{Records, WeaponSource},
    rules::TeamId,
    shell::Shell,
    vessel::Vessel,
    weapons::Ammunition,
};
use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

fn actors() -> Vec<Vessel> {
    static SHIP: OnceLock<Arc<naval_sim::vessel::CompiledShip>> = OnceLock::new();
    let ship = SHIP.get_or_init(|| {
        let catalog =
            Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap())
                .unwrap();
        Arc::new(catalog.compile("bismarck").unwrap())
    });
    vec![
        Vessel::new("own", TeamId::A, ship.clone()),
        Vessel::new("enemy", TeamId::B, ship.clone()),
    ]
}

fn impact(id: i64, kind: &str, outcome: &str, damage: f64) -> DamageEvent {
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
            kind: kind.into(),
            outcome: outcome.into(),
            hull_damage: Some(damage),
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn source(records: &mut Records, id: i64, owner: &str) {
    records.sources.insert(
        id,
        WeaponSource {
            owner_id: owner.into(),
            label: "AP shell".into(),
            ammunition: Default::default(),
            damage: 100.0,
        },
    );
}

#[test]
fn armor_scores_once_per_shell_after_its_delayed_damage_finishes() {
    let actors = actors();
    let mut records = Records::default();
    records.begin_tick(&actors);
    source(&mut records, 1, "enemy");
    records.event(&impact(1, "armor", "ricochet", 0.0), 1, &actors);
    records.event(&impact(1, "mount", "stopped", 0.0), 2, &actors);
    records.finish_tick(&actors, &[1]);
    assert_eq!(records.scores["own"].armor_blocked, 0.0);
    // A lodged fuze still explodes: that hull damage was not blocked.
    records.event(
        &impact(1, "burst", "detonation", 25.0 * HULL_HP_SCALE),
        3,
        &actors,
    );
    records.finish_tick(&actors, &[]);
    assert_eq!(records.scores["own"].armor_blocked, 75.0 * HULL_HP_SCALE);
    assert_eq!(records.scores["enemy"].damage_dealt, 25.0 * HULL_HP_SCALE);
    records.finish_tick(&actors, &[]);
    assert_eq!(records.scores["own"].armor_blocked, 75.0 * HULL_HP_SCALE);
    assert_eq!(Records::default().scores.len(), 0);
}

#[test]
fn only_hostile_armor_rejections_on_live_hulls_count() {
    let mut actors = actors();
    let mut records = Records::default();
    records.begin_tick(&actors);
    for (id, kind, outcome, owner) in [
        (1, "armor", "stopped", "enemy"),
        (2, "armor", "penetrated", "enemy"),
        (3, "module", "stopped", "enemy"),
        (4, "armor", "ricochet", "own"),
    ] {
        source(&mut records, id, owner);
        records.event(&impact(id, kind, outcome, 0.0), 1, &actors);
    }
    source(&mut records, 5, "enemy");
    let mut wreckage = impact(5, "mount", "stopped", 0.0);
    wreckage.impact.as_mut().unwrap().through_wreckage = Some(true);
    records.event(&wreckage, 1, &actors);
    records.finish_tick(&actors, &[]);
    assert_eq!(records.scores["own"].armor_blocked, 100.0 * HULL_HP_SCALE);
    assert_eq!(records.scores["enemy"].armor_blocked, 0.0);
    actors[0].damage.integrity = 0.0;
    records.begin_tick(&actors);
    source(&mut records, 6, "enemy");
    records.event(&impact(6, "armor", "stopped", 0.0), 2, &actors);
    records.finish_tick(&actors, &[]);
    assert_eq!(records.scores["own"].armor_blocked, 100.0 * HULL_HP_SCALE);
}

#[test]
fn yamato_armor_counts_real_ap_and_he_impacts() {
    let catalog = Arc::new(
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap(),
    );
    let compiled = ["yamato", "bismarck"]
        .into_iter()
        .map(|id| (id.to_owned(), Arc::new(catalog.compile(id).unwrap())))
        .collect();
    for ammunition in [Ammunition::Ap, Ammunition::He] {
        let setup: BattleSetup = serde_json::from_value(serde_json::json!({
            "ships": [
                {"id":"own","presetId":"yamato","team":"a","controller":"player","aiLevel":"normal","spawn":{"x":0,"z":0,"heading":0}},
                {"id":"enemy","presetId":"bismarck","team":"b","controller":"player","aiLevel":"normal","spawn":{"x":2000,"z":0,"heading":0}}
            ], "seed":54321,"mapId":"north-atlantic","weather":"clear","spawnDistance":5000,"windSpeed":0
        })).unwrap();
        let mut battle = Battle::new(catalog.clone(), &compiled, setup).unwrap();
        let weapon = &catalog.definitions["bismarck"]
            .mounts
            .iter()
            .find(|m| m.weapon.caliber_m == 0.15)
            .unwrap()
            .weapon;
        let position =
            naval_sim::geometry::local_to_world([30.0, 2.0, 0.0], battle.actors[0].motion.pose());
        battle.shells.push(Shell {
            id: 90001,
            owner_id: "enemy".into(),
            position,
            velocity: [-weapon.muzzle_speed, 0.0, 0.0],
            damage: weapon.damage,
            caliber_m: weapon.caliber_m,
            ammunition: Some(ammunition),
            penetration_mm: if ammunition == Ammunition::Ap {
                weapon.penetration_mm
            } else {
                0.0
            },
            ap: (ammunition == Ammunition::Ap)
                .then(|| weapon.ap.clone())
                .flatten(),
            he: (ammunition == Ammunition::He)
                .then(|| weapon.he.clone())
                .flatten(),
            ..Default::default()
        });
        for _ in 0..120 {
            battle.step(&BTreeMap::new());
            if battle.shells.is_empty() {
                break;
            }
        }
        let impacts: Vec<_> = battle
            .events
            .iter()
            .filter_map(|e| e.data.impact.as_ref())
            .collect();
        assert!(!impacts.is_empty(), "the shell must strike Yamato");
        assert!(
            impacts
                .iter()
                .any(|i| i.target_name == "Starboard main belt"
                    && i.resistance_mm.unwrap_or(0.0) >= 410.0)
        );
        if ammunition == Ammunition::He {
            assert!(
                impacts
                    .iter()
                    .any(|i| i.outcome == "detonation" && i.fragment_budget_mm == Some(25.0))
            );
        }
        assert!(
            battle.shells.is_empty(),
            "the score waits for the shell to finish"
        );
        let potential = if ammunition == Ammunition::He {
            weapon.he.as_ref().unwrap().damage
        } else {
            weapon.damage
        } * HULL_HP_SCALE;
        let dealt: f64 = impacts.iter().map(|i| i.hull_damage.unwrap_or(0.0)).sum();
        assert_eq!(
            battle.records.scores["own"].armor_blocked,
            potential - dealt,
            "{ammunition:?} stopped by Yamato should score the correct ammunition's prevented damage"
        );
        let frame = serde_json::to_value(battle.full_frame(&[])).unwrap();
        assert_eq!(
            frame["records"]["scores"]["own"]["armorBlocked"],
            potential - dealt
        );
    }
}

#[test]
fn he_scoring_requires_armor_to_reject_fragments_and_deducts_burst_damage() {
    let actors = actors();
    let mut records = Records::default();
    records.begin_tick(&actors);
    for (id, fragments, resistance, ammunition) in [
        (1, Some(25.0), Some(410.0), Ammunition::He),
        (2, Some(25.0), Some(10.0), Ammunition::He),
        (3, Some(25.0), Some(0.0), Ammunition::He),
        (4, Some(25.0), None, Ammunition::He),
        (5, None, Some(410.0), Ammunition::He),
        (6, Some(25.0), Some(410.0), Ammunition::Ap),
    ] {
        source(&mut records, id, "enemy");
        records.sources.get_mut(&id).unwrap().ammunition = ammunition;
        let mut event = impact(id, "armor", "detonation", 0.0);
        event.impact.as_mut().unwrap().fragment_budget_mm = fragments;
        event.impact.as_mut().unwrap().resistance_mm = resistance;
        records.event(&event, 1, &actors);
    }
    records.event(
        &impact(1, "burst", "detonation", 30.0 * HULL_HP_SCALE),
        1,
        &actors,
    );
    records.finish_tick(&actors, &[]);
    assert_eq!(records.scores["own"].armor_blocked, 70.0 * HULL_HP_SCALE);
    records.finish_tick(&actors, &[]);
    assert_eq!(records.scores["own"].armor_blocked, 70.0 * HULL_HP_SCALE);
}

#[test]
fn he_gunhouse_contact_reports_the_armor_that_rejects_its_fragments() {
    let mut actors = actors();
    let compiled = actors[0].compiled.clone();
    let def = &compiled.definition;
    let mount = &def.mounts[0];
    let mut shell = Shell {
        id: 1,
        owner_id: "enemy".into(),
        velocity: [-800.0, 0.0, 0.0],
        caliber_m: mount.weapon.caliber_m,
        ammunition: Some(Ammunition::He),
        he: mount.weapon.he.clone(),
        ..Default::default()
    };
    let contact = ShipContact {
        t: 0.0,
        key: "gunhouse".into(),
        kind: ContactKind::Mount,
        index: 0,
        point: mount.position,
        normal: [1.0, 0.0, 0.0],
        on_edge: false,
        seam_keys: vec![],
        armor: None,
    };
    let (_, event) = resolve_ship_contact(
        &mut shell,
        &contact,
        &mut actors[0],
        def,
        Some([-1.0, 0.0, 0.0]),
    );
    let evidence = event.impact.as_ref().unwrap();
    assert_eq!(evidence.resistance_mm, Some(mount.weapon.armor_mm));
    assert!(evidence.fragment_budget_mm.unwrap() < evidence.resistance_mm.unwrap());
    let mut records = Records::default();
    records.begin_tick(&actors);
    source(&mut records, 1, "enemy");
    records.sources.get_mut(&1).unwrap().ammunition = Ammunition::He;
    records.event(&event, 1, &actors);
    records.finish_tick(&actors, &[]);
    assert_eq!(records.scores["own"].armor_blocked, 100.0 * HULL_HP_SCALE);
}
