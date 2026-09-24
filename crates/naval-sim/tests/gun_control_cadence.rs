//! Surface controls sample at 10 Hz; clocks, damage, ships and projectiles
//! keep advancing on the fixed battle tick.
use naval_sim::{
    battle::{Battle, BattleSetup, Orders},
    catalog::Catalog,
    geometry::{length, radians, sub},
    gunnery::{PlayerGunOrders, SURFACE_CONTROL_TICKS},
    rules::DT,
    weapons::{MountStatus, shot_direction},
};
use std::{collections::BTreeMap, sync::Arc};

fn battle() -> Battle {
    battle_in(0.)
}
fn battle_in(wind: f64) -> Battle {
    let catalog = Catalog::installed();
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
        "seed":17,"mapId":"north-atlantic","weather":"clear","windSpeed":wind,"spawnDistance":12000
    }))
    .unwrap();
    Battle::new(catalog, &compiled, setup).unwrap()
}
fn orders(x: f64) -> BTreeMap<String, Orders> {
    orders_at([x, 10., -2000.])
}
fn orders_at(aim: [f64; 3]) -> BTreeMap<String, Orders> {
    BTreeMap::from([(
        "own".into(),
        Orders {
            guns: Some(PlayerGunOrders {
                battery: "main".into(),
                weapon_group_id: None,
                aim: Some(aim),
                fire: false,
                ammunition: Default::default(),
            }),
            ..Default::default()
        },
    )])
}

#[test]
fn a_new_aim_waits_for_the_next_decision_while_the_gun_moves_every_tick() {
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
    let mut moved = 0;
    for _ in 1..SURFACE_CONTROL_TICKS {
        battle.step(&orders(-1500.));
        let mount = &battle.actors[0].mounts[index];
        assert_eq!(mount.aim_cache.as_ref().unwrap().point, initial.point);
        assert!(
            mount.train >= previous.train,
            "the new order must wait for the next decision"
        );
        assert!(mount.train - previous.train <= max_step + 1e-12);
        if mount.train > previous.train {
            moved += 1;
        }
        assert!(
            mount.reload < previous.reload,
            "reload must advance every tick"
        );
        previous = mount.clone();
    }
    assert_eq!(
        moved,
        SURFACE_CONTROL_TICKS - 1,
        "a laid gun keeps training toward the last decision every tick"
    );
    battle.step(&orders(-1500.));
    let mount = &battle.actors[0].mounts[index];
    assert!(mount.aim_cache.as_ref().unwrap().train < 0.);
    assert!(
        mount.train < previous.train,
        "new aim must be acted on at 100 ms"
    );
    assert!(
        previous.train - mount.train <= max_step + 1e-12,
        "a decision spends only its own tick of slew time"
    );
    assert_eq!(battle.tick, SURFACE_CONTROL_TICKS + 1);
}

#[test]
fn a_laid_gun_holds_its_line_of_fire_while_the_hull_rolls() {
    let mut battle = battle_in(16.);
    let aim = orders_at([5000., 0.5, 0.]);
    for _ in 0..30 * 60 {
        battle.step(&aim);
    }
    let index = battle.actors[0]
        .definition()
        .mounts
        .iter()
        .position(|m| m.battery == "main")
        .unwrap();
    let bore = |b: &Battle| {
        let a = &b.actors[0];
        shot_direction(
            &a.definition().mounts[index],
            &a.mounts[index],
            a.motion.pose(),
        )
    };
    let (mut decided, mut roll) = (bore(&battle), battle.actors[0].motion.roll);
    let (mut drift, mut rolled) = (0f64, 0f64);
    for _ in 0..10 * 60 {
        let tick = battle.tick;
        battle.step(&aim);
        let (now, hull) = (bore(&battle), battle.actors[0].motion.roll);
        if tick.is_multiple_of(SURFACE_CONTROL_TICKS) {
            (decided, roll) = (now, hull);
            continue;
        }
        drift = drift.max(length(sub(now, decided)));
        rolled = rolled.max((hull - roll).abs());
    }
    assert!(
        rolled > 1e-3,
        "the sea must roll the hull between decisions: {rolled}"
    );
    // Gunnery lays against the attitude at the start of the tick and the hull
    // settles after it, so only the change in one tick's rotation remains.
    assert!(
        drift * 20. < rolled,
        "the barrels ride the deck between decisions: {drift} rad against {rolled} rad of roll"
    );
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
