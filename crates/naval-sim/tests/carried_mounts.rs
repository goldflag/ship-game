use naval_sim::{
    aviation::Aviation,
    catalog::{Catalog, validate_definition},
    contacts::{ContactGeometry, ContactKind, ship_contacts},
    damage::Combatant,
    definition::{ShipDefinition, Vec3},
    geometry::*,
    gunnery::{GunneryContext, PlayerGunOrders, operate},
    motion::ShipState,
    mount_frames::{mount_frame, update_mount_carrier},
    protection::plate_hit,
    rules::{DT, TeamId},
    shell::Shell,
    vessel::{CompiledShip, Vessel},
    weapons::{MountState, Obstructions, muzzle_local, shot_direction, update_mount},
};
use std::{collections::BTreeMap, sync::Arc};

fn iowa() -> ShipDefinition {
    serde_json::from_str(include_str!("../../../public/models/iowa.json")).unwrap()
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-8, "{a} != {b}");
}
fn vector(a: Vec3, b: Vec3) {
    for i in 0..3 {
        near(a[i], b[i]);
    }
}
fn fixture() -> ShipDefinition {
    let mut d = iowa();
    let mut parent = d.mounts[2].clone();
    parent.id = "parent".into();
    parent.position = [0.0, 4.0, 0.0];
    parent.bearing_deg = 180.0;
    let mut child = d
        .mounts
        .iter()
        .find(|m| m.weapon.barrel_count == Some(1.0))
        .unwrap()
        .clone();
    child.id = "child".into();
    child.position = [0.0, 8.0, -6.0];
    child.bearing_deg = 0.0;
    child.parent_mount_id = Some(parent.id.clone());
    let mut grandchild = child.clone();
    grandchild.id = "grandchild".into();
    grandchild.position = [0.0, 10.0, -8.0];
    grandchild.parent_mount_id = Some(child.id.clone());
    d.mounts = vec![parent, child, grandchild];
    d.obstructions.clear();
    d
}

#[test]
fn catalog_rejects_missing_self_and_forward_carriers() {
    let d = iowa();
    validate_definition(&d).unwrap();
    let i = d
        .mounts
        .iter()
        .position(|m| m.parent_mount_id.is_some())
        .unwrap();
    for parent in ["absent", &d.mounts[i].id] {
        let mut invalid = d.clone();
        invalid.mounts[i].parent_mount_id = Some(parent.into());
        assert!(validate_definition(&invalid).is_err());
    }
    let mut invalid = d.clone();
    invalid.mounts[0].parent_mount_id = Some(d.mounts[i].id.clone());
    assert!(validate_definition(&invalid).is_err());
}

#[test]
fn nested_carriers_countertrain_and_aim_in_the_ship_frame() {
    let d = fixture();
    let mut states: Vec<_> = d.mounts.iter().map(MountState::new).collect();
    states[0].train = radians(90.0);
    states[1].train = radians(-90.0);
    states[1].elevation = 0.0;
    for i in 0..states.len() {
        update_mount_carrier(&d, i, &mut states);
    }
    let m = &d.mounts[1];
    vector(
        muzzle_local(m, &states[1], 0),
        [6.0, 8.0 + m.weapon.pivot_height, -m.weapon.muzzle_forward],
    );
    vector(
        shot_direction(m, &states[1], Pose::default()),
        [0.0, 0.0, -1.0],
    );
    let mut state = states[1].clone();
    update_mount(
        m,
        &mut state,
        &d,
        &ShipState::new("test"),
        Some([6.0, 8.0 + m.weapon.pivot_height, -700.0]),
        0.0,
        [0.0; 3],
        1.0,
        &Obstructions::new(&d),
        &states,
    );
    assert!((state.aim_cache.unwrap().train - radians(-90.0)).abs() < 0.001);
    states[1].train = radians(90.0);
    let pose = mount_frame(&d, 2, &|i| states[i].train);
    vector([pose.x, pose.y, pose.z], [6.0, 10.0, 2.0]);
    assert!(states[0].carrier.is_none());
    assert!(
        serde_json::to_value(&states[1])
            .unwrap()
            .get("carrier")
            .is_none()
    );
}

#[test]
fn contacts_and_armor_leave_the_neutral_roof_position() {
    let mut d = fixture();
    d.armor.clear();
    let mut actor = Combatant::new("test", &d);
    actor.mounts[0].train = radians(90.0);
    actor.mounts[1].train = radians(-90.0);
    let geometry = ContactGeometry::new(&d).unwrap();
    let shell = Shell::default();
    let hits = |x| {
        ship_contacts(&shell, [x, 8.7, -5.0], [x, 8.7, 5.0], &actor, &d, &geometry)
            .into_iter()
            .filter(|h| h.kind == ContactKind::Mount && h.index == 1)
            .count()
    };
    assert!(hits(6.0) > 0);
    assert_eq!(hits(0.0), 0);
    let mut armor = iowa()
        .armor
        .into_iter()
        .find(|a| a.plate.is_some())
        .unwrap();
    armor.center = [0.0, 0.7, -0.5];
    armor.size = [2.0, 1.4, 0.001];
    let plate = armor.plate.as_mut().unwrap();
    plate.mount_id = Some(d.mounts[1].id.clone());
    plate.vertices = vec![
        [-1.0, 0.0, -0.5],
        [1.0, 0.0, -0.5],
        [1.0, 1.4, -0.5],
        [-1.0, 1.4, -0.5],
    ];
    let trains: Vec<_> = actor.mounts.iter().map(|m| m.train).collect();
    let hit = plate_hit([6.0, 8.7, -5.0], [6.0, 8.7, 5.0], &armor, &d, &trains).unwrap();
    vector(hit.point, [6.0, 8.7, -0.5]);
    assert!(plate_hit([0.0, 8.7, -5.0], [0.0, 8.7, 5.0], &armor, &d, &trains).is_none());
}

