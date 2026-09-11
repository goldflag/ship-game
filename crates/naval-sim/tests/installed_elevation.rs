use naval_sim::{
    definition::ShipDefinition,
    gunnery::group_id,
    motion::ShipState,
    weapons::{MountState, MountStatus, Obstructions, update_mount},
};

#[test]
fn installed_stop_preserves_battery_selection_and_limits_authoritative_aiming() {
    let mut d: ShipDefinition =
        serde_json::from_str(include_str!("../../../public/models/gleaves.json")).unwrap();
    let m = d.mounts.iter().find(|m| m.id == "gun-2").unwrap().clone();
    assert_eq!(m.weapon.elevation_min_deg, -3.0);
    assert_eq!(m.weapon.catalog_elevation_min_deg, Some(-15.0));
    for neighbor in d.mounts.iter().filter(|m| m.battery == "main") {
        assert_eq!(group_id(&m), group_id(neighbor));
    }
    d.mounts = vec![m.clone()];
    d.obstructions.clear();
    let mut state = MountState::new(&m);
    let aim = Some([0.0, 0.0, m.position[2] - 100.0]);
    let ready = update_mount(
        &m, &mut state, &d, &ShipState::new("test"), aim, 10.0,
        [0.0; 3], 1.0, &Obstructions::new(&d), &[],
    );
    assert!(!ready);
    assert!((state.elevation - (-3.0_f64).to_radians()).abs() < 1e-10);
    assert_eq!(state.status, MountStatus::OutOfArc);
}

#[test]
fn installed_aa_ceiling_preserves_group_and_limits_authoritative_aiming() {
    let mut d: ShipDefinition = serde_json::from_str(include_str!("../../../public/models/gleaves.json")).unwrap();
    let m = d.mounts.iter().find(|m| m.id == "oerlikon-7").unwrap().clone();
    assert_eq!(m.weapon.elevation_max_deg, 78.0);
    assert_eq!(m.weapon.catalog_elevation_max_deg, Some(85.0));
    let mut unrestricted = m.clone();
    unrestricted.weapon.elevation_max_deg = 85.0;
    assert_eq!(group_id(&m), group_id(&unrestricted));
    d.mounts = vec![m.clone()]; d.obstructions.clear();
    let b = m.bearing_deg.to_radians();
    let aim = Some([m.position[0] + b.sin() * 100.0, 600.0, m.position[2] - b.cos() * 100.0]);
    let mut state = MountState::new(&m);
    assert!(!update_mount(&m, &mut state, &d, &ShipState::new("test"), aim, 10.0, [0.0;3], 1.0, &Obstructions::new(&d), &[]));
    assert!((state.elevation - 78.0_f64.to_radians()).abs() < 1e-10);
    assert_eq!(state.status, MountStatus::OutOfArc);
    let mut free = MountState::new(&unrestricted);
    assert!(update_mount(&unrestricted, &mut free, &d, &ShipState::new("test"), aim, 10.0, [0.0;3], 1.0, &Obstructions::new(&d), &[]));
}
