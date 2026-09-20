//! Offline approximation probes only. Never publishes a simplified ship.
use naval_sim::{
    construction_geometry as cg,
    definition::ShipDefinition,
    geometry::radians,
    mount_clearance::{ClearancePose, MountClearance},
};
fn summary(d: &ShipDefinition) -> serde_json::Value {
    let hull = d.hull.volume.as_ref().unwrap();
    let h = cg::total(&hull.cells);
    let rooms: Vec<_> = d
        .compartments
        .iter()
        .map(|c| cg::total(c.volumes.as_ref().unwrap()))
        .collect();
    serde_json::json!({"hullVolumeM3":h.volume,"hullCenter":h.center(),"roomVolumeM3":rooms.iter().map(|r|r.volume).sum::<f64>(),"degenerateFaces":hull.cells.iter().chain(d.compartments.iter().flat_map(|c|c.volumes.as_ref().unwrap())).flat_map(|c|c.faces.iter()).filter(|f|cg::area(&f.vertices)<cg::EPS*cg::EPS).count()})
}
fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or("public/models/resolute.json".into());
    let original: ShipDefinition = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let mut rounded = original.clone();
    for c in rounded
        .hull
        .volume
        .as_mut()
        .unwrap()
        .cells
        .iter_mut()
        .chain(
            rounded
                .compartments
                .iter_mut()
                .flat_map(|c| c.volumes.as_mut().unwrap()),
        )
    {
        for f in std::sync::Arc::make_mut(&mut c.faces) {
            for p in &mut f.vertices {
                for x in p {
                    *x = (*x * 1e6).round() / 1e6;
                }
            }
        }
    }
    let mut boxes = original.clone();
    let profile = boxes.mount_clearance.as_mut().unwrap();
    for b in profile.bodies.as_mut().unwrap() {
        let (center, size) = naval_sim::structure::bounds(b.surface.vertices.iter().copied());
        let c = cg::box_cell(center, size);
        let mut vertices = vec![];
        let mut triangles = vec![];
        for f in c.faces.iter() {
            let start = vertices.len();
            vertices.extend_from_slice(&f.vertices);
            for i in 1..f.vertices.len() - 1 {
                triangles.push([start as f64, (start + i) as f64, (start + i + 1) as f64]);
            }
        }
        b.surface.vertices = vertices;
        b.surface.triangles = triangles;
    }
    let exact = MountClearance::new(&original).unwrap().unwrap();
    let boxed = MountClearance::new(&boxes).unwrap().unwrap();
    let mut changed = 0;
    let mut false_blocks = 0;
    let mut unsafe_clear = 0;
    let mut tested = 0;
    let mut poses = vec![ClearancePose::default(); original.mounts.len()];
    for sample in 0..24 {
        for (i, p) in poses.iter_mut().enumerate() {
            p.train = radians(((sample * 47 + i * 13) % 300) as f64 - 150.);
            p.elevation = radians(((sample * 17 + i * 5) % 80) as f64);
            p.recoil = (sample % 3) as f64 * 0.5;
        }
        for i in 0..poses.len() {
            let a = exact.minimum_clearance(&original, i, &poses, 1.).0;
            let b = boxed.minimum_clearance(&boxes, i, &poses, 1.).0;
            tested += 1;
            changed += usize::from(a.to_bits() != b.to_bits());
            false_blocks += usize::from(a > 0.01 && b <= 0.01);
            unsafe_clear += usize::from(a <= 0.01 && b > 0.01);
        }
    }
    // A one-box hull/room proposal is an intentionally coarse lower-complexity probe.
    // Its excess geometric capacity is measured, never silently copied into gameplay.
    let boxed_hull: f64 = original
        .hull
        .volume
        .as_ref()
        .unwrap()
        .cells
        .iter()
        .map(|c| {
            let (_, s) = naval_sim::structure::bounds(
                c.faces.iter().flat_map(|f| f.vertices.iter().copied()),
            );
            s.iter().product::<f64>()
        })
        .sum();
    let boxed_rooms: f64 = original
        .compartments
        .iter()
        .map(|c| c.size.iter().product::<f64>())
        .sum();
    println!(
        "{}",
        serde_json::json!({"original":summary(&original),"oneMicrometreGrid":summary(&rounded),"sumHullCellAabbM3":boxed_hull,"sumCompartmentAabbM3":boxed_rooms,"clearanceAabb":{"samples":tested,"changedGaps":changed,"extraBlocks":false_blocks,"unsafeClear":unsafe_clear},"adopted":false,"warning":"Moment/gap probes are not battle equivalence; quantization can collapse clipping slivers and AABBs can overlap. Keep exact geometry as default."})
    );
}
