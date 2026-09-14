//! Native diagnostic entry for the same source/catalog JSON accepted by WASM.
fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert!(
        args.len() == 3,
        "usage: compile_construction source.json catalog.json"
    );
    let source = std::fs::read_to_string(&args[1]).expect("source");
    let catalog = std::fs::read_to_string(&args[2]).expect("catalog");
    println!(
        "{}",
        naval_sim::construction::compile_json(&source, &catalog).expect("valid JSON")
    );
}
