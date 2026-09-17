//! Integrated ammunition uses the same retained components and native fit/combat definitions.
use naval_sim::{construction, definition::*};
fn fixture() -> (ConstructionSource, ConstructionCatalog) {
    let catalog: ConstructionCatalog = serde_json::from_str(include_str!(
        "../../../public/models/components/catalog.json"
    ))
    .unwrap();
    let source = ConstructionSource {
        schema_version: 1.,
        id: "integral-review".into(),
        revision: "r1".into(),
        name: "Integrated ammunition".into(),
        coordinates: "meters-y-up-bow-negative-z".into(),
        construction: ConstructionData {
            version: 2.,
            catalog_revision: catalog.revision.clone(),
            default_thickness_mm: 16.,
            primitives: vec![ConstructionPrimitive { shaping: None,
                id: "hull".into(),
                kind: "box".into(),
                position: [0.; 3],
                size: [24., 16., 80.],
                ..Default::default()
            }],
            ..Default::default()
        },
    };
    (source, catalog)
}
#[test]
fn every_retained_gun_has_a_magazine_and_can_be_raised_without_lifting_ammunition() {
    let (source, catalog) = fixture();
    for part in catalog.equipment.iter().filter(|p| p.kind == "gun") {
        let mut source = source.clone();
        let attachment = part
            .sockets
            .iter()
            .flatten()
            .find(|s| s.id == "attachment")
            .map_or(0., |s| s.position[1]);
        source.construction.equipment.push(ConstructionEquipment {
            id: "gun".into(),
            part_id: part.id.clone(),
            position: [0., 8. - attachment, 0.],
            ..Default::default()
        });
        let normal = construction::compile(&source, &catalog);
        let normal = normal
            .definition
            .unwrap_or_else(|| panic!("{}: {:?}", part.id, normal.diagnostics));
        let gun = &mut source.construction.equipment[0];
        gun.position[1] += 2.;
        gun.gun = Some(ConstructionEquipmentGun {
            barbette_height_m: Some(2.),
            ..Default::default()
        });
        let raised = construction::compile(&source, &catalog);
        let raised = raised
            .definition
            .unwrap_or_else(|| panic!("raised {}: {:?}", part.id, raised.diagnostics));
        let mag = |d: &ShipDefinition| {
            d.modules
                .iter()
                .find(|m| m.kind == "magazine")
                .unwrap()
                .clone()
        };
        assert!(
            (0..3).all(|i| (mag(&normal).center[i] - mag(&raised).center[i]).abs() < 1e-9),
            "{}",
            part.id
        );
        assert!(mag(&raised).center[1] + mag(&raised).size[1] / 2. < 8.);
        assert_eq!(
            raised.mounts[0].magazine_id.as_ref(),
            Some(&mag(&raised).id)
        );
        assert!(
            raised
                .mount_clearance
                .as_ref()
                .unwrap()
                .bodies
                .as_ref()
                .unwrap()
                .iter()
                .any(|b| b.id.contains("barbette"))
        );
    }
}
#[test]
fn torpedo_banks_carry_their_own_ready_ammunition_and_retain_rotation() {
    let (mut source, catalog) = fixture();
    let parts: Vec<_> = catalog
        .equipment
        .iter()
        .filter(|p| p.kind == "torpedo-launcher")
        .collect();
    for (i, part) in parts.iter().enumerate() {
        let attachment = part
            .sockets
            .iter()
            .flatten()
            .find(|s| s.id == "attachment")
            .map_or(0., |s| s.position[1]);
        source.construction.equipment.push(ConstructionEquipment {
            id: format!("bank-{i}"),
            part_id: part.id.clone(),
            position: [0., 8. - attachment, -15. + i as f64 * 30.],
            bearing_deg: 45.,
            ..Default::default()
        });
    }
    let result = construction::compile(&source, &catalog);
    let def = result
        .definition
        .unwrap_or_else(|| panic!("{:?}", result.diagnostics));
    for (i, part) in parts.iter().enumerate() {
        let id = format!("bank-{i}");
        let magazine = def
            .modules
            .iter()
            .find(|m| m.id == format!("{id}-magazine"))
            .unwrap();
        assert_eq!(magazine.kind, "magazine");
        assert_eq!(magazine.torpedo_launcher_id.as_deref(), Some(id.as_str()));
        assert_eq!(magazine.placement.as_deref(), Some("fixed"));
        let tubes: Vec<_> = def
            .torpedo_tubes
            .as_ref()
            .unwrap()
            .iter()
            .filter(|t| t.launcher_id.as_ref() == Some(&id))
            .collect();
        assert_eq!(tubes.len(), part.tube_offsets.as_ref().unwrap().len());
        assert!(
            tubes
                .iter()
                .all(|t| t.magazine_id == magazine.id && t.ammo == 1.)
        );
        // Catalog mass already includes ready torpedoes: no second ammunition mass.
        assert!(
            !def.loading
                .as_ref()
                .unwrap()
                .contributions
                .iter()
                .any(|m| m.id == format!("{id}-ammunition"))
        );
    }
}

