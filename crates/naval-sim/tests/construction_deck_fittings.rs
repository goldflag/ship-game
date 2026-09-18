//! Native acceptance for loading-only deck fittings and connected physical routes.
use naval_sim::{construction, definition::*};

fn fixture() -> (ConstructionSource, ConstructionCatalog) {
    (
        ConstructionSource {
            schema_version: 1.,
            id: "deck-fittings".into(),
            name: "Deck fittings".into(),
            coordinates: "meters-y-up-bow-negative-z".into(),
            revision: "one".into(),
            construction: ConstructionData {
                version: 1.,
                catalog_revision: "test".into(),
                default_thickness_mm: 10.,
                primitives: vec![ConstructionPrimitive { tilt: None, mesh: None, balcony: None, shaping: None, custom_hull: None,
                    id: "hull".into(),
                    kind: "box".into(),
                    size: [10., 4., 20.],
                    ..Default::default()
                }],
                ..Default::default()
            },
        },
        ConstructionCatalog {
            schema_version: 1.,
            revision: "test".into(),
            weapons: PartCatalog {
                schema_version: 1.,
                ..Default::default()
            },
            ..Default::default()
        },
    )
}
fn part(id: &str) -> ConstructionEquipmentPart {
    ConstructionEquipmentPart {
        id: id.into(),
        name: id.into(),
        kind: "deck-fitting".into(),
        placement: "deck".into(),
        size: [1., 1., 1.],
        bounds_center: [0., 0.5, 0.],
        center_of_gravity: [0., 0.5, 0.],
        mass_kg: Some(300.),
        model_url: format!("/models/components/{id}/test.glb"),
        content_hash: "test".into(),
        sockets: Some(vec![ConstructionEquipmentPartSocketsItem {
            id: "attachment".into(),
            kind: "support".into(),
            position: [0.; 3],
            direction: [0., -1., 0.],
        }]),
        ..Default::default()
    }
}
fn route_part(kind: &str) -> ConstructionEquipmentPart {
    let mut p = part(kind);
    p.mass_kg = Some(2.);
    p.path = Some(ConstructionEquipmentPartPath {
        kind: kind.into(),
        diameter_m: if kind == "chain" { 0.035 } else { 0.04 },
        mass_kg_per_m: if kind == "railing" { 8.4 } else { 1.2 },
        height_m: (kind == "railing").then_some(1.1),
        post_spacing_m: (kind == "railing").then_some(1.5),
        post_mass_kg: (kind == "railing").then_some(6.),
        ..Default::default()
    });
    p
}
fn fixed(id: &str, position: Vec3) -> ConstructionEquipment {
    ConstructionEquipment {
        id: id.into(),
        part_id: id.into(),
        position,
        ..Default::default()
    }
}
fn route(kind: &str, points: Vec<Vec3>, slack: f64) -> ConstructionEquipment {
    ConstructionEquipment {
        id: format!("{kind}-route"),
        part_id: kind.into(),
        path: Some(ConstructionEquipmentPath {
            points,
            slack_m: Some(slack),
            ..Default::default()
        }),
        ..Default::default()
    }
}
fn compiled(s: &ConstructionSource, c: &ConstructionCatalog) -> ShipDefinition {
    let r = construction::compile(s, c);
    r.definition
        .unwrap_or_else(|| panic!("{:?}", r.diagnostics))
}
fn rejected(s: &ConstructionSource, c: &ConstructionCatalog, code: &str) {
    let r = construction::compile(s, c);
    assert!(r.definition.is_none(), "invalid fitting compiled");
    assert!(
        r.diagnostics.iter().any(|d| d.code == code),
        "{:?}",
        r.diagnostics
    );
}
fn contribution<'a>(d: &'a ShipDefinition, id: &str) -> &'a ConstructionMass {
    d.loading
        .as_ref()
        .unwrap()
        .contributions
        .iter()
        .find(|m| m.id == id)
        .unwrap()
}
fn eye_fixture() -> (ConstructionSource, ConstructionCatalog) {
    let (mut s, mut c) = fixture();
    c.equipment.push(route_part("rope"));
    // The route intentionally appears before its anchors in source order.
    s.construction
        .equipment
        .push(route("rope", vec![[-3., 4., 0.], [3., 4., 0.]], 0.));
    for (id, x, inward) in [("port-eye", -3.06, 1.), ("starboard-eye", 3.06, -1.)] {
        let mut p = part(id);
        p.size = [0.12, 2., 0.12];
        p.bounds_center = [0., 1., 0.];
        p.center_of_gravity = p.bounds_center;
        p.sockets
            .as_mut()
            .unwrap()
            .push(ConstructionEquipmentPartSocketsItem {
                id: "rope-eye".into(),
                kind: "rigging".into(),
                position: [inward * 0.06, 2., 0.],
                direction: [inward, 0., 0.],
            });
        c.equipment.push(p);
        s.construction.equipment.push(fixed(id, [x, 2., 0.]));
    }
    (s, c)
}

