//! Explicit offline experiment: derive a coarse combat definition from an existing
//! compiled definition. Never publishes assets or changes the default compiler.
use naval_sim::{construction_geometry as cg, definition::*, geometry::*};
use std::collections::BTreeMap;

fn points(c: &ConvexVolume) -> impl Iterator<Item = Vec3> + '_ {
    c.faces.iter().flat_map(|f| f.vertices.iter().copied())
}
fn bounds(ps: impl Iterator<Item = Vec3>) -> (Vec3, Vec3) {
    ps.fold(
        ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]),
        |(mut lo, mut hi), p| {
            for a in 0..3 {
                lo[a] = lo[a].min(p[a]);
                hi[a] = hi[a].max(p[a]);
            }
            (lo, hi)
        },
    )
}
fn box_at(lo: Vec3, hi: Vec3) -> ConvexVolume {
    cg::box_cell(
        std::array::from_fn(|a| (lo[a] + hi[a]) * 0.5),
        std::array::from_fn(|a| (hi[a] - lo[a]).max(1e-8)),
    )
}
/// Disjoint spatial bins, each enclosed by a 26-direction support polyhedron.
/// All clipped source vertices lie inside every support half-space. The union
/// therefore encloses the input, with no inward quantization of vertices.
fn envelope(cells: &[ConvexVolume], pitch: Vec3) -> Vec<ConvexVolume> {
    let mut bins = BTreeMap::<[i32; 3], Vec<Vec3>>::new();
    for c in cells {
        let (lo, hi) = bounds(points(c));
        let start: [i32; 3] = std::array::from_fn(|a| (lo[a] / pitch[a]).floor() as i32);
        let end: [i32; 3] = std::array::from_fn(|a| (hi[a] / pitch[a]).floor() as i32);
        for x in start[0]..=end[0] {
            for y in start[1]..=end[1] {
                for z in start[2]..=end[2] {
                    let key = [x, y, z];
                    let mut part = Some(c.clone());
                    for a in 0..3 {
                        for sign in [-1., 1.] {
                            let mut n = [0.; 3];
                            n[a] = sign;
                            let d = if sign < 0. {
                                -(key[a] as f64) * pitch[a]
                            } else {
                                (key[a] + 1) as f64 * pitch[a]
                            };
                            part = part.and_then(|p| cg::clip(&p, n, d));
                        }
                    }
                    if let Some(part) = part
                        && cg::moments(&part).volume > 1e-9
                    {
                        bins.entry(key).or_default().extend(points(&part));
                    }
                }
            }
        }
    }
    bins.into_values()
        .map(|ps| {
            let (lo, hi) = bounds(ps.iter().copied());
            let mut c = box_at(lo, hi);
            for x in -1..=1 {
                for y in -1..=1 {
                    for z in -1..=1 {
                        if x * x + y * y + z * z <= 1 {
                            continue;
                        }
                        let n = normalize([x as f64, y as f64, z as f64]);
                        let d = ps
                            .iter()
                            .map(|p| dot(n, *p))
                            .fold(f64::NEG_INFINITY, f64::max);
                        c = cg::clip(&c, n, d + 1e-10).expect("nonempty support enclosure");
                    }
                }
            }
            c
        })
        .collect()
}
fn weighted(cells: &[ConvexVolume], pitch: Vec3) -> Vec<BuoyancyCell> {
    let mut bins = BTreeMap::<[i32; 3], (cg::Moments, Vec3, Vec3)>::new();
    for c in cells {
        let (lo, hi) = bounds(points(c));
        let start: [i32; 3] = std::array::from_fn(|a| (lo[a] / pitch[a]).floor() as i32);
        let end: [i32; 3] = std::array::from_fn(|a| (hi[a] / pitch[a]).floor() as i32);
        for x in start[0]..=end[0] {
            for y in start[1]..=end[1] {
                for z in start[2]..=end[2] {
                    let key = [x, y, z];
                    let mut part = Some(c.clone());
                    for a in 0..3 {
                        for sign in [-1., 1.] {
                            let mut n = [0.; 3];
                            n[a] = sign;
                            let d = if sign < 0. {
                                -(key[a] as f64) * pitch[a]
                            } else {
                                (key[a] + 1) as f64 * pitch[a]
                            };
                            part = part.and_then(|p| cg::clip(&p, n, d));
                        }
                    }
                    if let Some(part) = part
                        && cg::moments(&part).volume > 1e-9
                    {
                        let m = cg::moments(&part);
                        let entry = bins.entry(key).or_insert((
                            cg::Moments::default(),
                            [f64::INFINITY; 3],
                            [f64::NEG_INFINITY; 3],
                        ));
                        entry.0.add(m);
                        let (lo, hi) = bounds(points(&part));
                        for a in 0..3 {
                            entry.1[a] = entry.1[a].min(lo[a]);
                            entry.2[a] = entry.2[a].max(hi[a]);
                        }
                    }
                }
            }
        }
    }
    bins.into_values()
        .filter_map(|(m, lo, hi)| {
            if m.volume <= 1e-7 {
                return None;
            }
            let center = m.center();
            Some(BuoyancyCell {
                center,
                size: std::array::from_fn(|a| (hi[a] - lo[a]).max(1e-5)),
                volume_m3: m.volume,
            })
        })
        .collect()
}

