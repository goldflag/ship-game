//! A firing lane asks the hull one question: does this segment cross it. The
//! lane index answers from fragments of the hull's triangles, and it must give
//! the answer the full contact query gives for the same segment.
use naval_sim::{catalog::Catalog, hull_contact::HullContacts};
fn sample(state: &mut u64) -> f64 {
    *state = state
        .wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1_442_695_040_888_963_407);
    (*state >> 11) as f64 / (1u64 << 53) as f64
}
#[test]
fn the_lane_index_agrees_with_the_contact_query() {
    let bytes = std::fs::read("../../.build/naval-content/manifest.json")
        .expect("Run bun run multiplayer:content first");
    let catalog = Catalog::load(&bytes).unwrap();
    let mut state = 0x1a2e_5eed_0f1e_1d00;
    let (mut hulls, mut blocked) = (0, 0);
    for (id, def) in &catalog.definitions {
        if def.hull.volume.is_none() {
            continue;
        }
        hulls += 1;
        let hull = HullContacts::new(&def.hull);
        let (length, beam, height) = (def.hull.length, def.hull.beam, def.hull.depth + 30.0);
        for lane in 0..4000 {
            // Breech-like starts on and above the ship, ends a hull length away
            // in any direction; every tenth lane is short and inside the ship.
            let from = [
                (sample(&mut state) - 0.5) * beam,
                (sample(&mut state) - 0.3) * height,
                (sample(&mut state) - 0.5) * length,
            ];
            let reach = if lane % 10 == 0 { 8.0 } else { length };
            let (yaw, pitch) = (
                sample(&mut state) * std::f64::consts::TAU,
                (sample(&mut state) - 0.5) * 1.6,
            );
            let to = [
                from[0] + reach * yaw.sin() * pitch.cos(),
                from[1] + reach * pitch.sin(),
                from[2] - reach * yaw.cos() * pitch.cos(),
            ];
            let crossed = !hull.query(from, to).is_empty();
            assert_eq!(hull.blocks(from, to), crossed, "{id} {from:?} -> {to:?}");
            blocked += usize::from(crossed);
        }
    }
    assert!(hulls > 0, "no constructed hulls in the catalog");
    assert!(
        blocked > 1000,
        "too few blocked lanes to mean anything: {blocked}"
    );
}