fn registered_part(id: &str) -> ConstructionEquipmentPart {
    let source: serde_json::Value =
        serde_json::from_str(include_str!("../../../assets/parts/construction.json")).unwrap();
    let mut value = source["equipment"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == id)
        .unwrap()
        .clone();
    value["modelUrl"] = serde_json::json!(format!("/models/components/{id}/fixture.glb"));
    value["contentHash"] = serde_json::json!("fixture");
    serde_json::from_value(value).unwrap()
}

#[test]
fn legacy_sources_keep_their_physics_and_static_searchlights_only_add_catalog_mass() {
    let (mut s, mut c) = fixture();
    let before = compiled(&s, &c);
    c.equipment.push(part("searchlight"));
    c.equipment.push(route_part("railing"));
    let unused = compiled(&s, &c);
    assert_eq!(
        serde_json::to_value(&before.loading).unwrap(),
        serde_json::to_value(&unused.loading).unwrap()
    );
    let mut encoded = serde_json::to_value(&s).unwrap();
    encoded["construction"]["equipment"] = serde_json::json!([{
        "id": "searchlight", "partId": "searchlight", "position": [2, 2, 1], "bearingDeg": 90
    }]);
    s = serde_json::from_value(encoded).unwrap();
    assert!(s.construction.equipment[0].path.is_none());
    let after = compiled(&s, &c);
    let m = contribution(&after, "searchlight");
    assert_eq!(m.mass_kg, 300.);
    assert_eq!(m.center, [2., 2.5, 1.]);
    assert!(after.modules.is_empty() && after.mounts.is_empty());
    let a = after.loading.unwrap();
    let b = before.loading.unwrap();
    assert!((a.mass_kg - b.mass_kg - 300.).abs() < 1e-7);
    assert_eq!(a.envelope_volume_m3, b.envelope_volume_m3);
    assert_eq!(a.usable_volume_m3, b.usable_volume_m3);
    assert_eq!(a.power_kw, 0.);
}

#[test]
fn original_rear_attachment_datum_supports_side_fittings_and_rejects_wrong_orientation() {
    let (mut s, mut c) = fixture();
    let mut p = part("door");
    p.size = [1., 2., 0.2];
    p.bounds_center = [0., 1., -0.1];
    p.center_of_gravity = p.bounds_center;
    p.sockets.as_mut().unwrap()[0].direction = [0., 0., 1.];
    c.equipment.push(p);
    let mut e = fixed("door", [5., -1., 0.]);
    e.bearing_deg = 90.;
    s.construction.equipment.push(e);
    let d = compiled(&s, &c);
    assert!((contribution(&d, "door").center[0] - 5.1).abs() < 1e-8);
    s.construction.equipment[0].bearing_deg = 0.;
    rejected(&s, &c, "equipment-attachment");
    s.construction.equipment[0].bearing_deg = 90.;
    s.construction.equipment[0].position[0] += 0.1;
    rejected(&s, &c, "equipment-attachment");
}

#[test]
fn railing_counts_real_posts_and_keeps_empty_route_space_free() {
    let (mut s, mut c) = fixture();
    c.equipment.push(route_part("railing"));
    c.equipment.push(part("vent"));
    s.construction.equipment.push(route(
        "railing",
        vec![[-4., 2., -4.], [4., 2., -4.], [4., 2., 4.]],
        0.,
    ));
    s.construction.equipment.push(fixed("vent", [0., 2., 0.]));
    let d = compiled(&s, &c);
    let m = contribution(&d, "railing-route");
    // Each eight-metre leg has six spans/seven posts; the corner post is shared.
    assert!((m.mass_kg - (2. + 16. * 8.4 + 13. * 6.)).abs() < 1e-7);
    let expected_y = 2. + (16. * 8.4 * (1.1 * 2. / 3. - 0.02) + 13. * 6. * 0.55) / m.mass_kg;
    assert!((m.center[1] - expected_y).abs() < 1e-7);
    assert!(m.inertia_kg_m2.iter().all(|i| *i > 0.));
    assert!(!d.obstructions.iter().any(|v| v.id == "railing-route"));
}

