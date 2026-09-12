use naval_sim::{
    definition::ShipDefinition,
    geometry::radians,
    motion::ShipState,
    mount_clearance::{MountClearance, mount_pose_clear, move_mount_with_clearance},
    weapons::{MountState, MountStatus, Obstructions, update_mount},
};
fn fixture() -> (ShipDefinition, Vec<MountState>) {
    let d: ShipDefinition =
        serde_json::from_str(include_str!("../../../public/models/cleveland.json")).unwrap();
    assert!(d.mount_clearance.is_some());
    let states = d.mounts.iter().map(MountState::new).collect();
    (d, states)
}
fn move_to(d: &ShipDefinition, i: usize, states: &mut [MountState], target: (f64, f64)) -> bool {
    let mut s = states[i].clone();
    let result = move_mount_with_clearance(d, i, &mut s, target, states);
    states[i] = s;
    result
}
#[test]
fn installation_profile_uses_its_resolver_without_a_swept_body_cache() {
    let (d, _) = fixture();
    assert!(MountClearance::new(&d).unwrap().is_none());
    assert!(Obstructions::new(&d).clearance.is_none());
}
#[test]
fn neutral_and_platform_motion_cover_full_recoil() {
    let (d, mut states) = fixture();
    for (i, s) in states.iter().enumerate() {
        assert!(mount_pose_clear(
            &d,
            i,
            (s.train, s.elevation),
            &states,
            0.0
        ));
    }
    let i = d.mounts.iter().position(|m| m.id == "secondary-2").unwrap();
    assert!(!move_to(&d, i, &mut states, (0.0, radians(85.0))));
    assert!(states[i].elevation > radians(35.0) && states[i].elevation < radians(70.0));
    let elevation = states[i].elevation;
    assert!(move_to(&d, i, &mut states, (radians(-90.0), elevation)));
    assert!(move_to(&d, i, &mut states, (radians(-90.0), radians(85.0))));
    assert!(!move_to(&d, i, &mut states, (0.0, radians(85.0))));
    let train = states[i].train;
    assert!(move_to(&d, i, &mut states, (train, radians(1.0))));
    assert!(move_to(&d, i, &mut states, (0.0, radians(1.0))));
}
#[test]
fn half_degree_motion_can_lower_after_stopping_at_the_platform() {
    let (d, mut states) = fixture();
    let i = d.mounts.iter().position(|m| m.id == "secondary-2").unwrap();
    let advance = |states: &mut [MountState], target: (f64, f64)| {
        let step = radians(0.5);
        for _ in 0..1440 {
            let mut state = states[i].clone();
            let before = (state.train, state.elevation);
            let next = (
                state.train + (target.0 - state.train).clamp(-step, step),
                state.elevation + (target.1 - state.elevation).clamp(-step, step),
            );
            if !move_mount_with_clearance(&d, i, &mut state, next, states) {
                let train_only = (next.0, state.elevation);
                move_mount_with_clearance(&d, i, &mut state, train_only, states);
                let elevation_only = (state.train, next.1);
                move_mount_with_clearance(&d, i, &mut state, elevation_only, states);
            }
            let after = (state.train, state.elevation);
            states[i] = state;
            assert!(mount_pose_clear(&d, i, after, states, 0.0));
            if (after.0 - before.0).abs() + (after.1 - before.1).abs() < 1e-9 {
                break;
            }
        }
        (states[i].train - target.0).abs() + (states[i].elevation - target.1).abs() < 1e-7
    };
    assert!(!advance(&mut states, (0.0, radians(85.0))));
    let stopped_elevation = states[i].elevation;
    assert!(advance(&mut states, (radians(-90.0), stopped_elevation)));
    assert!(advance(&mut states, (radians(-90.0), radians(85.0))));
    assert!(!advance(&mut states, (0.0, radians(85.0))));
    let stopped_train = states[i].train;
    assert!(advance(&mut states, (stopped_train, radians(1.0))));
    assert!(advance(&mut states, (0.0, radians(1.0))));
}
#[test]
fn independent_neighbor_barrels_stop_before_crossing() {
    let (d, mut states) = fixture();
    states[1].elevation = radians(-2.0);
    let target = (radians(-155.0), radians(29.0));
    assert!(!mount_pose_clear(&d, 0, target, &states, 0.0));
    assert!(!move_to(&d, 0, &mut states, target));
    assert!(mount_pose_clear(
        &d,
        0,
        (states[0].train, states[0].elevation),
        &states,
        0.0
    ));
    states[0] = MountState::new(&d.mounts[0]);
    states[1].train = radians(90.0);
    assert!(mount_pose_clear(&d, 0, target, &states, 0.0));
}
#[test]
fn active_kernel_enforces_asymmetric_travel_and_platform_interlocks() {
    let (d, mut states) = fixture();
    let i = d.mounts.iter().position(|m| m.id == "secondary-2").unwrap();
    let m = &d.mounts[i];
    let obstructions = Obstructions::new(&d);
    let ship = ShipState::new("player");
    for _ in 0..400 {
        let mut s = states[i].clone();
        update_mount(
            m,
            &mut s,
            &d,
            &ship,
            Some([m.position[0], 1200.0, m.position[2] - 400.0]),
            1.0 / 60.0,
            [0.0; 3],
            1.0,
            &obstructions,
            &states,
        );
        states[i] = s;
        assert!(mount_pose_clear(
            &d,
            i,
            (states[i].train, states[i].elevation),
            &states,
            0.0
        ));
    }
    assert_eq!(states[i].status, MountStatus::Blocked);
    for _ in 0..700 {
        let mut s = states[i].clone();
        update_mount(
            m,
            &mut s,
            &d,
            &ship,
            Some([-2000.0, 5.0, m.position[2]]),
            1.0 / 60.0,
            [0.0; 3],
            1.0,
            &obstructions,
            &states,
        );
        states[i] = s;
    }
    assert!(states[i].train < radians(-80.0));
    assert!(states[i].elevation < radians(15.0));
    for _ in 0..1000 {
        let mut s = states[i].clone();
        update_mount(
            m,
            &mut s,
            &d,
            &ship,
            Some([2000.0, 5.0, m.position[2]]),
            1.0 / 60.0,
            [0.0; 3],
            1.0,
            &obstructions,
            &states,
        );
        states[i] = s;
        assert!(states[i].train <= 0.0 && states[i].train >= radians(-142.0));
    }
    // The neutral firing line is also obstructed, which takes readiness priority.
    assert_eq!(states[i].train, 0.0);
    assert_eq!(states[i].status, MountStatus::Blocked);
}

