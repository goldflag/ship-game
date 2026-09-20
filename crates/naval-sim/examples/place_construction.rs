//! Native seat resolution for `ship:place` and `ship:reseat`: positions only, no compile of the candidate.
fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert!(
        args.len() == 4,
        "usage: place_construction source.json catalog.json request.json"
    );
    let read = |i: usize| std::fs::read_to_string(&args[i]).expect("readable input");
    println!(
        "{}",
        naval_sim::construction_placement::place_json(&read(1), &read(2), &read(3))
            .expect("valid JSON")
    );
}
