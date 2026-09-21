//! Bounded, runtime-only merging across authored armor panel seams.
use super::{ContactKind, ShipContact, armor_index::ArmorIndex};
use crate::{
    construction_geometry as cg,
    definition::{Armor, ShipDefinition, Vec3},
    geometry::*,
    protection::{plate_hit, segment_plate},
    shell::Shell,
};
use std::collections::BTreeSet;

const DISTANCE_M: f64 = 0.02;
const ANGLE_COS: f64 = 0.9993908270190958; // two degrees
const EDGE_EPS: f64 = 1e-7;
const MAX_SOURCES: usize = 32;

#[cfg(test)]
mod tests;

#[derive(Clone)]
struct Patch {
    ids: Vec<usize>,
    vertices: Vec<Vec3>,
    center: Vec3,
    size: Vec3,
}

fn compatible(a: &Armor, b: &Armor) -> bool {
    let (Some(ap), Some(bp)) = (&a.plate, &b.plate) else {
        return false;
    };
    a.thickness_mm == b.thickness_mm
        && a.exterior == b.exterior
        && ap.material == bp.material
        && ap.exterior == bp.exterior
        && ap.mount_id == bp.mount_id
}

fn touching(a: &[Vec3], b: &[Vec3]) -> bool {
    for i in 0..a.len() {
        let (p, q) = (a[i], a[(i + 1) % a.len()]);
        let len = length(sub(q, p));
        if len <= EDGE_EPS {
            continue;
        }
        let axis = scale(sub(q, p), 1. / len);
        for j in 0..b.len() {
            let (r, s) = (sub(b[j], p), sub(b[(j + 1) % b.len()], p));
            if length(cross(axis, r)) > EDGE_EPS || length(cross(axis, s)) > EDGE_EPS {
                continue;
            }
            let (r, s) = (dot(axis, r), dot(axis, s));
            if r.max(s).min(len) - r.min(s).max(0.) > EDGE_EPS {
                return true;
            }
        }
    }
    false
}