#[test]
fn projecting_fittings_follow_their_joint_and_stop_before_overhead_structure() {
    let (mut d, mut states) = fixture();
    let m = &mut d.mounts[0];
    m.position = [0.0; 3];
    m.bearing_deg = 0.0;
    m.weapon.trunnion_forward = 0.0;
    m.weapon.pivot_height = 2.0;
    m.weapon.muzzle_forward = 1.0;
    m.weapon.barrel_count = Some(1.0);
    m.weapon.barrel_spacing = 0.0;
    m.weapon.recoil_m = 0.0;
    m.initial_elevation_deg = Some(30.0);
    assert_eq!(MountState::new(m).elevation, radians(30.0));
    let id = m.id.clone();
    d.structures = Some(serde_json::from_value(serde_json::json!([{
        "id":"overhead", "name":"Overhead fitting", "footprint":[[-0.5,-7.0],[0.5,-7.0],[0.5,-5.5],[-0.5,-5.5]],
        "baseY":4.5,"height":1.0,"material":"naval"
    }])).unwrap());
    d.mount_clearance = Some(serde_json::from_value(serde_json::json!({
        "version":1,"marginM":0.02,"basis":"Original fitting test",
        "mounts":[{"mountId":id,"barrelRadiusM":0.05,"fittings":[{"joint":"elevation","a":[0,0,-5],"b":[0,0,-7],"radiusM":0.03}]}],
        "structures":[{"structureId":"overhead","topExtensionM":0}],"neighbors":[]
    })).unwrap());
    assert!(MountClearance::new(&d).unwrap().is_none());
    states[0].train = 0.0;
    states[0].elevation = 0.0;
    assert!(mount_pose_clear(&d, 0, (0.0, 0.0), &states, 0.0));
    assert!(!mount_pose_clear(&d, 0, (0.0, radians(30.0)), &states, 0.0));
    assert!(!move_to(&d, 0, &mut states, (0.0, radians(50.0))));
    assert!(states[0].elevation > 0.0);
    assert!(move_to(&d, 0, &mut states, (0.0, 0.0)));
    let mut fixed = d.clone();
    fixed.mount_clearance.as_mut().unwrap().structures = Some(vec![]);
    fixed.structures = Some(vec![]);
    fixed.obstructions = serde_json::from_value(
        serde_json::json!([{"id":"deck-fitting","center":[0,5,-6.25],"size":[1,1,1.5]}]),
    )
    .unwrap();
    assert!(!mount_pose_clear(
        &fixed,
        0,
        (0.0, radians(30.0)),
        &states,
        0.0
    ));
    assert!(mount_pose_clear(&fixed, 0, (0.0, 0.0), &states, 0.0));
    let entry = &mut d.mount_clearance.as_mut().unwrap().mounts.as_mut().unwrap()[0];
    let c = &mut entry.fittings.as_mut().unwrap()[0];
    c.joint = "yaw".into();
    c.a = [4.0, 2.0, 0.0];
    c.b = [6.0, 2.0, 0.0];
    let s = &mut d.structures.as_mut().unwrap()[0];
    s.footprint = vec![[4.5, -0.5], [5.5, -0.5], [5.5, 0.5], [4.5, 0.5]];
    s.base_y = 1.5;
    for elevation in [0.0, radians(80.0)] {
        assert!(!mount_pose_clear(&d, 0, (0.0, elevation), &states, 0.0));
    }
    assert!(mount_pose_clear(&d, 0, (radians(90.0), 0.0), &states, 0.0));
    d.mount_clearance.as_mut().unwrap().mounts.as_mut().unwrap()[0]
        .fittings
        .as_mut()
        .unwrap()[0]
        .joint = "unsupported".into();
    assert!(MountClearance::new(&d).is_err());
}
