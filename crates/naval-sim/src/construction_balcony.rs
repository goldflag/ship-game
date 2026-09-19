//! Editable open platforms. Only the steel deck/edge geometry encloses volume.
use crate::{construction_geometry as cg, construction_vertex::VertexSolid, definition::*};
use std::collections::BTreeSet;

fn cross(
    a: &ConstructionBalconyPoint,
    b: &ConstructionBalconyPoint,
    c: &ConstructionBalconyPoint,
) -> f64 {
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
}
fn on(
    a: &ConstructionBalconyPoint,
    b: &ConstructionBalconyPoint,
    c: &ConstructionBalconyPoint,
) -> bool {
    cross(a, b, c).abs() < 1e-9
        && c.x >= a.x.min(b.x) - 1e-9
        && c.x <= a.x.max(b.x) + 1e-9
        && c.z >= a.z.min(b.z) - 1e-9
        && c.z <= a.z.max(b.z) + 1e-9
}
fn triangles(points: &[ConstructionBalconyPoint]) -> Result<Vec<[usize; 3]>, String> {
    let n = points.len();
    if !(3..=32).contains(&n) {
        return Err("Balconies need 3–32 outline points".into());
    }
    let mut ids = BTreeSet::new();
    for (i, a) in points.iter().enumerate() {
        let b = &points[(i + 1) % n];
        if a.id.is_empty()
            || a.id.len() > 128
            || !ids.insert(&a.id)
            || !a.x.is_finite()
            || !a.z.is_finite()
            || a.x.abs() > 2.
            || a.z.abs() > 2.
            || !["open", "wall", "railing", "triple-railing"].contains(&a.edge.as_str())
        {
            return Err("Balcony points need unique IDs, bounded coordinates and open, wall, railing or triple-railing edges".into());
        }
        if (a.x - b.x).hypot(a.z - b.z) < 1e-6 {
            return Err("Move overlapping balcony points apart".into());
        }
        for j in i + 1..n {
            if j == i + 1 || (i == 0 && j == n - 1) {
                continue;
            }
            let c = &points[j];
            let d = &points[(j + 1) % n];
            if (cross(a, b, c) * cross(a, b, d) < 0. && cross(c, d, a) * cross(c, d, b) < 0.)
                || on(a, b, c)
                || on(a, b, d)
                || on(c, d, a)
                || on(c, d, b)
            {
                return Err("Balcony outline crosses itself; move the points apart".into());
            }
        }
    }
    let area: f64 = points
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let b = &points[(i + 1) % n];
            a.x * b.z - b.x * a.z
        })
        .sum();
    if area.abs() < 1e-8 {
        return Err("Balcony outline needs a nonzero area".into());
    }
    let mut ring: Vec<_> = (0..n).collect();
    if area < 0. {
        ring.reverse();
    }
    let mut out = vec![];
    while ring.len() > 3 {
        let len = ring.len();
        let ear = (0..len)
            .find(|&i| {
                let (a, b, c) = (ring[(i + len - 1) % len], ring[i], ring[(i + 1) % len]);
                cross(&points[a], &points[b], &points[c]) > 1e-10
                    && !ring.iter().any(|&k| {
                        k != a
                            && k != b
                            && k != c
                            && cross(&points[a], &points[b], &points[k]) >= -1e-10
                            && cross(&points[b], &points[c], &points[k]) >= -1e-10
                            && cross(&points[c], &points[a], &points[k]) >= -1e-10
                    })
            })
            .ok_or("Simplify the balcony outline or move its points apart")?;
        out.push([
            ring[(ear + len - 1) % len],
            ring[ear],
            ring[(ear + 1) % len],
        ]);
        ring.remove(ear);
    }
    out.push([ring[0], ring[1], ring[2]]);
    Ok(out)
}

