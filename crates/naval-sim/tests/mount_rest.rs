//! Side secondaries rest trained toward the nearer end of the ship, clamped to
//! their installed arcs, clear of the movement interlocks, and train back there
//! when they have gone a while without an aim. Every other mount rests at
//! neutral as before.
use naval_sim::{
    battle::{Battle, BattleSetup},
    catalog::Catalog,
    definition::{MountDefinition, ShipDefinition},
    geometry::{radians, wrap_angle},
    motion::ShipState,
    mount_clearance::{ClearancePose, mount_pose_clear},
    mount_rest::{
        IDLE_REST_SECONDS, end_train, midship_z, rest_elevation, rests_toward_end, train_limits,
    },
    rules::{DT, TeamId},
    vessel::{CompiledShip, Vessel},
    weapons::{MountState, MountStatus, update_mount},
};
use std::{collections::BTreeMap, sync::Arc};

fn mount(battery: &str, x: f64, z: f64, bearing: f64, half: f64) -> MountDefinition {
    let mut m = MountDefinition {
        id: "m".into(),
        battery: battery.into(),
        position: [x, 6.0, z],
        bearing_deg: bearing,
        ..Default::default()
    };
    m.weapon.caliber_m = 0.127;
    m.weapon.traverse_deg = half;
    m
}
fn degrees(train: f64) -> f64 {
    (train.to_degrees() * 1e6).round() / 1e6
}
fn compiled(id: &str) -> Arc<CompiledShip> {
    Arc::new(Catalog::installed().compile(id).unwrap())
}
fn by_id(d: &ShipDefinition, id: &str) -> usize {
    d.mounts.iter().position(|m| m.id == id).unwrap()
}

#[test]
fn a_side_secondary_turns_toward_the_nearer_end_within_its_arc() {
    // Starboard, arc ±80° about the beam, like King George V's 5.25-inch.
    assert_eq!(
        degrees(end_train(&mount("secondary", 11., -12., 90., 80.), 0.)),
        -80.
    );
    assert_eq!(
        degrees(end_train(&mount("secondary", 11., 23., 90., 80.), 0.)),
        80.
    );
    // Port, authored either as -90° or 270°.
    for bearing in [-90., 270.] {
        assert_eq!(
            degrees(end_train(&mount("secondary", -11., -12., bearing, 80.), 0.)),
            80.
        );
        assert_eq!(
            degrees(end_train(&mount("secondary", -11., 23., bearing, 80.), 0.)),
            -80.
        );
    }
    // An arc that reaches the end points dead ahead or dead astern.
    let hood = mount("secondary", 12., 25., 90., 100.);
    assert_eq!(degrees(end_train(&hood, 0.)), 90.);
    assert_eq!(
        degrees(wrap_angle(radians(90.) + end_train(&hood, 0.))),
        -180.
    );
    // The ends are taken from the middle of the hull, not the origin.
    assert_eq!(midship_z(&[[0., -100.], [5., 40.], [0., 120.]]), 10.);
    let near_origin = mount("secondary", 11., 5., 90., 80.);
    assert_eq!(degrees(end_train(&near_origin, 0.)), 80.);
    assert_eq!(degrees(end_train(&near_origin, 10.)), -80.);
}

#[test]
fn asymmetric_limits_clamp_the_rest_and_take_the_turn_they_allow() {
    let mut m = mount("secondary", 9., -20., 90., 150.);
    m.traverse_limits_deg = Some([-30., 120.]);
    assert_eq!(degrees(end_train(&m, 0.)), -30.);
    m.position[2] = 20.;
    assert_eq!(degrees(end_train(&m, 0.)), 90.);
    // Bow-facing wing mount abaft midships: the stern is ±180° away, and only
    // the positive turn is installed.
    let mut wing = mount("secondary", 10., 20., 0., 180.);
    wing.traverse_limits_deg = Some([0., 142.]);
    assert_eq!(degrees(end_train(&wing, 0.)), 142.);
    wing.traverse_limits_deg = Some([-142., 0.]);
    assert_eq!(degrees(end_train(&wing, 0.)), -142.);
    // Already facing its end (USS Alaska's wing 5-inch): stays at neutral.
    let mut alaska = mount("secondary", 10.79, -16.64, 0., 180.);
    alaska.traverse_limits_deg = Some([0., 142.]);
    assert_eq!(degrees(end_train(&alaska, 0.)), 0.);
    let mut aft = mount("secondary", 10.9, 28.93, 180., 180.);
    aft.traverse_limits_deg = Some([-160., 0.]);
    assert_eq!(degrees(end_train(&aft, 0.)), 0.);
}