fn convex_hull(mut points: Vec<Vec3>, normal: Vec3) -> Vec<Vec3> {
    let u = normalize(sub(points[1], points[0]));
    let v = cross(normal, u);
    points.sort_by(|a, b| {
        dot(*a, u)
            .total_cmp(&dot(*b, u))
            .then(dot(*a, v).total_cmp(&dot(*b, v)))
    });
    points.dedup_by(|a, b| length(sub(*a, *b)) < 1e-9);
    let mut hull: Vec<Vec3> = vec![];
    let turn = |a, b, c| dot(cross(sub(b, a), sub(c, b)), normal);
    for &p in &points {
        while hull.len() > 1 && turn(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 1e-12 {
            hull.pop();
        }
        hull.push(p);
    }
    let lower = hull.len();
    for &p in points.iter().rev().skip(1) {
        while hull.len() > lower && turn(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 1e-12 {
            hull.pop();
        }
        hull.push(p);
    }
    hull.pop();
    hull
}

fn join(a: &Patch, b: &Patch, armor: &[Armor]) -> Option<Patch> {
    if a.ids.len() + b.ids.len() > MAX_SOURCES || !compatible(&armor[a.ids[0]], &armor[b.ids[0]]) {
        return None;
    }
    let polygon = |i: usize| armor[i].plate.as_ref().unwrap().vertices.as_slice();
    if !a
        .ids
        .iter()
        .any(|&i| b.ids.iter().any(|&j| touching(polygon(i), polygon(j))))
    {
        return None;
    }
    let mut ids = a.ids.clone();
    ids.extend(&b.ids);
    ids.sort_unstable();
    for (i, &a) in ids.iter().enumerate() {
        if ids[..i]
            .iter()
            .any(|&b| dot(cg::normal(polygon(a)), cg::normal(polygon(b))) < ANGLE_COS)
        {
            return None;
        }
    }
    let mut normal = [0.; 3];
    let mut origin = [0.; 3];
    let mut area = 0.;
    for &i in &ids {
        let p = polygon(i);
        let weight = cg::area(p);
        normal = add(normal, scale(cg::normal(p), weight));
        origin = add(
            origin,
            scale(
                p.iter().copied().fold([0.; 3], add),
                weight / p.len() as f64,
            ),
        );
        area += weight;
    }
    if area <= 1e-9 {
        return None;
    }
    normal = normalize(normal);
    origin = scale(origin, 1. / area);
    let mut projected = vec![];
    for &i in &ids {
        let p = polygon(i);
        if dot(normal, cg::normal(p)) < ANGLE_COS
            || p.iter()
                .any(|&v| dot(normal, sub(v, origin)).abs() > DISTANCE_M)
        {
            return None;
        }
        projected.push(
            p.iter()
                .map(|&v| sub(v, scale(normal, dot(normal, sub(v, origin)))))
                .collect::<Vec<_>>(),
        );
    }
    // Overlapping plates may be separate armor layers; never collapse them.
    // The convex envelope may contain empty corners or holes. Source-footprint
    // checks in contacts keep those empty, after the shared plane was hit.
    for i in 0..projected.len() {
        for b in &projected[..i] {
            let mut overlap = projected[i].clone();
            for j in 0..b.len() {
                let side = normalize(cross(sub(b[(j + 1) % b.len()], b[j]), normal));
                overlap = cg::clip_polygon(&overlap, side, dot(side, b[j]));
                if overlap.len() < 3 {
                    break;
                }
            }
            if cg::area(&overlap) > 1e-9 {
                return None;
            }
        }
    }
    let vertices = convex_hull(projected.into_iter().flatten().collect(), normal);
    if vertices.len() < 3 {
        return None;
    }
    let (center, size) =
        crate::structure::bounds(ids.iter().flat_map(|&i| polygon(i).iter().copied()));
    Some(Patch {
        ids,
        vertices,
        center,
        size,
    })
}

#[derive(Clone, Debug)]
pub(super) struct SurfaceContacts {
    pointer: usize,
    len: usize,
    armor: Vec<Armor>,
    sources: Vec<Vec<usize>>,
    index: Option<ArmorIndex>,
    pub replaced: Vec<bool>,
}

impl SurfaceContacts {
    pub fn new(def: &ShipDefinition) -> Self {
        let protected: BTreeSet<_> = def
            .connections
            .iter()
            .filter_map(|c| c.armor_id.as_deref())
            .collect();
        let mut patches: Vec<Option<Patch>> = def
            .armor
            .iter()
            .enumerate()
            .map(|(i, a)| {
                let p = a.plate.as_ref()?;
                if def.construction.is_none()
                    || p.mount_id.is_some()
                    || p.vertices.len() < 3
                    || a.id.contains(":installation-")
                    || protected.contains(a.id.as_str())
                    || !p.vertices.iter().flatten().all(|x| x.is_finite())
                    || cg::area(&p.vertices) < 1e-9
                {
                    return None;
                }
                let (center, size) = crate::structure::bounds(p.vertices.iter().copied());
                Some(Patch {
                    ids: vec![i],
                    vertices: p.vertices.clone(),
                    center,
                    size,
                })
            })
            .collect();
        let mut neighbors = vec![BTreeSet::new(); patches.len()];
        let mut queue = BTreeSet::new();
        let mut order: Vec<_> = (0..patches.len())
            .filter(|&i| patches[i].is_some())
            .collect();
        order.sort_by(|&a, &b| {
            let a = patches[a].as_ref().unwrap();
            let b = patches[b].as_ref().unwrap();
            (a.center[2] - a.size[2] / 2.).total_cmp(&(b.center[2] - b.size[2] / 2.))
        });
        let mut active: Vec<usize> = vec![];
        let budget = def.armor.len().saturating_mul(128).min(500_000);
        let mut searches = budget;
        'scan: for i in order {
            let a = patches[i].as_ref().unwrap();
            active.retain(|&j| {
                let b = patches[j].as_ref().unwrap();
                b.center[2] + b.size[2] / 2. >= a.center[2] - a.size[2] / 2. - EDGE_EPS
            });
            for &j in &active {
                if searches == 0 {
                    break 'scan;
                }
                searches -= 1;
                let b = patches[j].as_ref().unwrap();
                if compatible(&def.armor[i], &def.armor[j])
                    && (0..3).all(|k| {
                        (a.center[k] - b.center[k]).abs() <= (a.size[k] + b.size[k]) / 2. + EDGE_EPS
                    })
                {
                    neighbors[i].insert(j);
                    neighbors[j].insert(i);
                    queue.insert((j.min(i), j.max(i)));
                }
            }
            active.push(i);
        }
        let mut attempts = budget;
        while let Some((a, b)) = queue.pop_first() {
            if attempts == 0 {
                break;
            }
            attempts -= 1;
            let (Some(left), Some(right)) = (&patches[a], &patches[b]) else {
                continue;
            };
            let Some(patch) = join(left, right, &def.armor) else {
                continue;
            };
            patches[a] = Some(patch);
            patches[b] = None;
            let moved = std::mem::take(&mut neighbors[b]);
            neighbors[a].extend(moved);
            neighbors[a].remove(&a);
            neighbors[a].remove(&b);
            let adjacent: Vec<_> = neighbors[a]
                .iter()
                .copied()
                .filter(|&i| patches[i].is_some())
                .collect();
            for i in adjacent {
                neighbors[i].remove(&b);
                neighbors[i].insert(a);
                if queue.len() < budget {
                    queue.insert((a.min(i), a.max(i)));
                }
            }
        }
        let mut armor = vec![];
        let mut sources = vec![];
        let mut replaced = vec![false; def.armor.len()];
        for patch in patches.into_iter().flatten().filter(|p| p.ids.len() > 1) {
            let mut proxy = def.armor[patch.ids[0]].clone();
            (proxy.center, proxy.size) = crate::structure::bounds(patch.vertices.iter().copied());
            proxy.plate.as_mut().unwrap().vertices = patch.vertices;
            for &i in &patch.ids {
                replaced[i] = true;
            }
            armor.push(proxy);
            sources.push(patch.ids);
        }
        let index = ArmorIndex::new(&armor, &[]);
        Self {
            pointer: def.armor.as_ptr() as usize,
            len: def.armor.len(),
            armor,
            sources,
            index,
            replaced,
        }
    }

    pub fn matches(&self, armor: &[Armor]) -> bool {
        self.pointer == armor.as_ptr() as usize && self.len == armor.len()
    }
    pub fn reduction(&self) -> usize {
        self.replaced.iter().filter(|&&v| v).count() - self.armor.len()
    }

    pub fn contacts(
        &self,
        shell: &Shell,
        from: Vec3,
        to: Vec3,
        ship: &str,
        def: &ShipDefinition,
        out: &mut Vec<ShipContact>,
    ) {
        let candidates = self
            .index
            .as_ref()
            .filter(|i| i.matches(&self.armor))
            .map(|i| i.query(from, to));
        for k in 0..candidates.as_ref().map_or(self.armor.len(), Vec::len) {
            let i = candidates.as_ref().map_or(k, |v| v[k]);
            let Some(hit) = plate_hit(from, to, &self.armor[i], def, &[]) else {
                continue;
            };
            // Project the hit back onto source panels for damage attribution.
            // This work happens only after a merged shape was actually hit.
            let offset = scale(hit.normal, DISTANCE_M + 0.001);
            let ids: Vec<_> = self.sources[i]
                .iter()
                .copied()
                .filter(|&j| {
                    segment_plate(
                        add(hit.point, offset),
                        sub(hit.point, offset),
                        &def.armor[j].plate.as_ref().unwrap().vertices,
                    )
                    .is_some()
                })
                .collect();
            let Some(&id) = ids.first() else { continue };
            let keys: Vec<_> = ids
                .iter()
                .map(|&j| format!("{ship}:armor:{}:plate", def.armor[j].id))
                .collect();
            if keys.iter().any(|k| shell.visited.contains(k)) {
                continue;
            }
            let mut contact =
                ShipContact::new(hit, keys[0].clone(), ContactKind::Armor, id as isize);
            contact.seam_keys.extend(keys.into_iter().skip(1));
            out.push(contact);
        }
    }
}
