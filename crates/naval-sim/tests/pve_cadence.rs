//! The PvE simulation cadence is installed content that applies only while a
//! battle carries mission rules. These tests pin three claims: the asset is
//! versioned and validated, a battle without mission rules keeps the per-tick
//! path, and each cadenced phase reproduces the per-tick path — exactly for
//! `capability::update`, and within a stated tolerance for the fire and
//! damage-control integration, which becomes one explicit Euler step per window.
use naval_sim::{
    battle::{Battle, BattleSetup},
    catalog::Catalog,
    damage::Combatant,
    damage_control::update_damage_control,
    definition::ShipDefinition,
    mission::SimulationCadence,
    rules::{DT, TeamId},
    vessel::{CompiledShip, Vessel},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

const SHIPS: [&str; 2] = ["fletcher", "bismarck"];
const STORM: &str = "storm-clouds";
type Content = (Arc<Catalog>, BTreeMap<String, Arc<CompiledShip>>);
fn content() -> &'static Content {
    static CONTENT: OnceLock<Content> = OnceLock::new();
    CONTENT.get_or_init(|| {
        let catalog = Arc::new(
            Catalog::load(&std::fs::read("../../.build/naval-content/manifest.json").unwrap())
                .unwrap(),
        );
        let compiled = SHIPS
            .into_iter()
            .map(|id| {
                (
                    id.to_owned(),
                    Arc::new(CompiledShip::new(catalog.definitions[id].clone()).unwrap()),
                )
            })
            .collect();
        (catalog, compiled)
    })
}
fn battle(mission: bool, ai: &str, distance: f64) -> Battle {
    build(mission, ai, distance, "bismarck", "clear", Some(0.0))
}
/// A destroyer alone in the heaviest sea state the content ships, with the
/// preset's own wind: the short-hull case for the hydrostatic cadence.
fn storm(interval: f64) -> Battle {
    let mut battle = build(true, "static", 12000.0, "fletcher", STORM, None);
    battle
        .set_cadence(SimulationCadence {
            stability_interval_seconds: interval,
            ..SimulationCadence::PER_TICK
        })
        .unwrap();
    assert!(battle.sea.amplitude_m > 0.0, "the storm has to raise a sea");
    battle
}
fn build(
    mission: bool,
    ai: &str,
    distance: f64,
    own: &str,
    weather: &str,
    wind: Option<f64>,
) -> Battle {
    let (catalog, compiled) = content();
    let mut setup = serde_json::json!({
        "ships": [
            {"id":"own","presetId":own,"team":"a","controller":"bot","aiLevel":ai,
             "spawn":{"x":0,"z":0,"heading":0}},
            {"id":"enemy","presetId":"fletcher","team":"b","controller":"bot","aiLevel":ai,
             "spawn":{"x":0,"z":-distance,"heading":std::f64::consts::PI}}
        ],
        "seed":54321,"mapId":"north-atlantic","spawnDistance":16000,
        "weather":weather,"windSpeed":wind
    });
    if mission {
        setup["missionRules"] = serde_json::to_value(&catalog.missions["pve-fleet-v1"]).unwrap();
    }
    Battle::new(
        catalog.clone(),
        compiled,
        serde_json::from_value::<BattleSetup>(setup).unwrap(),
    )
    .unwrap()
}
/// A hull already alight in every space, so a run of a few simulated minutes
/// exercises spread, suppression, magazine ignition and mount burn-down.
fn ignite(actor: &mut Combatant, heat: f64) {
    for f in &mut actor.damage.control.rooms {
        f.heat = heat;
    }
    for f in &mut actor.damage.control.mounts {
        f.heat = heat;
    }
}
fn state(battle: &Battle) -> String {
    serde_json::to_string(&battle.snapshot()).unwrap()
}
/// Every fire quantity on a comparable 0 to 2 scale: heat, burn intensity, the
/// fuel still unburnt as a fraction, and mount health as a fraction.
fn fires(actor: &Combatant) -> Vec<f64> {
    actor
        .damage
        .control
        .rooms
        .iter()
        .chain(&actor.damage.control.mounts)
        .flat_map(|f| [f.heat, f.intensity, f.fuel / f.initial_fuel.max(1.0)])
        .chain(actor.mounts.iter().map(|m| m.hp / 100.0))
        .collect()
}
fn worst_gap(a: &Combatant, b: &Combatant) -> f64 {
    fires(a)
        .iter()
        .zip(&fires(b))
        .map(|(a, b)| (a - b).abs())
        .fold(0.0, f64::max)
}
fn detonated(actor: &Combatant) -> Vec<&str> {
    actor
        .damage
        .modules
        .iter()
        .filter(|m| m.detonated)
        .map(|m| m.id.as_str())
        .collect()
}