#[test]
fn main_battery_light_aa_carried_and_centreline_mounts_are_not_covered() {
    assert!(rests_toward_end(&mount("secondary", 11., -12., 90., 80.)));
    assert!(!rests_toward_end(&mount("main", 11., -12., 90., 80.)));
    assert!(!rests_toward_end(&mount("secondary", 0., -12., 0., 150.)));
    assert!(!rests_toward_end(&mount("secondary", 0.4, -12., 0., 150.)));
    let mut light = mount("secondary", 11., -12., 90., 80.);
    for caliber in [0.02, 0.04, 0.08] {
        light.weapon.caliber_m = caliber;
        assert!(!rests_toward_end(&light), "{caliber} m is light AA");
    }
    let mut carried = mount("secondary", 11., -12., 90., 80.);
    carried.parent_mount_id = Some("turret".into());
    assert!(!rests_toward_end(&carried));
}

#[test]
fn presets_spawn_with_side_secondaries_at_rest() {
    // King George V: the ±80° arcs stop 10° short of each end.
    let kgv = compiled("king-george-v");
    let ship = Vessel::new("kgv", TeamId::A, kgv.clone());
    let d = ship.definition();
    for (id, train) in [
        ("secondary-p1", 80.),
        ("secondary-p2", 80.),
        ("secondary-p3", -80.),
        ("secondary-p4", -80.),
        ("secondary-s1", -80.),
        ("secondary-s2", -80.),
        ("secondary-s3", 80.),
        ("secondary-s4", 80.),
    ] {
        assert_eq!(degrees(ship.mounts[by_id(d, id)].train), train, "{id}");
    }
    for (m, s) in d.mounts.iter().zip(&ship.mounts) {
        if m.battery == "main" {
            assert_eq!(s.train, 0., "{} main battery stays at neutral", m.id);
        }
    }
    // USS Alaska already authors her wing mounts facing their ends.
    let alaska = compiled("alaska");
    let ship = Vessel::new("alaska", TeamId::A, alaska.clone());
    assert!(ship.mounts.iter().all(|s| s.train == 0.));
    assert!(alaska.rest_trains.iter().flatten().all(|t| *t == 0.));
}

#[test]
fn a_rest_the_neighbouring_gunhouse_blocks_stops_short_of_it() {
    // Two wing pairs abaft midships at the same height, the forward pair just
    // ahead of the after one: dead astern, the forward barrels would run into
    // the after gunhouses. This is Baltimore's former wing arrangement, without
    // an installation profile as she then had; her measured layout now spreads
    // the pairs beside the bridge and the after deckhouse.
    let catalog = Catalog::installed();
    let mut layout = (*catalog.definitions["baltimore"]).clone();
    layout.mount_clearance = None;
    for (id, x, z) in [
        ("secondary-52", -7.05, 2.955),
        ("secondary-53", 7.05, 2.955),
        ("secondary-54", -7.05, 8.71),
        ("secondary-55", 7.05, 8.71),
    ] {
        let i = by_id(&layout, id);
        layout.mounts[i].position = [x, 6.3, z];
    }
    let baltimore = CompiledShip::new(Arc::new(layout), None).unwrap();
    let d = &baltimore.definition;
    let mid = midship_z(&baltimore.collision_profile);
    for id in ["secondary-52", "secondary-53"] {
        let i = by_id(d, id);
        let rest = baltimore.rest_trains[i].unwrap();
        let target = end_train(&d.mounts[i], mid);
        assert!(
            rest.abs() > radians(30.) && rest.abs() < target.abs(),
            "{id}"
        );
        assert_eq!(rest.signum(), target.signum(), "{id} turns toward its end");
    }
    for id in ["secondary-54", "secondary-55"] {
        let i = by_id(d, id);
        assert_eq!(
            baltimore.rest_trains[i].unwrap(),
            end_train(&d.mounts[i], mid)
        );
    }
}

