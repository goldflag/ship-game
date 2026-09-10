//! Bounded visual search history. Each cell records actual lookout eligibility
//! at its center and corners for a reference surface vessel, never a flight trail
//! or a promise that every possible target in that water would be detected.
use crate::{
    environment::{Island, TerrainField},
    rules::{TICK_RATE, TeamId},
    sensors::{
        ContactKind, VisualConditions, VisualEntity, VisualRules, line_visible,
        observation_strength,
    },
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

pub const CELL_SIZE_M: f64 = 1000.0;
pub const COVERAGE_INTERVAL: u64 = 5 * TICK_RATE;
const GRID_HALF: i32 = 32;
const MAX_OBSERVERS: usize = 64;
const MAX_PROBES: usize = 65_536;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ObservedCondition {
    #[ts(type = "number")]
    pub observed_tick: u64,
    pub fire: bool,
    pub heavy_smoke: bool,
    pub listing: bool,
    pub sinking: bool,
}

/// Private visible cues, with no internal durability or equipment information.
#[derive(Clone, Debug, Default)]
pub struct VisualCues {
    pub fire: Option<[f64; 3]>,
    pub smoke: Option<[f64; 3]>,
    pub listing: bool,
    pub sinking: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CoverageCell {
    pub x: f64,
    pub z: f64,
    #[ts(type = "number")]
    pub last_observed_tick: u64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum CoverageTarget {
    SurfaceVessel,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReconCoverage {
    pub cell_size_m: f64,
    pub target: CoverageTarget,
    pub reference_length_m: f64,
    pub reference_height_m: f64,
    #[ts(type = "number")]
    pub sample_interval_ticks: u64,
    pub cells: Vec<CoverageCell>,
}
#[derive(Default)]
pub struct CoverageGrid {
    cells: [BTreeMap<(i32, i32), u64>; 2],
    last_tick: Option<u64>,
}
impl CoverageGrid {
    pub fn snapshot(&self, team: TeamId) -> ReconCoverage {
        ReconCoverage {
            cell_size_m: CELL_SIZE_M,
            target: CoverageTarget::SurfaceVessel,
            reference_length_m: 100.0,
            reference_height_m: 5.0,
            sample_interval_ticks: COVERAGE_INTERVAL,
            cells: self.cells[team.index()]
                .iter()
                .map(|(&(x, z), &tick)| CoverageCell {
                    x: (x as f64 + 0.5) * CELL_SIZE_M,
                    z: (z as f64 + 0.5) * CELL_SIZE_M,
                    last_observed_tick: tick,
                })
                .collect(),
        }
    }
    pub fn update(
        &mut self,
        tick: u64,
        entities: &[VisualEntity],
        islands: &[Island],
        terrain: &[TerrainField],
        conditions: VisualConditions,
        rules: &VisualRules,
    ) {
        if self
            .last_tick
            .is_some_and(|last| tick.saturating_sub(last) < COVERAGE_INTERVAL)
        {
            return;
        }
        self.last_tick = Some(tick);
        for team in [TeamId::A, TeamId::B] {
            // Nearby formation members are redundant survey sources. Selecting
            // an actual observer can omit coverage but cannot invent visibility.
            let mut representatives = BTreeMap::<(i32, i32, i32), &VisualEntity>::new();
            for observer in entities
                .iter()
                .filter(|e| e.team == team && e.can_observe())
            {
                let key = (
                    (observer.eye[0] / CELL_SIZE_M).floor() as i32,
                    (observer.eye[2] / CELL_SIZE_M).floor() as i32,
                    (observer.eye[1] / 250.0).floor() as i32,
                );
                representatives
                    .entry(key)
                    .and_modify(|old| {
                        if observer.eye[1] > old.eye[1] {
                            *old = observer;
                        }
                    })
                    .or_insert(observer);
            }
            let observers: Vec<_> = representatives.into_values().collect();
            let mut probes = 0;
            'survey: for n in 0..observers.len().min(MAX_OBSERVERS) {
                let observer =
                    observers[(n + (tick / COVERAGE_INTERVAL) as usize) % observers.len()];
                let reach = (if observer.kind == ContactKind::Aircraft {
                    rules.air_small_range_m
                } else {
                    rules.surface_small_range_m
                })
                .min(conditions.visibility_m)
                .max(0.0);
                let bound = |n: f64| {
                    (n / CELL_SIZE_M)
                        .floor()
                        .clamp(-GRID_HALF as f64, (GRID_HALF - 1) as f64) as i32
                };
                for x in bound(observer.eye[0] - reach)..=bound(observer.eye[0] + reach) {
                    for z in bound(observer.eye[2] - reach)..=bound(observer.eye[2] + reach) {
                        if self.cells[team.index()].get(&(x, z)) == Some(&tick) {
                            continue;
                        }
                        let center = [
                            (x as f64 + 0.5) * CELL_SIZE_M,
                            0.0,
                            (z as f64 + 0.5) * CELL_SIZE_M,
                        ];
                        let mut covered = true;
                        for [dx, dz] in [
                            [0.0, 0.0],
                            [-0.5, -0.5],
                            [-0.5, 0.5],
                            [0.5, -0.5],
                            [0.5, 0.5],
                        ] {
                            if probes == MAX_PROBES {
                                break 'survey;
                            }
                            probes += 1;
                            let position = [
                                center[0] + dx * CELL_SIZE_M,
                                0.0,
                                center[2] + dz * CELL_SIZE_M,
                            ];
                            let target = VisualEntity {
                                id: String::new(),
                                team: if team == TeamId::A {
                                    TeamId::B
                                } else {
                                    TeamId::A
                                },
                                kind: ContactKind::Surface,
                                position,
                                eye: position,
                                feature: [position[0], 5.0, position[2]],
                                length_m: 100.0,
                                preset_id: None,
                                cues: VisualCues::default(),
                            };
                            if !observation_strength(observer, &target, 1, false, conditions, rules)
                                .is_some_and(|strength| strength >= 0.25)
                                || !line_visible(observer.eye, target.feature, islands, terrain)
                            {
                                covered = false;
                                break;
                            }
                        }
                        if covered {
                            self.cells[team.index()].insert((x, z), tick);
                        }
                    }
                }
            }
        }
    }
}
