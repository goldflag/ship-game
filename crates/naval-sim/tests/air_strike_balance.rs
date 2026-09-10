use naval_sim::{
    aircraft::AirOrder,
    aircraft_flight::FlightAttitude,
    battle::{Battle, BattleSetup, Orders, ShipSetup, Spawn},
    bots::AiLevel,
    catalog::Catalog,
    gunnery::PlayerGunOrders,
    motion::HelmCommand,
    navigation::WeaponsPolicy,
    projectile::advance_projectile,
    rules::TeamId,
    sensors::{self, VisualConditions, VisualRules},
    shell::Shell,
    torpedoes::{Torpedo, damage_torpedo_hit, first_torpedo_hit},
    vessel::{CompiledShip, Controller, Vessel},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, OnceLock},
};

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
fn compiled(id: &str) -> Arc<CompiledShip> {
    Arc::new(CompiledShip::new(catalog().definitions[id].clone()).unwrap())
}

fn bomb_at(a: &mut [Vessel], id: i64, is_bomb: bool) -> f64 {
    let c = catalog();
    let b = c.aircraft["sbd-3-dauntless"].bomb.as_ref().unwrap();
    let d = a[0].definition();
    let mut s = Shell {
        id,
        owner_id: "attacker".into(),
        position: [d.hull.beam * 0.3, 80.0, d.hull.length * 0.15],
        velocity: [0.0, -110.0, 0.0],
        damage: b.he.damage,
        caliber_m: b.caliber_m,
        he: Some(b.he.clone()),
        shell_type: Some("HE".into()),
        bomb: is_bomb.then_some(FlightAttitude {
            heading: 0.0,
            pitch: -1.0,
            bank: 0.0,
        }),
        ..Default::default()
    };
    let before = a[0].damage.integrity;
    for _ in 0..300 {
        if advance_projectile(&mut s, a, 1.0 / 60.0, &[], &[], &|_, _| 0.0)
            .0
            .is_some()
        {
            break;
        }
    }
    before - a[0].damage.integrity
}

#[test]
fn bomb_blast_reaches_underlying_structure_without_changing_shell_he() {
    let ship = compiled("enterprise-cv6");
    let mut shells = vec![Vessel::new("target", TeamId::A, ship.clone())];
    let shell_damage = bomb_at(&mut shells, 1, false);
    assert_eq!(
        shell_damage, 830.0,
        "ordinary HE keeps existing local damage rules"
    );
    let mut bombs = vec![Vessel::new("target", TeamId::A, ship)];
    let first = bomb_at(&mut bombs, 1, true);
    let second = bomb_at(&mut bombs, 2, true);
    assert!(
        first > 1400.0,
        "bomb damage confined to a tiny deck region: {first}"
    );
    assert!(
        second > 100.0 && second < first,
        "underlying structure remains damageable but saturates: {first}/{second}"
    );
    assert!(
        first < 6650.0,
        "one bomb must retain a finite overall hull budget"
    );
}

#[test]
fn six_aerial_torpedoes_leave_a_healthy_capital_ship_fighting() {
    let c = catalog();
    let w = c.aircraft["tbd-1-devastator"].torpedo.as_ref().unwrap();
    for sid in ["enterprise-cv6", "iowa", "bismarck"] {
        let ship = compiled(sid);
        let mut a = Vessel::new("target", TeamId::A, ship.clone());
        for (id, z) in [-0.3, -0.18, -0.06, 0.06, 0.18, 0.3]
            .into_iter()
            .enumerate()
        {
            let from = [100.0, -2.0, ship.definition.hull.length * z];
            let t = Torpedo {
                id: id as i64,
                owner_id: "attacker".into(),
                tube_id: "air".into(),
                position: from,
                velocity: [-25.3, 0.0, 0.0],
                distance: 500.0,
                age: 20.0,
                weapon: w.clone(),
            };
            let (_, point, _, _) = first_torpedo_hit(
                &t,
                from,
                [-100.0, from[1], from[2]],
                std::slice::from_ref(&a),
            )
            .unwrap();
            damage_torpedo_hit(&mut a, &ship.definition, point, w, id as i64);
        }
        let remaining = a.damage.integrity / a.damage.max_integrity;
        assert!(
            remaining > 0.35,
            "{sid} almost destroyed by one six-plane wave: remaining={remaining}"
        );
        assert!(
            a.damage.compartments.iter().any(|c| c.breach_area_m2 > 0.0),
            "torpedoes retain flooding consequences"
        );
    }
}

