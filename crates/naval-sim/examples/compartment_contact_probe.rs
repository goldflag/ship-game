use naval_sim::{construction_geometry as cg, definition::ShipDefinition};
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let read =
        |p: &str| -> ShipDefinition { serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap() };
    let stride = args
        .get(3)
        .map(|s| s.parse::<usize>().unwrap())
        .unwrap_or(31);
    let a = read(&args[1]);
    let b = read(&args[2]);
    let mut details = vec![];
    for (index, p) in a
        .connections
        .iter()
        .filter_map(|c| c.position)
        .enumerate()
        .step_by(stride)
    {
        let nearest = |d: &ShipDefinition| {
            d.compartments
                .iter()
                .enumerate()
                .map(|(i, c)| (i, cg::room_distance(c, p)))
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .unwrap()
        };
        let x = nearest(&a);
        let y = nearest(&b);
        if x.0 != y.0 || (x.1 - y.1).abs() > 1e-8 {
            details.push(serde_json::json!({"index":index,"point":p,"before":x,"after":y,"newDistanceToOldRoom":cg::room_distance(&b.compartments[x.0],p),"oldDistanceToNewRoom":cg::room_distance(&a.compartments[y.0],p),"oldRoomSize":a.compartments[x.0].size,"newRoomSize":a.compartments[y.0].size,"containingCells": b.compartments[y.0].volumes.as_ref().unwrap().iter().enumerate().filter(|(_,c)|cg::contains(c,p)).map(|(i,c)|serde_json::json!({"cell":i,"bounds":cg::bounds(c),"volume":cg::moments(c).volume,"faces":c.faces})).collect::<Vec<_>>()}));
        }
    }
    println!("{}", serde_json::to_string_pretty(&details).unwrap());
}
