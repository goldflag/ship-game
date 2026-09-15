//! Bounded convex polyhedral CSG. No occupancy grid, symmetry or convex-hull fill.
//! Every cell is closed and outward wound; disjoint cells integrate without double counting.
use crate::{
    definition::{ConvexVolume, ConvexVolumeFacesItem, Vec3},
    geometry::*,
};
pub const EPS: f64 = 1e-8;
pub const MAX_CELLS: usize = 4096;
pub type Polygon = Vec<Vec3>;
pub type Cell = ConvexVolume;
pub fn check_budget(cells: &[Cell]) -> Result<(), String> {
    if cells.len() > MAX_CELLS
        || cells.iter().any(|c| c.faces.len() > 128)
        || cells
            .iter()
            .map(|c| c.faces.iter().map(|f| f.vertices.len()).sum::<usize>())
            .sum::<usize>()
            > 131072
    {
        return Err("Geometry exceeds 4096 convex cells, 128 faces per cell, or 131072 face vertices; simplify the design".into());
    }
    Ok(())
}

pub fn normal(p: &[Vec3]) -> Vec3 {
    normalize(cross(sub(p[1], p[0]), sub(p[2], p[0])))
}
pub fn area(p: &[Vec3]) -> f64 {
    (1..p.len().saturating_sub(1))
        .map(|i| length(cross(sub(p[i], p[0]), sub(p[i + 1], p[0]))) * 0.5)
        .sum()
}
pub fn clean(p: &mut Polygon) {
    p.dedup_by(|a, b| length(sub(*a, *b)) < EPS);
    if p.len() > 1 && length(sub(p[0], *p.last().unwrap())) < EPS {
        p.pop();
    }
    // Collinear points can be the first three after a clip; remove them before computing a plane.
    let mut i = 0;
    while p.len() >= 3 && i < p.len() {
        let n = p.len();
        if length(cross(
            sub(p[i], p[(i + n - 1) % n]),
            sub(p[(i + 1) % n], p[i]),
        )) < EPS * EPS
        {
            p.remove(i);
            i = 0;
        } else {
            i += 1;
        }
    }
}
pub fn clip_polygon(p: &[Vec3], n: Vec3, d: f64) -> Polygon {
    let mut out = vec![];
    for i in 0..p.len() {
        let (a, b) = (p[i], p[(i + 1) % p.len()]);
        let (da, db) = (dot(n, a) - d, dot(n, b) - d);
        if da <= EPS {
            out.push(a);
        }
        if (da < -EPS && db > EPS) || (da > EPS && db < -EPS) {
            out.push(add(a, scale(sub(b, a), da / (da - db))));
        }
    }
    clean(&mut out);
    out
}
pub fn clip(c: &Cell, n: Vec3, d: f64) -> Option<Cell> {
    let (mut faces, mut cap) = (vec![], vec![]);
    let mut outside = false;
    let mut inside = false;
    for f in &c.faces {
        for &p in &f.vertices {
            outside |= dot(n, p) - d > EPS;
            inside |= dot(n, p) - d < -EPS;
        }
    }
    if !outside {
        return Some(c.clone());
    }
    if !inside {
        return None;
    }
    for f in &c.faces {
        let p = clip_polygon(&f.vertices, n, d);
        if p.len() < 3 || area(&p) < EPS * EPS {
            continue;
        }
        for &v in &p {
            if (dot(n, v) - d).abs() < EPS * 8.0
                && !cap.iter().any(|q| length(sub(*q, v)) < EPS * 8.0)
            {
                cap.push(v);
            }
        }
        faces.push(ConvexVolumeFacesItem { vertices: p });
    }
    if cap.len() >= 3 {
        let center = scale(
            cap.iter().copied().fold([0.; 3], add),
            1.0 / cap.len() as f64,
        );
        let u = normalize(sub(cap[0], center));
        let v = cross(n, u);
        cap.sort_by(|a, b| {
            let a = sub(*a, center);
            let b = sub(*b, center);
            dot(a, v)
                .atan2(dot(a, u))
                .total_cmp(&dot(b, v).atan2(dot(b, u)))
        });
        clean(&mut cap);
        if cap.len() >= 3 {
            faces.push(ConvexVolumeFacesItem { vertices: cap });
        }
    }
    (faces.len() >= 4).then_some(Cell { faces })
}
pub fn contains(c: &Cell, p: Vec3) -> bool {
    c.faces
        .iter()
        .all(|f| dot(normal(&f.vertices), sub(p, f.vertices[0])) <= EPS)
}
pub fn closest_point(c: &Cell, p: Vec3) -> Vec3 {
    if contains(c, p) {
        return p;
    }
    let mut best = ([0.; 3], f64::INFINITY);
    let mut consider = |q: Vec3| {
        let d = dot(sub(p, q), sub(p, q));
        if d < best.1 {
            best = (q, d);
        }
    };
    for f in &c.faces {
        let n = normal(&f.vertices);
        let q = sub(p, scale(n, dot(n, sub(p, f.vertices[0]))));
        if (0..f.vertices.len()).all(|i| {
            dot(
                cross(
                    sub(f.vertices[(i + 1) % f.vertices.len()], f.vertices[i]),
                    sub(q, f.vertices[i]),
                ),
                n,
            ) >= -EPS
        }) {
            consider(q);
        }
        for i in 0..f.vertices.len() {
            let a = f.vertices[i];
            let v = sub(f.vertices[(i + 1) % f.vertices.len()], a);
            let t = (dot(sub(p, a), v) / dot(v, v)).clamp(0., 1.);
            consider(add(a, scale(v, t)));
        }
    }
    best.0
}
pub fn room_distance(room: &crate::definition::Compartment, p: Vec3) -> f64 {
    if let Some(cells) = &room.volumes {
        return cells
            .iter()
            .map(|c| length(sub(p, closest_point(c, p))))
            .fold(f64::INFINITY, f64::min);
    }
    length(std::array::from_fn(|i| {
        ((p[i] - room.center[i]).abs() - room.size[i] * 0.5).max(0.)
    }))
}
pub fn bounds(c: &Cell) -> (Vec3, Vec3) {
    crate::structure::bounds(c.faces.iter().flat_map(|f| f.vertices.iter().copied()))
}
pub fn separated(a: &Cell, b: &Cell) -> bool {
    let (ac, asz) = bounds(a);
    let (bc, bsz) = bounds(b);
    (0..3).any(|i| (ac[i] - bc[i]).abs() > (asz[i] + bsz[i]) * 0.5 + EPS)
}
pub fn intersection(a: &Cell, b: &Cell) -> Option<Cell> {
    if separated(a, b) {
        return None;
    }
    let mut c = a.clone();
    for f in &b.faces {
        let n = normal(&f.vertices);
        c = clip(&c, n, dot(n, f.vertices[0]))?;
    }
    Some(c)
}
pub fn subtract(a: &Cell, b: &Cell) -> Vec<Cell> {
    if separated(a, b) {
        return vec![a.clone()];
    }
    // An overlapping AABB is common for neighboring curve facets. Splitting by
    // a non-intersecting cutter preserves volume but needlessly fragments it.
    // Prove actual positive-volume contact before introducing any cut planes.
    if intersection(a, b).is_none_or(|overlap| moments(&overlap).volume <= EPS) {
        return vec![a.clone()];
    }
    let mut inside = Some(a.clone());
    let mut out = vec![];
    for f in &b.faces {
        let Some(c) = inside else { break };
        let n = normal(&f.vertices);
        let d = dot(n, f.vertices[0]);
        if let Some(piece) = clip(&c, scale(n, -1.), -d)
            && moments(&piece).volume > EPS
        {
            out.push(piece);
        }
        inside = clip(&c, n, d);
    }
    out
}
pub fn subtract_all(mut cells: Vec<Cell>, cutters: &[Cell]) -> Result<Vec<Cell>, String> {
    for b in cutters {
        let mut next = vec![];
        for a in &cells {
            next.extend(subtract(a, b));
            if next.len() > MAX_CELLS {
                return Err(
                    "Geometry exceeds 4096 convex cells; simplify overlapping pieces".into(),
                );
            }
        }
        cells = next;
        check_budget(&cells)?;
    }
    Ok(cells)
}
pub fn union(cells: &[Cell]) -> Result<Vec<Cell>, String> {
    let mut out = vec![];
    for c in cells {
        let additions = subtract_all(vec![c.clone()], &out)?;
        out.extend(additions);
        check_budget(&out)?;
        if out.len() > MAX_CELLS {
            return Err("Geometry exceeds 4096 convex cells".into());
        }
    }
    Ok(out)
}
/// Remove the portion of a surface covered by another volume. Same-facing coincident
/// skin has deterministic owner; opposing coincident faces are both interior.
pub fn exposed(p: &[Vec3], b: &Cell, keep_coincident: bool) -> Vec<Polygon> {
    let pn = normal(p);
    // Nearby curved cells share bounding boxes without covering this face.
    // Reject those before splitting: otherwise unrelated clipping planes create
    // hundreds of sliver patches on a single open shell or window frame.
    let mut overlap = p.to_vec();
    for f in &b.faces {
        let n = normal(&f.vertices);
        overlap = clip_polygon(&overlap, n, dot(n, f.vertices[0]));
        if overlap.len() < 3 || area(&overlap) < EPS { return vec![p.to_vec()]; }
    }
    for f in &b.faces {
        let n = normal(&f.vertices);
        let d = dot(n, f.vertices[0]);
        if p.iter().all(|v| (dot(n, *v) - d).abs() < EPS)
            && dot(n, pn) > 1. - EPS
            && keep_coincident
        {
            return vec![p.to_vec()];
        }
    }
    let mut inside = p.to_vec();
    let mut out = vec![];
    for f in &b.faces {
        if inside.len() < 3 {
            break;
        }
        let n = normal(&f.vertices);
        let d = dot(n, f.vertices[0]);
        // Coplanar polygons are inside, not both halves of the cut.
        if inside.iter().all(|v| dot(n, *v) - d <= EPS) {
            continue;
        }
        let piece = clip_polygon(&inside, scale(n, -1.), -d);
        if piece.len() >= 3 && area(&piece) > EPS {
            out.push(piece);
        }
        inside = clip_polygon(&inside, n, d);
    }
    out
}
pub fn box_cell(center: Vec3, size: Vec3) -> Cell {
    let p: Vec<Vec3> = (0..8)
        .map(|i| {
            std::array::from_fn(|k| {
                center[k] + size[k] * (if i & (1 << k) == 0 { -0.5 } else { 0.5 })
            })
        })
        .collect();
    let fs = [
        [0, 4, 6, 2],
        [1, 3, 7, 5],
        [0, 1, 5, 4],
        [2, 6, 7, 3],
        [0, 2, 3, 1],
        [4, 5, 7, 6],
    ];
    Cell {
        faces: fs
            .iter()
            .map(|f| ConvexVolumeFacesItem {
                vertices: f.iter().map(|i| p[*i]).collect(),
            })
            .collect(),
    }
}
pub fn transform(c: &Cell, center: Vec3, size: Vec3, yaw: f64) -> Cell {
    let (s, co) = yaw.sin_cos();
    Cell {
        faces: c
            .faces
            .iter()
            .map(|f| ConvexVolumeFacesItem {
                vertices: f
                    .vertices
                    .iter()
                    .map(|p| {
                        let [x, y, z] = std::array::from_fn(|i| p[i] * size[i]);
                        add(center, [co * x + s * z, y, -s * x + co * z])
                    })
                    .collect(),
            })
            .collect(),
    }
}
pub fn prism(p: &[Vec3], thickness: f64) -> Cell {
    let n = normal(p);
    let q: Vec<_> = p.iter().map(|v| sub(*v, scale(n, thickness))).collect();
    let mut faces = vec![
        ConvexVolumeFacesItem {
            vertices: p.to_vec(),
        },
        ConvexVolumeFacesItem {
            vertices: q.iter().copied().rev().collect(),
        },
    ];
    for i in 0..p.len() {
        let j = (i + 1) % p.len();
        faces.push(ConvexVolumeFacesItem {
            vertices: vec![p[i], q[i], q[j], p[j]],
        });
    }
    Cell { faces }
}
#[derive(Clone, Copy, Debug, Default)]
pub struct Moments {
    pub volume: f64,
    pub first: Vec3,
    pub second: Vec3,
}
impl Moments {
    pub fn center(self) -> Vec3 {
        if self.volume > EPS {
            scale(self.first, 1. / self.volume)
        } else {
            [0.; 3]
        }
    }
    pub fn add(&mut self, m: Self) {
        self.volume += m.volume;
        self.first = add(self.first, m.first);
        self.second = add(self.second, m.second);
    }
    pub fn inertia(self, density: f64, center: Vec3) -> Vec3 {
        let s: Vec3 = std::array::from_fn(|i| {
            self.second[i] - 2. * center[i] * self.first[i] + center[i] * center[i] * self.volume
        });
        [
            (s[1] + s[2]) * density,
            (s[0] + s[2]) * density,
            (s[0] + s[1]) * density,
        ]
    }
}
pub fn moments(c: &Cell) -> Moments {
    // Reference near the body avoids catastrophic cancellation after translations.
    let origin = bounds(c).0;
    let mut m = Moments::default();
    for f in &c.faces {
        for i in 1..f.vertices.len() - 1 {
            let p = [
                sub(f.vertices[0], origin),
                sub(f.vertices[i], origin),
                sub(f.vertices[i + 1], origin),
            ];
            let v = dot(p[0], cross(p[1], p[2])) / 6.;
            m.volume += v;
            for k in 0..3 {
                let s = p[0][k] + p[1][k] + p[2][k];
                m.first[k] += v * s / 4.;
                m.second[k] += v * (s * s + p.iter().map(|p| p[k] * p[k]).sum::<f64>()) / 20.;
            }
        }
    }
    for (k, _) in origin.iter().enumerate() {
        m.second[k] += 2. * origin[k] * m.first[k] + origin[k] * origin[k] * m.volume;
        m.first[k] += origin[k] * m.volume;
    }
    m
}
pub fn total(cells: &[Cell]) -> Moments {
    let mut m = Moments::default();
    for c in cells {
        m.add(moments(c));
    }
    m
}
pub fn submerged(cells: &[Cell], n: Vec3, d: f64) -> Moments {
    let mut m = Moments::default();
    for c in cells {
        if let Some(c) = clip(c, n, d) {
            m.add(moments(&c));
        }
    }
    m
}
pub fn connected(a: &Cell, b: &Cell) -> bool {
    if separated(a, b) {
        return false;
    }
    if intersection(a, b).is_some_and(|c| moments(&c).volume > EPS) {
        return true;
    }
    a.faces.iter().any(|fa| {
        let n = normal(&fa.vertices);
        b.faces.iter().any(|fb| {
            let bn = normal(&fb.vertices);
            if dot(n, bn) > -1. + EPS || (dot(n, sub(fa.vertices[0], fb.vertices[0]))).abs() > EPS {
                return false;
            }
            let mut p = fa.vertices.clone();
            for f in &b.faces {
                let n = normal(&f.vertices);
                p = clip_polygon(&p, n, dot(n, f.vertices[0]));
                if p.len() < 3 {
                    return false;
                }
            }
            area(&p) > EPS
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn near(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-7, "{a} != {b}");
    }
    #[test]
    fn analytic_box_and_wedge() {
        let b = box_cell([2., 3., 4.], [4., 6., 8.]);
        let m = moments(&b);
        near(m.volume, 192.);
        assert_eq!(m.center(), [2., 3., 4.]);
        let w = clip(
            &box_cell([0.; 3], [2., 2., 2.]),
            normalize([0., 1., 1.]),
            0.,
        )
        .unwrap();
        let m = moments(&w);
        near(m.volume, 4.);
        near(m.center()[1], -1. / 3.);
        near(m.center()[2], -1. / 3.);
        let i = moments(&b).inertia(1., [2., 3., 4.]);
        near(i[0], 192. * (36. + 64.) / 12.);
    }
    #[test]
    fn overlap_union_and_inward_corner_occupancy() {
        let a = box_cell([0.; 3], [2.; 3]);
        let b = box_cell([1., 0., 0.], [2.; 3]);
        let c = union(&[a.clone(), a.clone(), b]).unwrap();
        near(total(&c).volume, 12.);
        let slabs: Vec<_> = a.faces.iter().map(|f| prism(&f.vertices, 0.1)).collect();
        let material = union(&slabs).unwrap();
        near(total(&material).volume, 8. - 1.8_f64.powi(3));
    }
    #[test]
    fn face_attachment_excludes_edge_and_point() {
        let a = box_cell([0.; 3], [2.; 3]);
        assert!(connected(&a, &box_cell([2., 0., 0.], [2.; 3])));
        assert!(!connected(&a, &box_cell([2., 2., 0.], [2.; 3])));
    }

    #[test]
    fn nearby_diagonal_walls_do_not_fragment_disjoint_geometry() {
        let wall = box_cell([0.; 3], [4., 1., 0.25]);
        let yaw = std::f64::consts::FRAC_PI_4;
        let a = transform(&wall, [0.; 3], [1.; 3], yaw);
        let b = transform(&wall, [1., 0., 0.], [1.; 3], yaw);
        assert!(!separated(&a, &b), "axis-aligned bounds overlap");
        assert!(intersection(&a, &b).is_none(), "walls have no physical contact");
        let remainder = subtract(&a, &b);
        assert_eq!(remainder.len(), 1, "unrelated planes must not split a wall");
        near(total(&remainder).volume, 1.);
        for face in &a.faces {
            let patches = exposed(&face.vertices, &b, false);
            assert_eq!(patches.len(), 1, "uncovered faces stay intact");
            near(area(&patches[0]), area(&face.vertices));
        }

        // A genuinely overlapping cutter still removes the physical overlap.
        let overlap = transform(&wall, [yaw.cos(), 0., -yaw.sin()], [1.; 3], yaw);
        let remainder = subtract(&a, &overlap);
        near(total(&remainder).volume, 0.25);
        near(total(&union(&[a, overlap]).unwrap()).volume, 1.25);
    }
}
