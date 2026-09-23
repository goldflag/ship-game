//! Trainable parents: a light deck gun or deck fitting that names a gun as its parent trains with
//! it. The compiler links a carried gun's mount to its carrier (`parentMountId`, parent-first), and
//! the runtime carries its frame, clearance and fire.
use naval_sim::{
    aviation::Aviation,
    catalog::Catalog,
    construction,
    definition::*,
    geometry::*,
    gunnery::{GunneryContext, PlayerGunOrders, operate},
    mount_clearance::{ClearancePose, MountClearance},
    mount_frames::{mount_frame, update_mount_carrier},
    rules::{DT, TeamId},
    vessel::{CompiledShip, Vessel},
    weapons::{MountState, muzzle_local},
};
use std::{collections::BTreeMap, sync::Arc};

const TURRET: &str = "sk-c28-150-twin";
const FLAK: &str = "flak38-20-vierling";

fn catalog() -> ConstructionCatalog {
    serde_json::from_str(include_str!(
        "../../../public/models/components/catalog.json"
    ))
    .unwrap()
}

/// Top of a part's bounds above its datum.
fn roof(catalog: &ConstructionCatalog, part: &str) -> f64 {
    let p = catalog.equipment.iter().find(|p| p.id == part).unwrap();
    p.bounds_center[1] + p.size[1] / 2.
}

/// A box hull with a 15 cm twin turret forward and a Flakvierling on its roof, the roof mount
/// listed first so the compiler must order the mounts itself.
fn source(catalog: &ConstructionCatalog, parent: Option<&str>) -> ConstructionSource {
    seated(catalog, parent, roof(catalog, TURRET))
}

/// The same design with the roof mount's datum `height` above the turret's.
fn seated(catalog: &ConstructionCatalog, parent: Option<&str>, height: f64) -> ConstructionSource {
    placed(catalog, parent, [0., height, 0.6])
}

/// The same design with the roof mount's datum at `offset` from the turret's.
fn placed(catalog: &ConstructionCatalog, parent: Option<&str>, offset: Vec3) -> ConstructionSource {
    let turret = ConstructionEquipment {
        id: "turret".into(),
        part_id: TURRET.into(),
        position: [0., 8., -25.],
        ..Default::default()
    };
    let flak = ConstructionEquipment {
        id: "flak".into(),
        part_id: FLAK.into(),
        position: [offset[0], 8. + offset[1], -25. + offset[2]],
        bearing_deg: 180.,
        parent: parent.map(str::to_owned),
        ..Default::default()
    };
    ConstructionSource {
        schema_version: 1.,
        id: "turret-parents".into(),
        revision: "r1".into(),
        name: "Turret parents".into(),
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
            equipment: vec![flak, turret],
            ..Default::default()
        },
    }
}

fn compiled(source: &ConstructionSource, catalog: &ConstructionCatalog) -> ShipDefinition {
    let result = construction::compile(source, catalog);
    result
        .definition
        .unwrap_or_else(|| panic!("{:#?}", result.diagnostics))
}

#[test]
fn a_roof_gun_is_linked_to_its_turret_parent_first() {
    let catalog = catalog();
    let def = compiled(&source(&catalog, Some("turret")), &catalog);
    let ids: Vec<_> = def.mounts.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["turret", "flak"]);
    assert_eq!(def.mounts[1].parent_mount_id.as_deref(), Some("turret"));
    assert_eq!(def.mounts[0].parent_mount_id, None);
    naval_sim::catalog::validate_definition(&def).unwrap();
    // Without the link the mount keeps source order and no carrier; nothing else differs.
    let loose = compiled(&source(&catalog, None), &catalog);
    let normalized = |d: &ShipDefinition| {
        let mut d = d.clone();
        d.mounts.sort_by(|a, b| a.id.cmp(&b.id));
        for m in &mut d.mounts {
            m.parent_mount_id = None;
        }
        d.mount_clearance.as_mut().unwrap().mount_ids = None;
        d.construction = None;
        d.content_hash = None;
        d.id = String::new();
        construction::to_json(&d).unwrap()
    };
    assert_eq!(
        loose
            .mounts
            .iter()
            .map(|m| m.id.as_str())
            .collect::<Vec<_>>(),
        ["flak", "turret"]
    );
    assert_eq!(normalized(&def), normalized(&loose));
}

#[test]
fn a_carried_gun_never_clashes_with_its_carrier() {
    // Seated into the turret's gameplay gunhouse (2.6 m tall) rather than on its modelled roof.
    let catalog = catalog();
    let loose = construction::compile(&seated(&catalog, None, 2.5), &catalog);
    assert!(
        loose.diagnostics.iter().any(|d| d.severity == "error"
            && d.source_id.as_deref() == Some("turret")
            && d.related_source_ids.as_deref() == Some(&["flak".to_owned()][..])
            && d.code == "equipment-overlap"),
        "{:#?}",
        loose.diagnostics
    );
    let carried = compiled(&seated(&catalog, Some("turret"), 2.5), &catalog);
    assert_eq!(carried.mounts[1].parent_mount_id.as_deref(), Some("turret"));
}

