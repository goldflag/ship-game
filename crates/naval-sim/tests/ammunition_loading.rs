//! A gun that carries only HE (the Japanese 12.7 cm and 25 mm mounts) has no
//! AP to load. It must start loaded with what it carries, and the client's
//! default AP order must not leave it empty.
use naval_sim::{
    battle::{Battle, BattleSetup, Orders},
    catalog::Catalog,
    gunnery::PlayerGunOrders,
    weapons::{Ammunition, MountStatus},
};
use std::{collections::BTreeMap, sync::Arc};

fn takao_battle() -> Battle {
    let catalog = Catalog::installed();
    let compiled = BTreeMap::from([
        (
            "takao".to_owned(),
            Arc::new(catalog.compile("takao").unwrap()),
        ),
        (
            "fletcher".to_owned(),
            Arc::new(catalog.compile("fletcher").unwrap()),
        ),
    ]);
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships": [
            {"id":"own","presetId":"takao","team":"a","controller":"player","aiLevel":"normal","spawn":{"x":0,"z":0,"heading":0}},
            {"id":"enemy","presetId":"fletcher","team":"b","controller":"bot","aiLevel":"static","spawn":{"x":4000,"z":0,"heading":0}}
        ],
        "seed":54321,"mapId":"north-atlantic","weather":"clear","spawnDistance":16000,"windSpeed":0
    }))
    .unwrap();
    Battle::new(catalog.clone(), &compiled, setup).unwrap()
}

/// Indices of the player's mounts that carry HE and no AP.
fn he_only(battle: &Battle) -> Vec<usize> {
    let own = &battle.actors[0];
    own.compiled
        .definition
        .mounts
        .iter()
        .enumerate()
        .filter(|(i, m)| own.mounts[*i].available(Ammunition::Ap) < m.weapon.barrel_count)
        .map(|(i, _)| i)
        .collect()
}

#[test]
fn he_only_mounts_start_loaded_with_he() {
    let battle = takao_battle();
    let own = &battle.actors[0];
    let he_only = he_only(&battle);
    assert!(!he_only.is_empty(), "Takao's HA and AA guns carry HE only");
    for i in he_only {
        let m = &own.compiled.definition.mounts[i];
        assert_eq!(own.mounts[i].loaded, Ammunition::He, "{} loaded", m.id);
        assert!(
            own.mounts[i].available(own.mounts[i].loaded) >= m.weapon.barrel_count,
            "{} starts with nothing loadable",
            m.id
        );
    }
}

#[test]
fn the_default_ap_order_does_not_empty_he_only_secondaries() {
    let mut battle = takao_battle();
    let he_only = he_only(&battle);
    let start: Vec<f64> = he_only
        .iter()
        .map(|&i| battle.actors[0].mounts[i].ammo)
        .collect();
    // What the client sends each tick with the secondary battery selected and
    // no shell chosen yet: AP, keyed by the battery.
    let orders = BTreeMap::from([(
        "own".to_owned(),
        Orders {
            guns: Some(PlayerGunOrders {
                battery: "secondary".into(),
                weapon_group_id: None,
                aim: Some([4000.0, 0.0, 0.0]),
                fire: true,
                ammunition: BTreeMap::from([("secondary".to_owned(), Ammunition::Ap)]),
            }),
            ..Default::default()
        },
    )]);
    for _ in 0..30 * 60 {
        battle.outcome = None;
        battle.step(&orders);
    }
    let own = &battle.actors[0];
    for &i in &he_only {
        let m = &own.compiled.definition.mounts[i];
        assert_ne!(
            own.mounts[i].status,
            MountStatus::Empty,
            "{} reads empty",
            m.id
        );
    }
    let fired = he_only
        .iter()
        .zip(&start)
        .filter(|&(&i, &ammo)| own.mounts[i].ammo < ammo)
        .count();
    assert!(fired > 0, "no HE-only secondary fired on the beam target");
}
