//! Surface controls sample at 10 Hz; clocks, damage, ships and projectiles
//! keep advancing on the fixed battle tick.
use naval_sim::{
    battle::{Battle, BattleSetup, Orders},
    catalog::Catalog,
    geometry::radians,
    gunnery::{PlayerGunOrders, SURFACE_CONTROL_TICKS},
    rules::DT,
    weapons::MountStatus,
};
use std::{collections::BTreeMap, sync::Arc};

fn battle() -> Battle {
    let catalog = Arc::new(
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap(),
    );
    let compiled = BTreeMap::from([(
        "fletcher".into(),
        Arc::new(catalog.compile("fletcher").unwrap()),
    )]);
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships": [
            {"id":"own","presetId":"fletcher","team":"a","controller":"player","aiLevel":"normal",
             "spawn":{"x":0,"z":0,"heading":0}},
            {"id":"enemy","presetId":"fletcher","team":"b","controller":"bot","aiLevel":"static",
             "spawn":{"x":0,"z":-12000,"heading":0}}
        ],
        "seed":17,"mapId":"north-atlantic","weather":"clear","windSpeed":0,"spawnDistance":12000
    }))
    .unwrap();
    Battle::new(catalog, &compiled, setup).unwrap()
}
fn orders(x: f64) -> BTreeMap<String, Orders> {
    BTreeMap::from([(
        "own".into(),
        Orders {
            guns: Some(PlayerGunOrders {
                battery: "main".into(),
                weapon_group_id: None,
                aim: Some([x, 10., -2000.]),
                fire: false,
                ammunition: Default::default(),
            }),
            ..Default::default()
        },
    )])
}

#[test]
fn controls_update_within_100_ms_while_reload_stays_at_60_hz() {
    let mut battle = battle();
    let index = battle.actors[0]
        .definition()
        .mounts
        .iter()
        .position(|m| m.battery == "main")
        .unwrap();
    let max_step = radians(
        battle.actors[0].definition().mounts[index]
            .weapon
            .traverse_rate_deg,
    ) * DT;
    battle.actors[0].mounts[index].reload = 10.;
    battle.step(&orders(1500.));
    let initial = battle.actors[0].mounts[index].aim_cache.clone().unwrap();
    let mut previous = battle.actors[0].mounts[index].clone();
    for _ in 1..SURFACE_CONTROL_TICKS {
        battle.step(&orders(-1500.));
        let mount = &battle.actors[0].mounts[index];
        assert_eq!(mount.aim_cache.as_ref().unwrap().point, initial.point);
        assert_eq!(
            mount.train, previous.train,
            "surface slew waits for the next control tick"
        );
        assert!(mount.train - previous.train <= max_step + 1e-12);
        assert!(
            mount.reload < previous.reload,
            "reload must advance every tick"
        );
        previous = mount.clone();
    }
    battle.step(&orders(-1500.));
    let mount = &battle.actors[0].mounts[index];
    assert!(mount.aim_cache.as_ref().unwrap().train < 0.);
    assert!(
        mount.train < previous.train,
        "new aim must be acted on at 100 ms"
    );
    assert!(previous.train - mount.train <= max_step * SURFACE_CONTROL_TICKS as f64 + 1e-12);
    assert_eq!(battle.tick, SURFACE_CONTROL_TICKS + 1);
}

#[test]
fn damage_stops_a_gun_between_aim_decisions() {
    let mut battle = battle();
    battle.step(&orders(1500.));
    let mount = &mut battle.actors[0].mounts[0];
    let train = mount.train;
    mount.hp = 0.;
    battle.step(&orders(-1500.));
    let mount = &battle.actors[0].mounts[0];
    assert_eq!(mount.train, train);
    assert_eq!(mount.status, MountStatus::Disabled);
}

#[test]
fn shots_use_fresh_decisions_but_shells_keep_moving_between_them() {
    let mut battle = battle();
    let mut firing = orders(0.);
    firing.get_mut("own").unwrap().guns.as_mut().unwrap().fire = true;
    let mut shots = 0;
    let mut moving_ticks = 0;
    for _ in 0..600 {
        let tick = battle.tick;
        let before = battle.shells.first().map(|s| (s.id, s.position));
        battle.step(&firing);
        for event in &battle.events {
            if event.tick == tick && event.data.ship_id == "own" && event.data.kind == "shot" {
                assert_eq!(
                    tick % SURFACE_CONTROL_TICKS,
                    0,
                    "surface shot used a held aim"
                );
                shots += 1;
            }
        }
        if !tick.is_multiple_of(SURFACE_CONTROL_TICKS)
            && let Some((id, position)) = before
            && let Some(shell) = battle.shells.iter().find(|s| s.id == id)
        {
            assert_ne!(shell.position, position);
            moving_ticks += 1;
        }
    }
    assert!(shots >= 2, "the test must exercise firing");
    assert!(
        moving_ticks > 10,
        "projectiles must advance between decisions"
    );
    firing.get_mut("own").unwrap().guns.as_mut().unwrap().fire = false;
    for _ in 0..SURFACE_CONTROL_TICKS * 2 {
        let tick = battle.tick;
        battle.step(&firing);
        assert!(
            !battle
                .events
                .iter()
                .any(|e| e.tick == tick && e.data.ship_id == "own" && e.data.kind == "shot")
        );
    }
}

#[test]
fn a_one_tick_fire_press_is_not_lost_between_control_ticks() {
    let mut battle = battle();
    let idle = orders(0.);
    for _ in 0..600 {
        battle.step(&idle);
    }
    // Deliver the press just after a control update, as requestFire can do.
    battle.step(&idle);
    assert_eq!(battle.tick % SURFACE_CONTROL_TICKS, 1);
    let mut press = idle.clone();
    press.get_mut("own").unwrap().guns.as_mut().unwrap().fire = true;
    let request_tick = battle.tick;
    battle.step(&press);
    for _ in 1..SURFACE_CONTROL_TICKS {
        battle.step(&idle);
    }
    assert!(
        battle.events.iter().any(|e| e.tick >= request_tick
            && e.tick < request_tick + SURFACE_CONTROL_TICKS
            && e.data.ship_id == "own"
            && e.data.kind == "shot"),
        "a brief press must fire at the next control tick"
    );
    let shot_count = battle.sequence;
    for _ in 0..600 {
        battle.step(&idle);
    }
    assert_eq!(
        battle.sequence, shot_count,
        "the press must be consumed once"
    );
}
