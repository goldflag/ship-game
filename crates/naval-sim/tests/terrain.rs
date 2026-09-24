//! The baked real-world charts in battle: ray queries on real coasts, route
//! planning through them, legal default and mission deployments on every map,
//! spawn admission near land and grounding against a real shore.
use naval_sim::{
    battle::{Battle, BattleSetup, Orders},
    catalog::Catalog,
    motion::HelmCommand,
    pve::{FleetShip, GroupStation, PvePlan, PveRequest, TaskGroup},
    rules::{Rules, TeamId},
    terrain::{DEPLOYMENT_CLEARANCE_M, Terrain},
    vessel::CompiledShip,
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
        let compiled = ["fletcher", "iowa"]
            .into_iter()
            .map(|id| (id.to_owned(), Arc::new(catalog.compile(id).unwrap())))
            .collect();
        (catalog, compiled)
    })
}
/// Every installed map that carries land, with its terrain id.
fn real_maps() -> Vec<(String, String)> {
    let catalog = &content().0;
    let maps: Vec<_> = catalog
        .map_ids()
        .unwrap()
        .into_iter()
        .filter_map(|map| {
            let terrain = catalog.map_terrain(&map).unwrap()?.to_owned();
            Some((map, terrain))
        })
        .collect();
    assert!(
        maps.len() >= 4,
        "the four baked charts are installed: {maps:?}"
    );
    maps
}
/// A custom battle's terrain: the chart centred between spawn lines `distance` apart.
fn custom_terrain(map: &str, distance: f64) -> Terrain {
    content()
        .0
        .resolve_environment(map, "clear", 1, 1, distance, Some(0.0))
        .unwrap()
        .terrain
}
struct Random(u64);
impl Random {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
    fn between(&mut self, low: f64, high: f64) -> f64 {
        low + (high - low) * self.next()
    }
}
/// The stepped rays without the relief pyramid, sample for sample.
fn stepped_first_hit(t: &Terrain, from: [f64; 3], to: [f64; 3]) -> Option<(f64, [f64; 3])> {
    let point = |s: f64| {
        [
            from[0] + (to[0] - from[0]) * s,
            from[1] + (to[1] - from[1]) * s,
            from[2] + (to[2] - from[2]) * s,
        ]
    };
    let solid = |p: [f64; 3]| p[1] <= t.height(p[0], p[2]);
    let steps = ((to[0] - from[0]).hypot(to[2] - from[2]) / 20.0)
        .ceil()
        .max(1.0) as usize;
    if solid(from) {
        return Some((0.0, from));
    }
    let i = (1..=steps).find(|&i| solid(point(i as f64 / steps as f64)))?;
    let (mut a, mut b) = ((i - 1) as f64 / steps as f64, i as f64 / steps as f64);
    for _ in 0..16 {
        let mid = (a + b) / 2.0;
        if solid(point(mid)) {
            b = mid;
        } else {
            a = mid;
        }
    }
    Some((b, point(b)))
}
fn stepped_visible(t: &Terrain, from: [f64; 3], to: [f64; 3]) -> bool {
    let distance = (to[0] - from[0]).hypot(to[2] - from[2]);
    let steps = ((distance / 20.0).ceil() as usize).max(1);
    (0..=steps).all(|i| {
        let s = i as f64 / steps as f64;
        let y = from[1] + (to[1] - from[1]) * s
            - distance * distance * s * (1.0 - s) / (2.0 * 6_371_000.0);
        t.height(
            from[0] + (to[0] - from[0]) * s,
            from[2] + (to[2] - from[2]) * s,
        ) <= y
    })
}
/// The nearest spot to the lane's centre line along world z, east or west, where
/// land comes within `radius`: its x, and the sign of the way to the coast.
fn coast_on_line(t: &Terrain, z: f64, radius: f64) -> (f64, f64) {
    (0..1900)
        .flat_map(|k| [(k as f64 * 25.0, 1.0), (-(k as f64) * 25.0, -1.0)])
        .find(|&(x, _)| t.land_within(x, z, radius))
        .expect("the chart has a coast abeam of the lane")
}
/// Exact metres to the nearest land sample: every sample inside the window the
/// conservative clearance promises holds the answer.
fn exact_clearance(t: &Terrain, p: [f64; 2]) -> f64 {
    let f = t.field.as_ref().unwrap();
    let reach = t.clearance(p[0], p[1]) + 200.0;
    let chart = [p[0] - t.offset[0], p[1] - t.offset[1]];
    let span = |c: f64, origin: f64, count: usize| {
        let low = ((c - reach - origin) / f.cell).floor().max(0.0) as usize;
        let high = (((c + reach - origin) / f.cell).ceil().max(0.0) as usize).min(count - 1);
        low..=high
    };
    let mut best = f64::INFINITY;
    for j in span(chart[1], f.origin_z, f.rows) {
        for i in span(chart[0], f.origin_x, f.columns) {
            if f.sample_is_land(i, j) {
                let d = (f.origin_x + i as f64 * f.cell - chart[0])
                    .hypot(f.origin_z + j as f64 * f.cell - chart[1]);
                best = best.min(d);
            }
        }
    }
    best
}

