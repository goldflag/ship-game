//! Plays hand-authored scenarios headless through the worker's own path
//! (`PvePlanner::scenario` → `start` → `LocalRuntime::step`) with nobody at the
//! helm: every ship on both sides follows its opening orders and its crew. It
//! prints when each side first sights the other, every loss, the raid's plan and
//! why it withdrew, and the victory points, so a scenario's timing and balance
//! can be read without a browser.
//!
//! cargo run --profile test-fast -p naval-wasm --example scenario_soak -- [scenario] [--seeds N] [--first S] [--levels easy,normal,hard] [--log]
use naval_sim::rules::{TICK_RATE, TeamId};
use serde_json::Value;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mut scenario, mut seeds, mut first, mut levels, mut log) = (
        "savo-island".to_string(),
        4u32,
        1u32,
        vec!["normal".to_string()],
        false,
    );
    let mut i = 0;
    while i < args.len() {
        let value = || args.get(i + 1).cloned().expect("flag value");
        match args[i].as_str() {
            "--seeds" => (seeds, i) = (value().parse().unwrap(), i + 1),
            "--first" => (first, i) = (value().parse().unwrap(), i + 1),
            "--levels" => (levels, i) = (value().split(',').map(String::from).collect(), i + 1),
            "--log" => log = true,
            other => scenario = other.to_string(),
        }
        i += 1;
    }
    let manifest = naval_sim::catalog::installed_manifest();
    let mut results = vec![];
    for level in &levels {
        for seed in first..first + seeds {
            results.push(run(&manifest, &scenario, seed, level, log));
        }
    }
    println!("\nseed level   plan          result   reason      points A-B  contact  minutes");
    for r in &results {
        println!("{r}");
    }
}

fn run(manifest: &[u8], scenario: &str, seed: u32, level: &str, log: bool) -> String {
    let request = serde_json::json!({"version": 1, "scenarioId": scenario, "seed": seed, "difficulty": level});
    let mut planner = naval_wasm::PvePlanner::scenario(manifest, &request.to_string())
        .unwrap_or_else(|_| panic!("scenario {scenario} did not generate"));
    let briefing: Value = serde_json::from_str(&planner.briefing().unwrap()).unwrap();
    let placements: Vec<Value> = briefing["setup"]["ships"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| serde_json::json!({"id": s["id"], "spawn": s["spawn"]}))
        .collect();
    let mut runtime = planner
        .start(&Value::from(placements).to_string(), None)
        .unwrap_or_else(|_| panic!("seed {seed}: the scenario's own deployment was refused"));
    let started = Instant::now();
    let mut first_contact = [None::<u64>; 2];
    let mut lost = std::collections::BTreeSet::new();
    let mut launched = std::collections::BTreeSet::new();
    let mut torpedoes = [0usize; 2];
    let deadline = briefing["scenario"]["durationSeconds"].as_u64().unwrap() * TICK_RATE;
    println!(
        "=== {scenario} seed {seed} {level}: weather {}",
        briefing["scenario"]["weather"]
    );
    loop {
        runtime.step(6).unwrap();
        let session = runtime.session();
        let battle = &session.battle;
        for team in [TeamId::A, TeamId::B] {
            if first_contact[team.index()].is_none()
                && battle
                    .sensors
                    .contacts(team)
                    .iter()
                    .any(|c| c.kind == naval_sim::sensors::ContactKind::Surface)
            {
                first_contact[team.index()] = Some(battle.tick);
                println!(
                    "  {:>5.1} min  team {team:?} first sights the other side",
                    battle.tick as f64 / 3600.0
                );
            }
        }
        for t in &battle.torpedoes {
            if launched.insert(t.id)
                && let Some(owner) = battle.actors.iter().find(|a| a.motion.id == t.owner_id)
            {
                torpedoes[owner.team.index()] += 1;
            }
        }
        for a in &battle.actors {
            if a.physical_loss().is_some() && lost.insert(a.motion.id.clone()) {
                println!(
                    "  {:>5.1} min  {} ({}, team {:?}) lost",
                    battle.tick as f64 / 3600.0,
                    a.motion.id,
                    a.preset_id,
                    a.team
                );
            }
        }
        if log && battle.tick.is_multiple_of(120 * TICK_RATE) {
            let raid: Vec<_> = battle
                .actors
                .iter()
                .filter(|a| a.team == TeamId::B && a.physical_loss().is_none())
                .map(|a| format!("{} ({:.0},{:.0})", a.motion.id, a.motion.x, a.motion.z))
                .collect();
            println!(
                "  {:>5.1} min  raid {}",
                battle.tick as f64 / 3600.0,
                raid.join(" ")
            );
        }
        if battle.outcome.is_some() || battle.tick > deadline + 60 {
            break;
        }
    }
    let frame: Value = serde_json::from_str(&runtime.snapshot().unwrap()).unwrap();
    let battle = &runtime.session().battle;
    let outcome = battle
        .outcome
        .clone()
        .expect("the deadline decides every scenario");
    let debrief = [&frame["debrief"], &frame["battle"]["debrief"]]
        .into_iter()
        .map(|d| &d["mission"]["scenario"])
        .find(|d| !d.is_null())
        .expect("a decided scenario frame carries its debrief");
    let points = &debrief["score"]["points"];
    let result = match outcome.winner_team_id {
        Some(TeamId::A) => "win",
        Some(TeamId::B) => "loss",
        None => "draw",
    };
    let minutes = outcome.final_tick as f64 / 3600.0;
    println!(
        "  {:>5.1} min  {result} ({:?}); plan {}, withdrawal {}; points {points}; torpedoes {torpedoes:?}; {:.0} s wall",
        minutes,
        outcome.reason,
        debrief["plan"],
        debrief["withdrawal"],
        started.elapsed().as_secs_f64()
    );
    for line in debrief["score"]["lines"].as_array().into_iter().flatten() {
        println!(
            "      team {} +{} {} {}",
            line["team"], line["points"], line["kind"], line["shipId"]
        );
    }
    format!(
        "{seed:>4} {level:<7} {:<13} {result:<8} {:<11} {:>3}-{:<3}      {:>5}  {minutes:>6.1}",
        debrief["plan"].as_str().unwrap_or("?"),
        format!("{:?}", outcome.reason),
        points[0],
        points[1],
        first_contact[0].map_or("-".into(), |t| format!("{:.1}", t as f64 / 3600.0)),
    )
}
