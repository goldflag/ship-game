//! Routes through real coastlines: A* over the clearance nodes, then pulled
//! taut with `segment_clear`.
//!
//! A node is open when its exact clearance leaves the margin plus half the edge
//! to any neighbour, so every grid edge the search walks is itself clear; the
//! start and goal join the grid through straight legs that `segment_clear`
//! proves. Ties break on node index and the frontier is bounded, so a plan is
//! deterministic and its cost has a ceiling: the search first runs in a window
//! around the two ends, then over the whole chart, and gives up after
//! `EXPANSIONS` nodes in either. Channels narrower than about twice the margin
//! plus one node spacing are not planned through.
use super::{Heightfield, clearance::Clearance};
use std::{cmp::Reverse, collections::BinaryHeap};

/// Nodes expanded per search window before a plan gives up.
const EXPANSIONS: usize = 60_000;
/// Nodes on either side of a route end that may join it to the grid.
const JOIN_REACH: isize = 2;
/// The first window pads the two ends by this much, or half their distance.
const WINDOW_PAD_M: f64 = 3000.0;
const START: u32 = u32::MAX;

pub(super) fn plan(
    field: &Heightfield,
    grid: &Clearance,
    from: [f64; 2],
    to: [f64; 2],
    margin: f64,
) -> Option<Vec<[f64; 2]>> {
    if ![from[0], from[1], to[0], to[1], margin]
        .iter()
        .all(|v| v.is_finite())
    {
        return None;
    }
    if grid.segment_clear(field, from, to, margin) {
        return Some(vec![to]);
    }
    if grid.clearance(field, from[0], from[1]) < margin
        || grid.clearance(field, to[0], to[1]) < margin
    {
        return None;
    }
    let s = grid.spacing;
    let pad = WINDOW_PAD_M.max((to[0] - from[0]).hypot(to[1] - from[1]) / 2.0);
    let whole = [0, 0, grid.width - 1, grid.height - 1];
    let local = {
        let node = |v: f64, origin: f64, count: usize| {
            ((v - origin) / s).floor().clamp(0.0, (count - 1) as f64) as usize
        };
        [
            node(from[0].min(to[0]) - pad, field.origin_x, grid.width),
            node(from[1].min(to[1]) - pad, field.origin_z, grid.height),
            node(from[0].max(to[0]) + pad, field.origin_x, grid.width),
            node(from[1].max(to[1]) + pad, field.origin_z, grid.height),
        ]
    };
    let nodes = if local == whole {
        search(field, grid, from, to, margin, whole)
    } else {
        search(field, grid, from, to, margin, local)
            .or_else(|| search(field, grid, from, to, margin, whole))
    }?;
    // Pull the node chain taut: from each anchor, run to the furthest point the
    // straight leg still clears.
    let mut points = Vec::with_capacity(nodes.len() + 2);
    points.push(from);
    points.extend(nodes);
    points.push(to);
    let mut path = vec![];
    let mut anchor = 0;
    while anchor + 1 < points.len() {
        let mut next = anchor + 1;
        while next + 1 < points.len()
            && grid.segment_clear(field, points[anchor], points[next + 1], margin)
        {
            next += 1;
        }
        path.push(points[next]);
        anchor = next;
    }
    Some(path)
}