#[test]
fn every_preset_rest_is_clear_of_its_interlocks() {
    let catalog = Catalog::installed();
    let mut covered = 0;
    for id in catalog.definitions.keys() {
        let compiled = Arc::new(catalog.compile(id).unwrap());
        if compiled.rest_trains.iter().all(Option::is_none) {
            continue;
        }
        let ship = Vessel::new("rest", TeamId::A, compiled.clone());
        let d = ship.definition();
        let poses: Vec<ClearancePose> = ship.mounts.iter().map(ClearancePose::from).collect();
        for (i, rest) in compiled.rest_trains.iter().enumerate() {
            let Some(rest) = rest else { continue };
            covered += 1;
            let m = &d.mounts[i];
            let [lo, hi] = train_limits(m);
            assert!((lo..=hi).contains(rest), "{id} {} rest in its arc", m.id);
            let s = &ship.mounts[i];
            assert_eq!(s.train, *rest);
            assert_eq!(s.elevation, rest_elevation(m));
            let obstructions = &compiled.obstructions;
            if let Some(clearance) = obstructions.clearance.as_ref().filter(|c| c.enabled(i)) {
                let (gap, body) = clearance.minimum_clearance(d, i, &poses, 1.0);
                assert!(gap > 0.0, "{id} {} rest touches {body:?}", m.id);
            } else {
                assert!(
                    mount_pose_clear(d, i, (s.train, s.elevation), &ship.mounts, 0.0),
                    "{id} {} rest fails its installation envelope",
                    m.id
                );
                assert!(
                    obstructions.clearance.is_some()
                        || d.mount_clearance.is_some()
                        || !obstructions.barrels_fouled(d, i, s, &ship.mounts),
                    "{id} {} barrels run into an obstruction at rest",
                    m.id
                );
            }
        }
    }
    assert!(covered >= 60, "only {covered} side secondaries covered");
}

/// Presets whose main battery is known to stop short of a beam: Mogami's No. 2
/// turret depresses onto No. 1's roof while both train and wedges the pair;
/// Takao's turrets rest inside their interlock envelopes.
const BEAM_BLOCKED: [&str; 2] = ["mogami", "takao"];

#[test]
fn every_preset_main_battery_trains_from_rest_to_either_beam() {
    // Every turret trains at once, as for a broadside, so neighbours' interlocks
    // meet as they do in battle. Kongō's superfiring pair once froze at rest.
    let catalog = Catalog::installed();
    let mut failures = Vec::new();
    for id in catalog.definitions.keys() {
        let compiled = Arc::new(catalog.compile(id).unwrap());
        let mut blocked = false;
        for side in [-1.0, 1.0] {
            let mut ship = Vessel::new("beam", TeamId::A, compiled.clone());
            let d = ship.definition().clone();
            let p = ShipState::new("beam");
            let mains: Vec<usize> = (0..d.mounts.len())
                .filter(|&i| d.mounts[i].battery == "main" && d.mounts[i].parent_mount_id.is_none())
                .collect();
            for _ in 0..600 {
                for &i in &mains {
                    let states = ship.mounts.clone();
                    update_mount(
                        &d.mounts[i],
                        &mut ship.mounts[i],
                        &d,
                        &p,
                        Some([side * 4000.0, 0.0, 0.0]),
                        0.1,
                        [0.0; 3],
                        1.0,
                        &compiled.obstructions,
                        &states,
                    );
                }
            }
            for &i in &mains {
                let (m, s) = (&d.mounts[i], &ship.mounts[i]);
                let [lo, hi] = train_limits(m);
                let beam = wrap_angle(side * radians(90.0) - radians(m.bearing_deg));
                // Anti-aircraft main batteries carry no surface shell.
                if beam < lo || beam > hi || s.status == MountStatus::Empty {
                    continue;
                }
                if !matches!(s.status, MountStatus::Ready | MountStatus::Reloading) {
                    blocked = true;
                    if !BEAM_BLOCKED.contains(&id.as_str()) {
                        failures.push(format!(
                            "{id} {} toward {} beam: {:?} at {:.1} deg train, {:.1} deg elevation",
                            m.id,
                            if side > 0.0 { "starboard" } else { "port" },
                            s.status,
                            degrees(s.train),
                            degrees(s.elevation),
                        ));
                    }
                }
            }
        }
        if BEAM_BLOCKED.contains(&id.as_str()) && !blocked {
            failures.push(format!(
                "{id} now reaches both beams: remove it from BEAM_BLOCKED"
            ));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

fn duel(enemy_x: f64, enemy_z: f64) -> Battle {
    let catalog = Catalog::installed();
    let compiled = BTreeMap::from([("king-george-v".into(), compiled("king-george-v"))]);
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships": [
            {"id":"own","presetId":"king-george-v","team":"a","controller":"bot","aiLevel":"normal",
             "spawn":{"x":0,"z":0,"heading":0}},
            {"id":"enemy","presetId":"king-george-v","team":"b","controller":"bot","aiLevel":"static",
             "spawn":{"x":enemy_x,"z":enemy_z,"heading":0}}
        ],
        "seed":23,"mapId":"north-atlantic","weather":"clear","windSpeed":0,"spawnDistance":12000
    }))
    .unwrap();
    Battle::new(catalog, &compiled, setup).unwrap()
}

