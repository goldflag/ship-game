use naval_sim::{
    catalog::Catalog,
    damage::{DamageState, max_hull_integrity},
};

#[test]
fn hull_hp_has_a_gentle_small_ship_bonus() {
    let catalog =
        Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap()).unwrap();
    let mut def = (*catalog.definitions["bismarck"]).clone();
    assert_eq!(max_hull_integrity(&def), 50_750.0);
    assert_eq!(
        max_hull_integrity(&catalog.definitions["type-viic"]),
        1_993.0
    );
    for mass in [
        10_000.0,
        769_000.0,
        1_000_000.0,
        4_000_000.0,
        20_000_000.0,
        100_000_000.0,
    ] {
        def.hull.mass_kg = mass;
        let hp = DamageState::new(&def).integrity;

        def.hull.mass_kg *= 2.0;
        assert!((1.7..1.8).contains(&(max_hull_integrity(&def) / hp)));
    }
}
