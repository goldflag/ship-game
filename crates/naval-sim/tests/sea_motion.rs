//! How much a hull moves in a seaway, by size and wind. The wave levers in
//! `stability.rs` are tuned, not derived, so these bands are their contract:
//! a destroyer works visibly in the default wind, a battleship only in heavy
//! weather, and nothing leaves its linear range at the top of the wind slider.
use naval_sim::{
    battle::{Battle, BattleSetup},
    catalog::Catalog,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};
fn catalog() -> &'static Arc<Catalog> {
    static CATALOG: OnceLock<Arc<Catalog>> = OnceLock::new();
    CATALOG.get_or_init(Catalog::installed)
}
struct Ride {
    roll_deg: f64,
    roll_rate_deg: f64,
    pitch_deg: f64,
    sunk: bool,
}
/// Peak motion of a stopped hull heading north over a minute, after the sea
/// has worked it for half a minute. Waves travel toward `direction_deg`: 0 is
/// beam-on, 90 is head-on.
fn ride(id: &str, wind: f64, direction_deg: f64) -> Ride {
    let mut battle = battle(id, wind, direction_deg);
    let mut ride = Ride {
        roll_deg: 0.0,
        roll_rate_deg: 0.0,
        pitch_deg: 0.0,
        sunk: false,
    };
    let mut previous = 0.0;
    for tick in 0..60 * 90 {
        battle.step(&BTreeMap::new());
        let motion = &battle.actors[0].motion;
        if tick >= 60 * 30 {
            ride.roll_deg = ride.roll_deg.max(motion.roll.abs().to_degrees());
            ride.pitch_deg = ride.pitch_deg.max(motion.pitch.abs().to_degrees());
            ride.roll_rate_deg = ride
                .roll_rate_deg
                .max((motion.roll - previous).abs().to_degrees() * 60.0);
        }
        previous = motion.roll;
    }
    ride.sunk = battle.actors[0].damage.sunk;
    ride
}
fn battle(id: &str, wind: f64, direction_deg: f64) -> Battle {
    let compiled: BTreeMap<String, Arc<_>> = [id, "fletcher"]
        .into_iter()
        .map(|i| (i.to_owned(), Arc::new(catalog().compile(i).unwrap())))
        .collect();
    let setup: BattleSetup = serde_json::from_value(serde_json::json!({
        "ships": [
            {"id":"own","presetId":id,"team":"a","controller":"player","aiLevel":"normal","spawn":{"x":0,"z":0,"heading":0}},
            {"id":"enemy","presetId":"fletcher","team":"b","controller":"bot","aiLevel":"static","spawn":{"x":0,"z":-19000,"heading":0}}
        ],
        "seed":54321,"mapId":"north-atlantic","weather":"clear","spawnDistance":16000,"windSpeed":wind
    }))
    .unwrap();
    let mut battle = Battle::new(catalog().clone(), &compiled, setup).unwrap();
    battle.set_wind(wind, direction_deg).unwrap();
    battle
}
fn within(value: f64, low: f64, high: f64, what: &str) {
    assert!(
        (low..=high).contains(&value),
        "{what}: {value:.2} outside {low}..{high}"
    );
}

#[test]
fn a_destroyer_works_in_the_default_wind_and_a_battleship_in_heavy_weather() {
    let destroyer = ride("fletcher", 9.0, 0.0);
    within(
        destroyer.roll_deg,
        2.5,
        4.5,
        "Fletcher roll, 9 m/s beam sea",
    );
    let battleship = ride("bismarck", 9.0, 0.0);
    within(
        battleship.roll_deg,
        0.35,
        0.9,
        "Bismarck roll, 9 m/s beam sea",
    );
    let heavy = ride("bismarck", 22.0, 0.0);
    within(heavy.roll_deg, 2.0, 4.0, "Bismarck roll, 22 m/s beam sea");
    // Her 38 cm guns elevate at 6 deg/s and must still hold a target through the roll.
    assert!(
        heavy.roll_rate_deg < 4.5,
        "Bismarck roll rate {:.2}",
        heavy.roll_rate_deg
    );
    let pitching = ride("fletcher", 16.0, 90.0);
    within(
        pitching.pitch_deg,
        0.7,
        1.6,
        "Fletcher pitch, 16 m/s head sea",
    );
    assert!(
        ![destroyer, battleship, heavy, pitching]
            .iter()
            .any(|r| r.sunk)
    );
}

#[test]
fn a_cargo_hull_stays_in_its_linear_range_at_the_top_of_the_wind_slider() {
    // Beyond WAVE_PITCH_LEVER 0.8 this hull's pitch runs away past 40 degrees.
    let liberty = ride("liberty-cargo", 30.0, 90.0);
    within(
        liberty.pitch_deg,
        4.0,
        9.0,
        "Liberty pitch, 30 m/s head sea",
    );
    assert!(!liberty.sunk);
}

#[test]
fn the_sea_heels_the_hull_every_tick_between_hydrostatic_solves() {
    // The solve runs every 30 ticks; the wave's heeling arm must not wait for it.
    let mut battle = battle("fletcher", 16.0, 0.0);
    for _ in 0..60 * 10 {
        battle.step(&BTreeMap::new());
    }
    let mut changed = 0;
    let mut previous = battle.actors[0].damage.stability.roll_arm;
    for _ in 0..60 {
        battle.step(&BTreeMap::new());
        let arm = battle.actors[0].damage.stability.roll_arm;
        if arm != previous {
            changed += 1;
        }
        previous = arm;
    }
    assert!(
        changed >= 58,
        "heeling arm changed on {changed} of 60 ticks"
    );
}

#[test]
fn a_deep_hull_feels_a_gentler_wave_slope_in_roll_only() {
    let battle = battle("bismarck", 9.0, 0.0);
    let sea = &battle.sea;
    let mut shallow = battle.actors[0].definition().hull.clone();
    shallow.draft = 0.0;
    let mut deep = shallow.clone();
    deep.draft = 9.3;
    let pose = naval_sim::motion::ShipState::default();
    let (mut surface, mut felt) = (0f64, 0f64);
    for tick in 0..60 * 20 {
        let time = tick as f64 / 60.0;
        let (a, b) = (
            sea.response(&shallow, &pose, false, time),
            sea.response(&deep, &pose, false, time),
        );
        assert_eq!((a.heave, a.pitch), (b.heave, b.pitch));
        surface = surface.max(a.roll.abs());
        felt = felt.max(b.roll.abs());
    }
    // Half of Bismarck's draft under a 128 m swell keeps about 80% of its slope.
    within(felt / surface, 0.7, 0.9, "slope felt at half the draft");
}