#[test]
fn the_cadence_is_versioned_content_and_is_validated() {
    let cadence = SimulationCadence::default();
    assert_eq!(cadence.version, 1);
    assert_eq!(cadence.capability_ticks, 6);
    assert_eq!(cadence.damage_control_ticks, 30);
    assert_eq!(cadence.stability_interval_seconds, 1.0);
    assert_eq!(SimulationCadence::PER_TICK.stability_interval_seconds, 0.5);
    assert!(cadence.validate().is_ok());
    assert_eq!(SimulationCadence::PER_TICK.capability_ticks, 1);
    assert_eq!(SimulationCadence::PER_TICK.damage_control_ticks, 1);
    for bad in [
        SimulationCadence {
            version: 2,
            ..cadence
        },
        SimulationCadence {
            capability_ticks: 0,
            ..cadence
        },
        SimulationCadence {
            damage_control_ticks: 61,
            ..cadence
        },
        SimulationCadence {
            stability_interval_seconds: 2.0,
            ..cadence
        },
        SimulationCadence {
            stability_interval_seconds: f64::NAN,
            ..cadence
        },
    ] {
        assert!(bad.validate().is_err(), "{bad:?}");
    }
}

#[test]
fn only_a_mission_takes_the_pve_cadence() {
    assert_eq!(
        battle(false, "normal", 6000.0).cadence(),
        SimulationCadence::PER_TICK
    );
    assert_eq!(
        battle(true, "normal", 6000.0).cadence(),
        SimulationCadence::default()
    );
}

/// The captain-loop sweep only refreshes what the post-damage call already
/// wrote at the end of the previous tick: nothing between the two changes its
/// inputs, and gunnery re-derives the disabled set itself. Skipping five sweeps
/// in six must therefore leave the authority state bit for bit unchanged, in a
/// battle that shoots, burns and sinks.
#[test]
fn the_capability_cadence_leaves_the_simulation_identical() {
    let cadenced = SimulationCadence {
        capability_ticks: 6,
        ..SimulationCadence::PER_TICK
    };
    let mut a = battle(true, "normal", 6000.0);
    let mut b = battle(true, "normal", 6000.0);
    a.set_cadence(cadenced).unwrap();
    b.set_cadence(SimulationCadence::PER_TICK).unwrap();
    ignite(&mut a.actors[1], 2.0);
    ignite(&mut b.actors[1], 2.0);
    let orders = BTreeMap::new();
    for tick in 0..1800 {
        a.step(&orders);
        b.step(&orders);
        assert_eq!(state(&a), state(&b), "tick {tick}");
    }
    // The run has to be a real one, or the equality proves nothing.
    assert!(a.actors[1].damage.integrity < a.actors[1].damage.max_integrity);
}

/// One Euler step of 0.5 s against thirty of 1/60 s, on the same burning hull.
#[test]
fn a_fire_window_integrates_the_same_equations_as_thirty_ticks() {
    let (catalog, compiled) = content();
    let def: &ShipDefinition = &catalog.definitions["bismarck"];
    let mut stepped = Vessel::new("stepped", TeamId::A, compiled["bismarck"].clone());
    let mut ticked = Vessel::new("ticked", TeamId::A, compiled["bismarck"].clone());
    // Below the 2.0 ceiling, so heat, intensity and fuel all keep moving and
    // the window really integrates the curve instead of sitting on the clamp.
    ignite(&mut stepped, 0.8);
    ignite(&mut ticked, 0.8);
    let mut worst: f64 = 0.0;
    for window in 0..20 {
        update_damage_control(&mut stepped, def, 30.0 * DT, None);
        for _ in 0..30 {
            update_damage_control(&mut ticked, def, DT, None);
        }
        // Threshold crossings — a fire dropping back below its ignition heat,
        // a team's setup expiring — can land one window apart, which shows up
        // as a transient gap of up to one burn intensity. It is bounded and it
        // does not accumulate, which is what the final gap below checks.
        worst = worst.max(worst_gap(&stepped, &ticked));
        assert!(worst < 0.6, "window {window} diverged by {worst}");
    }
    let settled = worst_gap(&stepped, &ticked);
    println!("fire window: worst transient gap {worst:.4}, settled gap {settled:.4}");
    // Bounded, and back to a fraction of a percent once the transient passes.
    assert!(settled < 0.01, "the window drifted away from the tick path");
    // Both hulls really did burn: heat and fuel moved away from ignition.
    assert!(worst > 0.0);
    assert!(
        stepped
            .damage
            .control
            .rooms
            .iter()
            .any(|f| f.fuel < f.initial_fuel)
    );
}

