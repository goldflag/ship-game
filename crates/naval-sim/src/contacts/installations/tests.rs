use super::*;
use crate::{
    contacts::{ContactGeometry, contact_armor, ship_contacts},
    damage::Combatant,
    protection::plate_hit,
};

fn support() -> ShipDefinition {
    let mut def: ShipDefinition =
        serde_json::from_str(include_str!("../../../../../public/models/valiant.json")).unwrap();
    let cache = InstallationContacts::new(&def);
    let ring = &cache.rings[0];
    def.armor = ring
        .outer
        .iter()
        .chain(&ring.cap)
        .map(|&i| def.armor[i].clone())
        .collect();
    def.mounts.clear();
    def.modules.clear();
    def.connections.clear();
    def.structural_plating = None;
    def
}

fn cast(def: &ShipDefinition, from: Vec3, to: Vec3) -> Vec<ShipContact> {
    ship_contacts(
        &Shell::default(),
        from,
        to,
        &Combatant::new("support", def),
        def,
        &ContactGeometry::new(def).unwrap(),
    )
}

#[test]
fn published_construction_supports_use_two_shapes_without_changing_the_definition() {
    for (source, rings) in [
        (
            include_str!("../../../../../public/models/valiant.json"),
            11,
        ),
        (
            include_str!("../../../../../public/models/resolute.json"),
            12,
        ),
        (
            include_str!("../../../../../public/models/bismarck.json"),
            0,
        ),
    ] {
        let def: ShipDefinition = serde_json::from_str(source).unwrap();
        let before = serde_json::to_vec(&def).unwrap();
        let geometry = ContactGeometry::new(&def).unwrap();
        assert_eq!(geometry.installations.rings.len(), rings, "{}", def.id);
        assert_eq!(
            geometry.armor_shape_count(&def),
            def.armor.len() - rings * 126
        );
        assert_eq!(serde_json::to_vec(&def).unwrap(), before);
    }
}

#[test]
fn circular_wall_stays_within_the_authored_faceting_error_and_keeps_sector_armor() {
    let mut def = support();
    // Sector-specific protection still belongs to the authored plate.
    def.armor[7].thickness_mm = 123.;
    def.armor[7].plate.as_mut().unwrap().material = "KC".into();
    let cache = InstallationContacts::new(&def);
    let ring = &cache.rings[0];
    let center = [ring.center[0], (ring.low + ring.top) / 2., ring.center[2]];
    let bound = ring.radius * (1. - (TAU / 128.).cos());
    for i in 0..256 {
        let a = ring.angle + (i as f64 + 0.37) * TAU / 256.;
        let normal = [a.cos(), 0., a.sin()];
        let to = add(center, scale(normal, ring.radius * 2.));
        let hits = cast(&def, center, to);
        assert_eq!(hits.len(), 1, "one wall, no inner-wall duplicate at {i}");
        let actual = &hits[0];
        let exact = def
            .armor
            .iter()
            .enumerate()
            .find_map(|(j, armor)| plate_hit(center, to, armor, &def, &[]).map(|h| (j, h)))
            .unwrap();
        assert_eq!(actual.index as usize, exact.0);
        assert!(length(sub(actual.point, exact.1.point)) <= bound + EPS);
        assert!(dot(actual.normal, exact.1.normal) >= (TAU / 128.).cos() - EPS);
        let armor = contact_armor(&def, actual);
        assert_eq!(armor.thickness_mm, def.armor[exact.0].thickness_mm);
        assert_eq!(
            armor.plate.as_ref().unwrap().material,
            def.armor[exact.0].plate.as_ref().unwrap().material
        );
        assert_eq!(armor.exterior, Some(false));
        let reverse = cast(&def, to, center);
        assert_eq!(reverse.len(), 1);
        assert!(near(reverse[0].point, actual.point));
    }
}

#[test]
fn annulus_keeps_the_bore_open_and_does_not_add_a_bottom_or_inner_wall() {
    let def = support();
    let cache = InstallationContacts::new(&def);
    let ring = &cache.rings[0];
    for (r, count) in [
        (0., 0),
        (ring.inner * 0.9, 0),
        ((ring.inner + ring.radius) / 2., 1),
        (ring.radius * 1.1, 0),
    ] {
        let point = [ring.center[0] + r, ring.top, ring.center[2]];
        let hits = cast(&def, add(point, [0., 1., 0.]), add(point, [0., -1., 0.]));
        assert_eq!(hits.len(), count, "radius {r}");
        if count == 1 {
            assert_eq!(hits[0].normal, [0., 1., 0.]);
            assert!(
                contact_armor(&def, &hits[0])
                    .id
                    .contains("installation-top")
            );
        }
    }
    let point = [
        ring.center[0] + (ring.inner + ring.radius) / 2.,
        ring.low,
        ring.center[2],
    ];
    let step = (ring.top - ring.low) / 4.;
    assert!(
        cast(
            &def,
            add(point, [0., -step, 0.]),
            add(point, [0., step, 0.])
        )
        .is_empty()
    );
}

