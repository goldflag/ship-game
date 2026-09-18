use naval_sim::{
    damage::Combatant,
    definition::*,
    maneuvering::{self, Maneuvering, MassProperties, Resistance},
    motion::HelmCommand,
};
fn fixture() -> ShipDefinition {
    let mut d = ShipDefinition {
        hull: Hull {
            mass_kg: 1_000_000.,
            length: 40.,
            beam: 8.,
            draft: 2.,
            depth: 2.,
            half_breadths: vec![[0., 4.], [40., 4.]],
            keel_heights: vec![[0., -2.], [40., -2.]],
            deck_heights: vec![[0., 2.], [40., 2.]],
            ..Default::default()
        },
        handling: Handling {
            forward_speed: 8.,
            reverse_speed: 3.,
            acceleration: 0.1,
            braking: 0.2,
            rudder_rate: 0.35,
            max_yaw_rate: 0.03,
        },
        ..Default::default()
    };
    for (id, kind, role, x, z) in [
        ("engine", "engine", "combined-drive", 0., 0.),
        ("port", "engine", "shaft", -2., 16.),
        ("starboard", "engine", "shaft", 2., 16.),
        ("rudder", "steering", "", 0., 18.),
    ] {
        d.modules.push(Module {
            id: id.into(),
            kind: kind.into(),
            role: Some(role.into()),
            hp: 100.,
            center: [x, -1., z],
            size: [1., 1., 1.],
            ..Default::default()
        });
    }
    d.propulsion = Some(ShipDefinitionPropulsion {
        groups: vec![PropulsionGroup {
            id: "engine".into(),
            share: 1.,
            drive_ids: vec!["engine".into()],
            shaft_ids: vec!["port".into(), "starboard".into()],
            ..Default::default()
        }],
        ..Default::default()
    });
    d.maneuvering = Some(ManeuveringProfile {
        version: 1.,
        propellers: vec!["port", "starboard"]
            .iter()
            .map(|id| ManeuveringProfilePropellersItem {
                module_id: (*id).into(),
                bearing_deg: 0.,
                diameter_m: 2.,
            })
            .collect(),
        rudders: vec![ManeuveringProfileRuddersItem {
            module_id: "rudder".into(),
            bearing_deg: 0.,
            area_m2: 3.,
        }],
    });
    d
}
fn run(d: &ShipDefinition, a: &mut Combatant, throttle: f64, rudder: f64, seconds: f64) {
    let model = Maneuvering::new(d);
    for _ in 0..(seconds * 60.) as usize {
        maneuvering::step(
            a,
            d,
            &model,
            HelmCommand {
                throttle,
                rudder,
                ..Default::default()
            },
            None,
        );
    }
}
#[test]
fn straight_ahead_reverse_coast_and_braking_are_finite() {
    let d = fixture();
    let mut a = Combatant::new("trial", &d);
    run(&d, &mut a, 1., 0., 180.);
    assert!((a.motion.speed - 8.).abs() < 0.2, "{}", a.motion.speed);
    assert!(a.motion.yaw_rate.abs() < 1e-8);
    let forward = a.motion.speed;
    run(&d, &mut a, 0., 0., 20.);
    assert!(a.motion.speed > 0. && a.motion.speed < forward);
    run(&d, &mut a, -1., 0., 1200.);
    assert!((a.motion.speed + 3.).abs() < 0.2, "{}", a.motion.speed);
}
#[test]
fn signed_rudder_lever_and_area_determine_yaw() {
    let trial = |z: f64, area: f64| {
        let mut d = fixture();
        d.modules[3].center[2] = z;
        d.maneuvering.as_mut().unwrap().rudders[0].area_m2 = area;
        let mut a = Combatant::new("turn", &d);
        a.motion.speed = 8.;
        a.motion.rudder = 1.;
        run(&d, &mut a, 0., 1., 0.1);
        a.motion.yaw_rate
    };
    let stern = trial(18., 3.);
    let bow = trial(-18., 3.);
    let center = trial(0., 3.);
    assert!(stern > 0. && bow < 0., "stern {stern}, bow {bow}");
    assert!(
        center.abs() < stern * 0.05,
        "center {center}, stern {stern}"
    );
    assert!(trial(18., 6.) > stern * 1.5);
    assert!(trial(9., 3.) < stern * 0.7);
}
#[test]
fn a_lost_outboard_screw_yaws_and_does_not_disable_its_sibling() {
    let d = fixture();
    let mut a = Combatant::new("loss", &d);
    a.damage.modules[1].hp = 0.;
    assert!((naval_sim::machinery::system_health(&a, &d, "engine", None) - 0.5).abs() < 1e-9);
    run(&d, &mut a, 1., 0., 2.);
    assert!(
        a.motion.speed > 0. && a.motion.yaw_rate < 0.,
        "{:?}",
        a.motion
    );
}
#[test]
fn angled_propeller_applies_sideways_thrust() {
    let mut d = fixture();
    for p in &mut d.maneuvering.as_mut().unwrap().propellers {
        p.bearing_deg = 45.;
    }
    let mut a = Combatant::new("angle", &d);
    run(&d, &mut a, 1., 0., 1.);
    assert!(a.motion.sway_speed > 0. && a.motion.yaw_rate < 0.);
}
#[test]
fn propeller_wash_steers_from_rest_only_when_aligned() {
    let trial = |x: f64| {
        let mut d = fixture();
        d.modules[3].center[0] = x;
        d.modules[3].center[2] = 18.;
        let mut a = Combatant::new("wash", &d);
        a.motion.rudder = 1.;
        run(&d, &mut a, 1., 1., 1. / 60.);
        a.motion.yaw_rate
    };
    assert!(
        trial(-2.) > trial(0.).abs() * 10.,
        "aligned {}, between {}",
        trial(-2.),
        trial(0.)
    );
}
#[test]
fn flooded_mass_and_end_loading_increase_inertia_and_reduce_acceleration() {
    let d = fixture();
    let mut dry = Combatant::new("dry", &d);
    let mut wet = Combatant::new("wet", &d);
    let room = Compartment {
        center: [0., -1., 15.],
        size: [8., 2., 8.],
        capacity_m3: 128.,
        ..Default::default()
    };
    let water = naval_sim::floodwater::water_body(&room, 100., 0., 0.);
    wet.motion_mass = MassProperties::flooded(&d, &[water]);
    assert!(
        wet.motion_mass.yaw_inertia > dry.motion_mass.yaw_inertia && wet.motion_mass.center[2] > 0.
    );
    run(&d, &mut dry, 1., 0., 0.5);
    run(&d, &mut wet, 1., 0., 0.5);
    assert!(wet.motion.speed < dry.motion.speed);
    let mut heavy_ends = Combatant::new("ends", &d);
    let mut concentrated = Combatant::new("center", &d);
    heavy_ends.motion_mass.yaw_inertia *= 2.;
    for a in [&mut heavy_ends, &mut concentrated] {
        a.motion.speed = 8.;
        a.motion.rudder = 1.;
        run(&d, a, 0., 1., 1. / 60.);
    }
    assert!(heavy_ends.motion.yaw_rate < concentrated.motion.yaw_rate * 0.6);
}
#[test]
fn a_finer_hull_has_lower_resistance_than_a_box_of_equal_dimensions() {
    let box_hull = fixture();
    let mut fine = box_hull.clone();
    fine.hull.half_breadths = vec![[0., 0.1], [8., 4.], [32., 4.], [40., 0.1]];
    let blunt = Resistance::new(&box_hull);
    let streamlined = Resistance::new(&fine);
    assert!(streamlined.frontal_area < blunt.frontal_area);
    assert!(
        streamlined.coefficient(8.) < blunt.coefficient(8.) * 0.9,
        "fine {}, box {}",
        streamlined.coefficient(8.),
        blunt.coefficient(8.)
    );
}
#[test]
fn hard_turn_loses_speed_without_creating_energy_and_small_hulls_stay_finite() {
    let d = fixture();
    let mut a = Combatant::new("turn", &d);
    a.motion.speed = 8.;
    run(&d, &mut a, 0., 1., 30.);
    assert!(a.motion.speed.hypot(a.motion.sway_speed) < 8.);
    let mut tiny = d.clone();
    tiny.hull.mass_kg = 100.;
    let mut a = Combatant::new("tiny", &tiny);
    a.motion.speed = 20.;
    a.motion.sway_speed = 20.;
    a.motion.yaw_rate = 3.;
    run(&tiny, &mut a, -1., 1., 60.);
    assert!(
        a.motion.speed.is_finite() && a.motion.speed.abs() < 30. && a.motion.yaw_rate.abs() < 3.,
        "{:?}",
        a.motion
    );
}
#[test]
fn profile_rejects_duplicate_and_invalid_fittings() {
    let mut d = fixture();
    assert!(maneuvering::validate(&d).is_ok());
    d.maneuvering.as_mut().unwrap().propellers[0].diameter_m = f64::NAN;
    assert!(maneuvering::validate(&d).is_err());
}