#[test]
fn real_coasts_answer_rays_exactly_and_clearance_conservatively() {
    for (map, _) in real_maps() {
        let t = custom_terrain(&map, 5000.0);
        let mut r = Random(0x5eed ^ map.len() as u64);
        let (mut hits, mut blocked, mut probes) = (0, 0, 0);
        while probes < 4000 {
            let from = [
                r.between(-30000.0, 30000.0),
                r.between(-30.0, 600.0),
                r.between(-32500.0, 27500.0),
            ];
            // Keep the rays near a coast, where the pyramid has to descend.
            if t.clearance(from[0], from[2]) > 3000.0 {
                continue;
            }
            probes += 1;
            let (angle, length) = (r.between(0.0, 6.3), r.between(0.0, 12000.0));
            let to = [
                from[0] + length * angle.cos(),
                r.between(-30.0, 600.0),
                from[2] + length * angle.sin(),
            ];
            let hit = t.first_hit(from, to);
            assert_eq!(
                hit,
                stepped_first_hit(&t, from, to),
                "{map}: {from:?} to {to:?}"
            );
            hits += hit.is_some() as usize;
            let visible = t.line_visible(from, to);
            assert_eq!(
                visible,
                stepped_visible(&t, from, to),
                "{map}: {from:?} to {to:?}"
            );
            blocked += !visible as usize;
            // Exact near the coast (the corners' samples are then within 360 m),
            // a lower bound short by less than a node diagonal further out.
            let (bound, exact) = (
                t.clearance(from[0], from[2]),
                exact_clearance(&t, [from[0], from[2]]),
            );
            let slack = if exact < 190.0 { 1e-9 } else { 170.0 };
            assert!(
                bound <= exact + 1e-9 && exact - bound <= slack,
                "{map}: clearance {bound} against {exact} at {from:?}"
            );
        }
        assert!(
            hits > 400 && blocked > 400,
            "{map}: {hits} hits, {blocked} blocked"
        );
    }
}

#[test]
fn routes_through_real_coasts_keep_their_margin() {
    let margin = 208.0;
    for (map, _) in real_maps() {
        let t = content()
            .0
            .resolve_pve_environment(
                &map,
                "clear",
                1,
                &content().0.missions["pve-fleet-v1"],
                None,
            )
            .unwrap()
            .terrain;
        let mut r = Random(0xc0a57 ^ map.len() as u64);
        let (mut planned, mut detoured, mut asked) = (0, 0, 0);
        let started = std::time::Instant::now();
        while asked < 60 {
            let a = [r.between(-22000.0, 22000.0), r.between(-22000.0, 22000.0)];
            let b = [r.between(-22000.0, 22000.0), r.between(-22000.0, 22000.0)];
            if t.clearance(a[0], a[1]) < margin + 300.0 || t.clearance(b[0], b[1]) < margin + 300.0
            {
                continue;
            }
            asked += 1;
            let Some(path) = t.plan_path(a, b, margin) else {
                continue;
            };
            planned += 1;
            detoured += (path.len() > 1) as usize;
            assert_eq!(*path.last().unwrap(), b);
            let mut at = a;
            for p in &path {
                assert!(
                    t.segment_clear(at, *p, margin),
                    "{map}: leg {at:?} -> {p:?}"
                );
                // No leg ever crosses the land itself.
                let steps = ((p[0] - at[0]).hypot(p[1] - at[1]) / 20.0).ceil().max(1.0) as usize;
                for i in 0..=steps {
                    let s = i as f64 / steps as f64;
                    let q = [at[0] + (p[0] - at[0]) * s, at[1] + (p[1] - at[1]) * s];
                    assert!(
                        t.height(q[0], q[1]) < 0.0,
                        "{map}: leg crosses land at {q:?}"
                    );
                }
                at = *p;
            }
        }
        let per_plan = started.elapsed().as_secs_f64() * 1000.0 / asked as f64;
        eprintln!(
            "{map}: {planned}/{asked} routes, {detoured} around land, {per_plan:.2} ms a plan"
        );
        assert!(
            planned * 10 >= asked * 7,
            "{map}: only {planned} of {asked} routes"
        );
        assert!(detoured > 0, "{map}: no route needed a detour");
    }
}

