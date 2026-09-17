//! Black-box source/compiler/consumer acceptance; no browser-derived definitions.
use naval_sim::{construction, damage::Combatant, definition::*, hydrostatics::HullHydrostatics};

fn fixture() -> (ConstructionSource, ConstructionCatalog) {
    (
        ConstructionSource {
            schema_version: 1.,
            id: "acceptance".into(),
            name: "Acceptance hull".into(),
            coordinates: "meters-y-up-bow-negative-z".into(),
            revision: "one".into(),
            construction: ConstructionData {
                version: 1.,
                catalog_revision: "test".into(),
                default_thickness_mm: 10.,
                primitives: vec![ConstructionPrimitive { custom_hull: None,
                    vertices: None,
            smooth_group: None,
                    id: "hull".into(),
                    kind: "box".into(),
                    position: [0.; 3],
                    size: [10., 4., 20.],
                    rotation_deg: 0.,
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
fn compile(source: &ConstructionSource, catalog: &ConstructionCatalog) -> ShipDefinition {
    let result = construction::compile(source, catalog);
    result
        .definition
        .unwrap_or_else(|| panic!("{:?}", result.diagnostics))
}
fn load(source: &mut ConstructionSource, mass: f64, center: Vec3) {
    source.construction.loads.push(ConstructionLoad {
        id: "load".into(),
        name: "Explicit occupied test load".into(),
        mass_kg: mass,
        center,
        size: [0.5, 0.5, 1.],
    });
}

#[test]
fn included_auxiliaries_follow_the_actual_engine_room_and_preserve_loading() {
    use naval_sim::{damage_control::update_damage_control, machinery::electrical_power};
    let (mut source, mut catalog) = fixture();
    source.construction.primitives[0].size[1] = 8.;
    source.construction.boundaries.push(ConstructionBoundary {
        id: "center-wall".into(),
        axis: "x".into(),
        offset: 0.,
        thickness_mm: 10.,
    });
    let bare = compile(&source, &catalog);
    assert_eq!(
        electrical_power(&Combatant::new("bare", &bare), &bare, None),
        0.
    );
    for (id, kind, size, center, mass) in [
        ("engine-part", "engine", [2., 2., 4.], [0., 1., 0.], 35_000.),
        ("funnel-part", "funnel", [1., 2., 1.], [0., 1., 0.], 1_000.),
    ] {
        catalog.equipment.push(ConstructionEquipmentPart {
            id: id.into(),
            name: id.into(),
            kind: kind.into(),
            placement: if kind == "engine" { "internal" } else { "deck" }.into(),
            size,
            bounds_center: center,
            center_of_gravity: center,
            mass_kg: Some(mass),
            power_kw: Some(3000.),
            exhaust_kw: Some(3000.),
            service_mass_kg: (kind == "engine").then_some(5000.),
            model_url: "/models/components/test/model.glb".into(),
            content_hash: "test".into(),
            ..Default::default()
        });
    }
    for (side, x) in [("port", -2.5), ("starboard", 2.5)] {
        for (kind, y) in [("engine", -3.99), ("funnel", 4.)] {
            source.construction.equipment.push(ConstructionEquipment {
                id: format!("{side}-{kind}"),
                part_id: format!("{kind}-part"),
                position: [x, y, 0.],
                bearing_deg: 0.,
                power_source_id: (kind == "funnel").then(|| format!("{side}-engine")),
                ..Default::default()
            });
        }
    }
    let def = compile(&source, &catalog);
    assert!((def.hull.mass_kg - bare.hull.mass_kg - 82_000.).abs() < 1e-6);
    assert_eq!(def.damage_control.teams, 2.);
    assert_eq!(def.handling.forward_speed, 0.); // Auxiliaries need no propeller.
    assert_eq!(def.modules.len(), 4); // No duplicate free generator proxy.
    assert_eq!(def.compartments.len(), 2);
    assert!(
        def.compartments
            .iter()
            .all(|c| (c.pump_m3_per_second - 0.02).abs() < 1e-9)
    );
    let engine = def
        .modules
        .iter()
        .position(|m| m.id == "port-engine")
        .unwrap();
    let other_engine = def
        .modules
        .iter()
        .position(|m| m.id == "starboard-engine")
        .unwrap();
    let other_funnel = def
        .modules
        .iter()
        .position(|m| m.id == "starboard-funnel")
        .unwrap();
    let room = def
        .compartments
        .iter()
        .position(|c| Some(&c.id) == def.modules[engine].compartment_id.as_ref())
        .unwrap();
    let other_room = 1 - room;
    let hydro = HullHydrostatics::new(&def.hull, None);
    let mut actor = Combatant::new("services", &def);
    assert_eq!(electrical_power(&actor, &def, None), 1.);
    for c in &mut actor.damage.compartments {
        c.water_m3 = 1.;
    }
    naval_sim::flooding::update_flooding(&mut actor, &def, &hydro, 1., 0.5, None, None);
    assert!((actor.damage.compartments[room].water_m3 - 0.98).abs() < 1e-8);
    actor.damage.modules[engine].hp *= 0.5;
    assert_eq!(electrical_power(&actor, &def, None), 0.75);
    naval_sim::flooding::update_flooding(&mut actor, &def, &hydro, 1., 0.5, None, None);
    assert!((actor.damage.compartments[room].water_m3 - 0.97).abs() < 1e-8);
    assert!((actor.damage.compartments[other_room].water_m3 - 0.96).abs() < 1e-8);
    actor.damage.modules[engine].hp = 0.;
    naval_sim::flooding::update_flooding(&mut actor, &def, &hydro, 1., 0.5, None, None);
    assert!((actor.damage.compartments[room].water_m3 - 0.97).abs() < 1e-8);
    assert!((actor.damage.compartments[other_room].water_m3 - 0.94).abs() < 1e-8);
    actor.damage.modules[engine].hp = def.modules[engine].hp;
    actor.damage.compartments[room].water_m3 = def.compartments[room].capacity_m3 * 0.4;
    assert_eq!(electrical_power(&actor, &def, None), 0.5);
    actor.damage.modules[other_funnel].hp = 0.;
    assert_eq!(electrical_power(&actor, &def, None), 0.);
    update_damage_control(&mut actor, &def, 10., None);
    assert!(actor.damage.control.pumping.iter().all(|p| *p == 0.));

    let mut repair = Combatant::new("repair", &def);
    let initial_integrity = repair.damage.integrity;
    repair.damage.modules[engine].hp = def.modules[engine].hp * 0.5;
    repair.damage.modules[other_engine].hp = 0.;
    let before = repair.damage.modules[engine].hp;
    update_damage_control(&mut repair, &def, 4., None);
    update_damage_control(&mut repair, &def, 10., None);
    assert!((repair.damage.modules[engine].hp - before - 5.).abs() < 1e-9);
    assert_eq!(repair.damage.modules[other_engine].hp, 0.);
    assert_eq!(repair.damage.integrity, initial_integrity);
    assert_eq!(repair.damage.control.spares, 75.);
    assert_eq!(
        Combatant::new("reset", &def).damage.modules[other_engine].hp,
        def.modules[other_engine].hp
    );
}
#[test]
fn overloaded_source_launches_and_loses_without_free_buoyancy() {
    let (mut source, catalog) = fixture();
    load(&mut source, 1_000_000., [0.; 3]);
    let result = construction::compile(&source, &catalog);
    assert!(result.diagnostics.iter().any(|d| d.code == "overloaded"));
    let def = result.definition.unwrap();
    assert_eq!(def.stability.as_ref().unwrap().buoyancy_scale, 1.);
    let hydro = HullHydrostatics::new(&def.hull, None);
    let mut actor = Combatant::new("overloaded", &def);
    let hp = actor.damage.integrity;
    naval_sim::flooding::update_flooding(&mut actor, &def, &hydro, 1. / 60., 0.5, None, None);
    assert!(actor.damage.sunk);
    assert!(actor.physical_loss().is_some());
    assert_eq!(actor.damage.integrity, hp);
    assert!(actor.damage.compartments.iter().all(|c| c.water_m3 == 0.));
    assert!((hydro.full_volume() - 800.).abs() < 1e-7);
}
#[test]
fn unstable_source_capsizes_from_authored_high_offset_load() {
    let (mut source, catalog) = fixture();
    source.construction.primitives[0].size = [4., 4., 20.];
    load(&mut source, 200_000., [0.4, 1.6, 0.]);
    let def = compile(&source, &catalog);
    assert!(def.loading.as_ref().unwrap().roll_metacentric_height_m < 0.);
    let hydro = HullHydrostatics::new(&def.hull, None);
    let mut actor = Combatant::new("unstable", &def);
    for _ in 0..3600 {
        naval_sim::flooding::update_flooding(&mut actor, &def, &hydro, 1. / 60., 0.5, None, None);
        if actor.damage.sunk {
            break;
        }
    }
    assert!(actor.motion.roll < -1.7, "roll={}", actor.motion.roll);
    assert!(
        actor.damage.sunk,
        "roll={} arm={} capsize_seconds={}",
        actor.motion.roll, actor.damage.stability.roll_arm, actor.damage.stability.capsize_seconds
    );
    assert_eq!(actor.damage.defeat_cause.as_deref(), Some("capsize"));
    assert_eq!(
        def.stability.as_ref().unwrap().dry_center_of_gravity,
        def.loading.as_ref().unwrap().center_of_gravity
    );
}
#[test]
fn compiled_duplicates_keep_damage_water_and_linked_machinery_independent() {
    let (mut source, mut catalog) = fixture();
    for (id, kind, placement, size, center, position) in [
        (
            "engine",
            "engine",
            "internal",
            [2., 1., 2.],
            [0., 0.5, 0.],
            [0., -1.99, 0.],
        ),
        (
            "funnel",
            "funnel",
            "deck",
            [1., 2., 1.],
            [0., 1., 0.],
            [0., 2., 0.],
        ),
        (
            "propeller",
            "propeller",
            "underwater",
            [0.5, 0.5, 0.5],
            [0., 0., 0.],
            [0., -1.5, 10.],
        ),
        (
            "rudder",
            "rudder",
            "underwater",
            [0.2, 1., 1.],
            [0., -0.5, 0.],
            [2., -2., 8.],
        ),
    ] {
        catalog.equipment.push(ConstructionEquipmentPart {
            id: id.into(),
            name: id.into(),
            kind: kind.into(),
            placement: placement.into(),
            size,
            bounds_center: center,
            center_of_gravity: center,
            mass_kg: Some(if kind == "engine" { 10000. } else { 100. }),
            model_url: "/models/components/test/model.glb".into(),
            content_hash: "test".into(),
            power_kw: Some(1000.),
            exhaust_kw: Some(1000.),
            thrust_efficiency: Some(0.6),
            rudder_area_m2: Some(1.),
            ..Default::default()
        });
        source.construction.equipment.push(ConstructionEquipment {
            id: id.into(),
            part_id: id.into(),
            position,
            bearing_deg: 0.,
            power_source_id: matches!(kind, "propeller" | "funnel").then(|| "engine".into()),
            ..Default::default()
        });
    }
    let def = compile(&source, &catalog);
    let mut one = Combatant::new("one", &def);
    let two = Combatant::new("two", &def);
    assert!((def.loading.as_ref().unwrap().power_kw - 588.).abs() < 1e-9);
    assert_eq!(
        naval_sim::machinery::system_health(&one, &def, "engine", None),
        1.
    );
    assert_eq!(
        naval_sim::machinery::system_health(&one, &def, "steering", None),
        1.
    );
    naval_sim::damage::damage_hull(&mut one, 10. / naval_sim::damage::HULL_HP_SCALE, None);
    assert_eq!(two.damage.integrity - one.damage.integrity, 10.);
    for id in ["funnel", "rudder"] {
        one.damage
            .modules
            .iter_mut()
            .find(|m| m.id == id)
            .unwrap()
            .hp = 0.;
    }
    assert_eq!(
        naval_sim::machinery::system_health(&one, &def, "engine", None),
        0.
    );
    assert_eq!(
        naval_sim::machinery::system_health(&one, &def, "steering", None),
        0.
    );
    assert_eq!(
        naval_sim::machinery::system_health(&two, &def, "engine", None),
        1.
    );
    assert_eq!(
        naval_sim::machinery::system_health(&two, &def, "steering", None),
        1.
    );
    let engine = def.modules.iter().find(|m| m.id == "engine").unwrap();
    let room = def
        .compartments
        .iter()
        .position(|r| Some(&r.id) == engine.compartment_id.as_ref())
        .unwrap();
    one.damage.compartments[room].water_m3 = def.compartments[room].capacity_m3 * 0.9;
    assert_eq!(two.damage.compartments[room].water_m3, 0.);
    assert_eq!(
        naval_sim::machinery::equipment_condition(&one, &def, engine, None).availability,
        0.
    );
    assert_eq!(
        naval_sim::machinery::equipment_condition(&two, &def, engine, None).availability,
        1.
    );
}

#[test]
fn separated_hull_rays_miss_water_and_hit_only_the_selected_skin() {
    use naval_sim::{
        contacts::{ContactGeometry, ContactKind, contact_armor, ship_contacts},
        hull_contact::HullContacts,
        shell::Shell,
        structure::structural_hits,
        torpedoes::torpedo_hull,
    };
    let (mut source, catalog) = fixture();
    source.construction.primitives = [
        ("port", [-4., 0., 0.], [3., 4., 20.]),
        ("starboard", [4., 0., 0.], [3., 4., 20.]),
        ("bridge", [0., 2.5, 0.], [11., 1., 4.]),
    ]
    .into_iter()
    .map(|(id, position, size)| ConstructionPrimitive { custom_hull: None,
        vertices: None,
            smooth_group: None,
        id: id.into(),
        kind: "box".into(),
        position,
        size,
        rotation_deg: 0.,
    })
    .collect();
    source
        .construction
        .surfaces
        .push(ConstructionSurfaceAssignment {
            primitive_id: "port".into(),
            face: "port".into(),
            thickness_mm: 50.,
            material: "armor-steel".into(),
            paint: "naval-gray".into(),
            ..Default::default()
        });
    let def = compile(&source, &catalog);
    let actor = Combatant::new("cat", &def);
    let geometry = ContactGeometry::new(&def).unwrap();
    let gap = ([0., 0., -30.], [0., 0., 30.]);
    let hull = ([-8., -1., 2.], [-2., -1., 2.]);
    assert!(ship_contacts(&Shell::default(), gap.0, gap.1, &actor, &def, &geometry).is_empty());
    assert!(HullContacts::new(&def.hull).query(gap.0, gap.1).is_empty());
    assert!(structural_hits(gap.0, gap.1, &torpedo_hull(&def).unwrap()).is_empty());
    assert!(
        !HullContacts::new(&def.hull)
            .query(hull.0, hull.1)
            .is_empty()
    );
    assert!(!structural_hits(hull.0, hull.1, &torpedo_hull(&def).unwrap()).is_empty());
    let hits = ship_contacts(&Shell::default(), hull.0, hull.1, &actor, &def, &geometry);
    assert_eq!(
        hits.len(),
        2,
        "entry and exit only; no duplicate structural skin"
    );
    assert!(hits.iter().all(|h| h.kind == ContactKind::Armor));
    assert_eq!(contact_armor(&def, &hits[0]).thickness_mm, 50.);
    assert_eq!(contact_armor(&def, &hits[1]).thickness_mm, 10.);
}

#[test]
fn trainable_torpedoes_use_one_absolute_rotation_for_sockets_damage_and_launch() {
    use naval_sim::{
        geometry::*,
        torpedoes::{TubeState, tube_local_position, tube_solution},
    };
    for bearing in [-90., 90.] {
        let (mut source, mut catalog) = fixture();
        catalog.weapons =
            serde_json::from_str(include_str!("../../../assets/parts/guns.json")).unwrap();
        catalog.equipment = vec![
            ConstructionEquipmentPart {
                id: "magazine".into(),
                name: "Magazine".into(),
                kind: "magazine".into(),
                placement: "internal".into(),
                size: [2.; 3],
                bounds_center: [0., 1., 0.],
                center_of_gravity: [0., 1., 0.],
                mass_kg: Some(1000.),
                ammunition_capacity: Some(1000.),
                model_url: "/models/components/test.glb".into(),
                content_hash: "test".into(),
                ..Default::default()
            },
            ConstructionEquipmentPart {
                id: "bank".into(),
                name: "Bank".into(),
                kind: "torpedo-launcher".into(),
                placement: "deck".into(),
                size: [2., 1., 4.],
                bounds_center: [0.1, 0.5, 0.2],
                center_of_gravity: [0., 0.5, 0.],
                mass_kg: Some(18000.),
                torpedo_part_id: Some("us-mk15-fast".into()),
                tube_offsets: Some(vec![[-0.5, 0.5, -2.], [0.5, 0.5, -2.]]),
                model_url: "/models/components/test.glb".into(),
                content_hash: "test".into(),
                ..Default::default()
            },
        ];
        source.construction.equipment = vec![
            ConstructionEquipment {
                id: "magazine".into(),
                part_id: "magazine".into(),
                position: [0., -1.99, 0.],
                ..Default::default()
            },
            ConstructionEquipment {
                id: "bank".into(),
                part_id: "bank".into(),
                position: [0., 2., 5.],
                bearing_deg: bearing,
                magazine_id: Some("magazine".into()),
                ..Default::default()
            },
        ];
        let def = compile(&source, &catalog);
        let mut actor = Combatant::new("bank", &def);
        actor.motion.heading = 0.3;
        assert_eq!(actor.launcher_trains["bank"], bearing.to_radians());
        let tube = &def.torpedo_tubes.as_ref().unwrap()[0];
        assert_eq!(tube.id, "bank.tube-1");
        assert_eq!(tube.position, [-0.5, 2.5, 3.]);
        assert_eq!(tube.bearing_deg, 0.);
        let module = def.modules.iter().find(|m| m.id == "bank").unwrap();
        assert_eq!(module.center, [0.1, 2.5, 5.2]);
        assert_eq!(module.size, [2., 1., 4.]);
        for train in [bearing.to_radians(), 0.47, -0.63] {
            actor.launcher_trains.insert("bank".into(), train);
            let base = Pose {
                heading: train,
                ..Default::default()
            };
            let expected = add([0., 2., 5.], rotate([-0.5, 0.5, -2.], base));
            assert!(length(sub(tube_local_position(&actor, &def, tube), expected)) < 1e-9);
            assert!(
                length(sub(
                    naval_sim::machinery::equipment_center(&actor, &def, module),
                    add([0., 2., 5.], rotate([0.1, 0.5, 0.2], base))
                )) < 1e-9
            );
            let origin = local_to_world(expected, actor.motion.pose());
            let heading = actor.motion.heading + train;
            let aim = add(origin, [heading.sin() * 1000., 0., -heading.cos() * 1000.]);
            let mut state = TubeState::new(tube);
            let solution = tube_solution(&actor, &def, tube, &mut state, aim, 1. / 60., None);
            assert_eq!(state.status, "ready");
            assert!(wrap_angle(solution.heading - heading).abs() < 1e-9);
            assert!(length(sub(solution.origin, origin)) < 1e-9);
        }
        let mut restricted = source.clone();
        let limits = if bearing < 0. { [-150., 0.] } else { [0., 150.] };
        let arc = if bearing < 0. { [-130., -50.] } else { [50., 130.] };
        restricted.construction.equipment[1].launcher = Some(ConstructionEquipmentLauncher {
            traverse_limits_deg: limits, launch_arcs_deg: vec![arc],
        });
        let fitted = compile(&restricted, &catalog);
        let launcher = &fitted.torpedo_launchers.as_ref().unwrap()[0];
        assert_eq!(launcher.traverse_limits_deg, Some(limits));
        assert_eq!(launcher.launch_arcs_deg, vec![arc]);
        restricted.construction.equipment[1].launcher.as_mut().unwrap().launch_arcs_deg = vec![[-180., 180.]];
        assert!(naval_sim::construction::compile(&restricted, &catalog).diagnostics.iter().any(|d| d.code == "weapon-installation"));
        // The actual battle launch consumes the same absolute heading.
        use naval_sim::{
            battle::{Battle, BattleSetup, Orders, ShipSetup},
            bots::AiLevel,
            catalog::Catalog,
            gunnery::PlayerGunOrders,
            rules::TeamId,
            vessel::Controller,
        };
        use std::{collections::BTreeMap, sync::Arc};
        let local =
            Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap())
                .unwrap()
                .with_constructions(&[source], &catalog)
                .unwrap();
        let compiled = BTreeMap::from([
            (def.id.clone(), Arc::new(local.compile(&def.id).unwrap())),
            (
                "fletcher".into(),
                Arc::new(local.compile("fletcher").unwrap()),
            ),
        ]);
        let setup = BattleSetup {
            ships: vec![
                ShipSetup {
                    id: "player".into(),
                    preset_id: def.id.clone(),
                    team: TeamId::A,
                    controller: Controller::Player,
                    ai_level: AiLevel::Static,
                    spawn: None,
                },
                ShipSetup {
                    id: "target".into(),
                    preset_id: "fletcher".into(),
                    team: TeamId::B,
                    controller: Controller::Idle,
                    ai_level: AiLevel::Static,
                    spawn: None,
                },
            ],
            seed: 1,
            map_id: "north-atlantic".into(),
            weather: "clear".into(),
            spawn_distance: 3000.,
            wind_speed: Some(0.),
            mission_rules: None,
            air_rules: None,
        };
        let mut battle = Battle::new(Arc::new(local), &compiled, setup).unwrap();
        let player = &battle.actors[0];
        let direction = player.motion.heading + bearing.to_radians();
        let origin = local_to_world([0., 2., 5.], player.motion.pose());
        let aim = add(
            origin,
            [direction.sin() * 1000., 0., -direction.cos() * 1000.],
        );
        battle.step(&BTreeMap::from([(
            "player".into(),
            Orders {
                guns: Some(PlayerGunOrders {
                    battery: "torpedo".into(),
                    weapon_group_id: None,
                    aim: Some(aim),
                    fire: true,
                    ammunition: BTreeMap::new(),
                }),
                ..Default::default()
            },
        )]));
        let shot = battle
            .torpedoes
            .first()
            .expect("bank must fire at nonzero installed bearing");
        let direction = battle.actors[0].motion.heading + battle.actors[0].launcher_trains["bank"];
        assert!(wrap_angle(shot.velocity[0].atan2(-shot.velocity[2]) - direction).abs() < 1e-9);
    }
}

#[test]
fn original_turret_rim_has_fixed_support_mass_and_single_internal_protection() {
    use naval_sim::{
        construction_geometry as cg,
        contacts::{ContactGeometry, contact_armor, ship_contacts},
        hull_contact::HullContacts,
        shell::Shell,
    };
    let (mut source, mut catalog) = fixture();
    source.construction.primitives[0].size = [16., 12., 60.];
    catalog.weapons =
        serde_json::from_str(include_str!("../../../assets/parts/guns.json")).unwrap();
    let weapon = catalog
        .weapons
        .parts
        .iter()
        .find(|w| w.id == "us-6in47-mk16-cleveland")
        .unwrap();
    let radius = weapon.barbette_radius;
    catalog.equipment = vec![
        ConstructionEquipmentPart {
            id: "magazine".into(),
            name: "Magazine".into(),
            kind: "magazine".into(),
            placement: "internal".into(),
            size: [2.; 3],
            bounds_center: [0., 1., 0.],
            center_of_gravity: [0., 1., 0.],
            mass_kg: Some(1000.),
            ammunition_capacity: Some(1000.),
            model_url: "/models/components/test.glb".into(),
            content_hash: "test".into(),
            ..Default::default()
        },
        ConstructionEquipmentPart {
            id: "original-gun".into(),
            name: "Original gun".into(),
            kind: "gun".into(),
            placement: "deck".into(),
            size: [6.24, 3.421, 13.265],
            bounds_center: [0., 1.71, -0.844],
            center_of_gravity: [0., 1.15, 0.],
            gun_part_id: Some(weapon.id.clone()),
            occupancy: Some(vec![ConstructionEquipmentPartOccupancyItem {
                center: [0., -2., 0.],
                size: [radius * 2., 4., radius * 2.],
            }]),
            model_url: "/models/components/test.glb".into(),
            content_hash: "test".into(),
            ..Default::default()
        },
    ];
    let bare = compile(&source, &catalog);
    source.construction.equipment = vec![
        ConstructionEquipment {
            id: "magazine".into(),
            part_id: "magazine".into(),
            position: [-5., -5.99, 10.],
            ..Default::default()
        },
        ConstructionEquipment {
            id: "gun".into(),
            part_id: "original-gun".into(),
            position: [0., 6., 0.],
            bearing_deg: 180.,
            magazine_id: Some("magazine".into()),
            ..Default::default()
        },
    ];
    let def = compile(&source, &catalog);
    let geometry = def.hull.volume.as_ref().unwrap();
    let top: Vec<_> = geometry
        .surfaces
        .iter()
        .filter(|s| s.face == "installation-top")
        .collect();
    assert!(!top.is_empty());
    for i in 0..64 {
        let a = i as f64 * std::f64::consts::TAU / 64.;
        let point = [radius * a.cos(), 6., radius * a.sin()];
        assert!(
            top.iter()
                .any(|s| cg::contains(&cg::prism(&s.vertices, 0.001), point)),
            "unsupported rim {i}"
        );
    }
    let thickness = 0.01;
    let inner = radius - thickness / (std::f64::consts::PI / 64.).cos();
    let area = |r: f64| 32. * r * r * (std::f64::consts::TAU / 64.).sin();
    let support_volume = (area(radius) - area(inner)) * (4. - thickness)
        + (4. * radius * radius - area(inner)) * thickness;
    let loading = def.loading.as_ref().unwrap();
    let support = loading
        .contributions
        .iter()
        .find(|m| m.kind == "installation")
        .unwrap();
    assert!((support.mass_kg - support_volume * 7850.).abs() < 1e-5);
    assert!(
        (loading.material_volume_m3 - bare.loading.as_ref().unwrap().material_volume_m3
            + 4. * radius * radius * thickness
            - support_volume)
            .abs()
            < 1e-7
    );
    assert!((HullHydrostatics::new(&def.hull, None).full_volume() - 11520.).abs() < 1e-6);
    assert!(
        HullContacts::new(&def.hull)
            .query([0., 4., 0.], [5., 4., 0.])
            .is_empty(),
        "internal supports cannot become hull envelope"
    );
    let angle = std::f64::consts::PI / 64.;
    let to = [angle.cos() * 5., 4., angle.sin() * 5.];
    let actor = Combatant::new("support", &def);
    let cache = ContactGeometry::new(&def).unwrap();
    let hits = ship_contacts(&Shell::default(), [0., 4., 0.], to, &actor, &def, &cache);
    assert_eq!(hits.len(), 1, "no duplicate inner/outer wall charges");
    let armor = contact_armor(&def, &hits[0]);
    assert_eq!(armor.thickness_mm, 10.);
    assert_eq!(armor.exterior, Some(false));
    let opening = def
        .openings
        .as_ref()
        .unwrap()
        .iter()
        .find(|o| o.sealed_by_mount_id.as_deref() == Some("gun"))
        .unwrap();
    assert!((opening.area_m2 - area(inner)).abs() < 1e-7);
}

#[test]
fn original_oerlikon_reaches_full_elevation_but_stops_at_a_real_overhead_beam() {
    use naval_sim::mount_clearance::{ClearancePose, MountClearance};
    let (mut source, mut catalog) = fixture();
    source.construction.primitives[0].size = [12., 20., 40.];
    catalog.weapons =
        serde_json::from_str(include_str!("../../../assets/parts/guns.json")).unwrap();
    catalog.equipment = vec![
        ConstructionEquipmentPart {
            id: "magazine".into(),
            name: "Magazine".into(),
            kind: "magazine".into(),
            placement: "internal".into(),
            size: [2.; 3],
            bounds_center: [0., 1., 0.],
            center_of_gravity: [0., 1., 0.],
            mass_kg: Some(1000.),
            ammunition_capacity: Some(2000.),
            model_url: "/models/components/test.glb".into(),
            content_hash: "test".into(),
            ..Default::default()
        },
        ConstructionEquipmentPart {
            id: "aa".into(),
            name: "Oerlikon".into(),
            kind: "gun".into(),
            placement: "deck".into(),
            size: [1.6, 1.9, 2.4],
            bounds_center: [0., 0.95, 0.],
            center_of_gravity: [0., 1., 0.],
            gun_part_id: Some("us-20mm-oerlikon-mk4-hsienyang".into()),
            model_url: "/models/components/test.glb".into(),
            content_hash: "test".into(),
            ..Default::default()
        },
    ];
    source.construction.equipment = vec![
        ConstructionEquipment {
            id: "magazine".into(),
            part_id: "magazine".into(),
            position: [-4., -9.99, 0.],
            ..Default::default()
        },
        ConstructionEquipment {
            id: "aa".into(),
            part_id: "aa".into(),
            position: [0., 10., 0.],
            magazine_id: Some("magazine".into()),
            ..Default::default()
        },
    ];
    let def = compile(&source, &catalog);
    let cache = MountClearance::new(&def).unwrap().unwrap();
    for degrees in [-5_f64, 0., 30., 60., 87.] {
        let target = ClearancePose {
            train: 0.,
            elevation: degrees.to_radians(),
            recoil: 1.,
        };
        let result = cache.resolve(&def, 0, &[ClearancePose::default()], target);
        assert!(!result.blocked, "{degrees}: {:?}", result.obstruction_id);
        assert!((result.pose.elevation - target.elevation).abs() < 1e-8);
    }
    for (id, position, size) in [
        ("pillar", [3., 11.5, 0.], [0.4, 3., 1.]),
        ("beam", [0., 13., 0.], [8., 0.5, 1.]),
    ] {
        source.construction.primitives.push(ConstructionPrimitive { custom_hull: None,
            vertices: None,
            smooth_group: None,
            id: id.into(),
            kind: "box".into(),
            position,
            size,
            rotation_deg: 0.,
        });
    }
    let def = compile(&source, &catalog);
    let cache = MountClearance::new(&def).unwrap().unwrap();
    let result = cache.resolve(
        &def,
        0,
        &[ClearancePose::default()],
        ClearancePose {
            elevation: 87_f64.to_radians(),
            ..Default::default()
        },
    );
    assert!(result.blocked);
    assert!(result.pose.elevation < 87_f64.to_radians());
}

#[test]
fn published_construction_uses_trusted_manifest_admission_without_admitting_local_drafts() {
    use naval_sim::catalog::Catalog;
    use sha2::{Digest, Sha256};
    let (source, parts) = fixture();
    let mut definition = compile(&source, &parts);
    let mut manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read("../../.build/naval-content/manifest.json").unwrap(),
    )
    .unwrap();
    let entry = |definition: &ShipDefinition| {
        let json = serde_json::to_string(definition).unwrap();
        serde_json::json!({"id": definition.id, "contentHash": definition.content_hash,
            "sha256": format!("{:x}", Sha256::digest(json.as_bytes())), "json": json})
    };
    // Local IDs are forbidden even when the surrounding digest is correct.
    manifest["ships"].as_array_mut().unwrap().push(entry(&definition));
    assert!(Catalog::load(&serde_json::to_vec(&manifest).unwrap()).is_err());
    manifest["ships"].as_array_mut().unwrap().pop();
    definition.id = "published-construction-acceptance".into();
    manifest["ships"].as_array_mut().unwrap().push(entry(&definition));
    let accepted = Catalog::load(&serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(accepted.definitions.contains_key(&definition.id));
    assert!(!accepted.hydrostatics.contains_key(&definition.id));
    let last = manifest["ships"].as_array_mut().unwrap().last_mut().unwrap();
    last["sha256"] = serde_json::json!("corrupt");
    assert!(Catalog::load(&serde_json::to_vec(&manifest).unwrap()).is_err());
}