#[test]
fn a_rail_cannot_bridge_an_unsupported_run_of_posts() {
    let (mut s, mut c) = fixture();
    c.equipment.push(route_part("railing"));
    s.construction.primitives[0].size[1] = 2.;
    s.construction.primitives[0].position[1] = -1.;
    for (id, x) in [("port-deck", -4.), ("starboard-deck", 4.)] {
        s.construction.primitives.push(ConstructionPrimitive { tilt: None, mesh: None, balcony: None, shaping: None, custom_hull: None,
            id: id.into(),
            kind: "box".into(),
            position: [x, 1., 0.],
            size: [2., 2., 20.],
            ..Default::default()
        });
    }
    s.construction
        .equipment
        .push(route("railing", vec![[-4., 2., 0.], [4., 2., 0.]], 0.));
    rejected(&s, &c, "equipment-path");
}

#[test]
fn supported_rope_slack_adds_real_length_and_lowers_its_distributed_cg() {
    let (mut s, c) = eye_fixture();
    let taut = compiled(&s, &c);
    assert!((contribution(&taut, "rope-route").mass_kg - 9.2).abs() < 1e-8);
    s.construction.equipment[0].path.as_mut().unwrap().slack_m = Some(1.);
    let sagged = compiled(&s, &c);
    let a = contribution(&taut, "rope-route");
    let b = contribution(&sagged, "rope-route");
    // Continuous parabola length, independent of the native piecewise-rod sum.
    let slope: f64 = 4. / 6.;
    let exact_length = 3. * ((1. + slope * slope).sqrt() + slope.asinh() / slope);
    assert!((b.mass_kg - (2. + exact_length * 1.2)).abs() < 0.003);
    assert!(b.mass_kg > a.mass_kg && b.center[1] < a.center[1] - 0.4);
    assert_eq!(b.center[0], 0.);
    assert_eq!(b.center[2], 0.);
    let (mut rotated, catalog) = eye_fixture();
    for e in &mut rotated.construction.equipment {
        e.bearing_deg = 90.;
        e.position = [-e.position[2], e.position[1], e.position[0]];
    }
    rotated.construction.equipment[0]
        .path
        .as_mut()
        .unwrap()
        .slack_m = Some(1.);
    let turned = compiled(&rotated, &catalog);
    let r = contribution(&turned, "rope-route");
    assert!((r.mass_kg - b.mass_kg).abs() < 1e-8);
    assert!((r.inertia_kg_m2[0] - b.inertia_kg_m2[2]).abs() < 1e-7);
}

#[test]
fn rope_anchors_require_explicit_independently_supported_sockets() {
    let (mut s, mut c) = eye_fixture();
    c.equipment[1]
        .sockets
        .as_mut()
        .unwrap()
        .retain(|x| x.id == "attachment");
    rejected(&s, &c, "equipment-path");
    let (source, catalog) = eye_fixture();
    s = source;
    c = catalog;
    s.construction.equipment[1].position[1] += 0.5;
    rejected(&s, &c, "equipment-attachment");
    let (source, catalog) = eye_fixture();
    s = source;
    c = catalog;
    s.construction.equipment[0].path.as_mut().unwrap().points[0][1] -= 0.3;
    rejected(&s, &c, "equipment-path");
}

#[test]
fn sag_cannot_pass_through_hull_and_fixed_parts_cannot_hide_path_data() {
    let (mut s, c) = eye_fixture();
    s.construction.equipment[0].path.as_mut().unwrap().slack_m = Some(2.5);
    rejected(&s, &c, "equipment-path");
    let (mut s, mut c) = fixture();
    c.equipment.push(part("vent"));
    let mut e = fixed("vent", [0., 2., 0.]);
    e.path = Some(ConstructionEquipmentPath {
        points: vec![[0.; 3], [1., 0., 0.]],
        slack_m: None,
        ..Default::default()
    });
    s.construction.equipment.push(e);
    rejected(&s, &c, "equipment-path");
}