fn strike(preset: &str, role: &str, moving: bool, seed: u32) -> (usize, usize) {
    let c = catalog();
    let ships = [preset, "enterprise-cv6"]
        .into_iter()
        .map(|id| (id.into(), compiled(id)))
        .collect();
    let setup = BattleSetup {
        ships: vec![
            ShipSetup {
                id: "defender".into(),
                preset_id: preset.into(),
                team: TeamId::A,
                controller: Controller::Player,
                ai_level: AiLevel::Static,
                spawn: Some(Spawn {
                    x: 0.0,
                    z: 0.0,
                    heading: 0.0,
                }),
            },
            ShipSetup {
                id: "attacker".into(),
                preset_id: "enterprise-cv6".into(),
                team: TeamId::B,
                controller: Controller::Player,
                ai_level: AiLevel::Static,
                spawn: Some(Spawn {
                    x: 14000.0,
                    z: 0.0,
                    heading: 0.0,
                }),
            },
        ],
        seed,
        map_id: "north-atlantic".into(),
        weather: "clear".into(),
        spawn_distance: 14000.0,
        wind_speed: Some(0.0),
        mission_rules: Some(c.missions["pve-fleet-v1"].clone()),
        air_rules: Some(c.air_profiles["pve-air-v1"].clone()),
    };
    let mut b = Battle::new(c.clone(), &ships, setup).unwrap();
    b.islands.clear();
    b.sea.amplitude_m = 0.0;
    let throttle = if moving { 0.8 } else { 0.0 };
    b.actors[0].motion.speed = b.actors[0].definition().handling.forward_speed * throttle;
    let squadron = b.actors[1]
        .definition()
        .air_wing
        .as_ref()
        .unwrap()
        .squadrons
        .iter()
        .find(|s| s.role == role)
        .unwrap()
        .id
        .clone();
    assert_eq!(
        b.aviation.launch_squadron(
            &b.actors[1],
            &squadron,
            None,
            Some(AirOrder::Patrol {
                point: [-6000.0, 850.0, 0.0]
            }),
            &b.actors,
            None,
            None
        ),
        6
    );
    let mut ids = vec![];
    for (slot, p) in b
        .aviation
        .wing_mut("attacker")
        .unwrap()
        .planes
        .iter_mut()
        .filter(|p| p.phase == "queued")
        .enumerate()
    {
        p.phase = "outbound".into();
        p.deck_slot = None;
        p.deck_position = None;
        p.deck_datum = None;
        p.position = [
            5000.0 + (slot.div_ceil(2) * 27) as f64,
            if role == "dive-bomber" { 850.0 } else { 90.0 },
            if slot == 0 {
                0.0
            } else {
                (slot.div_ceil(2) * 32) as f64 * if slot % 2 == 0 { 1.0 } else { -1.0 }
            },
        ];
        p.previous_position = p.position;
        p.velocity = [-85.0, 0.0, 0.0];
        p.heading = -std::f64::consts::FRAC_PI_2;
        p.pitch = 0.0;
        p.bank = 0.0;
        p.controls.gear = 0.0;
        p.flight_time = 30.0;
        ids.push(p.id.clone());
    }
    let conditions = VisualConditions::resolve(&c, "north-atlantic", "clear");
    for tick in (0..=360).step_by(60) {
        b.sensors.update(
            tick,
            &sensors::entities(&b.actors, &b.aviation),
            &[],
            &[],
            conditions,
            &VisualRules::default(),
        );
    }
    b.tick = 360;
    let contact = b.sensors.track(TeamId::B, "defender").unwrap().id.clone();
    let flight = b
        .aviation
        .wing("attacker")
        .unwrap()
        .flights
        .iter()
        .find(|f| f.plane_ids.contains(&ids[0]))
        .unwrap()
        .id
        .clone();
    assert!(b.command_air(
        "attacker",
        &flight,
        AirOrder::Strike {
            contact_id: contact
        }
    ));
    let orders: BTreeMap<_, _> = ["attacker", "defender"]
        .into_iter()
        .map(|id| {
            (
                id.into(),
                Orders {
                    helm: Some(HelmCommand {
                        throttle: if id == "defender" { throttle } else { 0.0 },
                        ..Default::default()
                    }),
                    guns: Some(PlayerGunOrders {
                        battery: "primary".into(),
                        weapon_group_id: None,
                        aim: None,
                        fire: false,
                        ammunition: BTreeMap::new(),
                    }),
                    weapons: WeaponsPolicy {
                        guns: false,
                        aa: false,
                        torpedoes: false,
                    },
                    ..Default::default()
                },
            )
        })
        .collect();
    let mut releases = BTreeSet::new();
    let mut hits = BTreeSet::new();
    for _ in 0..180 * 60 {
        b.outcome = None;
        b.step(&orders);
        for event in b.events.drain(..) {
            let e = event.data;
            if e.kind == "bomb-release" {
                releases.insert(e.shell.unwrap().id);
            } else if e.kind == "torpedo-launch" {
                releases.insert(e.torpedo.unwrap().id);
            } else if e.ship_id == "defender" && e.kind == "contact" {
                hits.insert(e.impact.unwrap().shell_id);
            } else if e.ship_id == "defender" && e.kind == "torpedo-hit" {
                hits.insert(e.torpedo.unwrap().id);
            }
        }
    }
    (releases.len(), hits.len())
}

#[test]
fn torpedo_bombers_establish_a_release_run_against_fast_straight_targets() {
    for target in ["fletcher", "bismarck"] {
        let (released, hits) = strike(target, "torpedo-bomber", true, 5739);
        assert!(
            released >= 4 && hits >= 1,
            "{target}: {released} released, {hits} hits"
        );
    }
}

#[test]
fn bombers_can_hit_small_stationary_ships_without_guaranteed_hits() {
    for target in ["flower-corvette", "fletcher"] {
        let mut hits = 0;
        let mut releases = 0;
        for seed in [1, 5739, 98765] {
            let (r, h) = strike(target, "dive-bomber", false, seed);
            releases += r;
            hits += h;
        }
        assert!(releases >= 15, "{target}: only {releases} released");
        assert!(
            hits >= 5 && hits < releases,
            "{target}: {hits}/{releases} hit; small ships must be viable, fallible targets"
        );
    }
}
