//! Compile-time propeller routing and power. Battle machinery consumes the frozen groups.
use crate::construction::warn;
use crate::definition::{
    ConstructionDiagnostic, ConstructionEquipment, ConstructionEquipmentPart,
    ConstructionPropellerAssignment, ConstructionResult, MachineryRating, PropulsionGroup,
    SharedExhaust, ShipDefinition, ShipDefinitionPropulsion,
};

type Fitting<'a> = (&'a ConstructionEquipment, &'a ConstructionEquipmentPart);

/// Freeze machinery groups and report incomplete propulsion after fitting validation.
/// Returns effective shaft power for the compiler's final loading estimate.
pub(crate) fn install(
    fitted: &[Fitting<'_>],
    def: &mut ShipDefinition,
    out: &mut ConstructionResult,
) -> f64 {
    let assignments = assignments(fitted);
    out.propeller_assignments = Some(assignments.clone());
    let mut power = 0.;
    let mut groups = vec![];
    let engine_count = fitted.iter().filter(|(_, p)| p.kind == "engine").count();
    if engine_count == 0 {
        let mut missing = vec!["engine"];
        for kind in ["funnel", "propeller"] {
            if !fitted.iter().any(|(_, p)| p.kind == kind) {
                missing.push(kind);
            }
        }
        warn(
            out,
            "unpowered",
            &format!(
                "No propulsion: missing {}. Add the missing equipment; funnels supply shared exhaust capacity and propellers connect to powered engines automatically. Sea trial is still available, but the ship cannot propel itself.",
                missing.join(", ")
            ),
        );
    }
    let funnels: Vec<_> = fitted.iter().filter(|(_, p)| p.kind == "funnel").collect();
    let shared_exhaust = SharedExhaust {
        engines: fitted
            .iter()
            .filter(|(_, p)| p.kind == "engine" && p.power_kw.unwrap_or(0.) > 0.)
            .map(|(e, p)| MachineryRating {
                id: e.id.clone(),
                kw: p.power_kw.unwrap_or(0.),
            })
            .collect(),
        funnels: funnels
            .iter()
            .map(|(e, p)| MachineryRating {
                id: e.id.clone(),
                kw: p.exhaust_kw.unwrap_or(0.),
            })
            .collect(),
    };
    let exhaust: f64 = shared_exhaust.funnels.iter().map(|f| f.kw).sum();
    let demand: f64 = shared_exhaust.engines.iter().map(|e| e.kw).sum();
    let supply = crate::construction_services::exhaust_fraction(exhaust, demand);
    if exhaust > 0. && exhaust < demand {
        warn(
            out,
            "exhaust-capacity",
            &format!(
                "Insufficient exhaust capacity: {exhaust:.0} kW available for {demand:.0} kW of engines. Add another funnel or use a higher-capacity funnel. Propulsion is limited; sea trial is still available."
            ),
        );
    }
    for (engine, part) in fitted.iter().filter(|(_, p)| p.kind == "engine") {
        let props: Vec<_> = fitted
            .iter()
            .filter(|(e, p)| {
                p.kind == "propeller"
                    && assignments
                        .iter()
                        .any(|a| a.propeller_id == e.id && a.engine_id == engine.id)
            })
            .collect();
        let rated = part.power_kw.unwrap_or(0.);
        let mut reasons: Vec<String> = vec![];
        if funnels.is_empty() {
            reasons.push(
                "Missing funnel. Add a funnel in Fittings to provide shared exhaust capacity"
                    .into(),
            );
        }
        if props.is_empty() {
            reasons.push(if fitted.iter().any(|(_, p)| p.kind == "propeller") {
                "No propeller assigned to this engine. Set a propeller to Automatic to share it, choose this engine in its Engine setting, or add another propeller".into()
            } else {
                "Missing propeller. Add a propeller in Fittings; its engine is assigned automatically".into()
            });
        }
        if rated == 0. {
            reasons.push(
                "This engine has no rated power. Replace it with an engine that supplies power"
                    .into(),
            );
        }
        if !funnels.is_empty() {
            if exhaust == 0. {
                reasons.push("Funnels have no exhaust capacity. Replace them with a funnel that provides exhaust capacity".into());
            } else if rated > 0. && supply <= crate::construction_services::AUXILIARY_POWER_SHARE {
                reasons.push("Shared exhaust capacity is too low to power propulsion after auxiliary services. Add another funnel or use a higher-capacity funnel".into());
            }
        }
        if !reasons.is_empty() {
            out.diagnostics.push(ConstructionDiagnostic {
                severity: "warning".into(),
                code: "unpowered".into(),
                message: format!("Engine {} has no propulsion: {}. Sea trial is still available, but this engine provides no thrust.", engine.id, reasons.join(". ")),
                source_id: Some(engine.id.clone()),
                ..Default::default()
            });
            continue;
        }
        let efficiency = props
            .iter()
            .map(|(_, p)| p.thrust_efficiency.unwrap_or(0.6).clamp(0.01, 1.))
            .sum::<f64>()
            / props.len() as f64;
        let kw = (rated * (supply - crate::construction_services::AUXILIARY_POWER_SHARE)).max(0.)
            * efficiency;
        if kw == 0. {
            continue;
        }
        power += kw;
        groups.push(PropulsionGroup {
            id: engine.id.clone(),
            share: kw,
            boiler_ids: funnels.iter().map(|(e, _)| e.id.clone()).collect(),
            drive_ids: vec![engine.id.clone()],
            shaft_ids: props.iter().map(|(e, _)| e.id.clone()).collect(),
        });
    }
    for g in &mut groups {
        g.share /= power.max(1.);
    }
    def.propulsion = Some(ShipDefinitionPropulsion { groups, shared_exhaust: Some(shared_exhaust), basis: "Catalog power limited by shared funnel capacity, allocated in proportion to engine power, less 2% rated power reserved for included auxiliaries, then propeller efficiency; damaged or submerged funnels reduce shared capacity at runtime".into() });
    power
}

pub(crate) fn assignments(fitted: &[Fitting<'_>]) -> Vec<ConstructionPropellerAssignment> {
    let mut engines: Vec<_> = fitted
        .iter()
        .copied()
        .filter(|(_, p)| p.kind == "engine" && p.power_kw.unwrap_or(0.) > 0.)
        .collect();
    let mut props: Vec<_> = fitted
        .iter()
        .copied()
        .filter(|(_, p)| p.kind == "propeller")
        .collect();
    // Source-array order must never change a saved ship's machinery connections.
    engines.sort_by(|a, b| a.0.id.cmp(&b.0.id));
    props.sort_by(|a, b| a.0.id.cmp(&b.0.id));
    let mut result = Vec::new();
    let mut counts = vec![0; engines.len()];
    for (prop, _) in &props {
        if let Some(id) = &prop.power_source_id {
            result.push(ConstructionPropellerAssignment {
                propeller_id: prop.id.clone(),
                engine_id: id.clone(),
            });
            if let Some(i) = engines.iter().position(|(e, _)| e.id == *id) {
                counts[i] += 1;
            }
        }
    }
    props.retain(|(e, _)| e.power_source_id.is_none());
    if !props.is_empty() && !engines.is_empty() {
        // Cover unused engines first. Additional outlets follow rated power,
        // accounting for manual connections without ever moving those links.
        let mut slots: Vec<_> = counts
            .iter()
            .enumerate()
            .filter_map(|(i, n)| (*n == 0).then_some(i))
            .collect();
        for &i in &slots {
            counts[i] += 1;
        }
        let total_outlets = props.len()
            + result
                .iter()
                .filter(|a| engines.iter().any(|(e, _)| e.id == a.engine_id))
                .count();
        let total_power: f64 = engines.iter().map(|(_, p)| p.power_kw.unwrap()).sum();
        while slots.len() < props.len() {
            let mut best = 0;
            for i in 1..engines.len() {
                let capacity = |j: usize| {
                    total_outlets as f64 * engines[j].1.power_kw.unwrap() / total_power
                        - counts[j] as f64
                };
                let load = |j: usize| counts[j] as f64 / engines[j].1.power_kw.unwrap();
                if capacity(i) > capacity(best)
                    || (capacity(i) == capacity(best) && load(i) < load(best))
                {
                    best = i;
                }
            }
            slots.push(best);
            counts[best] += 1;
        }
        // Normalizing distance keeps preferences consistent at every ship scale.
        let distance = |a: &ConstructionEquipment, b: &ConstructionEquipment| {
            a.position
                .iter()
                .zip(b.position)
                .map(|(a, b)| (a - b).powi(2))
                .sum::<f64>()
                .sqrt()
        };
        let span = props
            .iter()
            .flat_map(|(p, _)| engines.iter().map(move |(e, _)| distance(p, e)))
            .fold(1., f64::max);
        let max_power = engines
            .iter()
            .map(|(_, p)| p.power_kw.unwrap())
            .fold(0., f64::max);
        let side = |x: f64| {
            if x < -0.05 {
                -1
            } else if x > 0.05 {
                1
            } else {
                0
            }
        };
        let route_cost = |prop: &ConstructionEquipment, i: usize| {
            let (engine, part) = engines[i];
            let across = side(prop.position[0]) * side(engine.position[0]) == -1;
            let behind = engine.position[2] > prop.position[2] + 0.05; // -Z is forward.
            4. * f64::from(across)
                + 2. * f64::from(behind)
                + distance(prop, engine) / span
                + 0.001 * (1. - part.power_kw.unwrap() / max_power)
        };
        let costs: Vec<Vec<_>> = props
            .iter()
            .map(|(prop, _)| slots.iter().map(|&i| route_cost(prop, i)).collect())
            .collect();
        for (i, slot) in minimum_assignment(&costs).into_iter().enumerate() {
            result.push(ConstructionPropellerAssignment {
                propeller_id: props[i].0.id.clone(),
                engine_id: engines[slots[slot]].0.id.clone(),
            });
        }
        // Remaining engines can share automatic propellers. Manual overrides
        // stay exclusive. Route larger engines first; favor less loaded shafts
        // within the same side/forward preferences used for the initial match.
        let mut spare: Vec<_> = (0..engines.len())
            .filter(|&i| !result.iter().any(|a| a.engine_id == engines[i].0.id))
            .collect();
        spare.sort_by(|&a, &b| {
            engines[b]
                .1
                .power_kw
                .unwrap()
                .total_cmp(&engines[a].1.power_kw.unwrap())
                .then_with(|| engines[a].0.id.cmp(&engines[b].0.id))
        });
        let mut loads: Vec<f64> = props
            .iter()
            .map(|(prop, _)| {
                result
                    .iter()
                    .filter(|a| a.propeller_id == prop.id)
                    .map(|a| {
                        let (_, engine) =
                            engines.iter().find(|(e, _)| e.id == a.engine_id).unwrap();
                        engine.power_kw.unwrap()
                            / result.iter().filter(|b| b.engine_id == a.engine_id).count() as f64
                    })
                    .sum()
            })
            .collect();
        for i in spare {
            let best = (0..props.len())
                .min_by(|&a, &b| {
                    let cost = |j: usize| route_cost(props[j].0, i) + loads[j] / total_power;
                    cost(a)
                        .total_cmp(&cost(b))
                        .then_with(|| props[a].0.id.cmp(&props[b].0.id))
                })
                .unwrap();
            loads[best] += engines[i].1.power_kw.unwrap();
            result.push(ConstructionPropellerAssignment {
                propeller_id: props[best].0.id.clone(),
                engine_id: engines[i].0.id.clone(),
            });
        }
    }
    result.sort_by(|a, b| {
        a.propeller_id
            .cmp(&b.propeller_id)
            .then_with(|| a.engine_id.cmp(&b.engine_id))
    });
    result
}

/// Rectangular Hungarian assignment (rows <= columns), bounded by MAX_EQUIPMENT.
/// Resolves the whole layout together, avoiding a greedy centerline propeller
/// taking the only sensible engine for a later outboard propeller.
fn minimum_assignment(cost: &[Vec<f64>]) -> Vec<usize> {
    let n = cost.len();
    let m = cost[0].len();
    let (mut u, mut v) = (vec![0.; n + 1], vec![0.; m + 1]);
    let (mut owner, mut previous) = (vec![0; m + 1], vec![0; m + 1]);
    for row in 1..=n {
        owner[0] = row;
        let mut column = 0;
        let mut slack = vec![f64::INFINITY; m + 1];
        let mut used = vec![false; m + 1];
        loop {
            used[column] = true;
            let current = owner[column];
            let mut delta = f64::INFINITY;
            let mut next = 0;
            for j in 1..=m {
                if !used[j] {
                    let candidate = cost[current - 1][j - 1] - u[current] - v[j];
                    if candidate < slack[j] {
                        slack[j] = candidate;
                        previous[j] = column;
                    }
                    if slack[j] < delta {
                        delta = slack[j];
                        next = j;
                    }
                }
            }
            for j in 0..=m {
                if used[j] {
                    u[owner[j]] += delta;
                    v[j] -= delta;
                } else {
                    slack[j] -= delta;
                }
            }
            column = next;
            if owner[column] == 0 {
                break;
            }
        }
        loop {
            let next = previous[column];
            owner[column] = owner[next];
            column = next;
            if column == 0 {
                break;
            }
        }
    }
    let mut selected = vec![0; n];
    for j in 1..=m {
        if owner[j] > 0 {
            selected[owner[j] - 1] = j - 1;
        }
    }
    selected
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    type Engine<'a> = (&'a str, f64, f64, f64);
    type Prop<'a> = (&'a str, f64, f64, Option<&'a str>);

    fn links(engines: &[Engine<'_>], props: &[Prop<'_>]) -> Vec<ConstructionPropellerAssignment> {
        let owned: Vec<_> = engines
            .iter()
            .map(|&(id, x, z, kw)| {
                (
                    ConstructionEquipment {
                        id: id.into(),
                        position: [x, 0., z],
                        ..Default::default()
                    },
                    ConstructionEquipmentPart {
                        kind: "engine".into(),
                        power_kw: Some(kw),
                        ..Default::default()
                    },
                )
            })
            .chain(props.iter().map(|&(id, x, z, manual)| {
                (
                    ConstructionEquipment {
                        id: id.into(),
                        position: [x, 0., z],
                        power_source_id: manual.map(str::to_owned),
                        ..Default::default()
                    },
                    ConstructionEquipmentPart {
                        kind: "propeller".into(),
                        ..Default::default()
                    },
                )
            }))
            .collect();
        assignments(&owned.iter().map(|(e, p)| (e, p)).collect::<Vec<_>>())
    }

    // Convenience for fixtures with one engine per propeller.
    fn assign(engines: &[Engine<'_>], props: &[Prop<'_>]) -> BTreeMap<String, String> {
        links(engines, props)
            .into_iter()
            .map(|a| (a.propeller_id, a.engine_id))
            .collect()
    }

    #[test]
    fn paired_shafts_choose_their_side_regardless_of_source_order() {
        let engines = [("port", -3., 0., 1000.), ("starboard", 3., 0., 1000.)];
        let props = [
            ("port-prop", -3., 10., None),
            ("starboard-prop", 3., 10., None),
        ];
        let result = assign(&engines, &props);
        assert_eq!(result["port-prop"], "port");
        assert_eq!(result["starboard-prop"], "starboard");
        assert_eq!(
            result,
            assign(&[engines[1], engines[0]], &[props[1], props[0]])
        );
    }

    #[test]
    fn whole_layout_matching_preserves_the_outboard_engine() {
        // A centerline propeller must not steal the starboard engine merely
        // because it was considered first.
        let result = assign(
            &[("a-starboard", 2., 0., 1000.), ("b-port", -2., 0., 1000.)],
            &[("a-center", 0., 10., None), ("b-starboard", 2., 10., None)],
        );
        assert_eq!(result["a-center"], "b-port");
        assert_eq!(result["b-starboard"], "a-starboard");
    }

    #[test]
    fn spare_propellers_follow_power_and_manual_links_count_toward_allocation() {
        let engines = [("small", 0., 0., 1000.), ("large", 0., 0., 3000.)];
        let props: Vec<_> = ["a", "b", "c", "d", "e", "f"]
            .iter()
            .map(|&id| (id, 0., 10., None))
            .collect();
        let result = assign(&engines, &props);
        assert_eq!(result.values().filter(|e| *e == "small").count(), 2);
        assert_eq!(result.values().filter(|e| *e == "large").count(), 4);
        let result = assign(
            &engines,
            &[("a", -3., 10., Some("large")), ("b", 3., 10., None)],
        );
        assert_eq!(result["a"], "large");
        assert_eq!(result["b"], "small"); // Cover the unused engine.
        assert_eq!(links(&engines, &[("only", 0., 10., None)]).len(), 2);
    }

    #[test]
    fn one_engine_shares_all_props_zero_power_is_excluded_and_ties_are_stable() {
        let props = [("a", -2., 10., None), ("b", 2., 10., None)];
        assert!(assign(&[], &props).is_empty());
        assert!(assign(&[("dead", 0., 0., 0.)], &props).is_empty());
        let result = assign(&[("working", 0., 0., 1000.), ("dead", 0., 0., 0.)], &props);
        assert_eq!(result.len(), 2);
        assert!(result.values().all(|e| e == "working"));
        // Explicit overrides remain explicit even when the chosen engine has no power.
        assert_eq!(
            assign(&[("dead", 0., 0., 0.)], &[("a", 0., 0., Some("dead"))])["a"],
            "dead"
        );
        assert_eq!(
            assign(&[("z", 0., 0., 1.), ("a", 0., 0., 1.)], &props)["a"],
            "a"
        );
    }

    #[test]
    fn extra_engines_share_automatic_props_and_preserve_manual_exclusivity() {
        let engines = [
            ("p1", -3., 0., 1000.),
            ("p2", -3., 1., 1000.),
            ("s1", 3., 0., 1000.),
            ("s2", 3., 1., 1000.),
        ];
        let props = [("port", -3., 10., None), ("starboard", 3., 10., None)];
        let pairs = |engines: &[Engine<'_>], props: &[Prop<'_>]| {
            links(engines, props)
                .into_iter()
                .map(|a| (a.propeller_id, a.engine_id))
                .collect::<Vec<_>>()
        };
        let expected = vec![
            ("port".into(), "p1".into()),
            ("port".into(), "p2".into()),
            ("starboard".into(), "s1".into()),
            ("starboard".into(), "s2".into()),
        ];
        assert_eq!(pairs(&engines, &props), expected);
        assert_eq!(
            pairs(
                &[engines[3], engines[1], engines[0], engines[2]],
                &[props[1], props[0]]
            ),
            expected
        );
        let one = pairs(&engines, &[props[0]]);
        assert_eq!(one.len(), 4);
        assert!(one.iter().all(|(p, _)| p == "port"));
        let manual = pairs(&engines, &[("port", -3., 10., Some("p1")), props[1]]);
        assert_eq!(manual.iter().filter(|(p, _)| p == "port").count(), 1);
        assert_eq!(manual.iter().filter(|(p, _)| p == "starboard").count(), 3);
        assert_eq!(pairs(&engines, &[("port", -3., 10., Some("p1"))]).len(), 1);
        let centered = [
            ("a", 0., 0., 1000.),
            ("b", 0., 0., 1000.),
            ("c", 0., 0., 1000.),
            ("d", 0., 0., 1000.),
            ("e", 0., 0., 1000.),
        ];
        let balanced = pairs(&centered, &[("p", 0., 10., None), ("s", 0., 10., None)]);
        assert_eq!(balanced.iter().filter(|(p, _)| p == "p").count(), 3);
        assert_eq!(balanced.iter().filter(|(p, _)| p == "s").count(), 2);
    }

    #[test]
    fn matching_agrees_with_brute_force_for_small_rectangular_layouts() {
        fn brute(cost: &[Vec<f64>], row: usize, used: u32) -> f64 {
            if row == cost.len() {
                return 0.;
            }
            (0..cost[0].len())
                .filter(|&j| used & (1 << j) == 0)
                .map(|j| cost[row][j] + brute(cost, row + 1, used | (1 << j)))
                .fold(f64::INFINITY, f64::min)
        }
        for seed in 0..20 {
            let costs: Vec<Vec<_>> = (0..4)
                .map(|i| {
                    (0..6)
                        .map(|j| ((seed * 7 + i * 13 + j * 17 + i * j * 3) % 29) as f64 / 29.)
                        .collect()
                })
                .collect();
            let selected = minimum_assignment(&costs);
            let actual: f64 = selected.iter().enumerate().map(|(i, &j)| costs[i][j]).sum();
            assert!((actual - brute(&costs, 0, 0)).abs() < 1e-9);
        }
    }
}