#[test]
fn path_source_bounds_and_chain_envelope_are_enforced() {
    let (mut s, mut c) = fixture();
    c.equipment.push(route_part("chain"));
    s.construction
        .equipment
        .push(route("chain", vec![[-3., 2.07, 0.], [3., 2.07, 0.]], 0.));
    compiled(&s, &c);
    s.construction.equipment[0].path.as_mut().unwrap().points[0][1] = 2.01;
    s.construction.equipment[0].path.as_mut().unwrap().points[1][1] = 2.01;
    rejected(&s, &c, "equipment-path");
    for points in [
        vec![[0.; 3]],
        vec![[0.; 3]; 65],
        vec![[0.; 3], [0.01, 0., 0.]],
        vec![[0.; 3], [501., 0., 0.]],
    ] {
        s.construction.equipment[0].path.as_mut().unwrap().points = points;
        rejected(&s, &c, "equipment-path");
    }
    s.construction.equipment[0].path.as_mut().unwrap().points =
        vec![[-3., 2.07, 0.], [3., 2.07, 0.]];
    for slack in [-1., 3.1, f64::NAN] {
        s.construction.equipment[0].path.as_mut().unwrap().slack_m = Some(slack);
        rejected(&s, &c, "equipment-path");
    }
}

#[test]
fn nearby_diagonal_ropes_do_not_collide_just_because_their_route_bounds_overlap() {
    let (mut s, mut c) = fixture();
    c.equipment.push(route_part("rope"));
    let a = route("rope", vec![[-4., 2.02, -4.], [4., 2.02, 4.]], 0.);
    let mut b = route("rope", vec![[-4., 2.02, -3.8], [3.8, 2.02, 4.]], 0.);
    b.id = "nearby-rope".into();
    s.construction.equipment = vec![a, b];
    compiled(&s, &c);
    s.construction.equipment[1].path.as_mut().unwrap().points =
        vec![[-4., 2.02, 4.], [4., 2.02, -4.]];
    rejected(&s, &c, "equipment-path");
}

#[test]
fn registered_bitts_and_fairlead_eyes_accept_outward_ropes_but_reject_routes_through_the_body() {
    use naval_sim::geometry::{Pose, local_to_world};
    for id in ["generic-twin-bitts", "generic-fairlead", "generic-capstan"] {
        let (mut s, mut c) = fixture();
        let p = registered_part(id);
        let socket = p
            .sockets
            .as_ref()
            .unwrap()
            .iter()
            .find(|s| s.kind == "rigging")
            .unwrap()
            .clone();
        c.equipment.extend([p, registered_part("generic-rope")]);
        let first = ConstructionEquipment {
            id: "anchor-a".into(),
            part_id: id.into(),
            position: [0., 2., 3.],
            ..Default::default()
        };
        let second = ConstructionEquipment {
            id: "anchor-b".into(),
            part_id: id.into(),
            position: [2. * socket.position[0], 2., -3.],
            bearing_deg: 180.,
            ..Default::default()
        };
        let endpoint = |e: &ConstructionEquipment| {
            local_to_world(
                socket.position,
                Pose {
                    x: e.position[0],
                    y: e.position[1],
                    z: e.position[2],
                    heading: e.bearing_deg.to_radians(),
                    ..Default::default()
                },
            )
        };
        let mut rope = route(
            "generic-rope",
            vec![endpoint(&first), endpoint(&second)],
            0.1,
        );
        s.construction.equipment = vec![rope.clone(), first.clone(), second.clone()];
        compiled(&s, &c);
        let mut behind = second;
        behind.position[2] = 8.;
        rope.path.as_mut().unwrap().points = vec![endpoint(&first), endpoint(&behind)];
        s.construction.equipment = vec![rope, first, behind];
        rejected(&s, &c, "equipment-path");
    }
}

