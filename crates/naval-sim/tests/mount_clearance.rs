use naval_sim::{
    definition::{MountClearanceProfile, MountClearanceProfileMountsItem, ShipDefinition},
    geometry::radians,
    motion::ShipState,
    mount_clearance::{ClearancePose, MountClearance},
    weapons::{MountState, Obstructions, update_mount},
};

fn yamato() -> ShipDefinition {
    serde_json::from_str(include_str!("../../../public/models/yamato.json")).unwrap()
}
fn poses(def: &ShipDefinition) -> Vec<ClearancePose> {
    def.mounts
        .iter()
        .map(|m| ClearancePose::from(&MountState::new(m)))
        .collect()
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-8, "{a} != {b}");
}

#[test]
fn yamato_neutral_pose_and_observed_depression_collisions() {
    let def = yamato();
    let cache = MountClearance::new(&def).unwrap().unwrap();
    let initial = poses(&def);
    for i in 0..def.mounts.len() {
        let contact = cache.minimum_clearance(&def, i, &initial, 100.0);
        eprintln!("neutral {} {:?}", def.mounts[i].id, contact);
        assert!(
            contact.0 > 0.0,
            "{} neutral overlap {:?}",
            def.mounts[i].id,
            contact
        );
    }
    let mut requested = initial[1];
    requested.elevation = radians(-5.0);
    let mut impossible = initial.clone();
    impossible[1] = requested;
    let contact = cache.minimum_clearance(&def, 1, &impossible, 100.0);
    assert!(
        contact.0 < 0.0,
        "main2 depression should intersect main1: {contact:?}"
    );
    let accepted = cache.resolve(&def, 1, &initial, requested);
    eprintln!("main2 stopped {accepted:?}");
    assert!(accepted.blocked);
    assert!(accepted.pose.elevation > requested.elevation);
    let mut achieved = initial.clone();
    achieved[1] = accepted.pose;
    assert!(cache.minimum_clearance(&def, 1, &achieved, 100.0).0 >= 0.02 - 1e-7);
    for _ in 0..10 {
        let stopped = cache.resolve(&def, 1, &achieved, requested);
        assert!(stopped.blocked);
        assert_eq!(stopped.pose.elevation, achieved[1].elevation);
    }
    let clear = cache.resolve(
        &def,
        1,
        &achieved,
        ClearancePose {
            elevation: radians(20.0),
            ..achieved[1]
        },
    );
    assert!(!clear.blocked, "must elevate away from contact: {clear:?}");
    near(clear.pose.elevation, radians(20.0));
}

#[test]
fn yamato_intermediate_sweep_cannot_cross_the_superstructure() {
    let def = yamato();
    let cache = MountClearance::new(&def).unwrap().unwrap();
    // Raise first, traverse toward the bridge, then lower at the researched
    // aft-secondary end sector. Each accepted increment must remain physical.
    for (index, train, elevation) in [
        (2, 150.0, -5.0),
        (4, 150.0, -7.0),
        (2, -150.0, -5.0),
        (4, -150.0, -7.0),
    ] {
        let mut initial = poses(&def);
        // The neighboring aft 155 mm barrels must independently clear the
        // main turret while it traverses; raise that neighbor first.
        if index == 2 {
            initial[4].elevation = radians(75.0);
        }
        let raised = cache.resolve(
            &def,
            index,
            &initial,
            ClearancePose {
                elevation: radians(40.0),
                ..initial[index]
            },
        );
        assert!(!raised.blocked, "{index} raise {raised:?}");
        initial[index] = raised.pose;
        let traversed = cache.resolve(
            &def,
            index,
            &initial,
            ClearancePose {
                train: radians(train),
                ..initial[index]
            },
        );
        assert!(!traversed.blocked, "{index} traverse {traversed:?}");
        initial[index] = traversed.pose;
        let target = ClearancePose {
            elevation: radians(elevation),
            ..initial[index]
        };
        let mut impossible = initial.clone();
        impossible[index] = target;
        assert!(
            cache.minimum_clearance(&def, index, &impossible, 100.0).0 < 0.0,
            "expected collision at {index} {train}"
        );
        let accepted = cache.resolve(&def, index, &initial, target);
        eprintln!("sector {index} {train} {accepted:?}");
        assert!(accepted.blocked);
        initial[index] = accepted.pose;
        assert!(cache.minimum_clearance(&def, index, &initial, 100.0).0 >= 0.02 - 1e-7);
    }
}

