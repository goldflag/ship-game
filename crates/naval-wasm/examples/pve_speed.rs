//! Native mirror of the local worker diagnostics, for symbolized profiling and
//! the simulation equality gate. Runs the same `PvePlanner`/`LocalRuntime` code
//! the browser worker runs, without WASM or rendering.
//!
//! cargo run --release -p naval-wasm --example pve_speed -- [scenario] [seconds] [batch] [--dump PATH] [--no-snapshot]
//!
//! Scenarios: `surface` and `carrier` (fleet command, team projection, default
//! 12-tick batches like 4× at 20 Hz), `custom` (15-ship custom battle, full
//! snapshot every tick like the 60 Hz local session), `server` (same battle,
//! the match worker's tree projection plus baseline delta every 3 ticks).
//! `--dump` writes the complete final state for byte comparison across builds.
use std::time::Instant;

fn pve_request(scenario: &str) -> serde_json::Value {
    let roster: Vec<&str> = if scenario == "carrier" {
        let mut r = vec!["enterprise-cv6", "shokaku", "bismarck"];
        r.extend(std::iter::repeat_n("fletcher", 12));
        r
    } else {
        let mut r = vec!["bismarck", "iowa"];
        r.extend(std::iter::repeat_n("baltimore", 4));
        r.extend(std::iter::repeat_n("fletcher", 9));
        r
    };
    let ships: Vec<serde_json::Value> = roster
        .iter()
        .enumerate()
        .map(|(i, p)| {
            serde_json::json!({"id": format!("own-{i}"), "presetId": p,
                "groupId": if scenario == "carrier" && i < 2 { "rear" } else { "front" }})
        })
        .collect();
    let groups = if scenario == "carrier" {
        serde_json::json!([{"id":"rear","name":"Carriers","station":"rear"},{"id":"front","name":"Surface","station":"front"}])
    } else {
        serde_json::json!([{"id":"front","name":"Surface","station":"front"}])
    };
    serde_json::json!({"version":1,"seed":17001,"mapId":"pacific-islands","weather":"clear",
        "difficulty":"normal","ships":ships,"groups":groups})
}

/// The larger custom-battle performance roster from docs/custom-battle-performance.md.
fn custom_setup() -> serde_json::Value {
    const ROSTER: [&str; 15] = [
        "bismarck",
        "yamato",
        "king-george-v",
        "baltimore",
        "fletcher",
        "flower-corvette",
        "bismarck",
        "yamato",
        "king-george-v",
        "baltimore",
        "fletcher",
        "baltimore",
        "fletcher",
        "enterprise-cv6",
        "shokaku",
    ];
    let mut ships = Vec::new();
    for (team, prefix) in [("a", "friendly"), ("b", "enemy")] {
        for (i, preset) in ROSTER.iter().enumerate() {
            let player = team == "a" && i == 0;
            ships.push(serde_json::json!({
                "id": if player { "player".to_string() } else { format!("{prefix}-{i}") },
                "presetId": preset, "team": team,
                "controller": if player { "player" } else { "bot" },
                "aiLevel": "normal", "spawn": null }));
        }
    }
    serde_json::json!({"ships": ships, "seed": 17001, "mapId": "pacific-islands", "weather": "clear",
        "spawnDistance": 12000.0, "windSpeed": null})
}