#[test]
fn entry_exit_tangent_short_segments_and_top_seams_do_not_double_charge() {
    let def = support();
    let cache = InstallationContacts::new(&def);
    let ring = &cache.rings[0];
    let center = [ring.center[0], (ring.low + ring.top) / 2., ring.center[2]];
    let offset = [ring.radius * 2., 0., 0.];
    let hits = cast(&def, add(center, offset), sub(center, offset));
    assert_eq!(hits.len(), 2);
    assert!(hits[0].t < hits[1].t);
    let tangent = add(center, [ring.radius, 0., 0.]);
    assert!(
        cast(
            &def,
            add(tangent, [0., 0., -ring.radius]),
            add(tangent, [0., 0., ring.radius])
        )
        .is_empty()
    );
    assert_eq!(
        cast(
            &def,
            add(tangent, [0.0001, 0., 0.]),
            add(tangent, [-0.0001, 0., 0.])
        )
        .len(),
        1
    );
    let normal = [ring.angle.cos(), 0., ring.angle.sin()];
    let rim = add(
        [ring.center[0], ring.top, ring.center[2]],
        scale(normal, ring.radius),
    );
    let diagonal = add(scale(normal, 0.1), [0., 0.1, 0.]);
    let (from, to) = (add(rim, diagonal), sub(rim, diagonal));
    let hits = cast(&def, from, to);
    assert_eq!(hits.len(), 1, "top and wall meet in a single crossing");
    assert!(!hits[0].seam_keys.is_empty());
    let mut shell = Shell::default();
    shell.visited.push(hits[0].key.clone());
    shell.visited.extend(hits[0].seam_keys.iter().cloned());
    assert!(
        ship_contacts(
            &shell,
            from,
            to,
            &Combatant::new("support", &def),
            &def,
            &ContactGeometry::new(&def).unwrap()
        )
        .is_empty()
    );
}

#[test]
fn translated_rotated_supports_follow_ship_attitude_and_keep_damage_identity() {
    let mut def = support();
    let pose = Pose {
        x: 12.,
        y: -3.,
        z: 49.,
        heading: 0.71,
        ..Default::default()
    };
    for armor in &mut def.armor {
        let vertices = &mut armor.plate.as_mut().unwrap().vertices;
        for p in vertices.iter_mut() {
            *p = local_to_world(*p, pose);
        }
        let (center, size) = crate::structure::bounds(vertices.iter().copied());
        armor.center = center;
        armor.size = size;
    }
    let geometry = ContactGeometry::new(&def).unwrap();
    assert_eq!(geometry.armor_shape_count(&def), 2);
    let ring = &geometry.installations.rings[0];
    let from = [ring.center[0], (ring.low + ring.top) / 2., ring.center[2]];
    let to = add(from, [ring.radius * 2., 0., 0.]);
    let expected = cast(&def, from, to);
    let mut actor = Combatant::new("support", &def);
    actor.motion.x = 347.;
    actor.motion.z = -993.;
    actor.motion.heading = 1.2;
    actor.motion.roll = 0.27;
    actor.motion.pitch = -0.19;
    let basis = actor.motion.basis();
    let actual = ship_contacts(
        &Shell::default(),
        basis.local_to_world(from),
        basis.local_to_world(to),
        &actor,
        &def,
        &geometry,
    );
    assert_eq!(actual.len(), 1);
    assert_eq!(actual[0].key, expected[0].key);
    assert!(near(actual[0].point, expected[0].point));
    assert!(near(actual[0].normal, expected[0].normal));
}

#[test]
fn malformed_moving_or_flood_linked_supports_and_unrelated_definitions_use_literal_plates() {
    for change in 0..5 {
        let mut def = support();
        match change {
            0 => {
                def.armor.pop();
            }
            1 => {
                def.armor[0].plate.as_mut().unwrap().vertices[0][0] += 0.01;
            }
            2 => {
                def.armor[0].plate.as_mut().unwrap().mount_id = Some("gun".into());
            }
            3 => {
                def.connections.push(crate::definition::FloodConnection {
                    armor_id: Some(def.armor[0].id.clone()),
                    ..Default::default()
                });
            }
            _ => {
                def.construction = None;
            }
        }
        let geometry = ContactGeometry::new(&def).unwrap();
        assert_eq!(geometry.armor_shape_count(&def), def.armor.len());
    }
    let def = support();
    let geometry = ContactGeometry::new(&def).unwrap();
    let mut other = def.clone();
    other.armor[0].plate.as_mut().unwrap().vertices[0][0] += 0.01;
    assert_eq!(geometry.armor_shape_count(&other), other.armor.len());
    let ring = &geometry.installations.rings[0];
    let from = [ring.center[0], (ring.low + ring.top) / 2., ring.center[2]];
    let to = add(from, [ring.radius * 2., 0., 0.]);
    let actor = Combatant::new("support", &other);
    let cached = ship_contacts(&Shell::default(), from, to, &actor, &other, &geometry);
    let fresh = cast(&other, from, to);
    assert_eq!(
        serde_json::to_value(cached).unwrap(),
        serde_json::to_value(fresh).unwrap()
    );
}
