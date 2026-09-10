//! Deterministic visual reports. True world entities enter only at acquisition;
//! public tracks retain measurements, never a live reference to hidden motion.
use crate::{
    aviation::Aviation,
    catalog::Catalog,
    environment::{Island, TerrainField},
    rules::{TICK_RATE, TeamId},
    vessel::Vessel,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisualRules {
    pub version: u32,
    #[ts(type = "number")]
    pub cadence_ticks: u64,
    #[ts(type = "number")]
    pub lost_after_seconds: u64,
    #[ts(type = "number")]
    pub stale_surface_seconds: u64,
    #[ts(type = "number")]
    pub stale_air_seconds: u64,
    pub surface_large_range_m: f64,
    pub surface_small_range_m: f64,
    pub air_large_range_m: f64,
    pub air_small_range_m: f64,
    pub surface_low_air_range_m: f64,
    pub surface_high_air_range_m: f64,
    pub air_to_air_range_m: f64,
}
impl Default for VisualRules {
    fn default() -> Self {
        serde_json::from_str(include_str!(
            "../../../assets/gameplay/visual-sensors.v1.json"
        ))
        .expect("versioned visual rules")
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum ContactKind {
    Surface,
    Aircraft,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum TrackStatus {
    Reported,
    Tracked,
    Lost,
    Stale,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum Affiliation {
    Unknown,
    Hostile,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ObservationSource {
    pub observer_id: String,
    pub kind: ContactKind,
    #[ts(type = "number")]
    pub tick: u64,
    pub strength: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ContactTrack {
    pub id: String,
    pub kind: ContactKind,
    pub affiliation: Affiliation,
    pub status: TrackStatus,
    #[ts(type = "number")]
    pub first_observed_tick: u64,
    #[ts(type = "number")]
    pub last_observed_tick: u64,
    pub measured_position: [f64; 3],
    pub estimated_position: [f64; 3],
    pub velocity: [f64; 3],
    pub uncertainty_m: f64,
    pub identification_confidence: f64,
    pub classification: Option<String>,
    pub identified_preset_id: Option<String>,
    pub sources: Vec<ObservationSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub visible_condition: Option<crate::recon::ObservedCondition>,
}
impl ContactTrack {
    pub fn pose(&self) -> crate::geometry::Pose {
        crate::geometry::Pose {
            x: self.estimated_position[0],
            y: self.estimated_position[1],
            z: self.estimated_position[2],
            heading: self.velocity[0].atan2(-self.velocity[2]),
            ..Default::default()
        }
    }
    pub fn estimated_length(&self) -> f64 {
        match self.classification.as_deref() {
            Some("Small warship") => 100.0,
            Some("Large warship") => 260.0,
            _ => 180.0,
        }
    }
    pub fn targetable(&self) -> bool {
        self.kind == ContactKind::Surface
            && self.affiliation == Affiliation::Hostile
            && self.status != TrackStatus::Stale
            && !self.visible_condition.as_ref().is_some_and(|c| c.sinking)
    }
}

/// Read-only knowledge plus physical terrain for line-of-fire collision checks.
#[derive(Clone, Copy)]
pub struct Knowledge<'a> {
    pub sensors: &'a Sensors,
    pub tick: u64,
    pub islands: &'a [Island],
    pub terrain: &'a [TerrainField],
}
/// This is authority-only input, not a serialized presentation actor.
#[derive(Clone, Debug)]
pub struct VisualEntity {
    pub id: String,
    pub team: TeamId,
    pub kind: ContactKind,
    pub position: [f64; 3],
    pub eye: [f64; 3],
    pub feature: [f64; 3],
    pub length_m: f64,
    pub preset_id: Option<String>,
    pub cues: crate::recon::VisualCues,
}
impl VisualEntity {
    pub fn can_observe(&self) -> bool {
        !self.cues.sinking
    }
}
#[derive(Clone, Copy, Debug)]
pub struct VisualConditions {
    pub visibility_m: f64,
    pub light: f64,
}
impl VisualConditions {
    pub fn resolve(catalog: &Catalog, map_id: &str, weather: &str) -> Self {
        // PvE initially fixes daylight; weather has the same authored fog limit
        // used by the renderer. Decorative clouds do not occlude CPU lookouts.
        let weather = catalog.conditions["weather"]
            .as_array()
            .and_then(|v| v.iter().find(|w| w["id"] == weather));
        let map = catalog.maps["maps"]
            .as_array()
            .and_then(|v| v.iter().find(|m| m["id"] == map_id));
        let visibility_m = weather
            .and_then(|w| w["fog"]["end"].as_f64())
            .or_else(|| map.and_then(|m| m["fog"]["end"].as_f64()))
            .unwrap_or(20000.0);
        Self {
            visibility_m,
            light: 1.0,
        }
    }
}
#[derive(Clone, Debug)]
struct TrackRecord {
    track: ContactTrack,
    evidence: f64,
    measured_uncertainty: f64,
}
#[derive(Default)]
pub struct Sensors {
    records: [BTreeMap<String, TrackRecord>; 2],
    pending: [BTreeMap<String, f64>; 2],
    sequence: [u64; 2],
    last_tick: Option<u64>,
    coverage: crate::recon::CoverageGrid,
}
impl Sensors {
    pub fn coverage(&self, team: TeamId) -> crate::recon::ReconCoverage {
        self.coverage.snapshot(team)
    }
    /// Called only after the event's own visibility gate succeeds. Preserve the
    /// last measured location; a visible loss event is not a new exact pose.
    pub(crate) fn confirm_sinking(&mut self, team: TeamId, target_id: &str, tick: u64) {
        if let Some(record) = self.records[team.index()].get_mut(target_id) {
            record.track.visible_condition = Some(crate::recon::ObservedCondition {
                observed_tick: tick,
                sinking: true,
                ..Default::default()
            });
            record.track.velocity = [0.0; 3];
        }
    }
    pub fn contact(&self, team: TeamId, contact_id: &str) -> Option<&ContactTrack> {
        self.records[team.index()]
            .values()
            .map(|r| &r.track)
            .find(|t| t.id == contact_id)
    }
    pub fn surface_target(
        &self,
        team: TeamId,
        position: [f64; 3],
        priority: Option<&str>,
        previous: Option<&str>,
    ) -> Option<&ContactTrack> {
        let candidates: Vec<_> = self.records[team.index()]
            .values()
            .map(|r| &r.track)
            .filter(|t| t.targetable())
            .collect();
        if let Some(t) = candidates.iter().find(|t| Some(t.id.as_str()) == priority) {
            return Some(t);
        }
        let nearest = candidates.iter().min_by(|a, b| {
            horizontal(a.estimated_position, position)
                .total_cmp(&horizontal(b.estimated_position, position))
        })?;
        Some(
            candidates
                .iter()
                .find(|t| {
                    Some(t.id.as_str()) == previous
                        && horizontal(t.estimated_position, position)
                            <= horizontal(nearest.estimated_position, position) * 1.25
                })
                .unwrap_or(nearest),
        )
    }
    /// Borrow the same permitted reports used in public snapshots. Combat
    /// readers must not clone every report and observer string per AA mount.
    pub fn iter_contacts(&self, team: TeamId) -> impl Iterator<Item = &ContactTrack> + Clone {
        self.records[team.index()].values().map(|r| &r.track)
    }
    pub fn contacts(&self, team: TeamId) -> Vec<ContactTrack> {
        self.iter_contacts(team).cloned().collect()
    }
    pub fn track(&self, team: TeamId, target_id: &str) -> Option<&ContactTrack> {
        self.records[team.index()].get(target_id).map(|r| &r.track)
    }
    /// Resolve opaque commands internally; callers must use track measurements,
    /// not substitute the corresponding actor's unobserved current motion.
    pub fn resolve_contact(&self, team: TeamId, contact_id: &str) -> Option<&str> {
        self.records[team.index()]
            .iter()
            .find(|(_, r)| r.track.id == contact_id)
            .map(|(id, _)| id.as_str())
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
            .is_some_and(|t| tick < t + rules.cadence_ticks)
        {
            return;
        }
        let dt = self
            .last_tick
            .map_or(1.0, |t| (tick - t) as f64 / TICK_RATE as f64);
        self.last_tick = Some(tick);
        self.coverage
            .update(tick, entities, islands, terrain, conditions, rules);
        // Bounded spatial candidate search; UI flight/group identities never enter
        // the visual signature. Nearby physical aircraft supply aggregate evidence.
        let mut cells: BTreeMap<(i32, i32), Vec<&VisualEntity>> = BTreeMap::new();
        for e in entities {
            cells.entry(cell(e.position)).or_default().push(e);
        }
        for team in [TeamId::A, TeamId::B] {
            let mut reports: BTreeMap<String, (VisualEntity, Vec<ObservationSource>)> =
                BTreeMap::new();
            for observer in entities
                .iter()
                .filter(|e| e.team == team && e.can_observe())
            {
                let (cx, cz) = cell(observer.position);
                for x in cx - 3..=cx + 3 {
                    for z in cz - 3..=cz + 3 {
                        for target in cells
                            .get(&(x, z))
                            .into_iter()
                            .flatten()
                            .filter(|t| t.team != team)
                        {
                            let tracked = self.records[team.index()].contains_key(&target.id);
                            let formation = if target.kind == ContactKind::Aircraft {
                                let (tx, tz) = cell(target.position);
                                let mut count = 0;
                                for x in tx - 1..=tx + 1 {
                                    for z in tz - 1..=tz + 1 {
                                        count += cells
                                            .get(&(x, z))
                                            .into_iter()
                                            .flatten()
                                            .filter(|p| {
                                                p.team == target.team
                                                    && p.kind == ContactKind::Aircraft
                                                    && horizontal(p.position, target.position)
                                                        < 900.0
                                            })
                                            .count();
                                    }
                                }
                                count.max(1)
                            } else {
                                1
                            };
                            if let Some(strength) = observation_strength(
                                observer, target, formation, tracked, conditions, rules,
                            )
                            .filter(|_| {
                                line_visible(observer.eye, target.feature, islands, terrain)
                            }) {
                                reports
                                    .entry(target.id.clone())
                                    .or_insert_with(|| ((*target).clone(), vec![]))
                                    .1
                                    .push(ObservationSource {
                                        observer_id: observer.id.clone(),
                                        kind: observer.kind,
                                        tick,
                                        strength,
                                    });
                            }
                        }
                    }
                }
            }
            for (target_id, (target, mut sources)) in reports {
                sources.sort_by(|a, b| {
                    b.strength
                        .total_cmp(&a.strength)
                        .then(a.observer_id.cmp(&b.observer_id))
                });
                let strength = sources[0].strength;
                // Duplicate observers can corroborate classification, but cannot
                // convert a distant invisible target into an acquired contact.
                let evidence = self.pending[team.index()]
                    .entry(target_id.clone())
                    .or_default();
                *evidence = (*evidence + strength * dt).min(2.0);
                if !self.records[team.index()].contains_key(&target_id) && *evidence < 1.0 {
                    continue;
                }
                let uncertainty = 20.0 + (1.0 - strength).powi(2) * 500.0;
                let quantize = |n: f64| (n / uncertainty).round() * uncertainty;
                let measured = target.position.map(quantize);
                let record = self.records[team.index()]
                    .entry(target_id)
                    .or_insert_with(|| {
                        self.sequence[team.index()] += 1;
                        TrackRecord {
                            evidence: 0.0,
                            measured_uncertainty: uncertainty,
                            track: ContactTrack {
                                id: format!(
                                    "contact-{}-{}",
                                    team.index(),
                                    self.sequence[team.index()]
                                ),
                                kind: target.kind,
                                affiliation: Affiliation::Unknown,
                                status: TrackStatus::Reported,
                                first_observed_tick: tick,
                                last_observed_tick: tick,
                                measured_position: measured,
                                estimated_position: measured,
                                velocity: [0.0; 3],
                                uncertainty_m: uncertainty,
                                identification_confidence: 0.0,
                                classification: None,
                                identified_preset_id: None,
                                sources: vec![],
                                visible_condition: None,
                            },
                        }
                    });
                let elapsed = (tick - record.track.last_observed_tick) as f64 / TICK_RATE as f64;
                if elapsed >= 1.0 {
                    let max_speed = if target.kind == ContactKind::Aircraft {
                        180.0
                    } else {
                        25.0
                    };
                    for (i, measurement) in measured.iter().enumerate() {
                        let sample = ((measurement - record.track.measured_position[i]) / elapsed)
                            .clamp(-max_speed, max_speed);
                        record.track.velocity[i] = record.track.velocity[i] * 0.7 + sample * 0.3;
                    }
                }
                record.evidence = (record.evidence + strength * dt).min(30.0);
                record.measured_uncertainty = uncertainty;
                record.track.last_observed_tick = tick;
                record.track.measured_position = measured;
                record.track.identification_confidence = (record.evidence / 15.0).min(1.0);
                record.track.affiliation =
                    if target.kind == ContactKind::Surface || record.evidence >= 2.0 {
                        Affiliation::Hostile
                    } else {
                        Affiliation::Unknown
                    };
                if record.evidence >= 3.0 {
                    record.track.classification = Some(
                        match target.kind {
                            ContactKind::Aircraft => "Aircraft",
                            ContactKind::Surface if target.length_m < 150.0 => "Small warship",
                            ContactKind::Surface if target.length_m < 220.0 => "Warship",
                            ContactKind::Surface => "Large warship",
                        }
                        .into(),
                    );
                }
                if record.evidence >= 15.0 && strength >= 0.5 {
                    record.track.identified_preset_id = target.preset_id.clone();
                }
                record.track.sources = sources;
                if target.kind == ContactKind::Surface && strength >= 0.6 {
                    let visible = |point: Option<[f64; 3]>| {
                        point.is_some_and(|point| {
                            record
                                .track
                                .sources
                                .iter()
                                .filter(|source| source.strength >= 0.6)
                                .any(|source| {
                                    entities
                                        .iter()
                                        .find(|entity| entity.id == source.observer_id)
                                        .is_some_and(|observer| {
                                            line_visible(observer.eye, point, islands, terrain)
                                        })
                                })
                        })
                    };
                    let sinking = target.cues.sinking
                        || record
                            .track
                            .visible_condition
                            .as_ref()
                            .is_some_and(|c| c.sinking);
                    record.track.visible_condition = Some(crate::recon::ObservedCondition {
                        observed_tick: tick,
                        fire: visible(target.cues.fire),
                        heavy_smoke: visible(target.cues.smoke),
                        listing: target.cues.listing,
                        sinking,
                    });
                    if sinking {
                        record.track.velocity = [0.0; 3];
                    }
                }
            }
            for evidence in self.pending[team.index()].values_mut() {
                *evidence = (*evidence - dt * 0.02).max(0.0);
            }
            for record in self.records[team.index()].values_mut() {
                let age = (tick - record.track.last_observed_tick) as f64 / TICK_RATE as f64;
                let aircraft = record.track.kind == ContactKind::Aircraft;
                let stale = if aircraft {
                    rules.stale_air_seconds
                } else {
                    rules.stale_surface_seconds
                };
                record.track.status = if age >= stale as f64 {
                    TrackStatus::Stale
                } else if age >= rules.lost_after_seconds as f64 {
                    TrackStatus::Lost
                } else if record.evidence >= 3.0 {
                    TrackStatus::Tracked
                } else {
                    TrackStatus::Reported
                };
                let prediction_age = age.min(if aircraft { 10.0 } else { 30.0 });
                record.track.estimated_position = std::array::from_fn(|i| {
                    record.track.measured_position[i] + record.track.velocity[i] * prediction_age
                });
                record.track.uncertainty_m =
                    record.measured_uncertainty + age * if aircraft { 100.0 } else { 15.0 };
            }
        }
    }
}
fn cell(p: [f64; 3]) -> (i32, i32) {
    (
        (p[0] / 10000.0).floor() as i32,
        (p[2] / 10000.0).floor() as i32,
    )
}
fn horizontal(a: [f64; 3], b: [f64; 3]) -> f64 {
    (a[0] - b[0]).hypot(a[2] - b[2])
}
pub fn observation_strength(
    observer: &VisualEntity,
    target: &VisualEntity,
    formation: usize,
    tracked: bool,
    conditions: VisualConditions,
    r: &VisualRules,
) -> Option<f64> {
    let size = ((target.length_m - 100.0) / 160.0).clamp(0.0, 1.0);
    let range = match (observer.kind, target.kind) {
        (ContactKind::Surface, ContactKind::Surface) => {
            r.surface_small_range_m + size * (r.surface_large_range_m - r.surface_small_range_m)
        }
        (ContactKind::Aircraft, ContactKind::Surface) => {
            r.air_small_range_m + size * (r.air_large_range_m - r.air_small_range_m)
        }
        (ContactKind::Surface, ContactKind::Aircraft) => {
            r.surface_low_air_range_m
                + (target.position[1] / 1000.0).clamp(0.0, 1.0)
                    * (r.surface_high_air_range_m - r.surface_low_air_range_m)
        }
        (ContactKind::Aircraft, ContactKind::Aircraft) => r.air_to_air_range_m,
    };
    let aggregate = if target.kind == ContactKind::Aircraft {
        1.0 + (formation as f64).ln().min(3.0) * 0.1
    } else {
        1.0
    };
    let horizon = 3570.0 * (observer.eye[1].max(0.0).sqrt() + target.feature[1].max(0.0).sqrt());
    let range = (range
        * aggregate
        * conditions.light.clamp(0.05, 1.0).sqrt()
        * if tracked { 1.1 } else { 1.0 })
    .min(conditions.visibility_m)
    .min(horizon);
    let distance = horizontal(observer.eye, target.feature);
    if distance > range || range <= 0.0 {
        return None;
    }
    Some(((1.0 - distance / range) / 0.55).clamp(0.1, 1.0))
}
/// Sample the same baked CPU terrain used by grounding. Island intersection
/// narrows the samples; aircraft may see over ridges if their actual ray clears.
pub fn line_visible(
    from: [f64; 3],
    to: [f64; 3],
    islands: &[Island],
    terrain: &[TerrainField],
) -> bool {
    let distance = horizontal(from, to);
    for island in islands {
        let rx = island.rx * 1.22;
        let rz = island.rz * 1.22;
        let dx = (to[0] - from[0]) / rx;
        let dz = (to[2] - from[2]) / rz;
        let ox = (from[0] - island.x) / rx;
        let oz = (from[2] - island.z) / rz;
        let a = dx * dx + dz * dz;
        if a <= f64::EPSILON {
            continue;
        }
        let b = 2.0 * (ox * dx + oz * dz);
        let c = ox * ox + oz * oz - 1.0;
        let discriminant = b * b - 4.0 * a * c;
        if discriminant < 0.0 {
            continue;
        }
        let start = ((-b - discriminant.sqrt()) / (2.0 * a)).max(0.0);
        let end = ((-b + discriminant.sqrt()) / (2.0 * a)).min(1.0);
        if start > end {
            continue;
        }
        let Some(field) = terrain
            .iter()
            .find(|f| f.seed == island.seed && f.style == island.style)
        else {
            return false;
        };
        let steps = (((end - start) * distance / 20.0).ceil() as usize).max(1);
        for step in 0..=steps {
            let t = start + (end - start) * step as f64 / steps as f64;
            let x = from[0] + (to[0] - from[0]) * t;
            let z = from[2] + (to[2] - from[2]) * t;
            let y = from[1] + (to[1] - from[1]) * t
                - distance * distance * t * (1.0 - t) / (2.0 * 6_371_000.0);
            if island.height_at(field, x, z) > y {
                return false;
            }
        }
    }
    true
}
pub fn entities(actors: &[Vessel], aviation: &Aviation) -> Vec<VisualEntity> {
    let mut entities: Vec<_> = actors
        .iter()
        .filter(|a| a.motion.depth() <= 0.5)
        .map(|a| {
            let def = a.definition();
            let bridge = def
                .modules
                .iter()
                .filter(|m| m.kind == "bridge")
                .max_by(|a, b| a.center[1].total_cmp(&b.center[1]));
            let feature = def.modules.iter().max_by(|a, b| {
                (a.center[1] + a.size[1] / 2.0).total_cmp(&(b.center[1] + b.size[1] / 2.0))
            });
            let top = |module: Option<&crate::definition::Module>, fallback| {
                crate::geometry::local_to_world(
                    module.map_or([0.0, fallback, 0.0], |m| {
                        [m.center[0], m.center[1] + m.size[1] / 2.0, m.center[2]]
                    }),
                    a.motion.pose(),
                )
            };
            let mut cues = crate::recon::VisualCues {
                listing: a.motion.roll.abs() >= 12.0_f64.to_radians(),
                sinking: a.physical_loss().is_some(),
                ..Default::default()
            };
            // Match authored exterior flames/vent smoke, not hidden room HP,
            // flooding or machinery condition. Submerged sources are invisible.
            for (index, _) in a
                .damage
                .control
                .mounts
                .iter()
                .enumerate()
                .filter(|(_, f)| f.intensity >= 0.35)
            {
                let mount = crate::mount_frames::mount_frame(def, index, &|i| a.mounts[i].train);
                let point = crate::geometry::local_to_world(
                    [
                        mount.x,
                        mount.y + def.mounts[index].weapon.gunhouse_size[2],
                        mount.z,
                    ],
                    a.motion.pose(),
                );
                if point[1] > 0.0 {
                    cues.fire = Some(point);
                    cues.smoke = Some(point);
                    break;
                }
            }
            if cues.smoke.is_none() {
                cues.smoke = a
                    .damage
                    .control
                    .rooms
                    .iter()
                    .zip(&def.compartments)
                    .filter(|(fire, _)| fire.intensity >= 0.35)
                    .filter_map(|(_, compartment)| compartment.fire.as_ref()?.vent_position)
                    .map(|point| crate::geometry::local_to_world(point, a.motion.pose()))
                    .find(|point| point[1] > 0.0);
            }
            VisualEntity {
                id: a.motion.id.clone(),
                team: a.team,
                kind: ContactKind::Surface,
                position: [a.motion.x, a.motion.y, a.motion.z],
                eye: top(bridge, 8.0),
                feature: top(feature, 5.0),
                length_m: def.hull.length,
                preset_id: Some(a.preset_id.clone()),
                cues,
            }
        })
        .collect();
    entities.extend(
        aviation
            .wings
            .iter()
            .flat_map(|w| &w.state.planes)
            .filter(|p| {
                p.hp > 0.0
                    && matches!(
                        p.phase.as_str(),
                        "outbound" | "attack" | "returning" | "landing"
                    )
            })
            .map(|p| VisualEntity {
                id: p.id.clone(),
                team: p.team,
                kind: ContactKind::Aircraft,
                position: p.position,
                eye: p.position,
                feature: p.position,
                length_m: 12.0,
                preset_id: None,
                cues: Default::default(),
            }),
    );
    entities.sort_by(|a, b| a.id.cmp(&b.id));
    entities
}
