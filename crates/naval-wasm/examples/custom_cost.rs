//! Per-ship simulation cost of a local custom battle, natively. Runs the same
//! `LocalRuntime` the browser worker runs and reports ms/tick per ten-second
//! window next to each hull's flooding state, so cost can be read against damage.
//!
//! cargo run --release -p naval-wasm --example custom_cost -- <teamA> <teamB> [seconds] [--sources FILE --catalog FILE] [--spawn M] [--seed N] [--aftermath S] [--dump PATH]
//!
//! Teams are comma-separated preset ids. `local:N` names the Nth design in
//! `--sources` (a JSON array of construction sources, as the editor saves them).
//! `--aftermath` keeps stepping that many seconds past the outcome, as the game
//! does while a wreck goes down. `--dump` writes the complete final state for byte comparison across builds.
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mut positional, mut sources, mut catalog, mut spawn, mut seed, mut dump, mut aftermath) =
        (Vec::new(), None, None, 5000.0, 17001u64, None, 10u64);
    let mut i = 0;
    while i < args.len() {
        let value = || args.get(i + 1).cloned().expect("flag value");
        match args[i].as_str() {
            "--sources" => (sources, i) = (Some(value()), i + 1),
            "--catalog" => (catalog, i) = (Some(value()), i + 1),
            "--spawn" => (spawn, i) = (value().parse().unwrap(), i + 1),
            "--seed" => (seed, i) = (value().parse().unwrap(), i + 1),
            "--aftermath" => (aftermath, i) = (value().parse().unwrap(), i + 1),
            "--dump" => (dump, i) = (Some(value()), i + 1),
            other => positional.push(other.to_string()),
        }
        i += 1;
    }
    let seconds: u64 = positional
        .get(2)
        .and_then(|s| s.parse().ok())
        .unwrap_or(600);
    let manifest = std::fs::read(".build/naval-content/manifest.json").expect("manifest");
    let sources_json = sources.map(|p| std::fs::read_to_string(p).expect("sources"));
    let catalog_json = catalog.map(|p| std::fs::read_to_string(p).expect("catalog"));
    let local_ids: Vec<String> = match (&sources_json, &catalog_json) {
        (Some(s), Some(c)) => {
            let sources: Vec<naval_sim::definition::ConstructionSource> =
                serde_json::from_str(s).unwrap();
            let parts: naval_sim::definition::ConstructionCatalog =
                serde_json::from_str(c).unwrap();
            sources
                .iter()
                .map(|source| {
                    let started = Instant::now();
                    let result = naval_sim::construction::compile(source, &parts);
                    let d = result.definition.unwrap_or_else(|| {
                        panic!(
                            "{}: {:?}",
                            source.name,
                            result
                                .diagnostics
                                .iter()
                                .map(|d| &d.message)
                                .collect::<Vec<_>>()
                        )
                    });
                    eprintln!(
                        "compiled {} in {:.1}s",
                        d.id,
                        started.elapsed().as_secs_f64()
                    );
                    d.id
                })
                .collect()
        }
        _ => Vec::new(),
    };
    let resolve = |id: &str| match id.strip_prefix("local:") {
        Some(n) => local_ids[n.parse::<usize>().unwrap()].clone(),
        None => id.to_string(),
    };
    let mut ships = Vec::new();
    for (team, list) in [("a", &positional[0]), ("b", &positional[1])] {
        for (i, id) in list.split(',').enumerate() {
            ships.push(serde_json::json!({"id": format!("{team}-{i}"), "presetId": resolve(id), "team": team,
                "controller": "bot", "aiLevel": "hard", "spawn": null}));
        }
    }
    let setup = serde_json::json!({"ships": ships, "seed": seed, "mapId": "north-atlantic", "weather": "overcast",
        "spawnDistance": spawn, "windSpeed": null})
    .to_string();
    let started = Instant::now();
    let mut runtime = match (&sources_json, &catalog_json) {
        (Some(s), Some(c)) => {
            naval_wasm::LocalRuntime::with_construction(&manifest, &setup, s, c, false)
        }
        _ => naval_wasm::LocalRuntime::new(&manifest, &setup),
    }
    .unwrap_or_else(|_| panic!("runtime setup failed"));
    eprintln!("battle ready in {:.1}s", started.elapsed().as_secs_f64());
    let mut seen = std::collections::BTreeSet::new();
    for actor in &runtime.session().battle.actors {
        let d = actor.definition();
        if !seen.insert(d.id.clone()) {
            continue;
        }
        let rooms = &d.compartments;
        let volumes: Vec<usize> = rooms
            .iter()
            .map(|c| c.volumes.as_ref().map_or(0, |v| v.len()))
            .collect();
        eprintln!(
            "{}: hull cells {} buoyancy cells {} plates {} compartments {} room volumes {} (largest room {}) connections {} modules {} mounts {}",
            d.id,
            d.hull.volume.as_ref().map_or(0, |v| v.cells.len()),
            d.hull.buoyancy.as_ref().map_or(0, |b| b.cells.len()),
            d.armor.len(),
            rooms.len(),
            volumes.iter().sum::<usize>(),
            volumes.iter().max().copied().unwrap_or(0),
            d.connections.len(),
            d.modules.len(),
            d.mounts.len(),
        );
    }
    println!("second,mean_ms,max_ms,state");
    let mut after = 0;
    for window in 0..seconds.div_ceil(10) {
        let (mut total, mut worst) = (0.0, 0.0f64);
        for _ in 0..600 {
            let s = Instant::now();
            runtime.step(1).unwrap_or_else(|_| panic!("step"));
            let ms = s.elapsed().as_secs_f64() * 1000.0;
            total += ms;
            worst = worst.max(ms);
        }
        let battle = &runtime.session().battle;
        let state: Vec<String> = battle
            .actors
            .iter()
            .map(|a| {
                let wet = a
                    .damage
                    .compartments
                    .iter()
                    .filter(|c| c.water_m3 > 0.)
                    .count();
                let water: f64 = a.damage.compartments.iter().map(|c| c.water_m3).sum();
                let breaches: usize = a.damage.compartments.iter().map(|c| c.breaches.len()).sum();
                format!(
                    "{} hp {:.0} wet {wet} water {water:.0} breaches {breaches}{}",
                    a.motion.id,
                    a.damage.integrity,
                    if a.damage.sunk { " SUNK" } else { "" }
                )
            })
            .collect();
        println!(
            "{},{:.6},{:.6},{}",
            (window + 1) * 10,
            total / 600.0,
            worst,
            state.join(" | ")
        );
        if battle.outcome.is_some() {
            after += 10;
            if after > aftermath {
                break;
            }
        }
    }
    if let Some(path) = dump {
        let state = runtime
            .migration_snapshot_json()
            .unwrap_or_else(|_| panic!("dump"));
        std::fs::write(path, state).expect("dump");
    }
}
