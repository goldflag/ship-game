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

/// Gameplay tuning: repeated gunfire refreshes this visibility window.
pub const FIRING_VISIBILITY_SECONDS: f64 = 20.0;
const FIRING_VISIBILITY_BONUS_M: f64 = 1000.0;
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
            "../../../assets/gameplay/visual-sensors.v2.json"
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
    pub firing: bool,
    pub preset_id: Option<String>,
    /// Aircraft role for type classification once evidence is strong; ships use None.
    pub role: Option<String>,
    pub cues: crate::recon::VisualCues,
    pub motion: VisualMotion,
    pub aircraft: Option<AircraftExterior>,
    /// Hull or airframe health fraction, sampled only while visible.
    pub health: f64,
    /// Gun attitudes anyone can see from outside: train, elevation and recoil
    /// travel per mount, in definition order. Readiness and ammunition stay private.
    pub mounts: Vec<[f64; 3]>,
    /// Torpedo launcher train per launcher, in definition order.
    pub launchers: Vec<f64>,
}
/// Only externally visible pose and mechanisms are retained at acquisition.
#[derive(Clone, Debug, Default)]
pub struct VisualMotion {
    pub velocity: [f64; 3],
    pub heading: f64,
    pub pitch: f64,
    pub roll: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AircraftExterior {
    pub model_id: String,
    pub controls: crate::aircraft_flight::FlightControls,
    pub wing_fold: f64,
    /// A slung torpedo or bomb is visible from outside; guns and rounds are not.
    pub payload: bool,
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
    visual: VisualEntity,
}
#[derive(Default)]
pub struct Sensors {
    records: [BTreeMap<String, TrackRecord>; 2],
    sequence: [u64; 2],
    last_tick: Option<u64>,
    coverage: crate::recon::CoverageGrid,
}
impl Sensors {
    /// Retire a witnessed aircraft loss only after the event has been projected
    /// with its public contact ID. Unobserved losses retain their last report.
    pub(crate) fn confirm_aircraft_loss(&mut self, team: TeamId, target_id: &str) {
        if self.records[team.index()]
            .get(target_id)
            .is_some_and(|r| r.track.kind == ContactKind::Aircraft)
        {
            self.records[team.index()].remove(target_id);
        }
    }
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
    /// Score permitted reports for a battery. Hysteresis keeps crews on a
    /// useful solution; close, converging screens compete with distant capitals.
    pub fn battery_target(
        &self,
        team: TeamId,
        position: [f64; 3],
        mount: &crate::definition::MountDefinition,
        priority: Option<&str>,
        previous: Option<&str>,
    ) -> Option<&ContactTrack> {
        let range = crate::bots::gun_range(mount);
        let eligible = |c: &&ContactTrack| {
            c.targetable()
                && (mount.battery != "secondary"
                    || horizontal(c.estimated_position, position) <= range)
        };
        let score = |c: &ContactTrack| {
            let distance = horizontal(c.estimated_position, position).max(250.0);
            let large = c.classification.as_deref() == Some("Large warship");
            let small = c.classification.as_deref() == Some("Small warship");
            let suitability = if mount.weapon.caliber_m >= 0.2 {
                if large {
                    1.6
                } else if small {
                    0.75
                } else {
                    1.15
                }
            } else if small {
                1.6
            } else if large {
                0.65
            } else {
                1.0
            };
            let closing = ((position[0] - c.estimated_position[0]) * c.velocity[0]
                + (position[2] - c.estimated_position[2]) * c.velocity[2])
                / distance;
            let threat =
                if distance < 4000.0 { 1.5 } else { 1.0 } * if closing > 2.0 { 1.2 } else { 1.0 };
            let freshness = if c.status == TrackStatus::Lost {
                0.35
            } else {
                1.0
            };
            let reachable = if distance > range { 0.25 } else { 1.0 };
            suitability * threat * freshness * reachable / distance
        };
        let candidates = self.iter_contacts(team).filter(eligible);
        if let Some(c) = candidates.clone().find(|c| Some(c.id.as_str()) == priority) {
            return Some(c);
        }
        let best = candidates
            .clone()
            .max_by(|a, b| score(a).total_cmp(&score(b)))?;
        Some(
            candidates
                .into_iter()
                .find(|c| Some(c.id.as_str()) == previous && score(c) * 1.25 >= score(best))
                .unwrap_or(best),
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
    /// Exteriors exist only for the latest successful visibility sample.
    /// Lost reports never read a hidden entity's subsequent pose or condition.
    pub fn observed(&self, team: TeamId) -> impl Iterator<Item = (&ContactTrack, &VisualEntity)> {
        self.records[team.index()]
            .values()
            .filter(|r| Some(r.track.last_observed_tick) == self.last_tick)
            .map(|r| (&r.track, &r.visual))
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
        self.last_tick = Some(tick);
        self.coverage
            .update(tick, entities, islands, terrain, conditions, rules);
        // Bounded spatial candidate search; UI flight/group identities never enter
        // the visual signature. Nearby physical aircraft supply aggregate evidence.
        let mut cells: BTreeMap<(i32, i32), Vec<&VisualEntity>> = BTreeMap::new();
        for e in entities {
            cells.entry(cell(e.position)).or_default().push(e);
        }
        // Formation size depends on this acquisition's world, not the observer.
        // Share it across all lookouts, and discard it before the next update.
        let mut formation_sizes = BTreeMap::new();
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
                                *formation_sizes.entry(target.id.as_str()).or_insert_with(|| {
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
                                })
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
                let measured = target.position;
                let record = self.records[team.index()]
                    .entry(target_id)
                    .or_insert_with(|| {
                        self.sequence[team.index()] += 1;
                        TrackRecord {
                            visual: target.clone(),
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
                                uncertainty_m: 0.0,
                                identification_confidence: 0.0,
                                classification: None,
                                identified_preset_id: None,
                                sources: vec![],
                                visible_condition: None,
                            },
                        }
                    });
                record.visual = target.clone();
                record.track.velocity = target.motion.velocity;
                record.track.last_observed_tick = tick;
                record.track.measured_position = measured;
                record.track.identification_confidence = 1.0;
                record.track.affiliation = Affiliation::Hostile;
                record.track.classification = Some(
                    match target.kind {
                        // Observers recognise the airframe type, never its owner or state.
                        ContactKind::Aircraft => match target.role.as_deref() {
                            Some("fighter") => "Fighter",
                            Some("dive-bomber") => "Dive bomber",
                            Some("torpedo-bomber") => "Torpedo bomber",
                            _ => "Aircraft",
                        },
                        ContactKind::Surface if target.length_m < 150.0 => "Small warship",
                        ContactKind::Surface if target.length_m < 220.0 => "Warship",
                        ContactKind::Surface => "Large warship",
                    }
                    .into(),
                );
                record.track.identified_preset_id = target.preset_id.clone();
                record.track.sources = sources;
                if target.kind == ContactKind::Surface {
                    let visible = |point: Option<[f64; 3]>| {
                        point.is_some_and(|point| {
                            record.track.sources.iter().any(|source| {
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
                } else if age > 0.0 && age >= rules.lost_after_seconds as f64 {
                    TrackStatus::Lost
                } else {
                    TrackStatus::Tracked
                };
                let prediction_age = age.min(if aircraft { 10.0 } else { 30.0 });
                record.track.estimated_position = std::array::from_fn(|i| {
                    record.track.measured_position[i] + record.track.velocity[i] * prediction_age
                });
                record.track.uncertainty_m = age * if aircraft { 100.0 } else { 15.0 };
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
    _tracked: bool,
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
    let range = range
        + if target.kind == ContactKind::Surface && target.firing {
            FIRING_VISIBILITY_BONUS_M
        } else {
            0.0
        };
    let aggregate = if target.kind == ContactKind::Aircraft {
        1.0 + (formation as f64).ln().min(3.0) * 0.1
    } else {
        1.0
    };
    let horizon = 3570.0 * (observer.eye[1].max(0.0).sqrt() + target.feature[1].max(0.0).sqrt());
    let range = (range * aggregate * conditions.light.clamp(0.05, 1.0).sqrt())
        .min(conditions.visibility_m)
        .min(horizon);
    let distance = horizontal(observer.eye, target.feature);
    if distance > range || range <= 0.0 {
        return None;
    }
    Some(1.0)
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
            // The eye, the feature, every burning mount and every smoking vent
            // share this hull's attitude for the tick.
            let basis = a.motion.basis();
            let top = |module: Option<&crate::definition::Module>, fallback| {
                basis.local_to_world(module.map_or([0.0, fallback, 0.0], |m| {
                    [m.center[0], m.center[1] + m.size[1] / 2.0, m.center[2]]
                }))
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
                let point = basis.local_to_world([
                    mount.x,
                    mount.y + def.mounts[index].weapon.gunhouse_size[2],
                    mount.z,
                ]);
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
                    .map(|point| basis.local_to_world(point))
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
                firing: a.firing_visibility_seconds > 0.0,
                preset_id: Some(a.preset_id.clone()),
                role: None,
                cues,
                motion: VisualMotion {
                    velocity: a.motion.velocity(),
                    heading: a.motion.heading,
                    pitch: a.motion.pitch,
                    roll: a.motion.roll,
                },
                health: (a.damage.integrity / a.damage.max_integrity).clamp(0.0, 1.0),
                aircraft: None,
                mounts: a
                    .mounts
                    .iter()
                    .map(|m| [m.train, m.elevation, m.recoil])
                    .collect(),
                launchers: def
                    .torpedo_launchers
                    .iter()
                    .flatten()
                    .map(|l| a.launcher_trains.get(&l.id).copied().unwrap_or(0.0))
                    .collect(),
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
                    && p.deck_position.is_none()
                    && matches!(
                        p.phase.as_str(),
                        "takeoff" | "outbound" | "attack" | "returning" | "landing"
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
                firing: false,
                preset_id: None,
                role: Some(p.role.clone()),
                cues: Default::default(),
                motion: VisualMotion {
                    velocity: p.velocity,
                    heading: p.heading,
                    pitch: p.pitch,
                    roll: p.bank,
                },
                health: (p.hp / 100.0).clamp(0.0, 1.0),
                aircraft: Some(AircraftExterior {
                    model_id: p.model_id.clone(),
                    controls: p.controls,
                    wing_fold: p.wing_fold,
                    payload: p.payload,
                }),
                mounts: Vec::new(),
                launchers: Vec::new(),
            }),
    );
    entities.sort_by(|a, b| a.id.cmp(&b.id));
    entities
}
