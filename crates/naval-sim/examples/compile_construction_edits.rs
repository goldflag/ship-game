//! Compare warm editor revisions with fresh compilation, including exact results.
//! Usage: compile_construction_edits revisions.json catalog.json
use naval_sim::{construction::{self, ConstructionCompiler}, definition::{ConstructionCatalog, ConstructionSource}};
fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(args.len(), 3, "usage: compile_construction_edits revisions.json catalog.json");
    let sources: Vec<ConstructionSource> = serde_json::from_str(&std::fs::read_to_string(&args[1]).unwrap()).unwrap();
    let catalog: ConstructionCatalog = serde_json::from_str(&std::fs::read_to_string(&args[2]).unwrap()).unwrap();
    let mut compiler = ConstructionCompiler::default();
    for source in sources {
        let start = std::time::Instant::now();
        let cached = compiler.compile(&source, &catalog);
        let warm_ms = start.elapsed().as_secs_f64() * 1000.;
        let start = std::time::Instant::now();
        let fresh = construction::compile(&source, &catalog);
        let fresh_ms = start.elapsed().as_secs_f64() * 1000.;
        assert_eq!(construction::to_json(&cached).unwrap(), construction::to_json(&fresh).unwrap(), "{}", source.revision);
        println!("{}", serde_json::json!({ "revision": source.revision, "warmMs": warm_ms, "freshMs": fresh_ms,
            "reusedOperations": compiler.reused_geometry_operations(), "valid": cached.definition.is_some(), "surfaces": cached.surfaces.len() }));
    }
}
