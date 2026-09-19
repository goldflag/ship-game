use crate::{
    definition::{Hull, Vec3},
    geometry::*,
    hull::hull_section,
    structure::bounds,
};
#[derive(Clone, Debug)]
struct Triangle {
    a: Vec3,
    b: Vec3,
    c: Vec3,
    index: usize,
    center: Vec3,
}
#[derive(Clone, Debug)]
pub struct HullContacts {
    center: Vec3,
    size: Vec3,
    triangles: Vec<Triangle>,
    children: Vec<HullContacts>,
    /// Built by the root on its first lane check; empty everywhere else.
    lane: std::sync::OnceLock<Lane>,
}
/// The firing-lane index. A constructed hull's surfaces are fans over whole
/// deck and side polygons, so its triangles are long, their boxes overlap, and
/// a lane through the tree above reaches most of it. Here each triangle is cut
/// into fragments a few metres across and the tree bounds those. A fragment only
/// says where to look: reaching one tests the triangle it came from with
/// `HullContacts::crossing`, the same test on the same triangle, so the answer
/// is the one the full tree gives.
#[derive(Clone, Debug)]
struct Lane {
    triangles: Vec<Triangle>,
    nodes: Vec<LaneNode>,
    /// Leaf contents: indices into `triangles`, distinct within a leaf.
    parents: Vec<u32>,
}
#[derive(Clone, Debug)]
struct LaneNode {
    center: Vec3,
    size: Vec3,
    /// A leaf holds `parents[first..first + count]`; an inner node has no count,
    /// its first child follows it and `first` is its second.
    first: u32,
    count: u32,
}
/// Longest fragment edge. Shorter buys little: the lane is a line, and what it
/// passes within a few metres of is mostly what it has to test anyway.
const FRAGMENT_M: f64 = 6.0;
impl Lane {
    fn new(root: &HullContacts) -> Self {
        fn gather(node: &HullContacts, out: &mut Vec<Triangle>) {
            out.extend(node.triangles.iter().cloned());
            for child in &node.children {
                gather(child, out);
            }
        }
        fn cut(t: [Vec3; 3], parent: u32, depth: u32, out: &mut Vec<(Vec3, Vec3, u32)>) {
            let edges = [(0, 1), (1, 2), (2, 0)];
            let (i, j) = edges
                .into_iter()
                .max_by(|a, b| length(sub(t[a.0], t[a.1])).total_cmp(&length(sub(t[b.0], t[b.1]))))
                .unwrap();
            if depth >= 12 || length(sub(t[i], t[j])) <= FRAGMENT_M {
                let (center, size) = bounds(t.into_iter());
                out.push((center, size, parent));
                return;
            }
            let middle = scale(add(t[i], t[j]), 0.5);
            let k = 3 - i - j;
            cut([t[i], middle, t[k]], parent, depth + 1, out);
            cut([middle, t[j], t[k]], parent, depth + 1, out);
        }
        let mut triangles = vec![];
        gather(root, &mut triangles);
        let mut fragments = vec![];
        for (parent, t) in triangles.iter().enumerate() {
            cut([t.a, t.b, t.c], parent as u32, 0, &mut fragments);
        }
        let mut lane = Self {
            triangles,
            nodes: vec![],
            parents: vec![],
        };
        if !fragments.is_empty() {
            lane.build(&mut fragments);
        }
        lane
    }
    fn build(&mut self, fragments: &mut [(Vec3, Vec3, u32)]) -> u32 {
        let (center, size) = bounds(fragments.iter().flat_map(|f| {
            [
                std::array::from_fn(|a| f.0[a] - f.1[a] / 2.0),
                std::array::from_fn(|a| f.0[a] + f.1[a] / 2.0),
            ]
        }));
        let index = self.nodes.len() as u32;
        self.nodes.push(LaneNode {
            center,
            size,
            first: 0,
            count: 0,
        });
        if fragments.len() <= 8 {
            let mut parents: Vec<u32> = fragments.iter().map(|f| f.2).collect();
            parents.sort_unstable();
            parents.dedup();
            self.nodes[index as usize].first = self.parents.len() as u32;
            self.nodes[index as usize].count = parents.len() as u32;
            self.parents.extend(parents);
            return index;
        }
        let axis = (0..3).max_by(|&a, &b| size[a].total_cmp(&size[b])).unwrap();
        fragments.sort_by(|a, b| a.0[axis].total_cmp(&b.0[axis]).then(a.2.cmp(&b.2)));
        let (left, right) = fragments.split_at_mut(fragments.len() / 2);
        self.build(left);
        let second = self.build(right);
        self.nodes[index as usize].first = second;
        index
    }
    fn blocks(&self, from: Vec3, direction: Vec3, inverse: Vec3) -> bool {
        if self.nodes.is_empty() {
            return false;
        }
        // Median splits keep the tree a few dozen levels deep at most.
        let mut stack = [0u32; 128];
        let mut depth = 1;
        while depth > 0 {
            depth -= 1;
            let at = stack[depth] as usize;
            let node = &self.nodes[at];
            if !reached(node.center, node.size, from, direction, inverse) {
                continue;
            }
            if node.count > 0 {
                let leaf = node.first as usize..(node.first + node.count) as usize;
                if self.parents[leaf].iter().any(|&t| {
                    HullContacts::crossing(&self.triangles[t as usize], from, direction).is_some()
                }) {
                    return true;
                }
            } else if depth + 2 <= stack.len() {
                stack[depth] = node.first;
                stack[depth + 1] = at as u32 + 1;
                depth += 2;
            } else {
                // Deeper than any hull should be: fall back to the whole list.
                return self
                    .triangles
                    .iter()
                    .any(|t| HullContacts::crossing(t, from, direction).is_some());
            }
        }
        false
    }
}
/// A slab test that only ever errs towards visiting. Nodes merely bound the
/// triangles that decide the answer, and an accepted crossing lies within a few
/// hundredths of a millimetre of its triangle, so a tenth of a millimetre of
/// padding keeps every node that could hold one while one reciprocal per lane
/// replaces six divisions per node.
pub(crate) fn reached(
    center: Vec3,
    size: Vec3,
    from: Vec3,
    direction: Vec3,
    inverse: Vec3,
) -> bool {
    let (mut enter, mut exit) = (0.0_f64, 1.0_f64);
    for axis in 0..3 {
        let half = size[axis] / 2.0 + 1e-4;
        let (low, high) = (center[axis] - half, center[axis] + half);
        if direction[axis].abs() < 1e-10 {
            if from[axis] < low || from[axis] > high {
                return false;
            }
            continue;
        }
        let a = (low - from[axis]) * inverse[axis];
        let b = (high - from[axis]) * inverse[axis];
        enter = enter.max(a.min(b));
        exit = exit.min(a.max(b));
    }
    enter <= exit + 1e-6
}
#[derive(Clone, Debug, serde::Serialize)]
pub struct HullContact {
    pub t: f64,
    pub point: Vec3,
    pub normal: Vec3,
    pub index: usize,
}
struct Edge {
    low: f64,
    high: f64,
    polygon: Vec<[f64; 2]>,
    fractions: Vec<f64>,
}
fn edge(h: &Hull, station: f64) -> Edge {
    let polygon = hull_section(h, station);
    let low = polygon.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
    let high = polygon
        .iter()
        .map(|p| p[1])
        .fold(f64::NEG_INFINITY, f64::max);
    let fractions = polygon
        .iter()
        .map(|p| (p[1] - low) / if high == low { 1.0 } else { high - low })
        .collect();
    Edge {
        low,
        high,
        polygon,
        fractions,
    }
}
fn point(h: &Hull, s: &Edge, station: f64, f: f64, sign: f64) -> Vec3 {
    let y = s.low + (s.high - s.low) * f;
    let mut width: f64 = 0.0;
    for i in 0..s.polygon.len() {
        let a = s.polygon[i];
        let b = s.polygon[(i + 1) % s.polygon.len()];
        if y < a[1].min(b[1]) - 1e-7 || y > a[1].max(b[1]) + 1e-7 {
            continue;
        }
        let x = if (b[1] - a[1]).abs() < 1e-9 {
            a[0].max(b[0])
        } else {
            a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])
        };
        width = width.max(x);
    }
    [sign * width, y, h.length / 2.0 - station]
}
impl HullContacts {
    fn tree(mut ts: Vec<Triangle>) -> Self {
        let (center, size) = bounds(ts.iter().flat_map(|t| [t.a, t.b, t.c]));
        if ts.len() <= 12 {
            return Self {
                center,
                size,
                triangles: ts,
                children: vec![],
                lane: Default::default(),
            };
        }
        let mut axis = 0;
        for i in 1..3 {
            if size[i] > size[axis] {
                axis = i;
            }
        }
        ts.sort_by(|a, b| a.center[axis].total_cmp(&b.center[axis]));
        let tail = ts.split_off(ts.len() / 2);
        Self {
            center,
            size,
            triangles: vec![],
            children: vec![Self::tree(ts), Self::tree(tail)],
            lane: Default::default(),
        }
    }
    pub fn new(h: &Hull) -> Self {
        let mut stations = vec![0.0, h.length];
        stations.extend(h.half_breadths.iter().map(|p| p[0]));
        stations.extend(h.sections.iter().flatten().map(|s| s.station));
        stations.sort_by(f64::total_cmp);
        stations.dedup();
        let mut ts = vec![];
        let mut triangle = |a, b, c| {
            if length(cross(sub(b, a), sub(c, a))) > 1e-9 {
                ts.push(Triangle {
                    a,
                    b,
                    c,
                    index: ts.len(),
                    center: bounds([a, b, c].into_iter()).0,
                });
            }
        };
        if let Some(v) = &h.volume {
            for s in v
                .surfaces
                .iter()
                .filter(|s| !s.open && !crate::construction_installation::internal(s))
            {
                for i in 1..s.vertices.len() - 1 {
                    triangle(s.vertices[0], s.vertices[i], s.vertices[i + 1]);
                }
            }
            return Self::tree(ts);
        }
        for ss in stations.windows(2) {
            let (az, bz) = (ss[0], ss[1]);
            let (a, b) = (edge(h, az), edge(h, bz));
            let mut fs = vec![0.0, 1.0];
            fs.extend(&a.fractions);
            fs.extend(&b.fractions);
            fs.sort_by(f64::total_cmp);
            fs.dedup();
            for sign in [-1.0, 1.0] {
                for f in fs.windows(2) {
                    let (p, q, r, s) = (
                        point(h, &a, az, f[0], sign),
                        point(h, &a, az, f[1], sign),
                        point(h, &b, bz, f[1], sign),
                        point(h, &b, bz, f[0], sign),
                    );
                    triangle(p, q, r);
                    triangle(p, r, s);
                }
            }
            for f in [0.0, 1.0] {
                let (p, q, r, s) = (
                    point(h, &a, az, f, -1.0),
                    point(h, &a, az, f, 1.0),
                    point(h, &b, bz, f, 1.0),
                    point(h, &b, bz, f, -1.0),
                );
                triangle(p, q, r);
                triangle(p, r, s);
            }
        }
        for station in [0.0, h.length] {
            let polygon: Vec<_> = hull_section(h, station)
                .into_iter()
                .map(|p| [p[0], p[1], h.length / 2.0 - station])
                .collect();
            for i in 1..polygon.len() - 1 {
                triangle(polygon[0], polygon[i], polygon[i + 1]);
            }
        }
        Self::tree(ts)
    }
    pub fn query(&self, from: Vec3, to: Vec3) -> Vec<HullContact> {
        let mut result = vec![];
        self.visit(from, to, &mut result);
        result.sort_by(|a, b| a.t.total_cmp(&b.t));
        result
    }
    /// Whether `query` would return anything. A firing lane only asks that, so
    /// it stops at the first crossing and builds no contacts.
    pub fn blocks(&self, from: Vec3, to: Vec3) -> bool {
        let direction = sub(to, from);
        self.lane.get_or_init(|| Lane::new(self)).blocks(
            from,
            direction,
            direction.map(|d| 1.0 / d),
        )
    }
    /// Where along the segment it crosses the triangle, with its edge vectors.
    fn crossing(tri: &Triangle, from: Vec3, direction: Vec3) -> Option<(f64, Vec3, Vec3)> {
        let e1 = sub(tri.b, tri.a);
        let e2 = sub(tri.c, tri.a);
        let p = cross(direction, e2);
        let det = dot(e1, p);
        if det.abs() < 1e-9 {
            return None;
        }
        let offset = sub(from, tri.a);
        let u = dot(offset, p) / det;
        if !(-1e-7..=1.0 + 1e-7).contains(&u) {
            return None;
        }
        let q = cross(offset, e1);
        let v = dot(direction, q) / det;
        if v < -1e-7 || u + v > 1.0 + 1e-7 {
            return None;
        }
        let t = dot(e2, q) / det;
        if !(-1e-8..=1.0 + 1e-8).contains(&t) {
            return None;
        }
        Some((t, e1, e2))
    }
    fn visit(&self, from: Vec3, to: Vec3, result: &mut Vec<HullContact>) {
        if !segment_overlaps_box(from, to, self.center, self.size) {
            return;
        }
        for child in &self.children {
            child.visit(from, to, result);
        }
        let direction = sub(to, from);
        for tri in &self.triangles {
            let Some((t, e1, e2)) = Self::crossing(tri, from, direction) else {
                continue;
            };
            result.push(HullContact {
                t: t.max(0.0),
                point: add(from, scale(direction, t.max(0.0))),
                normal: normalize(cross(e1, e2)),
                index: tri.index,
            });
        }
    }
}
