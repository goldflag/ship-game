//! Isolated blast paths: retain a real compiled hull, replace its damage targets
//! with one structural volume and an optional plate so protection is measurable.
use naval_sim::{
    aircraft_flight::FlightAttitude,
    burst::burst_shell,
    catalog::Catalog,
    definition::{Armor, ArmorPlate, DamageRegion, HEProjectile, ShipDefinitionLocalDamage},
    rules::TeamId,
    shell::Shell,
    vessel::{CompiledShip, Vessel},
};
use std::sync::{Arc, OnceLock};

fn target(armor_mm: f64) -> Vessel {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    let catalog = CATALOG.get_or_init(|| {
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap()
    });
    let mut def = (*catalog.definitions["enterprise-cv6"]).clone();
    def.modules.clear();
    def.mounts.clear();
    def.compartments.clear();
    def.connections.clear();
    def.armor.clear();
    def.structural_plating = None;
    def.stability = None;
    def.air_wing = None;
    def.local_damage = Some(ShipDefinitionLocalDamage {
        version: 1.0,
        basis: "isolated structural blast test".into(),
        regions: vec![DamageRegion {
            id: "test-hull".into(),
            name: "Test hull".into(),
            kind: "hull".into(),
            center: [0.0, -1.0, 0.0],
            size: [2.0, 2.0, 2.0],
            durability_fraction: 1.0,
            ..Default::default()
        }],
    });
    if armor_mm > 0.0 {
        def.armor.push(Armor {
            id: "test-deck".into(),
            name: "Test deck".into(),
            thickness_mm: armor_mm,
            center: [0.0, 3.0, 0.0],
            size: [4.0, 0.01, 4.0],
            plate: Some(ArmorPlate {
                vertices: vec![
                    [-2.0, 3.0, -2.0],
                    [-2.0, 3.0, 2.0],
                    [2.0, 3.0, 2.0],
                    [2.0, 3.0, -2.0],
                ],
                material: "steel".into(),
                ..Default::default()
            }),
            ..Default::default()
        });
    }
    Vessel::new(
        "target",
        TeamId::A,
        // A synthetic armour box has no published table; the mesh solver stands in.
        Arc::new(CompiledShip::new(Arc::new(def), None).unwrap()),
    )
}
fn burst(distance: f64, armor_mm: f64, bomb: bool) -> (f64, Vec<naval_sim::impact::DamageEvent>) {
    let mut actor = target(armor_mm);
    let before = actor.damage.integrity;
    let mut shell = Shell {
        id: 1,
        owner_id: "attacker".into(),
        position: [0.0, distance, 0.0],
        velocity: [0.0, -100.0, 0.0],
        damage: 100.0,
        caliber_m: 0.25,
        last_hit_ship_id: Some("target".into()),
        bomb: bomb.then_some(FlightAttitude {
            heading: 0.0,
            pitch: -1.0,
            bank: 0.0,
        }),
        he: Some(HEProjectile {
            explosive_kg: 125.0,
            fragment_penetration_mm: 100.0,
            damage: 100.0,
            ..Default::default()
        }),
        ..Default::default()
    };
    let events = burst_shell(&mut shell, std::slice::from_mut(&mut actor));
    (before - actor.damage.integrity, events)
}

#[test]
fn structural_blast_pays_partial_shielding_and_cannot_cross_stopping_armor() {
    let (open, _) = burst(6.0, 0.0, true);
    let (shielded, events) = burst(6.0, 20.0, true);
    assert!(open > 0.0 && shielded > 0.0);
    // Normal incidence retains 80% fragment budget, then the ordinary protected
    // blast factor transmits 35% of that: 28%, within hull-HP rounding tolerance.
    assert!((shielded / open - 0.28).abs() < 0.002, "{shielded}/{open}");
    let impact = events
        .iter()
        .filter_map(|e| e.impact.as_ref())
        .find(|i| i.kind == "structure")
        .unwrap();
    assert_eq!(impact.penetration_before_mm, 100.0);
    assert_eq!(impact.penetration_after_mm, 80.0);
    let (blocked, events) = burst(6.0, 120.0, true);
    assert_eq!(blocked, 0.0);
    assert!(
        !events
            .iter()
            .filter_map(|e| e.impact.as_ref())
            .any(|i| i.kind == "structure")
    );
}

#[test]
fn a_single_structural_region_retains_radial_falloff_and_shell_he_does_not_use_it() {
    let (near, _) = burst(1.0, 0.0, true);
    let (far, _) = burst(14.0, 0.0, true);
    let (outside, _) = burst(15.1, 0.0, true);
    assert!(near > 0.0 && far > 0.0);
    // With a 15m radius these paths receive 14/15 and 1/15 of the cap.
    // Normalizing a sole target by its own weight would incorrectly make them equal.
    assert!((far / near - 1.0 / 14.0).abs() < 0.002, "{far}/{near}");
    assert_eq!(outside, 0.0);
    assert_eq!(burst(1.0, 0.0, false).0, 0.0);
}
