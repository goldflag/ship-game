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
                primitives: vec![ConstructionPrimitive {
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
        .expect(&format!("{:?}", result.diagnostics))
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
    .map(|(id, position, size)| ConstructionPrimitive {
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
