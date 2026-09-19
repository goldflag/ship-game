//! Bounded convex polyhedral CSG. No occupancy grid, symmetry or convex-hull fill.
//! Every cell is closed and outward wound; disjoint cells integrate without double counting.
use crate::{
    definition::{ConvexVolume, ConvexVolumeFacesItem, Vec3},
    geometry::*,
};
pub const EPS: f64 = 1e-8;
pub const MAX_CELLS: usize = 131_072;
pub const MAX_CELL_FACES: usize = 128;
pub const MAX_FACE_VERTICES: usize = 4_194_304;
pub type Polygon = Vec<Vec3>;
pub type Cell = ConvexVolume;
pub fn check_budget(cells: &[Cell]) -> Result<(), String> {
    let max_faces = cells.iter().map(|c| c.faces.len()).max().unwrap_or(0);
    let vertices = cells
        .iter()
        .map(|c| c.faces.iter().map(|f| f.vertices.len()).sum::<usize>())
        .sum::<usize>();
    if cells.len() > MAX_CELLS || max_faces > MAX_CELL_FACES || vertices > MAX_FACE_VERTICES {
        return Err(format!(
            "Geometry budget exceeded: {} / {MAX_CELLS} convex cells, {max_faces} / {MAX_CELL_FACES} maximum faces per cell, {vertices} / {MAX_FACE_VERTICES} face vertices",
            cells.len()
        ));
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
/// `area(p) < limit`. The area sums non-negative triangle terms, and a rounded
/// sum of those is never below any one of them, so a single triangle clearly
/// larger than the limit settles it without the remaining square roots.
fn area_below(p: &[Vec3], limit: f64) -> bool {
    let square = limit * limit * 4.0;
    if square.is_normal() {
        for i in 1..p.len().saturating_sub(1) {
            let c = cross(sub(p[i], p[0]), sub(p[i + 1], p[0]));
            let squared = dot(c, c);
            if squared.is_finite() && squared > square * (1.0 + 1e-9) {
                return false;
            }
        }
    }
    area(p) < limit
}
pub fn clean(p: &mut Polygon) {
    p.dedup_by(|a, b| shorter(sub(*a, *b), EPS));
    if p.len() > 1 && shorter(sub(p[0], *p.last().unwrap()), EPS) {
        p.pop();
    }
    // Collinear points can be the first three after a clip; remove them before computing a plane.
    let mut i = 0;
    while p.len() >= 3 && i < p.len() {
        let n = p.len();
        if shorter(
            cross(sub(p[i], p[(i + n - 1) % n]), sub(p[(i + 1) % n], p[i])),
            EPS * EPS,
        ) {
            p.remove(i);
            i = 0;
        } else {
            i += 1;
        }
    }
}
pub fn clip_polygon(p: &[Vec3], n: Vec3, d: f64) -> Polygon {
    let mut out = vec![];
    clip_polygon_into(p, n, d, &mut out);
    out
}
fn clip_polygon_into(p: &[Vec3], n: Vec3, d: f64, out: &mut Polygon) {
    out.clear();
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
    clean(out);
}
pub fn clip(c: &Cell, n: Vec3, d: f64) -> Option<Cell> {
    let (mut faces, mut cap) = (vec![], vec![]);
    let mut outside = false;
    let mut inside = false;
    for f in c.faces.iter() {
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
    for f in c.faces.iter() {
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
    (faces.len() >= 4).then_some(Cell { faces: faces.into() })
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
    for f in c.faces.iter() {
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
/// `room_distance(room, p).min(bound)` for a constructed room. A cell whose
/// bounding box is clearly farther than the nearest surface found so far cannot
/// hold it, and measuring that box is far cheaper than a closest point on every
/// face; the cell that does hold it is never skipped, so the distance is exact.
pub fn room_distance_within(cells: &[Cell], p: Vec3, bound: f64) -> f64 {
    let mut nearest = bound;
    for c in cells {
        let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for v in c.faces.iter().flat_map(|f| &f.vertices) {
            for i in 0..3 {
                low[i] = low[i].min(v[i]);
                high[i] = high[i].max(v[i]);
            }
        }
        let gaps: Vec3 = std::array::from_fn(|i| (low[i] - p[i]).max(p[i] - high[i]).max(0.));
        if dot(gaps, gaps) > nearest * nearest * (1. + 1e-9) {
            continue;
        }
        nearest = nearest.min(length(sub(p, closest_point(c, p))));
        if nearest == 0. {
            break;
        }
    }
    nearest
}
pub fn room_distance(room: &crate::definition::Compartment, p: Vec3) -> f64 {
    if let Some(cells) = &room.volumes {
        return cells
            .iter()
            .map(|c| length(sub(p, closest_point(c, p))))
            .fold(f64::INFINITY, f64::min);
    }
    // Explicit weighted runtime proxies use their cell locations for damage
    // assignment. Legacy and exact definitions retain their original path.
    if let Some(cells) = &room.cells
        && cells.iter().any(|c| c.volume_m3.is_some()) {
            return cells.iter().map(|c| length(std::array::from_fn(|i| {
                ((p[i]-c.center[i]).abs()-c.size[i]*0.5).max(0.)
            }))).fold(f64::INFINITY, f64::min);
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
    for f in b.faces.iter() {
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
    for f in b.faces.iter() {
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
pub fn subtract_all<'a>(
    cells: Vec<Cell>,
    cutters: impl IntoIterator<Item = &'a Cell>,
) -> Result<Vec<Cell>, String> {
    // Carry bounds and budget counts with unchanged cells. A fitting usually
    // touches only a handful of thousands of interior/material fragments; do not
    // rescan all their vertices for every remote cutter.
    let prepare = |cell: Cell| {
        let bound = bounds(&cell);
        let vertices = cell.faces.iter().map(|f| f.vertices.len()).sum::<usize>();
        (cell, bound, vertices)
    };
    let mut cells: Vec<_> = cells.into_iter().map(prepare).collect();
    for b in cutters {
        let (bc, bs) = bounds(b);
        let mut next = vec![];
        let mut max_faces = 0;
        let mut vertices = 0;
        for (a, (ac, asz), count) in cells {
            let start = next.len();
            if (0..3).any(|i| (ac[i] - bc[i]).abs() > (asz[i] + bs[i]) * 0.5 + EPS) {
                next.push((a, (ac, asz), count));
            } else {
                next.extend(subtract(&a, b).into_iter().map(prepare));
            }
            for (cell, _, count) in &next[start..] {
                vertices += count;
                max_faces = max_faces.max(cell.faces.len());
            }
            if next.len() > MAX_CELLS {
                return Err(format!(
                    "Subtraction budget exceeded: {} / {MAX_CELLS} convex cells",
                    next.len()
                ));
            }
        }
        if max_faces > MAX_CELL_FACES || vertices > MAX_FACE_VERTICES {
            return Err(format!("Geometry budget exceeded: {} / {MAX_CELLS} convex cells, {max_faces} / {MAX_CELL_FACES} maximum faces per cell, {vertices} / {MAX_FACE_VERTICES} face vertices", next.len()));
        }
        cells = next;
    }
    Ok(cells.into_iter().map(|(cell, _, _)| cell).collect())
}
pub fn union(cells: &[Cell]) -> Result<Vec<Cell>, String> {
    let mut out = vec![];
    for c in cells {
        let additions = subtract_all(vec![c.clone()], &out)?;
        out.extend(additions);
        check_budget(&out)?;
        if out.len() > MAX_CELLS {
            return Err(format!("Geometry exceeds {MAX_CELLS} convex cells"));
        }
    }
    Ok(out)
}
/// `union` for many cells: each new cell is cut only by the output of the earlier cells in
/// its neighbor list, in output order. A cutter outside a cell's bounds never changes it,
/// so the result matches the full scan when `neighbors` holds every non-separated pair.
pub fn union_near(cells: &[Cell], neighbors: &[Vec<usize>]) -> Result<Vec<Cell>, String> {
    union_near_with(cells, neighbors, |cell, out, cutters| {
        subtract_all(vec![cell.clone()], cutters.iter().map(|&k| &out[k]))
    })
}
/// Keep union ordering and complexity limits identical for fresh and cached CSG.
pub(crate) fn union_near_with(
    cells: &[Cell], neighbors: &[Vec<usize>],
    mut subtract: impl FnMut(&Cell, &[Cell], &[usize]) -> Result<Vec<Cell>, String>,
) -> Result<Vec<Cell>, String> {
    let mut out: Vec<Cell> = vec![];
    let mut produced: Vec<Vec<usize>> = vec![vec![]; cells.len()];
    let mut vertices = 0usize;
    for (i, c) in cells.iter().enumerate() {
        let mut cutters: Vec<usize> = neighbors[i]
            .iter()
            .filter(|&&j| j < i)
            .flat_map(|&j| produced[j].iter().copied())
            .collect();
        cutters.sort_unstable();
        let additions = subtract(c, &out, &cutters)?;
        for a in &additions {
            vertices += a.faces.iter().map(|f| f.vertices.len()).sum::<usize>();
            if a.faces.len() > MAX_CELL_FACES {
                return Err(format!(
                    "Union budget exceeded: {} / {MAX_CELL_FACES} faces in one convex cell",
                    a.faces.len()
                ));
            }
        }
        produced[i] = (out.len()..out.len() + additions.len()).collect();
        out.extend(additions);
        if out.len() > MAX_CELLS || vertices > MAX_FACE_VERTICES {
            return Err(format!(
                "Union budget exceeded: {} / {MAX_CELLS} convex cells, {vertices} / {MAX_FACE_VERTICES} face vertices",
                out.len()
            ));
        }
    }
    Ok(out)
}

/// Uniform-grid broadphase over convex cells. `candidates` lists, in ascending index order,
/// every inserted cell whose bounding box comes within a small margin of the query box.
/// Callers still apply the exact predicates (`separated`, `intersection`, `subtract`), and
/// those are no-ops for separated pairs, so a scan through the index matches a full scan.
pub struct Broadphase {
    pitch: f64,
    boxes: Vec<(Vec3, Vec3)>,
    grid: std::collections::HashMap<[i64; 3], Vec<usize>>,
}
const BROADPHASE_MARGIN: f64 = 1e-6;
impl Broadphase {
    pub fn new(pitch: f64) -> Self {
        Self {
            pitch: if pitch.is_finite() {
                pitch.max(1e-3)
            } else {
                8.
            },
            boxes: vec![],
            grid: Default::default(),
        }
    }
    /// A pitch near the typical cell extent, coarse enough that the largest cell spans few grid cells.
    pub fn sized_for(cells: &[Cell]) -> Self {
        let extents: Vec<f64> = cells
            .iter()
            .map(|c| {
                let (lo, hi) = Self::extent(c);
                (0..3).map(|i| hi[i] - lo[i]).fold(0., f64::max)
            })
            .collect();
        let mean = extents.iter().sum::<f64>() / extents.len().max(1) as f64;
        let largest = extents.iter().copied().fold(0., f64::max);
        let mut index = Self::new(mean.clamp(2., 32.).max(largest / 64.));
        for c in cells {
            index.insert(c);
        }
        index
    }
    pub fn pitch(&self) -> f64 {
        self.pitch
    }
    pub fn len(&self) -> usize {
        self.boxes.len()
    }
    pub fn is_empty(&self) -> bool {
        self.boxes.is_empty()
    }
    fn extent(c: &Cell) -> (Vec3, Vec3) {
        let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for p in c.faces.iter().flat_map(|f| f.vertices.iter()) {
            for i in 0..3 {
                lo[i] = lo[i].min(p[i]);
                hi[i] = hi[i].max(p[i]);
            }
        }
        (lo, hi)
    }
    fn range(&self, lo: Vec3, hi: Vec3) -> ([i64; 3], [i64; 3]) {
        let key = |v: f64| (v / self.pitch).clamp(-1e9, 1e9).floor() as i64;
        let mut a = [0; 3];
        let mut b = [0; 3];
        for i in 0..3 {
            a[i] = key(lo[i] - BROADPHASE_MARGIN);
            b[i] = key(hi[i] + BROADPHASE_MARGIN).max(a[i]);
        }
        (a, b)
    }
    /// Appends a cell; its index is the number of cells inserted before it.
    pub fn insert(&mut self, cell: &Cell) -> usize {
        let (lo, hi) = Self::extent(cell);
        let index = self.boxes.len();
        self.boxes.push((lo, hi));
        let (a, b) = self.range(lo, hi);
        for x in a[0]..=b[0] {
            for y in a[1]..=b[1] {
                for z in a[2]..=b[2] {
                    self.grid.entry([x, y, z]).or_default().push(index);
                }
            }
        }
        index
    }
    pub fn candidates(&self, cell: &Cell) -> Vec<usize> {
        let (lo, hi) = Self::extent(cell);
        self.candidates_box(lo, hi)
    }
    pub fn candidates_box(&self, lo: Vec3, hi: Vec3) -> Vec<usize> {
        let (a, b) = self.range(lo, hi);
        let mut out = vec![];
        for x in a[0]..=b[0] {
            for y in a[1]..=b[1] {
                for z in a[2]..=b[2] {
                    if let Some(list) = self.grid.get(&[x, y, z]) {
                        out.extend(list.iter().copied().filter(|&k| {
                            let (blo, bhi) = self.boxes[k];
                            (0..3).all(|i| {
                                blo[i] <= hi[i] + BROADPHASE_MARGIN
                                    && lo[i] <= bhi[i] + BROADPHASE_MARGIN
                            })
                        }));
                    }
                }
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }
}
/// Remove the portion of a surface covered by another volume. Same-facing coincident
/// skin has deterministic owner; opposing coincident faces are both interior.
pub fn exposed(p: &[Vec3], b: &Cell, keep_coincident: bool) -> Vec<Polygon> {
    let pn = normal(p);
    // Nearby curved cells share bounding boxes without covering this face.
    // Reject those before splitting: otherwise unrelated clipping planes create
    // hundreds of sliver patches on a single open shell or window frame.
    let mut overlap = p.to_vec();
    for f in b.faces.iter() {
        let n = normal(&f.vertices);
        overlap = clip_polygon(&overlap, n, dot(n, f.vertices[0]));
        if overlap.len() < 3 || area(&overlap) < EPS {
            return vec![p.to_vec()];
        }
    }
    for f in b.faces.iter() {
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
    for f in b.faces.iter() {
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
    Cell { faces: faces.into() }
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
    face_moments::<true>(c.faces.iter().map(|f| f.vertices.as_slice()))
}
/// `SECOND` false leaves the second moments zero. Volume and first moments are
/// accumulated independently of them, so those come out the same either way;
/// buoyancy reads nothing else and skips a third of the arithmetic.
fn face_moments<'a, const SECOND: bool>(
    faces: impl Iterator<Item = &'a [Vec3]> + Clone,
) -> Moments {
    // Reference near the body avoids catastrophic cancellation after translations.
    let origin = crate::structure::bounds(faces.clone().flat_map(|f| f.iter().copied())).0;
    let mut m = Moments::default();
    for f in faces {
        for i in 1..f.len() - 1 {
            let p = [sub(f[0], origin), sub(f[i], origin), sub(f[i + 1], origin)];
            let v = dot(p[0], cross(p[1], p[2])) / 6.;
            m.volume += v;
            for k in 0..3 {
                let s = p[0][k] + p[1][k] + p[2][k];
                m.first[k] += v * s / 4.;
                if SECOND {
                    m.second[k] += v * (s * s + p.iter().map(|p| p[k] * p[k]).sum::<f64>()) / 20.;
                }
            }
        }
    }
    for (k, _) in origin.iter().enumerate() {
        if SECOND {
            m.second[k] += 2. * origin[k] * m.first[k] + origin[k] * origin[k] * m.volume;
        }
        m.first[k] += origin[k] * m.volume;
    }
    m
}
/// Buffers `clipped_moments` reuses between cells; only their capacity survives.
#[derive(Default)]
struct ClipScratch {
    points: Polygon,
    faces: Vec<(usize, usize)>,
    polygon: Polygon,
    cap: Polygon,
    angles: Vec<(f64, Vec3)>,
}
thread_local! {
    static CLIP: std::cell::RefCell<ClipScratch> = std::cell::RefCell::new(ClipScratch::default());
}
/// `clip(c, n, d).map(|c| moments(&c))` without building the clipped cell. A
/// hydrostatic solve clips every waterline cell at each of some thirty levels
/// and keeps only the integrals, so the faces live in reused buffers instead.
/// Every float is produced by the same operations in the same order as the two
/// calls it replaces; the cap is keyed once and sorted stably, which orders it
/// exactly as comparing angles pairwise does
/// (`clipped_moments_are_clip_then_moments_bit_for_bit`).
pub fn clipped_moments(c: &Cell, n: Vec3, d: f64) -> Option<Moments> {
    clipped::<true>(c, n, d)
}
/// `clipped_moments` for a caller that reads only the volume and its centre:
/// the same volume and first moments, with the second moments left zero.
pub fn clipped_centre(c: &Cell, n: Vec3, d: f64) -> Option<Moments> {
    clipped::<false>(c, n, d)
}
fn clipped<const SECOND: bool>(c: &Cell, n: Vec3, d: f64) -> Option<Moments> {
    let (mut outside, mut inside) = (false, false);
    for f in c.faces.iter() {
        for &p in &f.vertices {
            outside |= dot(n, p) - d > EPS;
            inside |= dot(n, p) - d < -EPS;
        }
    }
    if !outside {
        return Some(face_moments::<SECOND>(
            c.faces.iter().map(|f| f.vertices.as_slice()),
        ));
    }
    if !inside {
        return None;
    }
    CLIP.with_borrow_mut(|work| {
        let ClipScratch {
            points,
            faces,
            polygon,
            cap,
            angles,
        } = work;
        points.clear();
        faces.clear();
        cap.clear();
        for f in c.faces.iter() {
            clip_polygon_into(&f.vertices, n, d, polygon);
            if polygon.len() < 3 || area_below(polygon, EPS * EPS) {
                continue;
            }
            for &v in polygon.iter() {
                if (dot(n, v) - d).abs() < EPS * 8.0
                    && !cap.iter().any(|q| shorter(sub(*q, v), EPS * 8.0))
                {
                    cap.push(v);
                }
            }
            faces.push((points.len(), points.len() + polygon.len()));
            points.extend_from_slice(polygon);
        }
        if cap.len() >= 3 {
            let center = scale(
                cap.iter().copied().fold([0.; 3], add),
                1.0 / cap.len() as f64,
            );
            // Same axes as `clip`, to the bit: on a symmetric cap a vertex sits
            // exactly opposite the first, and the rounding of its sign decides
            // where the fan starts.
            let u = normalize(sub(cap[0], center));
            let v = cross(n, u);
            // `clip` orders the cap by `atan2`. The diamond angle below rises
            // and falls with it over the same (-pi, pi] turn, signed zeros
            // included, so a stable sort on it yields the same order without the
            // library call; a vertex on the centroid has no direction and keeps
            // the original key for the whole cap.
            angles.clear();
            angles.extend(cap.iter().map(|p| {
                let a = sub(*p, center);
                let (x, y) = (dot(a, u), dot(a, v));
                ((1.0 - x / (x.abs() + y.abs())).copysign(y), *p)
            }));
            if angles.iter().any(|a| a.0.is_nan()) {
                for a in angles.iter_mut() {
                    let d = sub(a.1, center);
                    a.0 = dot(d, v).atan2(dot(d, u));
                }
            }
            angles.sort_by(|a, b| a.0.total_cmp(&b.0));
            cap.clear();
            cap.extend(angles.iter().map(|a| a.1));
            clean(cap);
            if cap.len() >= 3 {
                faces.push((points.len(), points.len() + cap.len()));
                points.extend_from_slice(cap);
            }
        }
        (faces.len() >= 4)
            .then(|| face_moments::<SECOND>(faces.iter().map(|&(a, b)| &points[a..b])))
    })
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
        if let Some(part) = clipped_moments(c, n, d) {
            m.add(part);
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
            for f in b.faces.iter() {
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

/// Join coplanar patches only when their convex hull has exactly their combined
/// area. This removes tessellation seams without filling a dent or an opening.
pub fn merge_patches(mut patches: Vec<Polygon>) -> Vec<Polygon> {
    loop {
        let mut joined = None;
        'search: for i in 0..patches.len() {
            for j in 0..i {
                let n = normal(&patches[i]);
                if dot(n, normal(&patches[j])) < 1. - EPS
                    || patches[j]
                        .iter()
                        .any(|p| dot(n, sub(*p, patches[i][0])).abs() > EPS)
                {
                    continue;
                }
                let u = normalize(sub(patches[i][1], patches[i][0]));
                let v = cross(n, u);
                let mut points = patches[i].clone();
                points.extend_from_slice(&patches[j]);
                points.sort_by(|a, b| {
                    dot(*a, u)
                        .total_cmp(&dot(*b, u))
                        .then(dot(*a, v).total_cmp(&dot(*b, v)))
                });
                points.dedup_by(|a, b| length(sub(*a, *b)) < EPS);
                let mut hull: Vec<Vec3> = vec![];
                for p in &points {
                    while hull.len() > 1
                        && dot(
                            cross(
                                sub(hull[hull.len() - 1], hull[hull.len() - 2]),
                                sub(*p, hull[hull.len() - 1]),
                            ),
                            n,
                        ) <= EPS
                    {
                        hull.pop();
                    }
                    hull.push(*p);
                }
                let lower = hull.len();
                for p in points.iter().rev().skip(1) {
                    while hull.len() > lower
                        && dot(
                            cross(
                                sub(hull[hull.len() - 1], hull[hull.len() - 2]),
                                sub(*p, hull[hull.len() - 1]),
                            ),
                            n,
                        ) <= EPS
                    {
                        hull.pop();
                    }
                    hull.push(*p);
                }
                hull.pop();
                if (area(&hull) - area(&patches[i]) - area(&patches[j])).abs() < 1e-7 {
                    joined = Some((i, j, hull));
                    break 'search;
                }
            }
        }
        let Some((i, j, hull)) = joined else {
            break;
        };
        patches.remove(i);
        patches[j] = hull;
    }
    patches
}
/// Adjacent tetrahedra often form much larger convex cells. Remove only complete
/// shared faces, then prove every retained plane contains both operands.
pub fn coalesce_cells(mut cells: Vec<Cell>) -> Vec<Cell> {
    loop {
        let mut joined = None;
        'search: for i in 0..cells.len() {
            for j in 0..i {
                let mut faces = vec![];
                let mut shared = false;
                for (a, b) in [(&cells[i], &cells[j]), (&cells[j], &cells[i])] {
                    for f in a.faces.iter() {
                        let matches = b.faces.iter().any(|g| {
                            f.vertices.len() == g.vertices.len()
                                && dot(normal(&f.vertices), normal(&g.vertices)) < -1. + EPS
                                && f.vertices
                                    .iter()
                                    .all(|p| g.vertices.iter().any(|q| length(sub(*p, *q)) < EPS))
                        });
                        if matches {
                            shared = true;
                        } else {
                            faces.push(f.clone());
                        }
                    }
                }
                if !shared {
                    continue;
                }
                let points: Vec<_> = faces.iter().flat_map(|f| f.vertices.iter()).collect();
                if !faces.iter().all(|f| {
                    let n = normal(&f.vertices);
                    points.iter().all(|p| dot(n, sub(**p, f.vertices[0])) < EPS)
                }) {
                    continue;
                }
                let faces: Vec<_> = merge_patches(faces.into_iter().map(|f| f.vertices).collect())
                    .into_iter()
                    .map(|vertices| ConvexVolumeFacesItem { vertices })
                    .collect();
                joined = Some((i, j, Cell { faces: faces.into() }));
                break 'search;
            }
        }
        let Some((i, j, cell)) = joined else {
            break;
        };
        cells.remove(i);
        cells[j] = cell;
    }
    cells
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prepared_subtraction_matches_original_cutter_order_and_geometry() {
        for step in 0..24 {
            let subjects = vec![box_cell([0.; 3], [4.; 3]), box_cell([6., 0., 0.], [3.; 3])];
            let cutters: Vec<_> = (0..8).map(|i| transform(&box_cell([0.; 3], [1., 5., 2.]),
                [i as f64 - 2., 0., (step % 3) as f64 * 0.1], [1.; 3], step as f64 * 0.13)).collect();
            let mut reference = subjects.clone();
            for cutter in &cutters {
                reference = reference.iter().flat_map(|cell| subtract(cell, cutter)).collect();
                check_budget(&reference).unwrap();
            }
            let actual = subtract_all(subjects, &cutters).unwrap();
            assert_eq!(serde_json::to_value(actual).unwrap(), serde_json::to_value(reference).unwrap());
        }
    }
    #[test]
    fn geometry_budget_reports_actual_cell_and_face_counts() {
        // Budget validation is independent of geometric validity; empty cells
        // keep this boundary test small while exercising the real collection cap.
        let mut cells = vec![Cell { faces: vec![].into() }; MAX_CELLS];
        assert!(check_budget(&cells).is_ok());
        cells.push(Cell { faces: vec![].into() });
        let error = check_budget(&cells).unwrap_err();
        assert!(error.contains(&format!("{} / {MAX_CELLS} convex cells", MAX_CELLS + 1)));
        let mut cell = box_cell([0.; 3], [1.; 3]);
        let mut faces = cell.faces.to_vec();
        faces.resize(MAX_CELL_FACES + 1, cell.faces[0].clone());
        cell.faces = faces.into();
        assert!(
            check_budget(&[cell])
                .unwrap_err()
                .contains("129 / 128 maximum faces per cell")
        );
    }
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
        assert!(
            intersection(&a, &b).is_none(),
            "walls have no physical contact"
        );
        let remainder = subtract(&a, &b);
        assert_eq!(remainder.len(), 1, "unrelated planes must not split a wall");
        near(total(&remainder).volume, 1.);
        for face in a.faces.iter() {
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
