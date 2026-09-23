//! Native diagnostic entry for the same source/catalog JSON accepted by WASM.
//! `--serve` answers newline-delimited JSON requests on stdin, one response line each,
//! through long-lived compilers so their geometry caches survive between requests.
use std::io::{BufRead, Write};

/// Request: `{"source": "<json text>", "catalog": "<json text>", "parts"?: "<json text>"}`.
/// Response: `{"ok":true,"reused":n,"result":<exact one-shot output>}` or `{"ok":false,"error":"…"}`.
/// `result` is always last, so callers may slice the exact bytes.
fn serve() {
    const COMPILERS: usize = 4;
    // One compiler per ship; its cache resets whenever the ship or catalog changes.
    let mut compilers: Vec<(String, naval_sim::construction::ConstructionCompiler)> = vec![];
    let text = |request: &serde_json::Value, key: &str| {
        request.get(key).and_then(|v| v.as_str()).map(str::to_owned)
    };
    let stdout = std::io::stdout();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let answer = (|| -> Result<(usize, String), String> {
            let request: serde_json::Value =
                serde_json::from_str(&line).map_err(|e| e.to_string())?;
            let source = text(&request, "source").ok_or("Request requires source JSON text")?;
            let catalog = text(&request, "catalog").ok_or("Request requires catalog JSON text")?;
            if let Some(parts) = text(&request, "parts") {
                return naval_sim::construction::suggest_json(&source, &catalog, &parts)
                    .map(|json| (0, json));
            }
            let id = serde_json::from_str::<serde_json::Value>(&source)
                .ok()
                .and_then(|v| v.get("id").and_then(|id| id.as_str()).map(str::to_owned))
                .unwrap_or_default();
            let index = compilers.iter().position(|(key, _)| *key == id);
            let (_, mut compiler) = index
                .map(|i| compilers.remove(i))
                .unwrap_or_else(|| (id.clone(), Default::default()));
            // A panic may leave a cache half-written. The compiler is kept only after success.
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let json = compiler.compile_json(&source, &catalog);
                (compiler.reused_geometry_operations(), json)
            }))
            .map_err(|_| "Native construction compile panicked".to_string())?;
            compilers.insert(0, (id, compiler));
            compilers.truncate(COMPILERS);
            result.1.map(|json| (result.0, json))
        })();
        let mut out = stdout.lock();
        let written = match answer {
            Ok((reused, json)) => {
                writeln!(out, "{{\"ok\":true,\"reused\":{reused},\"result\":{json}}}")
            }
            Err(error) => writeln!(
                out,
                "{}",
                serde_json::json!({ "ok": false, "error": error })
            ),
        };
        if written.and_then(|_| out.flush()).is_err() {
            break;
        }
    }
}

fn main() {
    let args: Vec<_> = std::env::args().collect();
    if args.len() == 2 && args[1] == "--serve" {
        return serve();
    }
    assert!(
        (3..=4).contains(&args.len()) || (args.len() == 5 && args[3] == "--suggest"),
        "usage: compile_construction source.json catalog.json [measurement_iterations | --suggest parts.json]"
    );
    let source = std::fs::read_to_string(&args[1]).expect("source");
    let catalog = std::fs::read_to_string(&args[2]).expect("catalog");
    if args.len() == 5 {
        let parts = std::fs::read_to_string(&args[4]).expect("part IDs");
        println!(
            "{}",
            naval_sim::construction::suggest_json(&source, &catalog, &parts).expect("valid JSON")
        );
        return;
    }
    if args.len() == 3 {
        println!(
            "{}",
            naval_sim::construction::compile_json(&source, &catalog).expect("valid JSON")
        );
        return;
    }
    let source = serde_json::from_str(&source).unwrap();
    let catalog = serde_json::from_str(&catalog).unwrap();
    let count: usize = args[3].parse().unwrap();
    assert!((1..=100).contains(&count));
    let mut times = vec![];
    let mut result = None;
    for _ in 0..count {
        let start = std::time::Instant::now();
        result = Some(naval_sim::construction::compile(&source, &catalog));
        times.push(start.elapsed().as_secs_f64() * 1000.);
    }
    times.sort_by(f64::total_cmp);
    let result = result.unwrap();
    eprintln!(
        "compile median_ms={:.3} max_ms={:.3} iterations={count}",
        times[count / 2],
        times[count - 1]
    );
    if let Some(d) = &result.definition {
        let hydro = naval_sim::hydrostatics::HullHydrostatics::new(&d.hull, None);
        let start = std::time::Instant::now();
        for i in 0..100 {
            std::hint::black_box(hydro.flotation(d.hull.mass_kg / 1025., i as f64 * 0.003, -0.01));
        }
        let flotation = start.elapsed().as_secs_f64() * 10.;
        let start = std::time::Instant::now();
        for i in 0..100 {
            for room in &d.compartments {
                std::hint::black_box(naval_sim::floodwater::water_body(
                    room,
                    room.capacity_m3 * 0.4,
                    i as f64 * 0.003,
                    -0.01,
                ));
            }
        }
        eprintln!(
            "hull_cells={} void_cells={} rooms={} flotation_mean_ms={flotation:.3} all_room_water_solve_mean_ms={:.3}",
            d.hull.volume.as_ref().unwrap().cells.len(),
            d.compartments
                .iter()
                .map(|r| r.volumes.as_ref().unwrap().len())
                .sum::<usize>(),
            d.compartments.len(),
            start.elapsed().as_secs_f64() * 10.
        );
    }
    println!("{}", naval_sim::construction::to_json(&result).unwrap());
}