/// Mirror of naval-server's baseline delta, minus gzip: patches against the
/// immutable match baseline, serialized contiguously.
fn delta_bytes(baseline: &serde_json::Value, current: &serde_json::Value) -> usize {
    fn diff(
        base: &serde_json::Value,
        value: &serde_json::Value,
        path: &mut Vec<serde_json::Value>,
        patches: &mut Vec<serde_json::Value>,
    ) {
        use serde_json::{Value, json};
        if base == value {
            return;
        }
        match (base, value) {
            (Value::Object(a), Value::Object(b)) if a.keys().all(|key| b.contains_key(key)) => {
                for (key, value) in b {
                    path.push(json!(key));
                    if let Some(base) = a.get(key) {
                        diff(base, value, path, patches);
                    } else {
                        patches.push(json!([path, value]));
                    }
                    path.pop();
                }
            }
            (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
                for (index, (base, value)) in a.iter().zip(b).enumerate() {
                    path.push(json!(index));
                    diff(base, value, path, patches);
                    path.pop();
                }
            }
            _ => patches.push(json!([path, value])),
        }
    }
    let mut patches = Vec::new();
    diff(baseline, current, &mut Vec::new(), &mut patches);
    serde_json::to_vec(&serde_json::json!({"type":"snapshot-delta","patches":patches}))
        .map(|v| v.len())
        .unwrap_or(0)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut positional = Vec::new();
    let mut dump = None;
    let mut snapshot = true;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--dump" => {
                dump = args.get(i + 1).cloned();
                i += 1;
            }
            "--no-snapshot" | "nosnapshot" => snapshot = false,
            other => positional.push(other.to_string()),
        }
        i += 1;
    }
    let scenario = positional.first().map(String::as_str).unwrap_or("surface");
    let seconds: u64 = positional
        .get(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(600);
    let batch: u32 = positional
        .get(2)
        .and_then(|s| s.parse().ok())
        .unwrap_or(match scenario {
            "custom" => 1,
            "server" => 3,
            _ => 12,
        });
    assert!(batch >= 1 && 3600 % batch == 0, "batch must divide 3600");
    let manifest = std::fs::read(".build/naval-content/manifest.json").expect("manifest");
    let mut runtime = match scenario {
        "surface" | "carrier" => {
            let request = pve_request(scenario);
            let mut planner = naval_wasm::PvePlanner::new(&manifest, &request.to_string()).unwrap();
            let briefing: serde_json::Value =
                serde_json::from_str(&planner.briefing().unwrap()).unwrap();
            let placements: Vec<serde_json::Value> = briefing["setup"]["ships"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| serde_json::json!({"id": s["id"], "spawn": s["spawn"]}))
                .collect();
            planner
                .start(&serde_json::to_string(&placements).unwrap(), None)
                .unwrap()
        }
        "custom" | "server" => {
            naval_wasm::LocalRuntime::new(&manifest, &custom_setup().to_string()).unwrap()
        }
        other => panic!("unknown scenario {other}"),
    };
    let server = scenario == "server";
    let baseline = server.then(|| runtime.full_knowledge_value().unwrap());
    let mut tick = 0u64;
    let (mut step_ms, mut snap_ms, mut bytes) = (0.0, 0.0, 0usize);
    let mut finished = false;
    for minute in 0..seconds.div_ceil(60) {
        let start = Instant::now();
        let (ms0, ss0, b0) = (step_ms, snap_ms, bytes);
        let mut t = 0u32;
        while t < 3600 {
            let s = Instant::now();
            let mut left = batch;
            while left > 0 {
                let n = left.min(6);
                runtime.step(n).unwrap();
                left -= n;
            }
            step_ms += s.elapsed().as_secs_f64() * 1000.0;
            if snapshot {
                let s = Instant::now();
                if let Some(baseline) = &baseline {
                    let value = runtime.full_knowledge_value().unwrap();
                    bytes += delta_bytes(baseline, &value);
                    finished |= value["outcome"].is_object();
                } else {
                    let json = runtime.snapshot().unwrap();
                    bytes += json.len();
                    finished |= json.contains("\"phase\":\"finished\"");
                }
                snap_ms += s.elapsed().as_secs_f64() * 1000.0;
            }
            t += batch;
            tick += batch as u64;
            if finished {
                break;
            }
        }
        eprintln!(
            "minute {minute}: wall {:.2}s step {:.0}ms snapshot {:.0}ms bytes {} tick {tick}",
            start.elapsed().as_secs_f64(),
            step_ms - ms0,
            snap_ms - ss0,
            bytes - b0
        );
        if finished {
            break;
        }
    }
    eprintln!(
        "{scenario} batch {batch}: total step {step_ms:.0}ms snapshot {snap_ms:.0}ms bytes {bytes} ticks {tick}"
    );
    println!(
        "{}",
        serde_json::json!({"scenario": scenario, "batch": batch, "ticks": tick,
            "stepMs": step_ms, "snapshotMs": snap_ms, "bytes": bytes, "finished": finished})
    );
    if let Some(path) = dump {
        std::fs::write(&path, runtime.migration_snapshot_json().unwrap()).expect("dump");
    }
}