#[test]
fn invalid_drafts_keep_round_barbettes_and_uncut_deck_corners() {
    let (mut source, catalog) = fixture();
    source.construction.surfaces.push(ConstructionSurfaceAssignment {
        primitive_id: "hull".into(), face: "top".into(),
        thickness_mm: 16., material: "steel".into(), paint: "teak-natural".into(),
        ..Default::default()
    });
    let part = catalog
        .equipment
        .iter()
        .find(|p| p.id == "us-5in38-mk30-mod0-single")
        .unwrap();
    let attachment = part
        .sockets
        .iter()
        .flatten()
        .find(|s| s.id == "attachment")
        .map_or(0., |s| s.position[1]);
    let weapon = catalog
        .weapons
        .parts
        .iter()
        .find(|w| Some(&w.id) == part.gun_part_id.as_ref())
        .unwrap();
    for rise in [0., 3.] {
        let mut source = source.clone();
        source.construction.equipment.push(ConstructionEquipment {
            id: "turret".into(),
            part_id: part.id.clone(),
            position: [0., 8. - attachment + rise, 0.],
            gun: Some(ConstructionEquipmentGun {
                barbette_height_m: Some(rise),
                barbette_paint: Some("red-oxide".into()),
                ..Default::default()
            }),
            ..Default::default()
        });
        let valid = construction::compile(&source, &catalog);
        assert!(valid.definition.is_some(), "{:?}", valid.diagnostics);
        let support = |result: &ConstructionResult| {
            result
                .surfaces
                .iter()
                .filter(|s| s.primitive_id == "equipment:turret")
                .cloned()
                .collect::<Vec<_>>()
        };
        let expected = support(&valid);
        assert!(!expected.is_empty());
        assert!(expected.iter().all(|s| s.paint == "red-oxide"));
        assert!(expected.iter().flat_map(|s| &s.vertices).all(|v|
            v[0].hypot(v[2]) <= weapon.barbette_radius + 1e-6),
            "Barbette has square plates protruding beyond its circular wall");
        for fault in ["load-fit", "boundary", "equipment-fit"] {
            let mut draft = source.clone();
            match fault {
                "load-fit" => draft.construction.loads.push(ConstructionLoad {
                    id: "bad-load".into(),
                    name: "Outside hull".into(),
                    center: [100., 0., 0.],
                    size: [1.; 3],
                    mass_kg: 100.,
                }),
                "boundary" => draft.construction.boundaries.push(ConstructionBoundary {
                    id: "bad-wall".into(),
                    axis: "z".into(),
                    offset: 100.,
                    thickness_mm: 10.,
                }),
                _ => draft.construction.equipment[0].position[0] = 11.9,
            }
            let preview = construction::compile(&draft, &catalog);
            assert!(
                preview.definition.is_none(),
                "Invalid draft must still block trials"
            );
            assert!(
                preview.diagnostics.iter().any(|d| d.code == fault),
                "{:?}",
                preview.diagnostics
            );
            let mut actual = support(&preview);
            assert!(
                !actual.is_empty(),
                "{fault}: missing turret support at rise {rise}"
            );
            if fault == "equipment-fit" {
                for surface in &mut actual {
                    for vertex in &mut surface.vertices {
                        vertex[0] -= 11.9;
                    }
                }
                assert!(actual.iter().any(|s| s.face == "installation-outer"
                    && s.vertices.iter().any(|v| v[1] > 8. + rise - 0.1)));
            } else {
                assert_eq!(
                    serde_json::to_value(&actual).unwrap(),
                    serde_json::to_value(&expected).unwrap(),
                    "An unrelated error must not change turret geometry"
                );
            }
            // The deck must remain continuous outside the circular wall, with its
            // original identity/paint, even if an unrelated draft error blocks trials.
            if fault == "equipment-fit" { continue; }
            for x in [-1., 1.] {
                for z in [-1., 1.] {
                    let point = [
                        x * weapon.barbette_radius * 0.95,
                        z * weapon.barbette_radius * 0.95,
                    ];
                    assert!(
                        preview.surfaces.iter().any(|s| s.primitive_id == "hull" && s.face == "top" && s.paint == "teak-natural"
                            && s.vertices.iter().all(|v| (v[1] - 8.).abs() < 1e-6)
                            && {
                                let crosses: Vec<_> = s
                                    .vertices
                                    .iter()
                                    .zip(s.vertices.iter().cycle().skip(1))
                                    .map(|(a, b)| {
                                        (b[0] - a[0]) * (point[1] - a[2])
                                            - (b[2] - a[2]) * (point[0] - a[0])
                                    })
                                    .collect();
                                crosses.iter().all(|c| *c >= -1e-8)
                                    || crosses.iter().all(|c| *c <= 1e-8)
                            }),
                        "{fault}: open square corner at {point:?}, rise {rise}"
                    );
                }
            }
        }
    }
}