#[test]
fn review_bitts_rope_can_leave_its_socket_downward_without_hitting_empty_catalog_bounds() {
    let (mut s, mut c) = fixture();
    // Exact deck/anchor/rope poses from deckFittingsFixture. The bitts' bedplate
    // widens their AABB, but the rope at this height clears the original posts.
    s.construction.primitives[0].size = [24., 2., 36.];
    s.construction.primitives.push(ConstructionPrimitive { tilt: None, mesh: None, balcony: None, shaping: None, custom_hull: None,
        id: "review-wall".into(),
        kind: "box".into(),
        size: [22., 3., 0.5],
        position: [0., 2.5, 15.],
        ..Default::default()
    });
    c.equipment.extend([
        registered_part("generic-twin-bitts"),
        registered_part("generic-rope"),
    ]);
    s.construction.equipment = vec![
        ConstructionEquipment {
            id: "review-twin-bitts".into(),
            part_id: "generic-twin-bitts".into(),
            position: [-8., 1., -10.],
            ..Default::default()
        },
        ConstructionEquipment {
            id: "review-second-bitts".into(),
            part_id: "generic-twin-bitts".into(),
            position: [-8., 1., -16.],
            bearing_deg: 180.,
            ..Default::default()
        },
        ConstructionEquipment {
            id: "review-rope".into(),
            part_id: "generic-rope".into(),
            position: [-7.54, 1.46, -10.155],
            path: Some(ConstructionEquipmentPath {
                points: vec![[0.; 3], [0., 0., -5.69]],
                slack_m: Some(0.3),
                ..Default::default()
            }),
            ..Default::default()
        },
    ];
    for slack in [0.3, 0.35, 0.4] {
        s.construction.equipment[2].path.as_mut().unwrap().slack_m = Some(slack);
        compiled(&s, &c);
    }
    s.construction.equipment[2].path.as_mut().unwrap().slack_m = Some(0.45);
    let grounded = construction::compile(&s, &c);
    assert!(grounded.definition.is_none());
    assert!(
        grounded
            .diagnostics
            .iter()
            .any(|d| d.message.contains("runs through the hull")),
        "{:?}",
        grounded.diagnostics
    );
    // Turn the first bitts around while preserving its exact eye location:
    // the same rope now leaves behind its declared socket and crosses its post.
    s.construction.equipment[0].position = [-7.08, 1., -10.31];
    s.construction.equipment[0].bearing_deg = 180.;
    s.construction.equipment[2].path.as_mut().unwrap().slack_m = Some(0.35);
    rejected(&s, &c, "equipment-path");
}

#[test]
fn every_registered_fixed_deck_fitting_uses_its_original_attachment_and_rangefinder_keeps_director_behavior()
 {
    for id in [
        "generic-twin-bitts",
        "generic-fairlead",
        "generic-capstan",
        "generic-anchor-windlass",
        "generic-stowed-anchor",
        "generic-lifeboat-davits",
        "generic-mushroom-vent",
        "generic-cowl-vent",
        "generic-watertight-door",
        "generic-deck-hatch",
        "generic-optical-rangefinder",
        "generic-static-searchlight",
        "generic-vertical-ladder",
        "generic-inclined-stairs",
    ] {
        let (mut s, mut c) = fixture();
        let p = registered_part(id);
        let attachment = p
            .sockets
            .as_ref()
            .unwrap()
            .iter()
            .find(|s| s.id == "attachment")
            .unwrap();
        let side = attachment.direction[2] > 0.5;
        let mut e = fixed(id, if side { [0., -1.5, -10.] } else { [0., 2., 0.] });
        for i in 0..3 {
            e.position[i] -= attachment.position[i];
        }
        let catalog_mass = p.mass_kg.unwrap();
        c.equipment.push(p);
        s.construction.equipment.push(e);
        let d = compiled(&s, &c);
        assert_eq!(contribution(&d, id).mass_kg, catalog_mass);
        if id == "generic-optical-rangefinder" {
            assert_eq!(d.modules.len(), 1);
            assert_eq!(d.modules[0].kind, "fire-control");
        } else {
            assert!(d.modules.is_empty());
        }
    }
}

#[test]
fn fitting_paint_roundtrips_and_changes_visual_identity_without_changing_loading() {
    let (mut source, mut catalog) = fixture();
    catalog.equipment.push(part("painted"));
    source.construction.equipment.push(fixed("painted", [0., 2., 0.]));
    let original = construction::compile(&source, &catalog);
    source.construction.equipment[0].paint = Some("sea-blue".into());
    let saved = serde_json::to_string(&source).unwrap();
    let restored: ConstructionSource = serde_json::from_str(&saved).unwrap();
    let painted = construction::compile(&restored, &catalog);
    assert_ne!(original.content_hash, painted.content_hash);
    let before = original.definition.unwrap();
    let after = painted.definition.unwrap();
    assert_eq!(before.hull.mass_kg, after.hull.mass_kg);
    assert_eq!(after.construction.unwrap().equipment[0].paint.as_deref(), Some("sea-blue"));
    source.construction.equipment[0].paint = Some(String::new());
    rejected(&source, &catalog, "equipment-paint");
}