fn line_setup(map: &str, per_side: usize, distance: f64) -> BattleSetup {
    let ships: Vec<_> = [("a", 0.0), ("b", std::f64::consts::PI)]
        .into_iter()
        .flat_map(|(team, _)| {
            (0..per_side).map(move |i| {
                serde_json::json!({"id": format!("{team}-{i}"), "presetId": "fletcher", "team": team,
                    "controller": "bot", "aiLevel": "normal", "spawn": null})
            })
        })
        .collect();
    serde_json::from_value(serde_json::json!({
        "ships": ships, "seed": 7, "mapId": map, "weather": "clear",
        "spawnDistance": distance, "windSpeed": null
    }))
    .unwrap()
}

#[test]
fn default_spawns_are_legal_on_every_real_map() {
    let (catalog, compiled) = content();
    let rules = Rules::default();
    for (map, _) in real_maps() {
        // Online: the server's fleet cap at its fixed spawn distance.
        let online = line_setup(&map, rules.max_vessels, rules.spawn_distance_m as f64);
        Battle::new(catalog.clone(), compiled, online)
            .unwrap_or_else(|e| panic!("{map} online: {e}"));
        // Custom: twelve a side in the default line, at every distance the slider reaches.
        for distance in [1000.0, 5000.0, 10000.0, 20000.0] {
            let setup = line_setup(&map, 12, distance);
            let battle = Battle::new(catalog.clone(), compiled, setup)
                .unwrap_or_else(|e| panic!("{map} at {distance} m: {e}"));
            assert_eq!(battle.terrain.offset, [0.0, -distance / 2.0]);
            for a in &battle.actors {
                assert!(!battle.terrain.land_within(
                    a.motion.x,
                    a.motion.z,
                    DEPLOYMENT_CLEARANCE_M
                ));
            }
        }
    }
}

#[test]
fn spawn_admission_names_the_ship_and_position_within_300_m_of_land() {
    let (catalog, compiled) = content();
    let (map, _) = real_maps().remove(0);
    let t = custom_terrain(&map, 5000.0);
    // Walk out along team a's spawn line to the first spot land is within 300 m.
    let (x, side) = coast_on_line(&t, 0.0, DEPLOYMENT_CLEARANCE_M);
    let setup = |x: f64| {
        let mut setup = line_setup(&map, 1, 5000.0);
        setup.ships[0].spawn = Some(
            serde_json::from_value(serde_json::json!({"x": x, "z": 0, "heading": 0})).unwrap(),
        );
        setup
    };
    let error = Battle::new(catalog.clone(), compiled, setup(x))
        .err()
        .unwrap();
    assert_eq!(
        error,
        format!(
            "Invalid fleet deployment: ship \"a-0\" at x {x}, z 0 (heading 0 rad) is within 300 m of land"
        )
    );
    Battle::new(catalog.clone(), compiled, setup(x - 100.0 * side)).unwrap();
}