#[test]
fn gun_magazines_fit_above_curved_bottom_plating_across_their_whole_footprint() {
    let (mut source, catalog) = fixture();
    let hull = &mut source.construction.primitives[0];
    hull.kind = "custom-hull".into();
    hull.size = [40., 24., 100.];
    hull.custom_hull = Some(ConstructionCustomHull {
        red_paint_y: None,
        version: 1.,
        rake: 0.,
        bulb: 0.,
        stations: (0..4)
            .map(|i| {
                let t = i as f64 / 3.;
                let keel = -0.52 + 0.1 * (t - 0.5).powi(2);
                ConstructionHullStation {
                    id: format!("section-{i}"),
                    t,
                    points: vec![
                        [-1., 0.45],
                        [-0.96, 0.1],
                        [-0.7, keel + 0.15],
                        [-0.36, keel + 0.02],
                        [0., keel],
                        [0.36, keel + 0.02],
                        [0.7, keel + 0.15],
                        [0.96, 0.1],
                        [1., 0.45],
                    ]
                    .into_iter()
                    .map(|[x, y]| ConstructionHullPoint { x, y })
                    .collect(),
                }
            })
            .collect(),
    });
    for part in catalog.equipment.iter().filter(|p| p.kind == "gun") {
        let mut draft = source.clone();
        let attachment = part
            .sockets
            .iter()
            .flatten()
            .find(|s| s.id == "attachment")
            .map_or(0., |s| s.position[1]);
        draft.construction.equipment = vec![ConstructionEquipment {
            id: "gun".into(),
            part_id: part.id.clone(),
            position: [0., 24. * 0.45 - attachment, 0.],
            bearing_deg: 37.,
            ..Default::default()
        }];
        let normal = construction::compile(&draft, &catalog);
        let normal = normal
            .definition
            .unwrap_or_else(|| panic!("{} on curved hull: {:?}", part.id, normal.diagnostics));
        let magazine = normal
            .modules
            .iter()
            .find(|m| m.kind == "magazine")
            .unwrap();
        draft.construction.equipment[0].position[1] += 3.;
        draft.construction.equipment[0].gun = Some(ConstructionEquipmentGun {
            barbette_height_m: Some(3.),
            ..Default::default()
        });
        let raised = construction::compile(&draft, &catalog);
        let raised = raised
            .definition
            .unwrap_or_else(|| panic!("raised {}: {:?}", part.id, raised.diagnostics));
        let raised_magazine = raised
            .modules
            .iter()
            .find(|m| m.kind == "magazine")
            .unwrap();
        assert!(
            (magazine.center[1] - raised_magazine.center[1]).abs() < 1e-8,
            "{} magazine moved",
            part.id
        );
    }
}