/// A whole battle on the fire cadence: the ships must still burn down to the
/// same mission verdict, and the published fire state has to track the per-tick
/// path at every window boundary.
#[test]
fn the_fire_cadence_tracks_the_per_tick_path_to_the_same_verdict() {
    let mut a = battle(true, "static", 20000.0);
    let mut b = battle(true, "static", 20000.0);
    a.set_cadence(SimulationCadence::default()).unwrap();
    b.set_cadence(SimulationCadence::PER_TICK).unwrap();
    for battle in [&mut a, &mut b] {
        for actor in &mut battle.actors {
            ignite(actor, 2.0);
        }
    }
    let orders = BTreeMap::new();
    let mut worst: f64 = 0.0;
    for tick in 0..7200u64 {
        a.step(&orders);
        b.step(&orders);
        if !tick.is_multiple_of(30) {
            continue;
        }
        // Fires are continuous and must track closely. A magazine cooking off
        // is a discrete event, and the window can move it by up to half a
        // second, so the tight bound holds only while both runs are still
        // burning; the detonations themselves are compared as a set below.
        if a.actors
            .iter()
            .chain(&b.actors)
            .all(|x| detonated(x).is_empty())
        {
            for (x, y) in a.actors.iter().zip(&b.actors) {
                worst = worst.max(worst_gap(x, y));
            }
            assert!(worst < 0.6, "tick {tick} diverged by {worst}");
        }
    }
    println!("fire cadence before any cook-off: worst gap {worst:.4}");
    assert_eq!(
        a.outcome.as_ref().map(|o| (o.winner_team_id, o.reason)),
        b.outcome.as_ref().map(|o| (o.winner_team_id, o.reason))
    );
    for (x, y) in a.actors.iter().zip(&b.actors) {
        // Magazines that cook off do so within one window of each other, and
        // the run has to end on the same verdict for the same hulls.
        assert_eq!(detonated(x), detonated(y), "{}", x.motion.id);
        assert_eq!(x.physical_loss(), y.physical_loss(), "{}", x.motion.id);
        assert_eq!(
            x.damage.stability.combat_lost, y.damage.stability.combat_lost,
            "{}",
            x.motion.id
        );
    }
    assert!(worst > 0.0, "the run never burned anything");
}

/// Ten simulated minutes of Fletcher in the heaviest weather preset. The
/// hydrostatic solve on a one-second cadence must not pump energy into the roll
/// through the linearised arm: the second half of the run has to stay inside the
/// envelope the half-second solve produces, not grow past it.
#[test]
fn a_one_second_hydrostatic_cadence_does_not_diverge_on_a_short_hull() {
    let orders = BTreeMap::new();
    let mut envelopes = vec![];
    for interval in [0.5, 1.0] {
        let mut battle = storm(interval);
        let (mut early, mut late) = (0.0f64, 0.0f64);
        for tick in 0..36000u64 {
            battle.step(&orders);
            let roll = battle.actors[0].motion.roll.abs();
            assert!(
                roll.is_finite(),
                "{interval}s roll left the reals at {tick}"
            );
            if tick < 18000 {
                early = early.max(roll);
            } else {
                late = late.max(roll);
            }
        }
        println!(
            "{interval}s solve: peak roll {:.2} deg early, {:.2} deg late",
            early.to_degrees(),
            late.to_degrees()
        );
        envelopes.push((early, late));
    }
    let (base_early, base_late) = envelopes[0];
    let (early, late) = envelopes[1];
    assert!(base_early > 0.0 && early > 0.0, "the hull never rolled");
    // Bounded in absolute terms, not growing over the run, and no worse than
    // the half-second solve by more than a fifth.
    for (label, value, reference) in [("early", early, base_early), ("late", late, base_late)] {
        assert!(value < 25f64.to_radians(), "{label} roll {value} rad");
        assert!(
            value < reference * 1.2,
            "{label} roll {value} vs {reference}"
        );
    }
    assert!(late < early * 1.2, "roll grew from {early} to {late}");
}
