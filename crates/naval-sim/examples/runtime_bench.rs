//! Reproducible renderer-free definition/instance/tick benchmark. See docs/ship-runtime-performance.md.
use naval_sim::{
    battle::{Battle, BattleSetup, ShipSetup},
    bots::AiLevel,
    catalog::{Catalog, sha256},
    rules::TeamId,
    vessel::Controller,
};
use std::{
    alloc::{GlobalAlloc, Layout, System},
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering::Relaxed},
    },
    time::Instant,
};
struct Allocator;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
fn allocated(n: usize) {
    let now = LIVE.fetch_add(n, Relaxed) + n;
    PEAK.fetch_max(now, Relaxed);
}
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = unsafe { System.alloc(l) };
        if !p.is_null() {
            allocated(l.size())
        }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        unsafe { System.dealloc(p, l) };
        LIVE.fetch_sub(l.size(), Relaxed);
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        let q = unsafe { System.realloc(p, l, n) };
        if !q.is_null() {
            LIVE.fetch_sub(l.size(), Relaxed);
            allocated(n)
        }
        q
    }
}
#[global_allocator]
static ALLOC: Allocator = Allocator;
fn memory() -> serde_json::Value {
    serde_json::json!({"liveAllocatedBytes":LIVE.load(Relaxed),"peakAllocatedBytes":PEAK.load(Relaxed)})
}
fn stats(mut v: Vec<f64>) -> serde_json::Value {
    v.sort_by(f64::total_cmp);
    serde_json::json!({"p50":v[v.len()/2],"p95":v[v.len()*95/100],"p99":v[v.len()*99/100],"max":v.last(),"mean":v.iter().sum::<f64>()/v.len() as f64})
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let path = args
        .get(1)
        .map(String::as_str)
        .unwrap_or(".build/naval-content/manifest.json");
    let count: usize = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(2);
    let matches: usize = args.get(3).map(|s| s.parse().unwrap()).unwrap_or(1);
    let ticks: usize = args.get(4).map(|s| s.parse().unwrap()).unwrap_or(120);
    let ids: Vec<_> = args
        .get(5)
        .map(String::as_str)
        .unwrap_or("resolute")
        .split(',')
        .collect();
    assert!(count > 0 && matches > 0 && ticks > 0);
    let start = Instant::now();
    let bytes = std::fs::read(path).unwrap();
    let read_ms = start.elapsed().as_secs_f64() * 1000.;
    let start = Instant::now();
    let catalog = Arc::new(Catalog::load(&bytes).unwrap());
    let load_ms = start.elapsed().as_secs_f64() * 1000.;
    drop(bytes);
    let loaded = memory();
    let start = Instant::now();
    let mut compiled = BTreeMap::new();
    for id in &ids {
        compiled.insert(id.to_string(), Arc::new(catalog.compile(id).unwrap()));
    }
    let compile_ms = start.elapsed().as_secs_f64() * 1000.;
    let compiled_memory = memory();
    let setup = BattleSetup {
        ships: (0..count)
            .map(|i| ShipSetup {
                id: format!("ship-{i}"),
                preset_id: ids[i % ids.len()].into(),
                team: if i % 2 == 0 { TeamId::A } else { TeamId::B },
                controller: Controller::Bot,
                ai_level: AiLevel::Hard,
                spawn: None,
            })
            .collect(),
        seed: 12345,
        map_id: "north-atlantic".into(),
        weather: "overcast".into(),
        spawn_distance: 5000.,
        wind_speed: None,
        mission_rules: None,
        air_rules: None,
    };
    let start = Instant::now();
    let mut battles: Vec<_> = (0..matches)
        .map(|_| Battle::new(catalog.clone(), &compiled, setup.clone()).unwrap())
        .collect();
    let instance_ms = start.elapsed().as_secs_f64() * 1000.;
    let instance_memory = memory();
    let wet = args.get(6).is_some_and(|s| s == "wet");
    if wet {
        for battle in &mut battles {
            for actor in &mut battle.actors {
                let mut rooms: Vec<_> = actor
                    .compiled
                    .definition
                    .compartments
                    .iter()
                    .enumerate()
                    .map(|(i, c)| (i, c.capacity_m3))
                    .collect();
                rooms.sort_by(|a, b| b.1.total_cmp(&a.1));
                for (i, capacity) in rooms.into_iter().take(3) {
                    actor.damage.compartments[i].water_m3 = capacity * 0.3;
                }
            }
        }
    }
    let mut times = vec![];
    let orders = BTreeMap::new();
    for _ in 0..ticks {
        let start = Instant::now();
        for b in &mut battles {
            b.step(&orders);
        }
        times.push(start.elapsed().as_secs_f64() * 1000.);
    }
    let stepped = memory();
    let snapshot = serde_json::to_vec(
        &battles[0]
            .presentation_value(naval_sim::snapshot::PresentationView::FullKnowledge)
            .unwrap(),
    )
    .unwrap();
    let state_hash = sha256(&snapshot);
    if let Ok(path) = std::env::var("NAVAL_BENCH_SNAPSHOT") {
        std::fs::write(path, &snapshot).unwrap();
    }
    println!(
        "{}",
        serde_json::json!({"simulationBuild":naval_sim::SIMULATION_BUILD,"shipsPerMatch":count,"matches":matches,"ticks":ticks,"wet":wet,"designs":ids,"readMs":read_ms,"loadMs":load_ms,"compileMs":compile_ms,"instanceMs":instance_ms,"loaded":loaded,"compiled":compiled_memory,"instances":instance_memory,"stepped":stepped,"tickMsAllMatches":stats(times),"stateSha256":state_hash})
    );
}