#[test]
fn native_weapon_update_keeps_the_achieved_pose_blocked() {
    let def = yamato();
    let obstructions = Obstructions::new(&def);
    let mut states: Vec<_> = def.mounts.iter().map(MountState::new).collect();
    let mount = &def.mounts[1];
    let mut state = states[1].clone();
    // A near target below the bow drives the upper mount toward depression.
    for _ in 0..240 {
        update_mount(
            mount,
            &mut state,
            &def,
            &ShipState::new("test"),
            Some([0.0, 0.0, -130.0]),
            1.0 / 60.0,
            [0.0; 3],
            1.0,
            &obstructions,
            &states,
        );
        states[1] = state.clone();
    }
    assert_eq!(state.status, "blocked");
    assert!(state.elevation > radians(-5.0));
    let poses: Vec<_> = states.iter().map(ClearancePose::from).collect();
    assert!(
        obstructions
            .clearance
            .as_ref()
            .unwrap()
            .minimum_clearance(&def, 1, &poses, 100.0)
            .0
            >= 0.02 - 1e-7
    );
}

#[test]
fn unconfigured_ships_do_not_create_clearance_caches() {
    let mut def = yamato();
    def.mount_clearance = None;
    assert!(MountClearance::new(&def).unwrap().is_none());
    assert!(Obstructions::new(&def).clearance.is_none());
}

fn crossing_barrels() -> ShipDefinition {
    let mut def = yamato();
    def.mounts.truncate(2);
    def.structures = None;
    def.structural_plating = None;
    for (i, mount) in def.mounts.iter_mut().enumerate() {
        mount.parent_mount_id = None;
        mount.rangefinder = false;
        mount.position = if i == 0 {
            [0.0, 10.0, 0.0]
        } else {
            [5.0, 10.0, -12.0]
        };
        mount.bearing_deg = if i == 0 { 0.0 } else { 180.0 };
        let w = &mut mount.weapon;
        w.gunhouse_mesh = None;
        w.gunhouse_shape = None;
        w.gunhouse_size = [0.4, 0.4, 0.4];
        w.pivot_height = 1.0;
        w.trunnion_forward = 0.0;
        w.muzzle_forward = 10.0;
        w.barrel_count = Some(1.0);
        w.barrel_base_radius = Some(0.2);
        w.recoil_m = 0.4;
        w.traverse_deg = 150.0;
    }
    def.mount_clearance = Some(MountClearanceProfile {
        version: 1.0,
        margin_m: 0.02,
        mount_ids: Some(def.mounts.iter().map(|m| m.id.clone()).collect()),
        bodies: Some(vec![]),
        basis: "Independent crossing-barrel regression".into(),
        ..Default::default()
    });
    def
}

#[test]
fn clearance_encodings_are_exclusive_and_complete() {
    let mut def = crossing_barrels();
    let swept = def.mount_clearance.clone().unwrap();
    def.mount_clearance.as_mut().unwrap().bodies = None;
    assert!(MountClearance::new(&def).is_err());

    let installed = MountClearanceProfile {
        version: 1.0,
        margin_m: 0.02,
        basis: "Installation encoding merge regression".into(),
        mounts: Some(vec![MountClearanceProfileMountsItem {
            mount_id: def.mounts[0].id.clone(),
            barrel_radius_m: 0.2,
            body: None,
        }]),
        structures: Some(vec![]),
        neighbors: Some(vec![]),
        ..Default::default()
    };
    def.mount_clearance = Some(installed.clone());
    assert!(MountClearance::new(&def).unwrap().is_none());
    def.mount_clearance.as_mut().unwrap().neighbors = None;
    assert!(MountClearance::new(&def).is_err());

    def.mount_clearance = Some(MountClearanceProfile {
        mount_ids: swept.mount_ids,
        bodies: swept.bodies,
        ..installed
    });
    assert!(MountClearance::new(&def).is_err());
    let states: Vec<_> = def.mounts.iter().map(MountState::new).collect();
    let mut state = states[0].clone();
    assert!(!naval_sim::mount_clearance::move_mount_with_clearance(
        &def,
        0,
        &mut state,
        (radians(10.0), radians(20.0)),
        &states,
    ));
    near(state.train, states[0].train);
    near(state.elevation, states[0].elevation);
}

#[test]
fn swept_resolution_preserves_asymmetric_mount_travel_limits() {
    let mut def = crossing_barrels();
    def.mounts[0].traverse_limits_deg = Some([-30.0, 0.0]);
    let cache = MountClearance::new(&def).unwrap().unwrap();
    let initial = poses(&def);
    let accepted = cache.resolve(
        &def,
        0,
        &initial,
        ClearancePose {
            train: radians(30.0),
            ..initial[0]
        },
    );
    assert!(!accepted.blocked);
    near(accepted.pose.train, 0.0);
}