#[test]
fn an_idle_secondary_trains_back_to_rest_after_a_few_seconds() {
    // The enemy is beyond the 5.25-inch guns' reach, so they have no aim.
    let mut battle = duel(0., -15000.);
    let d = battle.actors[0].definition().clone();
    let i = by_id(&d, "secondary-s1");
    let rest = battle.actors[0].compiled.rest_trains[i].unwrap();
    battle.actors[0].mounts[i].train = 0.;
    battle.actors[0].mounts[i].elevation = radians(20.);
    let orders = BTreeMap::new();
    let hold = ((IDLE_REST_SECONDS - 0.5) / DT) as usize;
    for _ in 0..hold {
        battle.step(&orders);
    }
    assert_eq!(
        battle.actors[0].mounts[i].train, 0.,
        "holds while recently aimed"
    );
    for _ in 0..(12. / DT) as usize {
        battle.step(&orders);
    }
    let s = &battle.actors[0].mounts[i];
    assert!(
        (s.train - rest).abs() < 1e-9,
        "train {} rest {rest}",
        s.train
    );
    assert!((s.elevation - rest_elevation(&d.mounts[i])).abs() < 1e-9);
    // Main battery is not covered: it keeps laying on the target.
    let main = by_id(
        &d,
        &d.mounts.iter().find(|m| m.battery == "main").unwrap().id,
    );
    assert!(battle.actors[0].mounts[main].aim_cache.is_some());
}

#[test]
fn a_resting_secondary_still_engages_a_target_in_reach() {
    // Enemy on the starboard beam inside the 8 km secondary range.
    let mut battle = duel(6000., 0.);
    let d = battle.actors[0].definition().clone();
    let starboard: Vec<usize> = [
        "secondary-s1",
        "secondary-s2",
        "secondary-s3",
        "secondary-s4",
    ]
    .iter()
    .map(|id| by_id(&d, id))
    .collect();
    let orders = BTreeMap::new();
    let mut fired = false;
    let mut laid = vec![false; starboard.len()];
    for _ in 0..(40. / DT) as usize {
        battle.step(&orders);
        fired |= battle.shells.iter().any(|s| {
            s.owner_id == "own"
                && s.weapon_label
                    .as_deref()
                    .is_some_and(|l| l.contains("Secondary"))
        });
        for (k, &i) in starboard.iter().enumerate() {
            let s: &MountState = &battle.actors[0].mounts[i];
            laid[k] |= s
                .aim_cache
                .as_ref()
                .is_some_and(|c| (c.train - s.train).abs() < 0.01 && c.train.abs() < radians(60.));
        }
    }
    assert!(
        laid.iter().all(|l| *l),
        "starboard secondaries laid: {laid:?}"
    );
    assert!(fired, "no secondary shell was fired");
}
