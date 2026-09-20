//! Grouping boundary topology must retain the original sequential transfer,
//! localized breach heights, and water conservation across a network of rooms.
use naval_sim::{
    catalog::Catalog,
    damage::{Combatant, ConnectionState},
    definition::{
        Compartment, FloodConnection, FloodConnectionBounds, FloodConnectionPatch,
        FloodConnectionPatchBounds, ShipDefinition,
    },
    flooding::update_flooding,
    hydrostatics::HullHydrostatics,
};

fn fixture() -> ShipDefinition {
    let bytes = std::fs::read("../../.build/naval-content/manifest.json").unwrap();
    let catalog = Catalog::load(&bytes).unwrap();
    let mut def = catalog.definitions["bismarck"].as_ref().clone();
    def.stability = None;
    def.modules.clear();
    def.mounts.clear();
    def.openings = None;
    def.damage_control.teams = 0.;
    def.hull.reserve_buoyancy_m3 = 1e6;
    def.compartments = ["a", "b", "c"]
        .into_iter()
        .map(|id| Compartment {
            id: id.into(),
            name: id.into(),
            center: [0., 2., 0.],
            size: [5., 4., 5.],
            capacity_m3: 100.,
            ..Default::default()
        })
        .collect();
    def.connections.clear();
    def
}

fn portal(from: &str, to: &str, height: f64, order: usize) -> FloodConnection {
    FloodConnection {
        id: Some(format!("{from}-{to}-{order}")),
        from_id: from.into(),
        to_id: to.into(),
        area_m2: 0.31 + order as f64 * 0.127,
        position: Some([0., height, 0.]),
        bounds: Some(FloodConnectionBounds {
            center: [0., height, 0.],
            size: [1., 0.5, 0.1],
        }),
        state: Some("closed".into()),
        armor_id: Some(format!("wall-{from}-{to}")),
        transfer_order: Some(order as f64),
        ..Default::default()
    }
}

/// Construct the runtime representation directly: the test's baseline retains
/// the original entries, so its numerical oracle does not use the grouping code.
fn group(original: &[FloodConnection]) -> FloodConnection {
    let mut combined = original[0].clone();
    combined.area_m2 = original.iter().map(|c| c.area_m2).sum();
    combined.bounds = None;
    combined.position = Some([0., 2., 0.]); // Deliberately unlike the low breach.
    combined.patches = Some(
        original
            .iter()
            .map(|c| {
                let b = c.bounds.as_ref().unwrap();
                FloodConnectionPatch {
                    area_m2: c.area_m2,
                    position: c.position.unwrap(),
                    bounds: FloodConnectionPatchBounds {
                        center: b.center,
                        size: b.size,
                    },
                    transfer_order: c.transfer_order.unwrap(),
                }
            })
            .collect(),
    );
    combined
}

fn actor(def: &ShipDefinition, fills: [f64; 3]) -> Combatant {
    let mut actor = Combatant::new("fixture", def);
    for (room, fill) in actor.damage.compartments.iter_mut().zip(fills) {
        room.water_m3 = fill;
    }
    actor
}

fn wet(state: &mut ConnectionState, area: f64) {
    state.state = "damaged".into();
    state.damage_area_m2 = area;
}

fn same_water(a: &Combatant, b: &Combatant, total: f64) {
    for (i, (a, b)) in a
        .damage
        .compartments
        .iter()
        .zip(&b.damage.compartments)
        .enumerate()
    {
        assert_eq!(
            a.water_m3.to_bits(),
            b.water_m3.to_bits(),
            "room {i}: {} != {}",
            a.water_m3,
            b.water_m3
        );
        assert!((0. ..=100.).contains(&a.water_m3));
    }
    let actual: f64 = a.damage.compartments.iter().map(|c| c.water_m3).sum();
    assert!(
        (actual - total).abs() < 1e-10,
        "water changed: {actual} != {total}"
    );
}

#[test]
fn interleaved_group_patches_preserve_sequential_network_flow() {
    let mut original = fixture();
    original.connections = vec![
        portal("a", "b", 0.1, 0),
        portal("b", "c", 0.2, 1),
        portal("a", "b", 0.3, 2),
        portal("a", "c", 0.1, 3),
        portal("a", "b", 0.5, 4),
    ];
    // The standalone door retains a separate state and original transfer order.
    original.connections[3].armor_id = None;
    let mut grouped = original.clone();
    grouped.connections = vec![
        group(&[
            original.connections[0].clone(),
            original.connections[2].clone(),
            original.connections[4].clone(),
        ]),
        original.connections[1].clone(),
        original.connections[3].clone(),
    ];
    let hydro = HullHydrostatics::new(&original.hull, None);
    for (fills, dt) in [
        ([95., 30., 1.], 0.1),
        ([1., 30., 95.], 0.7),
        ([99.99, 0.001, 45.], 20.),
    ] {
        let (mut a, mut b) = (actor(&original, fills), actor(&grouped, fills));
        for (s, c) in a.damage.connections.iter_mut().zip(&original.connections) {
            wet(s, c.area_m2);
        }
        for (s, c) in b.damage.connections.iter_mut().zip(&grouped.connections) {
            wet(s, c.area_m2);
        }
        for step in 0..80 {
            // Recheck individual patch heights under heel and trim as well.
            for actor in [&mut a, &mut b] {
                actor.motion.roll = (step as f64 * 0.1).sin() * 0.45;
                actor.motion.pitch = (step as f64 * 0.13).sin() * 0.1;
            }
            update_flooding(&mut a, &original, &hydro, dt, 0.5, None, None);
            update_flooding(&mut b, &grouped, &hydro, dt, 0.5, None, None);
            same_water(&a, &b, fills.into_iter().sum());
        }
    }
}