#[test]
fn independently_moving_neighbor_barrels_and_clear_endpoints_require_sweeps() {
    let def = crossing_barrels();
    let cache = MountClearance::new(&def).unwrap().unwrap();
    let initial: Vec<_> = poses(&def)
        .into_iter()
        .map(|p| ClearancePose {
            elevation: 0.0,
            ..p
        })
        .collect();
    let requested = ClearancePose {
        train: radians(90.0),
        ..initial[0]
    };
    let mut endpoint = initial.clone();
    endpoint[0] = requested;
    assert!(cache.minimum_clearance(&def, 0, &initial, 100.0).0 > 0.1);
    assert!(cache.minimum_clearance(&def, 0, &endpoint, 100.0).0 > 0.1);
    let stopped = cache.resolve(&def, 0, &initial, requested);
    assert!(
        stopped.blocked,
        "Clear endpoints cannot permit crossing the neighbor barrel"
    );
    assert!(stopped.pose.train > 0.0 && stopped.pose.train < requested.train);
    assert!(
        stopped
            .obstruction_id
            .as_deref()
            .unwrap()
            .contains(":barrels:")
    );
    let mut clear_neighbor = initial.clone();
    clear_neighbor[1].train = radians(90.0);
    let allowed = cache.resolve(&def, 0, &clear_neighbor, requested);
    assert!(
        !allowed.blocked,
        "The independently turned neighbor must change clearance: {allowed:?}"
    );
    near(allowed.pose.train, requested.train);
    // Move the second barrel toward an already stopped first barrel. The
    // reciprocal movement must be stopped by the same pairwise rule.
    clear_neighbor[0] = stopped.pose;
    let reciprocal = cache.resolve(&def, 1, &clear_neighbor, initial[1]);
    assert!(reciprocal.blocked);
}

#[test]
fn full_recoil_cycle_does_not_change_the_accepted_sweep_envelope() {
    let def = crossing_barrels();
    let cache = MountClearance::new(&def).unwrap().unwrap();
    let initial = poses(&def);
    let target = ClearancePose {
        train: radians(90.0),
        ..initial[0]
    };
    let forward = cache.resolve(&def, 0, &initial, target);
    let recoiled = cache.resolve(
        &def,
        0,
        &initial,
        ClearancePose {
            recoil: 1.0,
            ..target
        },
    );
    near(forward.pose.train, recoiled.pose.train);
    near(forward.pose.elevation, recoiled.pose.elevation);
    assert_eq!(forward.blocked, recoiled.blocked);
    near(recoiled.pose.recoil, 1.0);
}

#[test]
fn moving_gunhouse_cannot_enter_a_stationary_neighbor_barrel() {
    let mut def = crossing_barrels();
    let neighbor = &mut def.mounts[1];
    neighbor.bearing_deg = 90.0;
    neighbor.weapon.mounting_style = Some("open-pedestal".into());
    neighbor.weapon.gunhouse_size = [14.0, 0.4, 3.0];
    neighbor.weapon.muzzle_forward = 0.1;
    neighbor.weapon.barrel_base_radius = Some(0.01);
    let cache = MountClearance::new(&def).unwrap().unwrap();
    let mut initial = poses(&def);
    initial[0].train = radians(45.0);
    initial[0].elevation = 0.0;
    initial[1].elevation = 0.0;
    assert!(cache.minimum_clearance(&def, 1, &initial, 100.0).0 > 0.0);
    let accepted = cache.resolve(
        &def,
        1,
        &initial,
        ClearancePose {
            train: radians(90.0),
            ..initial[1]
        },
    );
    assert!(accepted.blocked);
    assert_eq!(accepted.obstruction_id.as_deref(), Some("main-2.gunhouse"));
}

#[test]
fn authority_cache_tracks_neighbor_motion_and_requires_complete_pose_context() {
    let def = crossing_barrels();
    let obstructions = Obstructions::new(&def);
    let mut states: Vec<_> = def.mounts.iter().map(MountState::new).collect();
    for s in &mut states {
        s.elevation = 0.0;
    }
    let mut state = states[0].clone();
    let ship = ShipState::new("test");
    let update = |state: &mut MountState, states: &[MountState]| {
        update_mount(
            &def.mounts[0],
            state,
            &def,
            &ship,
            Some([1000.0, 11.0, 0.0]),
            100.0,
            [0.0; 3],
            1.0,
            &obstructions,
            states,
        )
    };
    update(&mut state, &states);
    states[0] = state.clone();
    assert_eq!(state.status, "blocked");
    let stopped = state.train;
    update(&mut state, &states);
    states[0] = state.clone();
    near(state.train, stopped);
    states[1].train = radians(90.0);
    update(&mut state, &states);
    assert!(
        state.train > stopped + 0.1,
        "Neighbor motion must invalidate the mechanical stop cache"
    );
    let before = state.train;
    assert!(!update(&mut state, &[]));
    assert_eq!(state.status, "blocked");
    near(state.train, before);
}
