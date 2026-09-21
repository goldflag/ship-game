//! Broad phase for fixed armor. Moving gun plates retain their live pose check.
use crate::definition::{Armor, Vec3};

#[derive(Clone, Debug)]
struct Node {
    low: Vec3,
    high: Vec3,
    ids: Vec<usize>,
    children: Option<Box<[Node; 2]>>,
}
impl Node {
    fn new(armor: &[Armor], mut ids: Vec<usize>) -> Self {
        let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for &i in &ids {
            for axis in 0..3 {
                // Match the padded box used by plate_hit. Keeping extrema
                // directly avoids shrinking a union by center/size rounding.
                let half = (armor[i].size[axis] + 2e-5) / 2.;
                low[axis] = low[axis].min(armor[i].center[axis] - half);
                high[axis] = high[axis].max(armor[i].center[axis] + half);
            }
        }
        let children = if ids.len() > 12 {
            let axis = (0..3)
                .max_by(|&a, &b| (high[a] - low[a]).total_cmp(&(high[b] - low[b])))
                .unwrap();
            ids.sort_unstable_by(|&a, &b| armor[a].center[axis].total_cmp(&armor[b].center[axis]));
            let right = ids.split_off(ids.len() / 2);
            Some(Box::new([
                Self::new(armor, std::mem::take(&mut ids)),
                Self::new(armor, right),
            ]))
        } else {
            None
        };
        Self {
            low,
            high,
            ids,
            children,
        }
    }
    fn query(&self, low: Vec3, high: Vec3, out: &mut Vec<usize>) {
        if (0..3).any(|a| self.high[a] < low[a] || self.low[a] > high[a]) {
            return;
        }
        if let Some(children) = &self.children {
            children[0].query(low, high, out);
            children[1].query(low, high, out);
        } else {
            out.extend_from_slice(&self.ids);
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct ArmorIndex {
    pointer: usize,
    len: usize,
    fixed: Option<Node>,
    moving: Vec<usize>,
}
impl ArmorIndex {
    pub fn new(armor: &[Armor]) -> Option<Self> {
        if armor.len() < 64 {
            return None;
        }
        let (moving, fixed): (Vec<_>, Vec<_>) = (0..armor.len()).partition(|&i| {
            armor[i]
                .plate
                .as_ref()
                .is_some_and(|p| p.mount_id.is_some())
        });
        Some(Self {
            pointer: armor.as_ptr() as usize,
            len: armor.len(),
            fixed: (!fixed.is_empty()).then(|| Node::new(armor, fixed)),
            moving,
        })
    }
    pub fn matches(&self, armor: &[Armor]) -> bool {
        self.pointer == armor.as_ptr() as usize && self.len == armor.len()
    }
    pub fn query(&self, from: Vec3, to: Vec3) -> Vec<usize> {
        // segment_box accepts a 1e-9 parameter overlap and nearly parallel
        // endpoints. Enclose that tolerance as well as the literal segment.
        let pad: Vec3 = std::array::from_fn(|a| 1e-8 + (to[a] - from[a]).abs() * 2e-9);
        let low = std::array::from_fn(|a| from[a].min(to[a]) - pad[a]);
        let high = std::array::from_fn(|a| from[a].max(to[a]) + pad[a]);
        let mut out = self.moving.clone();
        if let Some(fixed) = &self.fixed {
            fixed.query(low, high, &mut out);
        }
        // Preserve authoring order, including ties before the final hit sort.
        out.sort_unstable();
        out
    }
}