#[test]
fn parent_motion_invalidates_a_stationary_neighbors_clearance() {
    let mut d = fixture();
    d.mounts[2].position = [0.0, 8.0, 10.0];
    d.mounts[2].parent_mount_id = None;
    for m in &mut d.mounts {
        m.weapon.gunhouse_size = [2.0; 3];
        m.weapon.mounting_style = None;
        m.weapon.pivot_height = 1.0;
        m.weapon.barrel_count = Some(1.0);
    }
    let mut states: Vec<_> = d.mounts.iter().map(MountState::new).collect();
    let mut gun = states[2].clone();
    gun.elevation = 0.0;
    let obstructions = Obstructions::new(&d);
    let mut check = |states: &[MountState]| {
        update_mount(
            &d.mounts[2],
            &mut gun,
            &d,
            &ShipState::new("test"),
            None,
            0.0,
            [0.0; 3],
            1.0,
            &obstructions,
            states,
        );
        gun.status.clone()
    };
    assert_eq!(check(&states), "blocked");
    states[0].train = radians(90.0);
    assert_eq!(check(&states), "out-of-range");
    states[0].train = 0.0;
    assert_eq!(check(&states), "blocked");
}

#[test]
fn iowa_roof_bofors_fires_from_the_moving_main_turret() {
    let catalog =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    let compiled = Arc::new(CompiledShip::new(catalog.definitions["iowa"].clone()).unwrap());
    let mut actor = Vessel::new("iowa", TeamId::A, compiled.clone());
    let def = &compiled.definition;
    let child = def
        .mounts
        .iter()
        .position(|m| m.parent_mount_id.is_some())
        .unwrap();
    let parent = def
        .mounts
        .iter()
        .position(|m| Some(&m.id) == def.mounts[child].parent_mount_id.as_ref())
        .unwrap();
    for (i, m) in actor.mounts.iter_mut().enumerate() {
        if i != child && i != parent {
            m.hp = 0.0;
        }
    }
    let carrier = Vessel::new(
        "carrier",
        TeamId::B,
        Arc::new(CompiledShip::new(catalog.definitions["enterprise-cv6"].clone()).unwrap()),
    );
    let mut air = Aviation::new(&[carrier], catalog.aircraft.clone());
    air.wings[0].state.planes.truncate(1);
    let plane = &mut air.wings[0].state.planes[0];
    plane.phase = "outbound".into();
    plane.deck_slot = None;
    plane.hp = 1e6;
    plane.position = [600.0, 250.0, 600.0];
    plane.velocity = [0.0; 3];
    let orders = PlayerGunOrders {
        battery: "main".into(),
        weapon_group_id: None,
        aim: Some([1500.0, 10.0, 0.0]),
        fire: false,
        ammunition: BTreeMap::new(),
    };
    let (mut sequence, mut dispersion) = (0, 0);
    let mut shells = vec![];
    let mut fired = 0;
    for _ in 0..600 {
        let mut events = vec![];
        operate(
            &mut actor,
            &mut GunneryContext {
                actors: &[],
                aviation: &mut air,
                shells: &mut shells,
                sequence: &mut sequence,
                dispersion: &mut dispersion,
                events: &mut events,
                seed: 17,
                dt: DT,
            },
            None,
            Some(&orders),
        );
        let shots: Vec<_> = events
            .iter()
            .filter(|e| e.message == format!("{} · AA fire", def.mounts[child].name))
            .collect();
        for (barrel, shot) in shots.iter().enumerate() {
            let m = &def.mounts[child];
            let s = &actor.mounts[child];
            // Compose an independent neutral gun pose under the parent's yaw.
            let mut neutral = s.clone();
            neutral.carrier = None;
            let local = muzzle_local(m, &neutral, barrel);
            let pivot = def.mounts[parent].position;
            let expected = local_to_world(
                sub(local, pivot),
                Pose {
                    x: pivot[0],
                    y: pivot[1],
                    z: pivot[2],
                    heading: actor.mounts[parent].train,
                    ..Pose::default()
                },
            );
            vector(shot.position, expected);
            fired += 1;
        }
    }
    assert!(actor.mounts[parent].train.abs() > radians(20.0));
    assert!(
        fired > 0,
        "roof Bofors never fired: {}",
        actor.mounts[child].status
    );
    near(
        actor.mounts[child].ammo,
        def.mounts[child].weapon.ammo_per_barrel * 2.0 - fired as f64,
    );
}