#[test]
fn a_ship_driven_onto_a_real_coast_grounds_and_stays_off_the_land() {
    let (catalog, compiled) = content();
    for (map, _) in real_maps() {
        let t = custom_terrain(&map, 5000.0);
        let (x, side) = coast_on_line(&t, 0.0, 60.0);
        let mut setup = line_setup(&map, 1, 5000.0);
        setup.ships[0].controller = naval_sim::vessel::Controller::Player;
        setup.ships[0].preset_id = "iowa".into();
        // Full ahead, straight at the coast from 1.8 km off.
        setup.ships[0].spawn = Some(
            serde_json::from_value(serde_json::json!({
                "x": x - 1800.0 * side, "z": 0, "heading": side * std::f64::consts::FRAC_PI_2
            }))
            .unwrap(),
        );
        let mut battle = Battle::new(catalog.clone(), compiled, setup).unwrap();
        let orders = BTreeMap::from([(
            "a-0".to_owned(),
            Orders {
                helm: Some(HelmCommand {
                    throttle: 1.0,
                    ..Default::default()
                }),
                ..Default::default()
            },
        )]);
        let mut grounded = false;
        for _ in 0..60 * 150 {
            battle.step(&orders);
            let a = &battle.actors[0];
            grounded |= battle
                .events
                .iter()
                .any(|e| e.data.kind == "contact" && e.data.message.starts_with("Grounding"));
            // Resolution leaves every hull point above the ground it met.
            let basis = a.motion.basis();
            for p in &a.compiled.ground_points {
                let w = basis.local_to_world(*p);
                assert!(
                    battle.terrain.height(w[0], w[2]) < w[1] + 0.05,
                    "{map}: hull point {w:?} left inside the ground"
                );
            }
            assert!(
                battle.terrain.height(a.motion.x, a.motion.z) < 0.0,
                "{map}: beached amidships"
            );
        }
        assert!(grounded, "{map}: a full-speed battleship struck the coast");
        let a = &battle.actors[0];
        assert!(
            a.damage.integrity < a.damage.max_integrity,
            "{map}: grounding damage"
        );
        assert!(
            (a.motion.x - x) * side > -1000.0,
            "{map}: the ship reached the shore"
        );
    }
}

fn mission_request(map: &str, seed: u32) -> PveRequest {
    let ids = [
        ("iowa", "line"),
        ("bismarck", "line"),
        ("baltimore", "line"),
        ("baltimore", "line"),
        ("fletcher", "screen"),
        ("fletcher", "screen"),
        ("fletcher", "screen"),
        ("fletcher", "screen"),
        ("enterprise-cv6", "carriers"),
        ("fletcher", "carriers"),
        ("fletcher", "carriers"),
    ];
    PveRequest {
        version: 1,
        seed,
        map_id: map.into(),
        weather: "clear".into(),
        difficulty: naval_sim::bots::AiLevel::Normal,
        ships: ids
            .iter()
            .enumerate()
            .map(|(i, (preset, group))| FleetShip {
                id: format!("ship-{i}"),
                preset_id: (*preset).into(),
                group_id: (*group).into(),
            })
            .collect(),
        groups: [
            (
                "line",
                GroupStation::Front,
                naval_sim::navigation::Formation::DoubleColumn,
            ),
            (
                "screen",
                GroupStation::Front,
                naval_sim::navigation::Formation::LineAbreast,
            ),
            (
                "carriers",
                GroupStation::Rear,
                naval_sim::navigation::Formation::Screen,
            ),
        ]
        .into_iter()
        .map(|(id, station, formation)| TaskGroup {
            id: id.into(),
            name: id.into(),
            station,
            formation: Some(formation),
        })
        .collect(),
    }
}

#[test]
fn mission_generation_deploys_both_fleets_in_legal_water_on_every_real_map() {
    let catalog = &content().0;
    let rules = &catalog.missions["pve-fleet-v1"];
    for (map, _) in real_maps() {
        for seed in 0..6 {
            let plan = PvePlan::generate(catalog, mission_request(&map, seed))
                .unwrap_or_else(|e| panic!("{map} seed {seed}: {e}"));
            let setup = plan.restart_setup();
            let terrain = catalog
                .resolve_pve_environment(&map, "clear", seed, rules, None)
                .unwrap()
                .terrain;
            for ship in &setup.ships {
                let p = ship.spawn.as_ref().unwrap();
                assert!(
                    !terrain.land_within(p.x, p.z, DEPLOYMENT_CLEARANCE_M),
                    "{map} seed {seed}: {} at ({}, {})",
                    ship.id,
                    p.x,
                    p.z
                );
                let depth = if ship.team == TeamId::A { p.z } else { -p.z };
                assert!(
                    depth >= 7000.0,
                    "{map} seed {seed}: {} behind its line",
                    ship.id
                );
            }
            // The briefing's own placements pass the deployment check unchanged.
            let mut plan = plan;
            let own: Vec<_> = setup
                .ships
                .iter()
                .filter(|s| s.team == TeamId::A)
                .map(|s| naval_sim::pve::Placement {
                    id: s.id.clone(),
                    spawn: s.spawn.clone().unwrap(),
                })
                .collect();
            plan.deploy(catalog, own)
                .unwrap_or_else(|e| panic!("{map} seed {seed}: {e}"));
        }
    }
}