#[test]
fn a_carrier_elevates_through_what_it_carries() {
    // A mount stood out over the turret's barrels: fixed, it stops them elevating; carried, the
    // turret's barrels pass it (constructed ships exempt a carrier from what it carries).
    let catalog = catalog();
    let offset = [0., roof(&catalog, TURRET), -4.5];
    let elevate = |def: &ShipDefinition| {
        let clearance = MountClearance::new(def).unwrap().unwrap();
        let turret = def.mounts.iter().position(|m| m.id == "turret").unwrap();
        let poses: Vec<_> = def
            .mounts
            .iter()
            .map(|_| ClearancePose::default())
            .collect();
        clearance.resolve(
            def,
            turret,
            &poses,
            ClearancePose {
                train: 0.,
                elevation: radians(40.),
                recoil: 0.,
            },
        )
    };
    let fixed = elevate(&compiled(&placed(&catalog, None, offset), &catalog));
    assert!(fixed.blocked, "{fixed:?}");
    let carried = elevate(&compiled(
        &placed(&catalog, Some("turret"), offset),
        &catalog,
    ));
    assert!(!carried.blocked, "{carried:?}");
}

#[test]
fn the_roof_gun_trains_with_its_turret() {
    let catalog = catalog();
    let def = compiled(&source(&catalog, Some("turret")), &catalog);
    let mut states: Vec<_> = def.mounts.iter().map(MountState::new).collect();
    let neutral: Vec<_> = (0..4)
        .map(|b| muzzle_local(&def.mounts[1], &states[1], b))
        .collect();
    states[0].train = radians(30.);
    for i in 0..states.len() {
        update_mount_carrier(&def, i, &mut states);
    }
    let pivot = def.mounts[0].position;
    let turned = Pose {
        x: pivot[0],
        y: pivot[1],
        z: pivot[2],
        heading: radians(30.),
        ..Pose::default()
    };
    for (barrel, point) in neutral.iter().enumerate() {
        let expected = local_to_world(sub(*point, pivot), turned);
        let actual = muzzle_local(&def.mounts[1], &states[1], barrel);
        assert!(
            length(sub(expected, actual)) < 1e-9,
            "{expected:?} {actual:?}"
        );
    }
    let frame = mount_frame(&def, 1, &|i| states[i].train);
    assert!((frame.heading - radians(180. + 30.)).abs() < 1e-9);
    // Carried clearance: the turret's barrels pass its own roof mount, and the roof mount can
    // still train and elevate clear of the turret's gunhouse.
    let clearance = MountClearance::new(&def).unwrap().unwrap();
    let poses: Vec<_> = def
        .mounts
        .iter()
        .map(|_| ClearancePose::default())
        .collect();
    for (index, request) in [
        (0, [radians(60.), radians(30.)]),
        (1, [radians(-90.), radians(60.)]),
    ] {
        let result = clearance.resolve(
            &def,
            index,
            &poses,
            ClearancePose {
                train: request[0],
                elevation: request[1],
                recoil: 0.,
            },
        );
        assert!(!result.blocked, "{index}: {result:?}");
    }
}

#[test]
fn the_roof_gun_fires_from_the_trained_turret() {
    let catalog = catalog();
    let def = compiled(&source(&catalog, Some("turret")), &catalog);
    let content =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    let compiled = Arc::new(CompiledShip::new(Arc::new(def), None).unwrap());
    let def = &compiled.definition;
    let mut actor = Vessel::new("turret-parents", TeamId::A, compiled.clone());
    actor.mounts[0].train = radians(30.);
    let carrier = Vessel::new(
        "carrier",
        TeamId::B,
        Arc::new(content.compile("enterprise-cv6").unwrap()),
    );
    let mut air = Aviation::new(&[carrier], content.aircraft.clone());
    air.wings[0].state.planes.truncate(1);
    let plane = &mut air.wings[0].state.planes[0];
    plane.phase = "outbound".into();
    plane.deck_slot = None;
    plane.hp = 1e6;
    // Off the port quarter, where the roof mount (facing aft, turned 30° with the turret) looks.
    plane.position = [-200.0, 300.0, 550.0];
    plane.velocity = [0.0; 3];
    let orders = PlayerGunOrders {
        battery: "main".into(),
        weapon_group_id: None,
        aim: None,
        fire: false,
        ammunition: BTreeMap::new(),
    };
    let (mut sequence, mut dispersion) = (0, 0);
    let mut shells = vec![];
    let mut fired = 0;
    for _ in 0..900 {
        let mut events = vec![];
        operate(
            &mut actor,
            &mut GunneryContext {
                actors: naval_sim::vessel::Fleet::all(&[]),
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
        // Every shot leaves a muzzle of the carried mount, posed through the turret's train.
        for shot in events.iter().filter(|e| e.message.contains("AA fire")) {
            let pivot = def.mounts[0].position;
            let mut neutral = actor.mounts[1].clone();
            neutral.carrier = None;
            let at_turret = |barrel| {
                local_to_world(
                    sub(muzzle_local(&def.mounts[1], &neutral, barrel), pivot),
                    Pose {
                        x: pivot[0],
                        y: pivot[1],
                        z: pivot[2],
                        heading: actor.mounts[0].train,
                        ..Pose::default()
                    },
                )
            };
            let basis = actor.motion.basis();
            assert!(
                (0..4)
                    .any(|b| length(sub(shot.position, basis.local_to_world(at_turret(b)))) < 1e-6),
                "{:?}",
                shot.position
            );
            fired += 1;
        }
    }
    assert!(
        fired > 0,
        "the roof Flakvierling never fired: {}",
        actor.mounts[1].status
    );
    assert!(actor.mounts[0].train.abs() > radians(1.));
}