fn mesh(c: &ConvexVolume) -> AuthoredSurface {
    let mut s = AuthoredSurface::default();
    for f in c.faces.iter() {
        let start = s.vertices.len();
        s.vertices.extend(&f.vertices);
        for i in 1..f.vertices.len() - 1 {
            s.triangles
                .push([start as f64, (start + i) as f64, (start + i + 1) as f64]);
        }
    }
    s
}
fn distance(p: Vec3, c: Vec3, s: Vec3) -> f64 {
    length(std::array::from_fn(|a| {
        ((p[a] - c[a]).abs() - s[a] * 0.5).max(0.)
    }))
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let input = &args[1];
    let output = &args[2];
    assert!(output.starts_with(".build/"));
    let pitch: f64 = args.get(3).map(|s| s.parse().unwrap()).unwrap_or(6.);
    assert!((1.0..=20.).contains(&pitch));
    let original: ShipDefinition = serde_json::from_slice(&std::fs::read(input).unwrap()).unwrap();
    let mut d = original.clone();
    let old = d.hull.volume.as_ref().expect("construction definition");
    let hybrid = args.get(4).is_some_and(|s| s == "hybrid");
    let guarded = hybrid || args.get(4).is_some_and(|s| s == "guarded");
    let weighted_mode = guarded || args.get(4).is_some_and(|s| s == "weighted");
    if weighted_mode {
        d.hull.buoyancy = Some(HullBuoyancy {
            version: 1.,
            cells: weighted(&old.cells, [pitch, pitch * 0.5, pitch * 2.]),
        });
    }
    let coarse = if hybrid {
        let mut cells: Vec<_> = original
            .construction
            .as_ref()
            .unwrap()
            .primitives
            .iter()
            .flat_map(|p| naval_sim::construction::primitive_cells(p).unwrap())
            .collect();
        let index = cg::Broadphase::sized_for(&cells);
        // Retain any generated installation support or fragment not enclosed by
        // one source solid. Vertex containment of convex cells proves inclusion.
        for c in &old.cells {
            if !index
                .candidates(c)
                .iter()
                .any(|&i| points(c).all(|p| cg::contains(&cells[i], p)))
            {
                cells.push(c.clone());
            }
        }
        cells
    } else {
        envelope(&old.cells, [pitch, pitch * 0.5, pitch * 2.])
    };
    // Small decorative voids have negligible capacity; retain meaningful rooms,
    // merging microspaces into the closest room within the same authored boundary.
    let mut rooms: Vec<_> = d
        .compartments
        .iter()
        .filter(|c| c.capacity_m3 >= 10.)
        .cloned()
        .collect();
    assert!(!rooms.is_empty());
    let mut mapping = BTreeMap::new();
    for c in &d.compartments {
        let base = c.id.split("-space-").next().unwrap();
        let i = rooms.iter().position(|r| r.id == c.id).unwrap_or_else(|| {
            rooms
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| {
                    let score = |r: &Compartment| {
                        distance(c.center, r.center, r.size)
                            + if r.id.starts_with(base) { 0. } else { 10000. }
                    };
                    score(a).total_cmp(&score(b))
                })
                .unwrap()
                .0
        });
        mapping.insert(c.id.clone(), rooms[i].id.clone());
        if c.id != rooms[i].id {
            rooms[i].capacity_m3 += c.capacity_m3;
            rooms[i].pump_m3_per_second += c.pump_m3_per_second;
        }
    }
    for r in &mut rooms {
        // Approximate water centers on a bounded set of boxes. Capacity stays
        // authoritative; legacy column integration applies uniform porosity.
        let proxy = envelope(r.volumes.as_ref().unwrap(), [pitch, pitch, pitch * 2.]);
        r.cells = Some(
            proxy
                .iter()
                .map(|c| {
                    let (center, size) = cg::bounds(c);
                    CompartmentCellsItem {
                        center,
                        size,
                        volume_m3: None,
                    }
                })
                .collect(),
        );
        if weighted_mode {
            r.cells = Some(
                weighted(
                    r.volumes.as_ref().unwrap(),
                    [pitch, pitch * 0.5, pitch * 2.],
                )
                .into_iter()
                .map(|c| CompartmentCellsItem {
                    center: c.center,
                    size: c.size,
                    volume_m3: Some(c.volume_m3),
                })
                .collect(),
            );
        }
        r.volumes = None;
    }
    for m in &mut d.modules {
        if let Some(id) = &mut m.compartment_id {
            *id = mapping[id].clone();
        }
    }
    d.compartments = rooms;
    // Merge parallel portals between the same retained rooms and state. Preserve
    // total opening area; its area-weighted head is an explicit approximation.
    let mut connections = BTreeMap::<(String, String, String), Vec<FloodConnection>>::new();
    for mut c in d.connections {
        c.from_id = mapping[&c.from_id].clone();
        c.to_id = mapping[&c.to_id].clone();
        if c.from_id == c.to_id {
            continue;
        }
        if c.from_id > c.to_id {
            std::mem::swap(&mut c.from_id, &mut c.to_id);
        }
        connections
            .entry((
                c.from_id.clone(),
                c.to_id.clone(),
                c.state.clone().unwrap_or("open".into()),
            ))
            .or_default()
            .push(c);
    }
    d.connections = connections
        .into_values()
        .enumerate()
        .map(|(i, cs)| {
            let mut c = cs[0].clone();
            let area = cs.iter().map(|c| c.area_m2).sum::<f64>();
            c.id = Some(format!("combat-portal-{i}"));
            c.area_m2 = area;
            c.position = Some(std::array::from_fn(|a| {
                cs.iter()
                    .map(|c| c.position.unwrap_or([0.; 3])[a] * c.area_m2)
                    .sum::<f64>()
                    / area
            }));
            let (lo, hi) = bounds(cs.iter().flat_map(|c| {
                let p = c.position.unwrap_or([0.; 3]);
                let (center, size) = c
                    .bounds
                    .as_ref()
                    .map(|b| (b.center, b.size))
                    .unwrap_or((p, [0.001; 3]));
                [-1., 1.].map(move |s| std::array::from_fn(move |a| center[a] + s * size[a] * 0.5))
            }));
            c.bounds = Some(FloodConnectionBounds {
                center: std::array::from_fn(|a| (lo[a] + hi[a]) * 0.5),
                size: std::array::from_fn(|a| (hi[a] - lo[a]).max(0.001)),
            });
            c.armor_id = Some(format!("combat-boundary-{i}"));
            c
        })
        .collect();
    // Exterior faces only. A spatial enclosure changes hit location and plate
    // angle. Nearest original plating supplies thickness/material, never an
    // unlabelled claim of equivalent penetration.
    let mut armor = vec![];
    for (i, c) in coarse.iter().enumerate() {
        for (j, f) in c.faces.iter().enumerate() {
            let center = scale(
                f.vertices.iter().fold([0.; 3], |s, p| add(s, *p)),
                1. / f.vertices.len() as f64,
            );
            let n = cg::normal(&f.vertices);
            let outside = add(center, scale(n, 1e-5));
            if coarse
                .iter()
                .enumerate()
                .any(|(k, c)| k != i && cg::contains(c, outside))
            {
                continue;
            }
            let source = original
                .armor
                .iter()
                .filter(|a| {
                    a.exterior == Some(true)
                        && a.plate.as_ref().is_none_or(|p| p.mount_id.is_none())
                })
                .min_by(|a, b| {
                    distance(center, a.center, a.size)
                        .total_cmp(&distance(center, b.center, b.size))
                })
                .unwrap();
            let (lo, hi) = bounds(f.vertices.iter().copied());
            armor.push(Armor {
                id: format!("combat-shell-{i}-{j}"),
                name: "Combat shell zone".into(),
                center,
                size: std::array::from_fn(|a| (hi[a] - lo[a]).max(1e-5)),
                thickness_mm: source.thickness_mm,
                exterior: Some(true),
                plate: Some(ArmorPlate {
                    vertices: f.vertices.clone(),
                    material: source
                        .plate
                        .as_ref()
                        .map_or("steel".into(), |p| p.material.clone()),
                    exterior: Some(true),
                    ..Default::default()
                }),
                ..Default::default()
            });
        }
    }
    // Retain weapon protection and boundary damage paths.
    armor.extend(
        original
            .armor
            .iter()
            .filter(|a| a.plate.as_ref().is_some_and(|p| p.mount_id.is_some()))
            .cloned(),
    );
    for c in &d.connections {
        let b = c.bounds.as_ref().unwrap();
        armor.push(Armor {
            id: c.armor_id.clone().unwrap(),
            name: "Combat watertight boundary".into(),
            center: b.center,
            size: b.size,
            thickness_mm: c.thickness_mm.unwrap_or(20.),
            exterior: Some(false),
            ..Default::default()
        });
    }
    d.armor = if guarded {
        original.armor.clone()
    } else {
        armor
    };
    if guarded {
        // Keeping portal patches avoids changing which local hit breaches a
        // boundary. Remove only portals internal to a merged microspace.
        d.connections = original
            .connections
            .iter()
            .filter_map(|old| {
                let mut c = old.clone();
                c.from_id = mapping[&c.from_id].clone();
                c.to_id = mapping[&c.to_id].clone();
                (c.from_id != c.to_id).then_some(c)
            })
            .collect();
    }
    if !weighted_mode && let Some(clearance) = &mut d.mount_clearance {
        let mut bodies: Vec<_> = clearance
            .bodies
            .take()
            .unwrap()
            .into_iter()
            .filter(|b| !b.id.starts_with("hull-cell-"))
            .collect();
        bodies.extend(
            coarse
                .iter()
                .enumerate()
                .map(|(i, c)| MountClearanceProfileBodiesItem {
                    id: format!("combat-hull-{i}"),
                    mount_id: None,
                    surface: mesh(c),
                }),
        );
        clearance.bodies = Some(bodies);
        clearance.basis =
            "Experimental conservative support envelopes; detailed moving weapons retained".into();
    }
    if guarded && !hybrid {
        let clearance = naval_sim::mount_clearance::MountClearance::new(&d)
            .unwrap()
            .unwrap();
        let keep = clearance.reachable_body_ids(&d);
        d.mount_clearance
            .as_mut()
            .unwrap()
            .bodies
            .as_mut()
            .unwrap()
            .retain(|b| keep.contains(&b.id));
    }
    d.hull.volume = Some(ConstructionGeometry {
        version: 1.,
        cells: coarse,
        // Volume cells drive buoyancy/ramming; surfaces separately drive shell
        // and torpedo hull contacts. Never remove that damage coverage.
        surfaces: original.hull.volume.as_ref().unwrap().surfaces.clone(),
    });
    let report = serde_json::json!({"profile":if weighted_mode {"combat-weighted-v1"} else {"combat-envelopes-v1"},"pitchM":pitch,"sourceContentHash":original.content_hash,"rooms":d.compartments.len(),"roomCells":d.compartments.iter().map(|r|r.cells.as_ref().unwrap().len()).sum::<usize>(),"hullCells":d.hull.volume.as_ref().unwrap().cells.len(),"armor":d.armor.len(),"connections":d.connections.len(),"roomMapping":mapping,"capacityBefore":original.compartments.iter().map(|r|r.capacity_m3).sum::<f64>(),"capacityAfter":d.compartments.iter().map(|r|r.capacity_m3).sum::<f64>()});
    // Distinct derived identity. Fixtures cannot impersonate the published GLB.
    d.content_hash = Some(naval_sim::catalog::sha256(
        format!(
            "combat-envelopes-v1:{pitch}:{}",
            naval_sim::construction::to_json(&d).unwrap()
        )
        .as_bytes(),
    ));
    naval_sim::catalog::validate_definition(&d).unwrap();
    std::fs::write(output, naval_sim::construction::to_json(&d).unwrap()).unwrap();
    println!("{}", report);
}
