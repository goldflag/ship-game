//! Port and battle both start through Vessel::new. An undamaged construction
//! ship should already be floating at its loaded draft and trim in that frame.
use naval_sim::{
    definition::ShipDefinition,
    flooding::update_flooding,
    rules::TeamId,
    vessel::{CompiledShip, Vessel},
};
use std::sync::Arc;

#[test]
fn valiant_port_pose_matches_undamaged_calm_water_battle() {
    let def: ShipDefinition =
        serde_json::from_slice(&std::fs::read("../../public/models/valiant.json").unwrap())
            .unwrap();
    let compiled = Arc::new(CompiledShip::new(Arc::new(def), None).unwrap());
    let loading = compiled.definition.loading.as_ref().unwrap();
    let upright = compiled.hydro.flotation(loading.mass_kg / 1025., 0., 0.);
    assert!((upright.y + loading.waterline_y).abs() < 1e-6);
    let mut actor = Vessel::new("valiant", TeamId::A, compiled.clone());
    let initial = actor.motion.clone();
    for _ in 0..3600 {
        update_flooding(
            &mut actor.state,
            &compiled.definition,
            &compiled.hydro,
            1. / 60.,
            0.5,
            None,
            None,
        );
    }
    assert!(!actor.damage.sunk);
    assert!(actor.damage.compartments.iter().all(|c| c.water_m3 == 0.));
    assert!(
        (actor.motion.y - initial.y).abs() < 0.01,
        "port y={}, battle y={}",
        initial.y,
        actor.motion.y
    );
    assert!(
        (actor.motion.pitch - initial.pitch).abs() < 0.0001,
        "port pitch={}, battle pitch={}",
        initial.pitch,
        actor.motion.pitch
    );
    assert!((actor.motion.roll - initial.roll).abs() < 0.0001);
    // Valiant's physical loading still determines its draft and bow-down trim.
    assert!((initial.y + 2.8).abs() < 0.1);
    assert!((initial.pitch.to_degrees() + 0.43).abs() < 0.05);
    let reset = Vessel::new("valiant", TeamId::A, compiled);
    assert_eq!(reset.motion.y, initial.y);
    assert_eq!(reset.motion.pitch, initial.pitch);
    assert_eq!(reset.motion.tick, 0);
    assert_eq!(reset.motion.vertical_speed, 0.);
}

#[test]
fn legacy_calibrated_hulls_keep_the_authored_waterline() {
    let def: ShipDefinition =
        serde_json::from_slice(&std::fs::read("../../public/models/bismarck.json").unwrap())
            .unwrap();
    let compiled = Arc::new(CompiledShip::new(Arc::new(def), None).unwrap());
    let actor = Vessel::new("bismarck", TeamId::A, compiled);
    assert_eq!(
        [actor.motion.y, actor.motion.roll, actor.motion.pitch],
        [0.; 3]
    );
}

fn box_hydro() -> naval_sim::hydrostatics::HullHydrostatics {
    use naval_sim::{
        construction_geometry::box_cell,
        definition::{ConstructionGeometry, Hull},
    };
    naval_sim::hydrostatics::HullHydrostatics::new(
        &Hull {
            length: 80.,
            beam: 20.,
            draft: 6.,
            half_breadths: vec![[0., 10.], [80., 10.]],
            deck_heights: vec![[0., 6.], [80., 6.]],
            keel_heights: vec![[0., -6.], [80., -6.]],
            depth: 6.,
            volume: Some(ConstructionGeometry {
                version: 1.,
                cells: vec![box_cell([0.; 3], [20., 12., 80.])],
                surfaces: vec![],
            }),
            ..Default::default()
        },
        None,
    )
}

#[test]
fn equilibrium_balances_displacement_and_both_off_center_load_moments() {
    use naval_sim::hydrostatics::righting_arms;
    let hydro = box_hydro();
    let gravity = [0.4, -2., -3.];
    let pose = hydro
        .equilibrium(9600., gravity)
        .expect("stable loaded hull");
    let sample = hydro.sample(pose.y, pose.roll, pose.pitch);
    let arms = righting_arms(sample.center, gravity, pose.roll, pose.pitch);
    assert!((sample.volume - 9600.).abs() < 0.01);
    assert!(arms.0.hypot(arms.1) < 1e-6);
    assert!(pose.roll.abs() > 0.01);
    assert!(pose.pitch.abs() > 0.01);
}

#[test]
fn equilibrium_does_not_hide_overloading_or_unstable_top_weight() {
    let hydro = box_hydro();
    assert!(
        hydro
            .equilibrium(hydro.full_volume() * 1.1, [0.; 3])
            .is_none()
    );
    assert!(hydro.equilibrium(9600., [0., 20., 0.]).is_none());
}