pub fn build(p: &ConstructionPrimitive) -> Result<VertexSolid, String> {
    let b = p.balcony.as_ref().ok_or("Balcony outline is missing")?;
    if b.version != 1.
        || !b.height_m.is_finite()
        || !(0.2..=5.).contains(&b.height_m)
        || !b.wall_thickness_m.is_finite()
        || !(0.01..=0.5).contains(&b.wall_thickness_m)
    {
        return Err(
            "Balconies require version 1, 0.2–5 m edge height and 0.01–0.5 m wall thickness".into(),
        );
    }
    let top = p.size[1] / 2.;
    let triangles = triangles(&b.points)?;
    let n = b.points.len();
    let points: Vec<_> = b
        .points
        .iter()
        .map(|q| [q.x * p.size[0], q.z * p.size[2]])
        .collect();
    let positive = (0..n)
        .map(|i| points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1])
        .sum::<f64>()
        > 0.;
    let sign = if positive { 1. } else { -1. };
    let lengths: Vec<_> = (0..n)
        .map(|i| {
            (points[(i + 1) % n][0] - points[i][0]).hypot(points[(i + 1) % n][1] - points[i][1])
        })
        .collect();
    let normals: Vec<_> = (0..n)
        .map(|i| {
            [
                sign * (points[(i + 1) % n][1] - points[i][1]) / lengths[i],
                -sign * (points[(i + 1) % n][0] - points[i][0]) / lengths[i],
            ]
        })
        .collect();
    let half = b.wall_thickness_m / 2.;
    // Same bounded mitres as the source preview in constructionBalcony.ts.
    let offsets: Vec<_> = (0..n)
        .map(|i| {
            let previous = (i + n - 1) % n;
            let a = normals[previous];
            let z = normals[i];
            let denominator = 1. + a[0] * z[0] + a[1] * z[1];
            if denominator < 1e-8 {
                return [z[0] * half, z[1] * half];
            }
            let x = (a[0] + z[0]) * half / denominator;
            let y = (a[1] + z[1]) * half / denominator;
            let scale = (half * 4.).min(lengths[previous].min(lengths[i]) * 0.45) / x.hypot(y);
            [x * scale.min(1.), y * scale.min(1.)]
        })
        .collect();
    let at = |i: usize| [points[i][0], top, points[i][1]];
    let deck = |i: usize| {
        [
            points[i][0] + offsets[i][0],
            top,
            points[i][1] + offsets[i][1],
        ]
    };
    let mut cells = vec![];
    for [a, c, d] in triangles {
        cells.push(cg::prism(&[deck(d), deck(c), deck(a)], p.size[1]));
    }

    for (i, point) in b.points.iter().enumerate() {
        let a = at(i);
        let z = at((i + 1) % b.points.len());
        let dx = z[0] - a[0];
        let dz = z[2] - a[2];
        let length = dx.hypot(dz);
        let yaw = dx.atan2(dz);
        let center = [
            (a[0] + z[0]) / 2.,
            top + b.height_m / 2.,
            (a[2] + z[2]) / 2.,
        ];
        let beam = |center, size| cg::transform(&cg::box_cell([0.; 3], size), center, [1.; 3], yaw);
        if point.edge == "wall" {
            let j = (i + 1) % n;
            let end = |index: usize, neighbor: usize| {
                if b.points[neighbor].edge == "wall" {
                    offsets[index]
                } else {
                    [normals[i][0] * half, normals[i][1] * half]
                }
            };
            let u = end(i, (i + n - 1) % n);
            let v = end(j, j);
            let y = top + b.height_m;
            let mut outline = vec![
                [a[0] + u[0], y, a[2] + u[1]],
                [z[0] + v[0], y, z[2] + v[1]],
                [z[0] - v[0], y, z[2] - v[1]],
                [a[0] - u[0], y, a[2] - u[1]],
            ];
            if positive {
                outline.reverse();
            }
            cells.push(cg::prism(&outline, b.height_m));
        }
        if point.edge == "railing" || point.edge == "triple-railing" {
            let count = (length / 2.).ceil().clamp(1., 64.) as usize;
            for k in 0..=count {
                let t = k as f64 / count as f64;
                cells.push(beam(
                    [a[0] + dx * t, center[1], a[2] + dz * t],
                    [0.04, b.height_m, 0.04],
                ));
            }
            let rails: &[f64] = if point.edge == "railing" {
                &[0.5, 1.]
            } else {
                &[1. / 3., 2. / 3., 1.]
            };
            for &fraction in rails {
                cells.push(beam(
                    [center[0], top + b.height_m * fraction - 0.02, center[2]],
                    [0.04, 0.04, length],
                ));
            }
        }
        if cells.len() > 512 {
            return Err("Balcony has too many railing posts; shorten or simplify its edges".into());
        }
    }
    // Remove internal boundaries between triangular deck cells and overlapping edge beams.
    let faces = crate::construction_shapes::exterior(&cells)
        .into_iter()
        .map(|vertices| {
            let n = cg::normal(&vertices);
            let name = if n[1] > 0.999 {
                "top"
            } else if n[1] < -0.999 {
                "bottom"
            } else if n[0] > 0.999 {
                "starboard"
            } else if n[0] < -0.999 {
                "port"
            } else if n[2] > 0.999 {
                "stern"
            } else if n[2] < -0.999 {
                "bow"
            } else {
                "slope"
            };
            let polygon = vertices
                .into_iter()
                .map(|v| crate::construction_orientation::point(p, v))
                .collect();
            (name.into(), polygon)
        })
        .collect();
    let cells: Vec<_> = cells
        .iter()
        .map(|c| crate::construction_orientation::cell(p, c, [1.; 3]))
        .collect();
    if cells
        .iter()
        .flat_map(|c| c.faces.iter())
        .flat_map(|f| f.vertices.iter())
        .flatten()
        .any(|v| !v.is_finite() || v.abs() > 1000.)
    {
        return Err("Balcony geometry must stay within 1000 m of the design origin".into());
    }
    Ok(VertexSolid { cells, faces })
}
