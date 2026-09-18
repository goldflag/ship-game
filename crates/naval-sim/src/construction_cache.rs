//! Bounded, content-addressed CSG reuse across editor revisions. Only exact ordered
//! geometry is cached; validation, source identities and physical loading are rebuilt.
use crate::{construction_geometry as cg, definition::Vec3};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_ENTRIES: usize = 8192;
struct Entry { cells: Vec<cg::Cell>, bytes: usize, used: u64 }
#[derive(Default)]
pub(crate) struct GeometryCache {
    entries: HashMap<[u8; 32], Entry>,
    bytes: usize,
    revision: u64,
    pub hits: usize,
}

fn hash_cells(hash: &mut Sha256, cells: &[&cg::Cell]) {
    hash.update((cells.len() as u64).to_le_bytes());
    for cell in cells {
        hash.update((cell.faces.len() as u64).to_le_bytes());
        for face in cell.faces.iter() {
            hash.update((face.vertices.len() as u64).to_le_bytes());
            for vertex in &face.vertices {
                for n in vertex { hash.update(n.to_bits().to_le_bytes()); }
            }
        }
    }
}
fn stored_bytes(cells: &[cg::Cell]) -> usize {
    128 + cells.iter().map(|c| std::mem::size_of::<cg::Cell>() + c.faces.iter().map(|f|
        std::mem::size_of_val(f) + f.vertices.len() * std::mem::size_of::<Vec3>()
    ).sum::<usize>()).sum::<usize>()
}

impl GeometryCache {
    pub fn begin(&mut self) {
        self.revision += 1;
        self.hits = 0;
        // Keep only geometry used in the previous revision. Deleted/editing history
        // cannot grow the cache indefinitely, even below the hard memory bound.
        self.entries.retain(|_, e| e.used + 1 >= self.revision);
        self.bytes = self.entries.values().map(|e| e.bytes).sum();
    }

    pub fn subtract_all<'a>(&mut self, cells: Vec<cg::Cell>, cutters: impl IntoIterator<Item = &'a cg::Cell>) -> Result<Vec<cg::Cell>, String> {
        if cells.is_empty() { return Ok(cells); }
        let bounds = crate::structure::bounds(cells.iter().flat_map(|c| c.faces.iter().flat_map(|f| f.vertices.iter().copied())));
        // A remote block must not invalidate this operation. Removing disjoint
        // cutters is exact and keeps the order of every cutter that can matter.
        let cutters: Vec<_> = cutters.into_iter().filter(|b| {
            let (center, size) = cg::bounds(b);
            (0..3).all(|i| (center[i] - bounds.0[i]).abs() <= (size[i] + bounds.1[i]) * 0.5 + cg::EPS * 4.)
        }).collect();
        if cutters.is_empty() { cg::check_budget(&cells)?; return Ok(cells); }
        let mut hash = Sha256::new();
        hash_cells(&mut hash, &cells.iter().collect::<Vec<_>>());
        hash_cells(&mut hash, &cutters);
        let key: [u8; 32] = hash.finalize().into();
        if let Some(entry) = self.entries.get_mut(&key) {
            entry.used = self.revision;
            self.hits += 1;
            return Ok(entry.cells.clone());
        }
        let result = cg::subtract_all(cells, cutters)?;
        let bytes = stored_bytes(&result);
        if self.entries.len() < MAX_ENTRIES && self.bytes + bytes <= MAX_BYTES {
            self.bytes += bytes;
            self.entries.insert(key, Entry { cells: result.clone(), bytes, used: self.revision });
        }
        Ok(result)
    }

    pub fn union_near(&mut self, cells: &[cg::Cell], neighbors: &[Vec<usize>]) -> Result<Vec<cg::Cell>, String> {
        cg::union_near_with(cells, neighbors, |cell, out, cutters| {
            self.subtract_all(vec![cell.clone()], cutters.iter().map(|&k| &out[k]))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn equal(a: Vec<cg::Cell>, b: Vec<cg::Cell>) { assert_eq!(serde_json::to_value(a).unwrap(), serde_json::to_value(b).unwrap()); }
    #[test]
    fn reuse_is_exact_and_ignores_only_disjoint_cutters() {
        let a = cg::box_cell([0.; 3], [4.; 3]);
        let b = cg::box_cell([1., 0., 0.], [2.; 3]);
        let remote = cg::box_cell([20.; 3], [1.; 3]);
        let mut cache = GeometryCache::default(); cache.begin();
        let expected = cg::subtract_all(vec![a.clone()], [&b, &remote]).unwrap();
        equal(cache.subtract_all(vec![a.clone()], [&b, &remote]).unwrap(), expected.clone());
        cache.begin();
        equal(cache.subtract_all(vec![a.clone()], [&b]).unwrap(), expected);
        assert_eq!(cache.hits, 1);
        let moved = cg::box_cell([0.5, 0., 0.], [2.; 3]);
        equal(cache.subtract_all(vec![a.clone()], [&moved]).unwrap(), cg::subtract_all(vec![a], [&moved]).unwrap());
        assert_eq!(cache.hits, 1);
    }
    #[test]
    fn union_matches_stateless_geometry_through_add_remove_and_move() {
        let mut cache = GeometryCache::default();
        for offset in [1., 0.5, 1., 10., 1.] {
            let cells = vec![cg::box_cell([0.; 3], [4.; 3]), cg::box_cell([offset, 0., 0.], [2.; 3])];
            let neighbors = vec![vec![1], vec![0]];
            cache.begin();
            equal(cache.union_near(&cells, &neighbors).unwrap(), cg::union_near(&cells, &neighbors).unwrap());
        }
        cache.begin(); cache.begin();
        assert!(cache.entries.is_empty()); assert_eq!(cache.bytes, 0);
    }
}
