use crate::definition::{Hull, Vec3};
pub fn interpolate(table: &[[f64; 2]], at: f64) -> f64 {
    if at <= table[0][0] {
        return table[0][1];
    }
    for p in table.windows(2) {
        let ([a, x], [b, y]) = (p[0], p[1]);
        if at <= b {
            return x + (y - x) * (at - a) / (b - a);
        }
    }
    table.last().unwrap()[1]
}
fn right_section(h: &Hull, station: f64) -> Vec<[f64; 2]> {
    let ss = h.sections.as_ref().unwrap();
    let i = ss
        .iter()
        .position(|s| s.station >= station)
        .unwrap_or(1)
        .max(1);
    let (a, b) = (&ss[i - 1], &ss[i]);
    let t = (station - a.station) / (b.station - a.station);
    if a.points.len() == b.points.len() {
        return a
            .points
            .iter()
            .zip(&b.points)
            .map(|(a, b)| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
            .collect();
    }
    let low = a.points[0][1] * (1.0 - t) + b.points[0][1] * t;
    let high = a.points.last().unwrap()[1] * (1.0 - t) + b.points.last().unwrap()[1] * t;
    let aa: Vec<_> = a.points.iter().map(|p| [p[1], p[0]]).collect();
    let bb: Vec<_> = b.points.iter().map(|p| [p[1], p[0]]).collect();
    (0..17)
        .map(|j| {
            let y = low + (high - low) * j as f64 / 16.0;
            [interpolate(&aa, y) * (1.0 - t) + interpolate(&bb, y) * t, y]
        })
        .collect()
}
pub fn hull_section(h: &Hull, station: f64) -> Vec<[f64; 2]> {
    if h.sections.is_none() {
        let w = interpolate(&h.half_breadths, station);
        let bottom = interpolate(&h.keel_heights, station);
        let top = interpolate(&h.deck_heights, station);
        return vec![[-w, bottom], [w, bottom], [w, top], [-w, top]];
    }
    let right = right_section(h, station);
    right
        .iter()
        .rev()
        .map(|p| [-p[0], p[1]])
        .chain(right.iter().copied())
        .collect()
}
pub fn hull_contains(h: &Hull, [x, y, z]: Vec3) -> bool {
    let station = h.length / 2.0 - z;
    if station < 0.0 || station > h.length {
        return false;
    }
    let Some(ss) = h.sections.as_ref() else {
        return x.abs() <= interpolate(&h.half_breadths, station)
            && y >= interpolate(&h.keel_heights, station)
            && y <= interpolate(&h.deck_heights, station);
    };
    let i = ss
        .iter()
        .position(|s| s.station >= station)
        .unwrap_or(1)
        .max(1);
    let (a, b) = (&ss[i - 1], &ss[i]);
    let t = (station - a.station) / (b.station - a.station);
    if a.points.len() != b.points.len() {
        let low = a.points[0][1] * (1.0 - t) + b.points[0][1] * t;
        let high = a.points.last().unwrap()[1] * (1.0 - t) + b.points.last().unwrap()[1] * t;
        if y < low || y > high {
            return false;
        }
        let aa: Vec<_> = a.points.iter().map(|p| [p[1], p[0]]).collect();
        let bb: Vec<_> = b.points.iter().map(|p| [p[1], p[0]]).collect();
        return x.abs() <= interpolate(&aa, y) * (1.0 - t) + interpolate(&bb, y) * t;
    }
    let points = right_section(h, station);
    if y < points[0][1] - 1e-7 || y > points.last().unwrap()[1] + 1e-7 {
        return false;
    }
    let mut width: f64 = 0.0;
    for p in points.windows(2) {
        let ([aw, ay], [bw, by]) = (p[0], p[1]);
        if y >= ay - 1e-7 && y <= by + 1e-7 {
            width = width.max(if by - ay < 1e-7 {
                aw.max(bw)
            } else {
                aw + (bw - aw) * (y - ay) / (by - ay)
            });
        }
    }
    x.abs() <= width + 1e-7
}