fn physical_fixture() -> ShipDefinition {
    use naval_sim::construction_geometry as cg;
    let mut d = fixture();
    let cell = cg::box_cell([0., 0., 0.], [8., 4., 40.]);
    let surfaces = cell
        .faces
        .iter()
        .enumerate()
        .map(|(i, f)| ConstructionSurface {
            id: format!("face-{i}"),
            primitive_id: "hull".into(),
            vertices: f.vertices.clone(),
            normal: cg::normal(&f.vertices),
            area_m2: cg::area(&f.vertices),
            ..Default::default()
        })
        .collect();
    d.hull.volume = Some(ConstructionGeometry {
        version: 1.,
        cells: vec![cell],
        surfaces,
    });
    let mass = MassProperties::dry(&d);
    d.loading = Some(ConstructionLoading {
        mass_kg: mass.mass,
        center_of_gravity: mass.center,
        inertia_kg_m2: [mass.yaw_inertia; 3],
        power_kw: 2000.,
        waterline_y: 0.,
        ..Default::default()
    });
    d
}

#[test]
fn construction_geometry_controls_drag_and_disconnected_props_cannot_create_power() {
    let d = physical_fixture();
    let model = Maneuvering::new(&d);
    assert!((model.resistance.wetted_area - 512.).abs() < 1e-6);
    assert!((model.resistance.frontal_area - 16.).abs() < 1e-6);
    // A finer bow with the same installed machinery must improve estimated speed.
    let mut fine = d.clone();
    let v = fine.hull.volume.as_mut().unwrap();
    for s in &mut v.surfaces {
        for p in &mut s.vertices {
            if p[2] < 0. {
                p[0] *= 0.1;
            }
        }
        s.normal = naval_sim::construction_geometry::normal(&s.vertices);
    }
    assert!(Maneuvering::new(&fine).estimated_speed > model.estimated_speed);
    let mut no_connection = d.clone();
    no_connection.propulsion.as_mut().unwrap().groups.clear();
    let mut a = Combatant::new("disconnected", &no_connection);
    run(&no_connection, &mut a, 1., 0., 10.);
    assert_eq!(a.motion.speed, 0.);
}

