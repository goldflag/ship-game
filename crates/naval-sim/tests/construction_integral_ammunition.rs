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
            primitives: vec![ConstructionPrimitive {
                tilt: None,
                mesh: None,
                balcony: None,
                shaping: None,
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
fn turret_wells_fit_gently_sloped_decks() {
    let (source, catalog) = fixture();
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
        .unwrap()
        .position[1];
    let mut failures = vec![];
    for (pitch, roll, thickness) in [
        (0_f64, 0_f64, 16.),
        (1., 0., 16.),
        (-1., 0., 16.),
        (5., 0., 16.),
        (-5., 0., 80.),
        (0., 5., 16.),
        (0., -5., 80.),
    ] {
        for rise in [0., 2.] {
            let mut draft = source.clone();
            draft.construction.primitives[0].tilt = Some(ConstructionPrimitiveTilt {
                version: 1.,
                pitch_deg: pitch,
                roll_deg: roll,
            });
            draft.construction.default_thickness_mm = thickness;
            draft.construction.equipment.push(ConstructionEquipment {
                id: "gun".into(),
                part_id: part.id.clone(),
                position: [
                    0.,
                    8. / (pitch.to_radians().cos() * roll.to_radians().cos()) - attachment + rise,
                    0.,
                ],
                bearing_deg: 37.,
                gun: Some(ConstructionEquipmentGun {
                    barbette_height_m: Some(rise),
                    ..Default::default()
                }),
                ..Default::default()
            });
            let result = construction::compile(&draft, &catalog);
            if let Some(def) = result.definition {
                assert!(
                    def.openings
                        .iter()
                        .flatten()
                        .any(|o| o.sealed_by_mount_id.as_deref() == Some("gun") && o.area_m2 > 0.)
                );
                if pitch != 0. || roll != 0. {
                    assert!(
                        def.mount_clearance
                            .as_ref()
                            .unwrap()
                            .bodies
                            .iter()
                            .flatten()
                            .any(|b| b.id == "gun-barbette-0")
                    );
                }
            } else {
                failures.push(format!(
                    "pitch {pitch}, roll {roll}, thickness {thickness}, rise {rise}: {:?}",
                    result.diagnostics
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn sloped_custom_hull_turrets_still_reject_real_obstructions() {
    let (mut source, catalog) = fixture();
    let hull = &mut source.construction.primitives[0];
    hull.kind = "custom-hull".into();
    hull.custom_hull = Some(ConstructionCustomHull {
        paint_bands: None,
        creases: None,
        bilge_keels: None,
        version: 1.,
        rake: 0.,
        bulb: 0.,
        red_paint_y: None,
        stations: (0..4)
            .map(|i| {
                let t = i as f64 / 3.;
                let deck = 0.5 + (0.5 - t) * 80. * 5_f64.to_radians().tan() / 16.;
                ConstructionHullStation {
                    id: format!("section-{i}"),
                    t,
                    points: [[-1., deck], [-1., -0.5], [0., -0.5], [1., -0.5], [1., deck]]
                        .into_iter()
                        .map(|[x, y]| ConstructionHullPoint {
                            x,
                            y,
                            contour: None,
                        })
                        .collect(),
                }
            })
            .collect(),
    });
    source.construction.equipment.push(ConstructionEquipment {
        id: "gun".into(),
        part_id: "us-5in38-mk30-mod0-single".into(),
        position: [0., 10.5, 0.],
        bearing_deg: 37.,
        gun: Some(ConstructionEquipmentGun {
            barbette_height_m: Some(2.),
            ..Default::default()
        }),
        ..Default::default()
    });
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_some(), "{:?}", result.diagnostics);
    for fault in ["wall", "load", "side", "bottom", "floating", "body"] {
        let mut draft = source.clone();
        match fault {
            "wall" => draft.construction.boundaries.push(ConstructionBoundary {
                id: "wall".into(),
                axis: "x".into(),
                offset: 0.,
                thickness_mm: 16.,
            }),
            "load" => draft.construction.loads.push(ConstructionLoad {
                id: "load".into(),
                name: "Occupied space".into(),
                center: [0., 7.2, 0.],
                size: [0.4; 3],
                mass_kg: 100.,
            }),
            "side" => draft.construction.primitives[0].size[0] = 2.5,
            "bottom" => {
                draft.construction.primitives[0].size[1] = 1.;
                draft.construction.equipment[0].position[1] = 3.;
            }
            "floating" => draft.construction.equipment[0].position[1] += 0.2,
            "body" => draft.construction.primitives.push(ConstructionPrimitive {
                id: "pillar".into(),
                kind: "box".into(),
                position: [2., 9., 0.],
                size: [1., 4., 2.],
                ..Default::default()
            }),
            _ => unreachable!(),
        }
        let result = construction::compile(&draft, &catalog);
        assert!(result.definition.is_none(), "{fault} must block launch");
        // A well that leaves the hull may be caught by either the installation
        // backing check or the later free-interior check, whichever measures it first.
        let codes: &[&str] = if fault == "floating" {
            &["equipment-attachment"]
        } else {
            &["equipment-fit", "installation-support"]
        };
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| codes.contains(&d.code.as_str()) && d.source_id.as_deref() == Some("gun")),
            "{fault}: {:?}",
            result.diagnostics
        );
        if fault == "body" {
            assert!(
                result
                    .diagnostics
                    .iter()
                    .any(|d| d.message.starts_with("Exterior equipment body overlaps"))
            );
        }
    }
}

#[test]
fn every_retained_gun_keeps_ammunition_in_its_installation_when_raised() {
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
        let deck_mount = mag(&normal).placement.as_deref() == Some("fixed");
        let lift = if deck_mount { 2. } else { 0. };
        assert!(
            (mag(&raised).center[1] - mag(&normal).center[1] - lift).abs() < 1e-9,
            "{}",
            part.id
        );
        assert!((0..3).all(|i| (mag(&normal).size[i] - mag(&raised).size[i]).abs() < 1e-9));
        if deck_mount {
            assert!(mag(&raised).center[1] - mag(&raised).size[1] / 2. >= 10. - 1e-6);
            let result = construction::compile(&source, &catalog);
            assert!(
                result
                    .surfaces
                    .iter()
                    .filter(|s| s.primitive_id == "equipment:gun")
                    .flat_map(|s| &s.vertices)
                    .all(|v| v[1] >= 8. - 1e-6)
            );
            assert!(
                !raised
                    .openings
                    .iter()
                    .flatten()
                    .any(|o| o.sealed_by_mount_id.as_deref() == Some("gun"))
            );
        } else {
            assert!(mag(&raised).center[1] + mag(&raised).size[1] / 2. < 8.);
        }
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
        source.construction.equipment = vec![ConstructionEquipment {
            id: format!("bank-{i}"),
            part_id: part.id.clone(),
            position: [0., 8. - attachment, 0.],
            bearing_deg: 45.,
            ..Default::default()
        }];
        let result = construction::compile(&source, &catalog);
        let def = result
            .definition
            .unwrap_or_else(|| panic!("{:?}", result.diagnostics));
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
    source
        .construction
        .surfaces
        .push(ConstructionSurfaceAssignment {
            primitive_id: "hull".into(),
            face: "top".into(),
            thickness_mm: 16.,
            material: "steel".into(),
            paint: "teak-natural".into(),
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
        // The barbette wears the turret's paint, or the ship paint under an unpainted turret.
        source.construction.paint = Some("sea-blue".into());
        let paint = if rise > 0. { "red-oxide" } else { "sea-blue" };
        source.construction.equipment.push(ConstructionEquipment {
            id: "turret".into(),
            part_id: part.id.clone(),
            position: [0., 8. - attachment + rise, 0.],
            paint: (rise > 0.).then(|| "red-oxide".into()),
            gun: Some(ConstructionEquipmentGun {
                barbette_height_m: Some(rise),
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
        assert!(expected.iter().all(|s| s.paint == paint));
        assert!(
            expected
                .iter()
                .flat_map(|s| &s.vertices)
                .all(|v| v[0].hypot(v[2]) <= weapon.barbette_radius + 1e-6),
            "Barbette has square plates protruding beyond its circular wall"
        );
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
            if fault == "equipment-fit" {
                continue;
            }
            for x in [-1., 1.] {
                for z in [-1., 1.] {
                    let point = [
                        x * weapon.barbette_radius * 0.95,
                        z * weapon.barbette_radius * 0.95,
                    ];
                    assert!(
                        preview.surfaces.iter().any(|s| s.primitive_id == "hull"
                            && s.face == "top"
                            && s.paint == "teak-natural"
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
        paint_bands: None,
        creases: None,
        bilge_keels: None,
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
                    .map(|[x, y]| ConstructionHullPoint {
                        x,
                        y,
                        contour: None,
                    })
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
            (raised_magazine.center[1]
                - magazine.center[1]
                - if magazine.placement.as_deref() == Some("fixed") {
                    3.
                } else {
                    0.
                })
            .abs()
                < 1e-8,
            "{} magazine moved",
            part.id
        );
    }
}

#[test]
fn oval_funnels_keep_deck_corners_and_matching_sealed_openings() {
    let (source, catalog) = fixture();
    for part in catalog.equipment.iter().filter(|p| p.kind == "funnel") {
        let attachment = part
            .sockets
            .iter()
            .flatten()
            .find(|s| s.id == "attachment")
            .unwrap()
            .position[1];
        // Area of the oval uptake's 64-sided outline, inside the visible casing.
        let area: f64 = part
            .occupancy
            .iter()
            .flatten()
            .map(|space| {
                32. * (space.size[0] / 2.)
                    * (space.size[2] / 2.)
                    * (std::f64::consts::TAU / 64.).sin()
            })
            .sum();
        for version in [1., 2.] {
            for bearing in [0., 37.] {
                let mut source = source.clone();
                source.construction.version = version;
                source.construction.equipment.push(ConstructionEquipment {
                    id: "funnel".into(),
                    part_id: part.id.clone(),
                    position: [2., 8. - attachment, 3.],
                    bearing_deg: bearing,
                    ..Default::default()
                });
                let result = construction::compile(&source, &catalog);
                let definition = result
                    .definition
                    .as_ref()
                    .unwrap_or_else(|| panic!("{}: {:?}", part.id, result.diagnostics));
                let deck_area: f64 = result
                    .surfaces
                    .iter()
                    .filter(|s| s.primitive_id == "hull" && s.face == "top")
                    .map(|s| s.area_m2)
                    .sum();
                assert!(
                    (24. * 80. - deck_area - area).abs() < 1e-6,
                    "{} at {bearing} degrees cuts rectangular corners out of the deck",
                    part.id
                );
                let openings: Vec<_> = definition
                    .openings
                    .iter()
                    .flatten()
                    .filter(|o| o.sealed_by_module_id.as_deref() == Some("funnel"))
                    .collect();
                assert_eq!(
                    openings.is_empty(),
                    area == 0.,
                    "Only a declared uptake cuts the deck"
                );
                assert!((openings.iter().map(|o| o.area_m2).sum::<f64>() - area).abs() < 1e-6);
            }
        }
    }
}

#[test]
fn light_aa_stands_on_a_thin_deck_without_a_well_or_deck_opening() {
    let (mut source, catalog) = fixture();
    source.construction.primitives[0].size[1] = 0.2;
    source.construction.primitives[0].position[1] = 7.9;
    for part in catalog.equipment.iter().filter(|p| p.kind == "gun") {
        let weapon = catalog
            .weapons
            .parts
            .iter()
            .find(|w| Some(&w.id) == part.gun_part_id.as_ref())
            .unwrap();
        if weapon.caliber_m >= 0.1 {
            continue;
        }
        let attachment = part
            .sockets
            .iter()
            .flatten()
            .find(|s| s.id == "attachment")
            .unwrap()
            .position[1];
        source.construction.equipment = vec![ConstructionEquipment {
            id: "aa".into(),
            part_id: part.id.clone(),
            position: [0., 8. - attachment, 0.],
            ..Default::default()
        }];
        let result = construction::compile(&source, &catalog);
        let def = result
            .definition
            .as_ref()
            .unwrap_or_else(|| panic!("{}: {:?}", part.id, result.diagnostics));
        assert!(
            !result
                .surfaces
                .iter()
                .any(|s| s.primitive_id == "equipment:aa"),
            "{} has a fabricated barbette",
            part.id
        );
        let deck_area: f64 = result
            .surfaces
            .iter()
            .filter(|s| s.primitive_id == "hull" && s.face == "top")
            .map(|s| s.area_m2)
            .sum();
        assert!(
            (deck_area - 24. * 80.).abs() < 1e-6,
            "{} cuts the deck",
            part.id
        );
        assert!(
            !def.openings
                .iter()
                .flatten()
                .any(|o| o.sealed_by_mount_id.as_deref() == Some("aa"))
        );
        let mag = def.modules.iter().find(|m| m.kind == "magazine").unwrap();
        assert!(
            mag.center[1] - mag.size[1] / 2. >= 8. - 1e-6,
            "{} ammunition below deck",
            part.id
        );
        assert_eq!(mag.placement.as_deref(), Some("fixed"));
        assert_eq!(def.mounts[0].magazine_id.as_deref(), Some(mag.id.as_str()));
        let mut actor = naval_sim::damage::Combatant::new("aa-review", def);
        assert_eq!(
            naval_sim::machinery::equipment_condition(&actor, def, mag, None).availability,
            1.
        );
        actor
            .damage
            .modules
            .iter_mut()
            .find(|m| m.id == mag.id)
            .unwrap()
            .hp = 0.;
        assert_eq!(
            naval_sim::machinery::equipment_condition(&actor, def, mag, None).availability,
            0.
        );
        assert!(
            def.loading
                .as_ref()
                .unwrap()
                .contributions
                .iter()
                .any(|m| m.id == "aa-ammunition" && m.mass_kg > 0.)
        );
    }
}

#[test]
fn turret_working_depth_does_not_follow_the_hull_bottom() {
    let (mut source, catalog) = fixture();
    for part_id in [
        "us-5in38-mk30-mod0-single",
        "sk-c34-380-twin",
        "us-16in50-mk7-iowa",
    ] {
        let part = catalog.equipment.iter().find(|p| p.id == part_id).unwrap();
        let attachment = part
            .sockets
            .iter()
            .flatten()
            .find(|s| s.id == "attachment")
            .unwrap()
            .position[1];
        source.construction.equipment = vec![ConstructionEquipment {
            id: "turret".into(),
            part_id: part.id.clone(),
            position: [0., 8. - attachment, 0.],
            ..Default::default()
        }];
        let mut signatures = vec![];
        for depth in [16., 32.] {
            source.construction.primitives[0].size[1] = depth;
            source.construction.primitives[0].position[1] = 8. - depth / 2.;
            let result = construction::compile(&source, &catalog);
            let def = result
                .definition
                .as_ref()
                .unwrap_or_else(|| panic!("{part_id}: {:?}", result.diagnostics));
            let bottom = result
                .surfaces
                .iter()
                .filter(|s| s.primitive_id == "equipment:turret")
                .flat_map(|s| s.vertices.iter())
                .map(|v| v[1])
                .fold(f64::INFINITY, f64::min);
            let mag = def.modules.iter().find(|m| m.kind == "magazine").unwrap();
            signatures.push((bottom, mag.center, mag.size));
        }
        assert_eq!(
            signatures[0], signatures[1],
            "{part_id} follows the hull bottom"
        );
    }
}

#[test]
fn explicit_catalog_installations_override_light_gun_defaults() {
    let (mut source, mut catalog) = fixture();
    let id = "us-20mm-oerlikon-mk4-hsienyang";
    source.construction.equipment = vec![ConstructionEquipment {
        id: "gun".into(),
        part_id: id.into(),
        position: [0., 8., 0.],
        ..Default::default()
    }];
    catalog
        .equipment
        .iter_mut()
        .find(|p| p.id == id)
        .unwrap()
        .occupancy = Some(vec![ConstructionEquipmentPartOccupancyItem {
        center: [0., -0.5, 0.],
        size: [1., 1., 1.],
    }]);
    let result = construction::compile(&source, &catalog);
    let def = result
        .definition
        .as_ref()
        .unwrap_or_else(|| panic!("{:?}", result.diagnostics));
    assert!(
        result
            .surfaces
            .iter()
            .any(|s| s.primitive_id == "equipment:gun")
    );
    assert!(
        def.modules
            .iter()
            .find(|m| m.kind == "magazine")
            .unwrap()
            .center[1]
            < 8.
    );
    // An explicitly empty occupancy is a deck mount even for a larger weapon.
    catalog
        .equipment
        .iter_mut()
        .find(|p| p.id == id)
        .unwrap()
        .occupancy = Some(vec![]);
    catalog
        .weapons
        .parts
        .iter_mut()
        .find(|w| w.id == id)
        .unwrap()
        .caliber_m = 0.127;
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_some(), "{:?}", result.diagnostics);
    assert!(
        !result
            .surfaces
            .iter()
            .any(|s| s.primitive_id == "equipment:gun")
    );
}

#[test]
fn deck_mounts_leave_room_for_internal_decks_and_loads_below() {
    let (mut source, catalog) = fixture();
    source.construction.boundaries.push(ConstructionBoundary {
        id: "internal-deck".into(),
        axis: "y".into(),
        offset: 4.,
        thickness_mm: 16.,
    });
    source.construction.loads.push(ConstructionLoad {
        id: "stores".into(),
        name: "Stores".into(),
        center: [0., 2., 0.],
        size: [2., 2., 2.],
        mass_kg: 1000.,
    });
    source.construction.equipment.push(ConstructionEquipment {
        id: "aa".into(),
        part_id: "us-20mm-oerlikon-mk4-hsienyang".into(),
        position: [0., 8., 0.],
        ..Default::default()
    });
    let result = construction::compile(&source, &catalog);
    assert!(result.definition.is_some(), "{:?}", result.diagnostics);
    source.construction.equipment[0].position[1] += 0.25;
    assert!(
        construction::compile(&source, &catalog)
            .definition
            .is_none(),
        "A floating deck mount must still fail"
    );
    source.construction.equipment[0].position[1] = 8.;
    source
        .construction
        .surfaces
        .push(ConstructionSurfaceAssignment {
            primitive_id: "hull".into(),
            face: "top".into(),
            open: Some(true),
            thickness_mm: 16.,
            material: "steel".into(),
            paint: "naval-gray".into(),
            ..Default::default()
        });
    assert!(
        construction::compile(&source, &catalog)
            .definition
            .is_none(),
        "An open deck cannot support a pedestal"
    );
}
