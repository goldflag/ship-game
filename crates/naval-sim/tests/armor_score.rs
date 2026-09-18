use naval_sim::{
    catalog::Catalog,
    damage::HULL_HP_SCALE,
    impact::{DamageEvent, ImpactRecord, ShellEffect},
    records::{Records, WeaponSource},
    rules::TeamId,
    shell::Shell,
    vessel::Vessel,
};
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
