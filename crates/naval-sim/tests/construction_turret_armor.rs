use naval_sim::{
    construction,
    contacts::{ContactGeometry, ContactKind, contact_armor, ship_contacts},
    damage::Combatant,
    definition::*,
    geometry::*,
    impact::resolve_ship_contact,
    mount_frames::mount_frame,
    shell::Shell,
};

fn compiled(part_id: &str) -> ShipDefinition {
    let catalog: ConstructionCatalog = serde_json::from_str(include_str!(
        "../../../public/models/components/catalog.json"
    ))
    .unwrap();
    let part = catalog.equipment.iter().find(|p| p.id == part_id).unwrap();
    let attachment = part
        .sockets
        .iter()
        .flatten()
        .find(|s| s.id == "attachment")
        .unwrap()
        .position[1];
    let source = ConstructionSource {
        schema_version: 1.,
        id: "turret-armor".into(),
        revision: "r1".into(),
        name: "Turret armor".into(),
        coordinates: "meters-y-up-bow-negative-z".into(),
        construction: ConstructionData {
            version: 2.,
            catalog_revision: catalog.revision.clone(),
            default_thickness_mm: 16.,
            primitives: vec![ConstructionPrimitive {
                id: "hull".into(),
                kind: "box".into(),
                size: [40., 16., 120.],
                ..Default::default()
            }],
            equipment: [("forward", 2., -25., 37.), ("aft", -2., 25., 180.)]
                .into_iter()
                .map(|(id, x, z, bearing)| ConstructionEquipment {
                    id: id.into(),
                    part_id: part_id.into(),
                    position: [x, 10. - attachment, z],
                    bearing_deg: bearing,
                    gun: Some(ConstructionEquipmentGun {
                        barbette_height_m: Some(2.),
                        ..Default::default()
                    }),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        },
    };
    let result = construction::compile(&source, &catalog);
    result
        .definition
        .unwrap_or_else(|| panic!("{part_id}: {:?}", result.diagnostics))
}

#[test]
fn construction_preserves_each_installed_gunhouse_facet() {
    for part in ["sk-c34-283-triple", "sk-c28-150-twin"] {
        let def = compiled(part);
        for mount in &def.mounts {
            let mesh = mount.weapon.gunhouse_mesh.as_ref().unwrap();
            let armor: Vec<_> = def
                .armor
                .iter()
                .filter(|a| a.plate.as_ref().unwrap().mount_id.as_ref() == Some(&mount.id))
                .collect();
            assert_eq!(armor.len(), mesh.faces.len(), "{}", mount.id);
            for face in &mesh.faces {
                let id = format!("{}-turret-{}", mount.id, face.id);
                let a = armor.iter().find(|a| a.id == id).unwrap();
                let plate = a.plate.as_ref().unwrap();
                let expected: Vec<Vec3> = face
                    .indices
                    .iter()
                    .map(|&i| {
                        let [forward, port, up] = mesh.vertices[i as usize];
                        [-port, up, -forward]
                    })
                    .collect();
                assert_eq!(plate.vertices, expected);
                assert_eq!(plate.material, face.material);
                assert_eq!(a.thickness_mm, face.thickness_mm);
                assert_eq!(
                    serde_json::to_value(&a.provenance).unwrap(),
                    serde_json::to_value(&mesh.provenance).unwrap()
                );
                assert!(expected.iter().all(|p| {
                    (0..3).all(|i| (p[i] - a.center[i]).abs() <= a.size[i] / 2. + 1e-8)
                }));
            }
        }
        assert!(
            ContactGeometry::new(&def)
                .unwrap()
                .plated_mounts
                .iter()
                .all(|p| *p)
        );
    }
}

#[test]
fn shells_use_face_armor_and_follow_independently_trained_turrets() {
    let def = compiled("sk-c34-283-triple");
    let geometry = ContactGeometry::new(&def).unwrap();
    for index in 0..def.mounts.len() {
        for train in [0., 0.73] {
            for (face_id, thickness, stopped) in [
                ("face-1", 360., true),
                ("side-port-1", 200., false),
                ("rear-port-1", 350., true),
                ("roof-1", 150., false),
            ] {
                let mut actor = Combatant::new("target", &def);
                actor.motion.x = 17.;
                actor.motion.z = -31.;
                actor.motion.heading = 0.4;
                actor.mounts[index].train = train;
                let pose = mount_frame(&def, index, &|i| actor.mounts[i].train);
                let mesh = def.mounts[index].weapon.gunhouse_mesh.as_ref().unwrap();
                let face = mesh.faces.iter().find(|f| f.id == face_id).unwrap();
                let [a, b, c] = face.indices.map(|i| {
                    let [forward, port, up] = mesh.vertices[i as usize];
                    [-port, up, -forward]
                });
                let middle = scale(add(add(a, b), c), 1. / 3.);
                let normal = normalize(cross(sub(b, a), sub(c, a)));
                let world = |p| local_to_world(local_to_world(p, pose), actor.motion.pose());
                let from = world(add(middle, scale(normal, 0.05)));
                let to = world(sub(middle, scale(normal, 0.05)));
                let mut shell = Shell {
                    position: from,
                    velocity: scale(normalize(sub(to, from)), 800.),
                    penetration_mm: 250.,
                    damage: 10.,
                    caliber_m: 0.283,
                    ..Default::default()
                };
                let hits = ship_contacts(&shell, from, to, &actor, &def, &geometry);
                assert_eq!(hits.len(), 1, "{index} {train} {face_id}: {hits:?}");
                let hit = &hits[0];
                assert_eq!(hit.kind, ContactKind::Armor);
                let armor = contact_armor(&def, hit);
                assert_eq!(armor.thickness_mm, thickness);
                assert_eq!(
                    armor.plate.unwrap().mount_id.as_ref(),
                    Some(&def.mounts[index].id)
                );
                let hp = actor.mounts[index].hp;
                let (stop, event) = resolve_ship_contact(&mut shell, hit, &mut actor, &def, None);
                assert_eq!(stop, stopped, "{face_id}");
                assert_eq!(event.impact.unwrap().thickness_mm, Some(thickness));
                assert_eq!(actor.mounts[index].hp < hp, !stopped);
                assert_eq!(actor.mounts[1 - index].hp, hp);
            }
        }
    }
}

#[test]
fn unplated_guns_keep_the_existing_box_fallback() {
    let def = compiled("flak-37-bismarck-1941");
    let geometry = ContactGeometry::new(&def).unwrap();
    assert!(geometry.plated_mounts.iter().all(|p| !p));
    let actor = Combatant::new("target", &def);
    let mount = &def.mounts[0];
    let pose = mount_frame(&def, 0, &|_| 0.);
    let y = mount.weapon.gunhouse_size[2] / 2.;
    let from = local_to_world([0., y, -5.], pose);
    let to = local_to_world([0., y, 0.], pose);
    let hits = ship_contacts(&Shell::default(), from, to, &actor, &def, &geometry);
    assert!(
        hits.iter()
            .any(|h| h.kind == ContactKind::Mount && h.index == 0)
    );
}