/// A* over the nodes of `window` ([a0, b0, a1, b1], inclusive). Returns the
/// node chain between the two ends, excluding them.
fn search(
    field: &Heightfield,
    grid: &Clearance,
    from: [f64; 2],
    to: [f64; 2],
    margin: f64,
    window: [usize; 4],
) -> Option<Vec<[f64; 2]>> {
    let s = grid.spacing;
    let [a0, b0, a1, b1] = window;
    let (w, h) = (a1 - a0 + 1, b1 - b0 + 1);
    let local = |n: usize| (n / grid.width - b0) * w + (n % grid.width - a0);
    let global = |l: usize| (l / w + b0) * grid.width + l % w + a0;
    // Open for straight edges; diagonals need the longer half edge at both ends.
    let straight = margin + s / 2.0;
    let diagonal = margin + s * std::f64::consts::FRAC_1_SQRT_2;
    let clearance = |l: usize| grid.at_node(field, global(l));
    let position = |l: usize| grid.node_position(field, global(l));
    let distance = |p: [f64; 2], q: [f64; 2]| (p[0] - q[0]).hypot(p[1] - q[1]);
    let near = |p: [f64; 2]| {
        let a = ((p[0] - field.origin_x) / s).round() as isize;
        let b = ((p[1] - field.origin_z) / s).round() as isize;
        let mut out = vec![];
        for db in -JOIN_REACH..=JOIN_REACH {
            for da in -JOIN_REACH..=JOIN_REACH {
                let (x, z) = (a + da, b + db);
                if x >= a0 as isize && x <= a1 as isize && z >= b0 as isize && z <= b1 as isize {
                    let l = local(z as usize * grid.width + x as usize);
                    if clearance(l) >= straight {
                        out.push(l);
                    }
                }
            }
        }
        out
    };
    let goals: Vec<(usize, f64)> = near(to)
        .into_iter()
        .filter(|&l| grid.segment_clear(field, position(l), to, margin))
        .map(|l| (l, distance(position(l), to)))
        .collect();
    if goals.is_empty() {
        return None;
    }
    let goal_leg = |l: usize| goals.iter().find(|(g, _)| *g == l).map(|(_, leg)| *leg);
    // Costs are kept in f32: nine bytes a node keeps a whole-chart search small.
    let mut cost = vec![f32::INFINITY; w * h];
    let mut parent = vec![START; w * h];
    let mut closed = vec![false; w * h];
    let mut frontier = BinaryHeap::new();
    let key = |f: f64| f.max(0.0).to_bits();
    for l in near(from) {
        if grid.segment_clear(field, from, position(l), margin) {
            let g = distance(from, position(l));
            if (g as f32) < cost[l] {
                cost[l] = g as f32;
                frontier.push(Reverse((key(g + distance(position(l), to)), l as u32)));
            }
        }
    }
    // The goal is a virtual node: its entry carries the index `w * h`.
    let goal = w * h;
    let mut best_goal = (f64::INFINITY, START);
    let mut expanded = 0;
    const STEPS: [(isize, isize); 8] = [
        (1, 0),
        (-1, 0),
        (0, 1),
        (0, -1),
        (1, 1),
        (-1, 1),
        (1, -1),
        (-1, -1),
    ];
    while let Some(Reverse((_, l))) = frontier.pop() {
        let l = l as usize;
        if l == goal {
            break;
        }
        if closed[l] {
            continue;
        }
        closed[l] = true;
        expanded += 1;
        if expanded > EXPANSIONS {
            return None;
        }
        let g = cost[l] as f64;
        if let Some(leg) = goal_leg(l)
            && g + leg < best_goal.0
        {
            best_goal = (g + leg, l as u32);
            frontier.push(Reverse((key(best_goal.0), goal as u32)));
        }
        let (x, z) = ((l % w) as isize, (l / w) as isize);
        let open = clearance(l);
        for (dx, dz) in STEPS {
            let (nx, nz) = (x + dx, z + dz);
            if nx < 0 || nz < 0 || nx >= w as isize || nz >= h as isize {
                continue;
            }
            let n = nz as usize * w + nx as usize;
            if closed[n] {
                continue;
            }
            let (need, step) = if dx != 0 && dz != 0 {
                (diagonal, s * std::f64::consts::SQRT_2)
            } else {
                (straight, s)
            };
            if open < need || clearance(n) < need {
                continue;
            }
            let next = g + step;
            if (next as f32) < cost[n] {
                cost[n] = next as f32;
                parent[n] = l as u32;
                frontier.push(Reverse((key(next + distance(position(n), to)), n as u32)));
            }
        }
    }
    if best_goal.1 == START {
        return None;
    }
    let mut chain = vec![];
    let mut l = best_goal.1;
    while l != START {
        chain.push(position(l as usize));
        l = parent[l as usize];
    }
    chain.reverse();
    Some(chain)
}