#[test]
fn internal_planes_do_not_collide_with_exterior_fittings() {
    for (axis, offset) in [("x", 0.), ("y", 0.), ("z", 5.)] {
        let (mut source, mut catalog) = fixture();
        let mut fitting = part("outside");
        let position = if axis == "y" {
            // Side fitting straddles the deck plane outside the starboard skin.
            fitting.bounds_center = [0.5, 0., 0.];
            fitting.center_of_gravity = fitting.bounds_center;
            fitting.sockets.as_mut().unwrap()[0].direction = [-1., 0., 0.];
            [5., 0., 0.]
        } else {
            // Top fitting straddles the split/bulkhead plane above the deck.
            [0., 2., 5.]
        };
        catalog.equipment.push(fitting);
        source.construction.equipment.push(fixed("outside", position));
        source.construction.boundaries.push(ConstructionBoundary {
            id: "inside".into(), axis: axis.into(), offset, thickness_mm: 10.,
        });
        compiled(&source, &catalog);
    }
}

#[test]
fn internal_planes_still_reject_real_machinery_intersections() {
    let (mut source, mut catalog) = fixture();
    let mut engine = part("engine");
    engine.kind = "engine".into();
    engine.placement = "internal".into();
    engine.power_kw = Some(1000.);
    catalog.equipment.push(engine);
    source.construction.equipment.push(fixed("engine", [0., -1., 0.]));
    compiled(&source, &catalog);
    source.construction.boundaries.push(ConstructionBoundary {
        id: "through-engine".into(), axis: "x".into(), offset: 0., thickness_mm: 10.,
    });
    rejected(&source, &catalog, "equipment-fit");
}

#[test]
fn railing_options_change_loading_and_allow_small_contacts() {
    let (mut s, mut c) = fixture();
    c.equipment.push(route_part("railing"));
    s.construction.equipment.push(route("railing", vec![[-4., 2., 0.], [4., 2., 0.]], 0.));
    let original = compiled(&s, &c);
    let path = s.construction.equipment[0].path.as_mut().unwrap();
    path.height_m = Some(1.65);
    path.rail_count = Some(2.);
    let changed = compiled(&s, &c);
    assert!((contribution(&changed, "railing-route").mass_kg - (2. + 8. * 8.4 * 2. / 3. + 7. * 6. * 1.5)).abs() < 1e-7);
    assert!(contribution(&changed, "railing-route").center[1] > contribution(&original, "railing-route").center[1]);
    let mut small = part("small");
    small.size = [0.1, 1., 0.1];
    c.equipment.push(small);
    s.construction.equipment.push(fixed("small", [0.1, 2., 0.]));
    compiled(&s, &c); // A short crossing/contact is normal for a deck railing.
    s.construction.equipment.reverse();
    compiled(&s, &c); // Independent of source order.
    c.equipment.last_mut().unwrap().size = [4., 2., 2.];
    c.equipment.last_mut().unwrap().bounds_center[1] = 1.;
    rejected(&s, &c, "equipment-path");
}

#[test]
fn catalog_rail_count_sets_loading_without_an_instance_override() {
    let (mut s, mut c) = fixture();
    let mut part = route_part("railing");
    let profile = part.path.as_mut().unwrap();
    profile.rail_count = Some(2.);
    profile.mass_kg_per_m = 5.6;
    c.equipment.push(part);
    s.construction.equipment.push(route("railing", vec![[-4., 2., 0.], [4., 2., 0.]], 0.));
    let two = compiled(&s, &c);
    assert!((contribution(&two, "railing-route").mass_kg - (2. + 8. * 5.6 + 7. * 6.)).abs() < 1e-7);
    // Older saved paths keep their explicit count when loaded with a catalog.
    s.construction.equipment[0].path.as_mut().unwrap().rail_count = Some(3.);
    let three = compiled(&s, &c);
    assert!((contribution(&three, "railing-route").mass_kg - (2. + 8. * 8.4 + 7. * 6.)).abs() < 1e-7);
    c.equipment.last_mut().unwrap().path.as_mut().unwrap().rail_count = Some(4.);
    rejected(&s, &c, "equipment-path");
}

#[test]
fn invalid_railing_options_are_rejected_by_native_compiler() {
    for (height, rails) in [(0.2, 3.), (3.1, 3.), (1., 1.), (1., 2.5), (1., 4.)] {
        let (mut s, mut c) = fixture();
        c.equipment.push(route_part("railing"));
        let mut e = route("railing", vec![[-4., 2., 0.], [4., 2., 0.]], 0.);
        e.path.as_mut().unwrap().height_m = Some(height);
        e.path.as_mut().unwrap().rail_count = Some(rails);
        s.construction.equipment.push(e);
        rejected(&s, &c, "equipment-path");
    }
}
