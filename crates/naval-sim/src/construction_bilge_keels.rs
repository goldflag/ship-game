//! Visual plates, deliberately separate from buoyant cells, armor and loading.
use crate::{construction_geometry as cg, definition::*, geometry::*};

pub fn validate(k: &ConstructionBilgeKeels) -> Result<(), String> {
    if k.version != 1. {
        return Err("Unsupported bilge keel settings".into());
    }
    if ![k.start, k.end, k.width_m, k.thickness_m, k.placement]
        .iter()
        .all(|n| n.is_finite())
    {
        return Err("Enter finite bilge keel dimensions".into());
    }
    if k.start < 0.02 - 1e-10 || k.end > 0.98 + 1e-10 || k.end - k.start < 0.02 - 1e-10 {
        return Err(
            "Keep bilge keels between 2% and 98% of hull length, spanning at least 2%".into(),
        );
    }
    if !(0.05..=3.).contains(&k.width_m)
        || !(0.005..=0.1).contains(&k.thickness_m)
        || k.thickness_m > k.width_m
    {
        return Err(
            "Use bilge keel width 0.05–3 m and thickness 5–100 mm, no thicker than the width"
                .into(),
        );
    }
    if !(0.05..=0.8).contains(&k.placement) {
        return Err("Place bilge keels 5–80% around the outline from keel to deck".into());
    }
    Ok(())
}

pub fn surfaces(p: &ConstructionPrimitive, paint: &str) -> Vec<ConstructionSurface> {
    let Some(h) = &p.custom_hull else {
        return vec![];
    };
    let Some(k) = &h.bilge_keels else {
        return vec![];
    };
    if !k.enabled || validate(k).is_err() {
        return vec![];
    }
    let mut local = p.clone();
    local.position = [0.; 3];
    local.rotation_deg = 0.;
    local.tilt = None;
    let n = h.stations[0].points.len();
    let contour = |i: usize| {
        h.stations[0].points[i]
            .contour
            .unwrap_or(i as f64 * 8. / (n - 1) as f64)
    };
    let q = 4. + k.placement * 4.;
    let mut edge = (n - 1) / 2;
    while edge < n - 2 && contour(edge + 1) < q {
        edge += 1;
    }
    let u = (q - contour(edge)) / (contour(edge + 1) - contour(edge));
    let rings: Vec<Vec<Vec3>> = h
        .stations
        .iter()
        .map(|s| {
            s.points
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    crate::construction_custom_hull::transform(&local, s.t, v, contour(i))
                })
                .collect()
        })
        .collect();
    let taper = (k.end - k.start) * 0.12;
    let mut times = vec![k.start, k.end, k.start + taper, k.end - taper];
    times.extend(h.stations.iter().map(|s| s.t));
    times.extend(
        h.stations
            .windows(2)
            .map(|s| s[0].t + u * (s[1].t - s[0].t)),
    );
    times.retain(|t| *t >= k.start && *t <= k.end);
    times.sort_by(f64::total_cmp);
    times.dedup();
    let sections: Vec<Vec<Vec3>> = times
        .iter()
        .map(|&t| {
            let mut j = 0;
            while j < h.stations.len() - 2 && h.stations[j + 1].t < t {
                j += 1;
            }
            let f = (t - h.stations[j].t) / (h.stations[j + 1].t - h.stations[j].t);
            let [a, b, c, d] = [
                rings[j][edge],
                rings[j][edge + 1],
                rings[j + 1][edge],
                rings[j + 1][edge + 1],
            ];
            let root = if u >= f {
                add(add(scale(a, 1. - u), scale(b, u - f)), scale(d, f))
            } else {
                add(add(scale(a, 1. - f), scale(d, u)), scale(c, f - u))
            };
            let low = add(a, scale(sub(c, a), f));
            let high = add(b, scale(sub(d, b), f));
            let dx = high[0] - low[0];
            let dy = high[1] - low[1];
            let length = dx.hypot(dy);
            let length = if length > 0. { length } else { 1. };
            let nx = dy / length;
            let ny = -dx / length;
            let width = k.width_m
                * ((t - k.start) / taper)
                    .min((k.end - t) / taper)
                    .clamp(0.08, 1.);
            [
                (-k.thickness_m, -0.5),
                (width, -0.5),
                (width, 0.5),
                (-k.thickness_m, 0.5),
            ]
            .iter()
            .map(|&(w, s)| {
                [
                    root[0] + nx * w - ny * k.thickness_m * s,
                    root[1] + ny * w + nx * k.thickness_m * s,
                    root[2],
                ]
            })
            .collect()
        })
        .collect();
    let mut faces = vec![];
    let mut triangle = |a: Vec3, b: Vec3, c: Vec3| {
        faces.push(vec![a, b, c]);
        faces.push([c, b, a].iter().map(|v| [-v[0], v[1], v[2]]).collect());
    };
    for pair in sections.windows(2) {
        for i in 0..4 {
            let [a, b, c, d] = [
                pair[0][i],
                pair[0][(i + 1) % 4],
                pair[1][i],
                pair[1][(i + 1) % 4],
            ];
            triangle(a, b, c);
            triangle(b, d, c);
        }
    }
    let first = &sections[0];
    let last = sections.last().unwrap();
    triangle(first[2], first[1], first[0]);
    triangle(first[3], first[2], first[0]);
    triangle(last[0], last[1], last[2]);
    triangle(last[0], last[2], last[3]);
    faces
        .into_iter()
        .enumerate()
        .map(|(i, face)| {
            let vertices: Vec<_> = face
                .into_iter()
                .map(|v| crate::construction_orientation::point(p, v))
                .collect();
            ConstructionSurface {
                id: format!("{}:bilge-keel:{i}", p.id),
                primitive_id: p.id.clone(),
                face: "bilge-keel".into(),
                panel_id: Some(format!("bilge-keel:{i}")),
                normal: cg::normal(&vertices),
                area_m2: cg::area(&vertices),
                vertices,
                thickness_mm: k.thickness_m * 1000.,
                material: "steel".into(),
                paint: paint.into(),
                open: false,
            }
        })
        .collect()
}