#[test]
fn propeller_and_rudder_exposure_remove_their_forces() {
    let mut d = physical_fixture();
    d.modules[1].center[1] = 5.;
    d.modules[2].center[1] = 5.;
    let mut a = Combatant::new("dry-screws", &d);
    run(&d, &mut a, 1., 0., 2.);
    assert_eq!(a.motion.speed, 0.);
    let mut d = physical_fixture();
    d.modules[3].center[1] = 5.;
    let mut a = Combatant::new("dry-rudder", &d);
    a.motion.speed = 8.;
    a.motion.rudder = 1.;
    run(&d, &mut a, 0., 1., 1.);
    assert!(a.motion.yaw_rate.abs() < 1e-10);
}

#[test]
fn exact_floodwater_keeps_intrinsic_inertia_and_runtime_stability_updates_motion_loading() {
    use naval_sim::{
        construction_geometry as cg, hydrostatics::HullHydrostatics, stability::update_stability,
    };
    let mut d = physical_fixture();
    d.compartments = vec![Compartment {
        id: "room".into(),
        center: [0., -1., 0.],
        size: [4., 2., 10.],
        capacity_m3: 80.,
        volumes: Some(vec![cg::box_cell([0., -1., 0.], [4., 2., 10.])]),
        ..Default::default()
    }];
    d.stability = Some(ShipDefinitionStability {
        version: 1.,
        buoyancy_scale: 1.,
        ..Default::default()
    });
    let w = naval_sim::floodwater::water_body(&d.compartments[0], 40., 0., 0.);
    assert!((w.inertia_m3([0., 0., 0.])[1] - 40. * (16. + 100.) / 12.).abs() < 1e-4);
    let mut a = Combatant::new("flooded", &d);
    let dry = a.motion_mass;
    a.damage.compartments[0].water_m3 = 40.;
    update_stability(
        &mut a,
        &d,
        &HullHydrostatics::new(&d.hull, None),
        1. / 60.,
        0.5,
        None,
    );
    assert_eq!(a.motion_mass.mass, dry.mass + 40. * 1025.);
    assert!(a.motion_mass.yaw_inertia > dry.yaw_inertia);
}

#[test]
fn finite_inputs_and_repeatable_replays_share_one_force_solver() {
    let d = physical_fixture();
    let model = Maneuvering::new(&d);
    let mut a = Combatant::new("same", &d);
    let mut b = Combatant::new("same", &d);
    for tick in 0..3600 {
        let command = HelmCommand {
            throttle: if tick < 1800 { 1. } else { -0.7 },
            rudder: if tick % 600 < 300 { 1. } else { -1. },
            ..Default::default()
        };
        for actor in [&mut a, &mut b] {
            maneuvering::step(actor, &d, &model, command, None);
        }
    }
    assert_eq!(
        serde_json::to_value(&a.motion).unwrap(),
        serde_json::to_value(&b.motion).unwrap()
    );
    maneuvering::step(
        &mut a,
        &d,
        &model,
        HelmCommand {
            throttle: f64::NAN,
            rudder: f64::INFINITY,
            ..Default::default()
        },
        None,
    );
    assert!(a.motion.speed.is_finite() && a.motion.yaw_rate.is_finite());
}

#[test]
fn misdirected_screws_reduce_the_compiled_forward_speed_estimate() {
    let d = physical_fixture();
    let aligned = Maneuvering::new(&d).estimated_speed;
    let mut bad = d.clone();
    for p in &mut bad.maneuvering.as_mut().unwrap().propellers {
        p.bearing_deg = 60.;
    }
    assert!(Maneuvering::new(&bad).estimated_speed < aligned);
    for p in &mut bad.maneuvering.as_mut().unwrap().propellers {
        p.bearing_deg = 180.;
    }
    let model = Maneuvering::new(&bad);
    assert_eq!(model.estimated_speed, 0.);
    assert!(model.estimated_handling(&bad).braking >= 0.);
}