#[test]
fn a_high_local_breach_does_not_create_a_low_transfer_opening() {
    let mut original = fixture();
    original.connections = vec![portal("a", "b", 0.25, 0), portal("a", "b", 3., 1)];
    let mut grouped = original.clone();
    grouped.connections = vec![group(&original.connections)];
    let hydro = HullHydrostatics::new(&original.hull, None);
    for (damaged_patch, fills) in [(1, [40., 0., 0.]), (0, [40., 0., 0.]), (1, [95., 0., 0.])] {
        let (mut a, mut b) = (actor(&original, fills), actor(&grouped, fills));
        wet(&mut a.damage.connections[damaged_patch], 0.2);
        wet(&mut b.damage.connections[0], 0.2);
        let mut damage = vec![0.; 2];
        damage[damaged_patch] = 0.2;
        b.damage.connections[0].patch_damage_m2 = Some(damage);
        for _ in 0..60 {
            update_flooding(&mut a, &original, &hydro, 0.1, 0.5, None, None);
            update_flooding(&mut b, &grouped, &hydro, 0.1, 0.5, None, None);
            same_water(&a, &b, fills.into_iter().sum());
        }
        if damaged_patch == 1 && fills[0] == 40. {
            assert_eq!(b.damage.compartments[1].water_m3, 0.);
        } else {
            assert!(b.damage.compartments[1].water_m3 > 0.);
        }
    }
}

#[test]
fn local_patch_damage_survives_snapshot_roundtrip_and_old_states_default_it() {
    let mut def = fixture();
    def.connections = vec![group(&[portal("a", "b", 0.25, 0), portal("a", "b", 3., 1)])];
    let mut a = actor(&def, [40., 0., 0.]);
    wet(&mut a.damage.connections[0], 0.2);
    a.damage.connections[0].patch_damage_m2 = Some(vec![0., 0.2]);
    let json = serde_json::to_vec(&a.damage.connections).unwrap();
    let mut b = actor(&def, [40., 0., 0.]);
    b.damage.connections = serde_json::from_slice(&json).unwrap();
    let hydro = HullHydrostatics::new(&def.hull, None);
    update_flooding(&mut a, &def, &hydro, 0.1, 0.5, None, None);
    update_flooding(&mut b, &def, &hydro, 0.1, 0.5, None, None);
    same_water(&a, &b, 40.);
    let mut legacy = serde_json::to_value(&a.damage.connections[0]).unwrap();
    legacy.as_object_mut().unwrap().remove("patchDamageM2");
    let legacy: ConnectionState = serde_json::from_value(legacy).unwrap();
    assert!(legacy.patch_damage_m2.is_none());
}

#[test]
fn grouped_fire_transmission_keeps_parallel_fragment_exposure() {
    let mut original = fixture();
    original.connections = vec![
        portal("a", "b", 0.25, 0),
        portal("a", "b", 1.25, 1),
        portal("a", "b", 3., 2),
    ];
    let mut grouped = original.clone();
    grouped.connections = vec![group(&original.connections)];
    for opened in [false, true] {
        let (mut a, mut b) = (actor(&original, [0.; 3]), actor(&grouped, [0.; 3]));
        for actor in [&mut a, &mut b] {
            actor.damage.control.rooms[0].heat = 1.2;
            actor.damage.control.rooms[0].fuel = 100.;
            actor.damage.control.rooms[1].fuel = 100.;
        }
        let damage = [0.1, 0.4, 0.2];
        for (s, area) in a.damage.connections.iter_mut().zip(damage) {
            wet(s, area);
            if opened {
                s.state = "open".into();
            }
        }
        wet(&mut b.damage.connections[0], damage.into_iter().sum());
        b.damage.connections[0].patch_damage_m2 = Some(damage.to_vec());
        if opened {
            b.damage.connections[0].state = "open".into();
        }
        for _ in 0..10 {
            naval_sim::damage_control::update_damage_control(&mut a, &original, 0.1, None);
            naval_sim::damage_control::update_damage_control(&mut b, &grouped, 0.1, None);
            for (a, b) in a.damage.control.rooms.iter().zip(&b.damage.control.rooms) {
                assert!(
                    (a.heat - b.heat).abs() < 1e-12,
                    "parallel fire heat: {} != {}",
                    a.heat,
                    b.heat
                );
                assert!((a.intensity - b.intensity).abs() < 1e-12);
            }
        }
        assert!(b.damage.control.rooms[1].heat > 0.);
    }
}

#[test]
fn an_open_group_uses_every_original_height_instead_of_its_display_center() {
    let mut original = fixture();
    original.connections = vec![portal("a", "b", 0.25, 0), portal("a", "b", 3., 1)];
    let mut grouped = original.clone();
    grouped.connections = vec![group(&original.connections)];
    let (mut a, mut b) = (
        actor(&original, [40., 0., 0.]),
        actor(&grouped, [40., 0., 0.]),
    );
    for s in &mut a.damage.connections {
        s.state = "open".into();
    }
    b.damage.connections[0].state = "open".into();
    // Historical local damage must not restrict a subsequently opened boundary.
    b.damage.connections[0].patch_damage_m2 = Some(vec![0., 0.1]);
    let hydro = HullHydrostatics::new(&original.hull, None);
    for _ in 0..60 {
        update_flooding(&mut a, &original, &hydro, 0.1, 0.5, None, None);
        update_flooding(&mut b, &grouped, &hydro, 0.1, 0.5, None, None);
        same_water(&a, &b, 40.);
    }
    assert!(b.damage.compartments[1].water_m3 > 0.);
}
