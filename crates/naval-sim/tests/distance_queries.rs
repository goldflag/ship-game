use naval_sim::geometry::{length, sub, within_distance};

#[test]
fn range_queries_preserve_hypot_decisions_including_the_rounding_boundary() {
    let mut seed = 17001_u64;
    for _ in 0..10_000 {
        let mut coordinate = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            ((seed >> 32) as f64 / u32::MAX as f64 - 0.5) * 50_000.0
        };
        let a = [coordinate(), coordinate(), coordinate()];
        let b = [coordinate(), coordinate(), coordinate()];
        let distance = length(sub(a, b));
        for radius in [
            900.0,
            1800.0,
            8000.0,
            distance.next_down(),
            distance,
            distance.next_up(),
        ] {
            assert_eq!(
                within_distance(a, b, radius),
                distance <= radius,
                "{a:?} {b:?} {radius}"
            );
        }
    }
    for (a, radius) in [
        ([0.0; 3], 0.0),
        ([f64::MIN_POSITIVE; 3], f64::MIN_POSITIVE),
        ([f64::MAX / 4.0; 3], f64::MAX / 2.0),
        ([f64::INFINITY; 3], f64::INFINITY),
        ([f64::NAN; 3], 1.0),
        ([1.0; 3], -1.0),
    ] {
        assert_eq!(within_distance(a, [0.0; 3], radius), length(a) <= radius);
    }
}
