//! Release-mode capacity evidence: complete battles and actual snapshot encoding.
#[path = "../encoding.rs"]
mod encoding;
use naval_sim::{
    battle::{Battle, BattleSetup, ShipSetup},
    bots::AiLevel,
    catalog::Catalog,
    rules::TeamId,
    vessel::Controller,
};
use std::{collections::BTreeMap, sync::Arc, time::Instant};
fn main() {
    let seconds: u64 = std::env::args()
        .nth(1)
        .unwrap_or("1800".into())
        .parse()
        .unwrap();
    assert!(
        seconds > 0 && seconds <= 7200,
        "Benchmark duration must be 1..7200 seconds"
    );
    let seed = std::env::var("NAVAL_BENCH_SEED")
        .ok()
        .map(|s| s.parse().unwrap())
        .unwrap_or(12345);
    let map_id = std::env::var("NAVAL_BENCH_MAP").unwrap_or("north-atlantic".into());
    let weather = std::env::var("NAVAL_BENCH_WEATHER").unwrap_or("overcast".into());
    let custom = std::env::var("NAVAL_BENCH_CUSTOM").is_ok();
    let catalog = Arc::new(
        Catalog::load(&std::fs::read(".build/naval-content/manifest.json").unwrap()).unwrap(),
    );
    let base_ids = [
        "enterprise-cv6",
        "enterprise-cv6",
        "bismarck",
        "baltimore",
        "fletcher",
        "fletcher",
        "fletcher",
        "fletcher",
    ];
    let ids: Vec<_> = (0..if custom { 30 } else { 8 })
        .map(|i| base_ids[i % base_ids.len()])
        .collect();
    if !custom {
        naval_sim::rules::validate_fleet(
            &ids.iter().map(|id| id.to_string()).collect::<Vec<_>>(),
            &catalog.fleet_entries,
            &Default::default(),
        )
        .unwrap();
    }
    let compiled = ids
        .iter()
        .map(|id| (id.to_string(), Arc::new(catalog.compile(*id).unwrap())))
        .collect::<BTreeMap<_, _>>();
    let setup = BattleSetup {
        ships: [TeamId::A, TeamId::B]
            .into_iter()
            .flat_map(|team| {
                ids.iter().enumerate().map(move |(i, id)| ShipSetup {
                    id: format!("{team:?}-{i}"),
                    preset_id: id.to_string(),
                    team,
                    controller: Controller::Bot,
                    ai_level: AiLevel::Hard,
                    spawn: None,
                })
            })
            .collect(),
        seed,
        map_id: map_id.clone(),
        weather: weather.clone(),
        spawn_distance: 5000.0,
        wind_speed: None,
        mission_rules: None,
        air_rules: None,
    };
    let mut battle = Battle::new(catalog.clone(), &compiled, setup.clone()).unwrap();
    let mut baseline = battle
        .presentation_value(naval_sim::snapshot::PresentationView::FullKnowledge)
        .unwrap();
    let mut ticks = Vec::new();
    let mut encoding = Vec::new();
    let mut bytes = Vec::new();
    let mut peak_airborne = 0;
    let mut completed = 0;
    let started = Instant::now();
    let orders = BTreeMap::new();
    for tick in 0..seconds * 60 {
        if battle.outcome.is_some() {
            completed += 1;
            battle = Battle::new(catalog.clone(), &compiled, setup.clone()).unwrap();
            baseline = battle
                .presentation_value(naval_sim::snapshot::PresentationView::FullKnowledge)
                .unwrap();
        }
        let step = Instant::now();
        battle.step(&orders);
        ticks.push(step.elapsed().as_secs_f64() * 1000.0);
        peak_airborne = peak_airborne.max(
            battle
                .aviation
                .wings
                .iter()
                .flat_map(|w| &w.state.planes)
                .filter(|p| {
                    matches!(
                        p.phase.as_str(),
                        "takeoff" | "outbound" | "attack" | "returning" | "landing"
                    )
                })
                .count(),
        );
        if tick % 3 == 0 {
            let start = Instant::now();
            let data = battle
                .presentation_value(naval_sim::snapshot::PresentationView::FullKnowledge)
                .unwrap();
            let frame = encoding::delta_bytes(&baseline, &data).unwrap();
            bytes.push(frame.len() as f64);
            encoding.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        if tick > 0 && tick % 3600 == 0 {
            eprintln!(
                "Simulated {} seconds; elapsed {:.1}s; active planes {peak_airborne}",
                tick / 60,
                started.elapsed().as_secs_f64()
            );
        }
    }
    std::fs::write(
        ".build/naval-content/profile-snapshot.json",
        serde_json::to_vec(
            &battle
                .presentation_value(naval_sim::snapshot::PresentationView::FullKnowledge)
                .unwrap(),
        )
        .unwrap(),
    )
    .unwrap();
    std::fs::write(
        ".build/naval-content/profile-delta.gz",
        encoding::delta_bytes(
            &baseline,
            &battle
                .presentation_value(naval_sim::snapshot::PresentationView::FullKnowledge)
                .unwrap(),
        )
        .unwrap(),
    )
    .unwrap();
    fn stats(mut samples: Vec<f64>) -> serde_json::Value {
        samples.sort_by(f64::total_cmp);
        serde_json::json!({"mean": samples.iter().sum::<f64>()/samples.len() as f64, "p50": samples[samples.len()/2], "p95": samples[samples.len()*95/100], "p99": samples[samples.len()*99/100], "max": samples.last()})
    }
    println!(
        "{}",
        serde_json::json!({"simulationBuild":naval_sim::SIMULATION_BUILD,"simulatedSeconds":seconds,"seed":seed,"map":map_id,"weather":weather,"vesselsPerSide":ids.len(),"wallSeconds":started.elapsed().as_secs_f64(),"completedBattles":completed,"peakAirborne":peak_airborne,"tickMs":stats(ticks),"snapshotMs":stats(encoding),"snapshotBytes":stats(bytes)})
    );
}
