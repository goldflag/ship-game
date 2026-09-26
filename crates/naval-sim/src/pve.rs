//! Seeded local mission preparation. The full opponent stays behind the worker
//! boundary; moving friendly deployment markers never regenerates this plan.
use crate::{
    battle::{BattleSetup, ShipSetup, Spawn},
    bots::AiLevel,
    catalog::{Catalog, ContentIdentity},
    definition::ShipDefinition,
    formations::{StationClass, formation_stations},
    mission::{FleetTotals, MissionRules},
    navigation::Formation,
    rules::{TeamId, mix32},
    terrain::{DEPLOYMENT_CLEARANCE_M, Terrain},
    vessel::Controller,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, f64::consts::PI};
use ts_rs::TS;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum GroupStation {
    Front,
    Rear,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskGroup {
    pub id: String,
    pub name: String,
    pub station: GroupStation,
    /// Cruising formation the group sails at the start; column when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub formation: Option<crate::navigation::Formation>,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FleetShip {
    pub id: String,
    pub preset_id: String,
    pub group_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PveRequest {
    pub version: u32,
    pub seed: u32,
    pub map_id: String,
    pub weather: String,
    pub difficulty: AiLevel,
    pub ships: Vec<FleetShip>,
    pub groups: Vec<TaskGroup>,
}
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Placement {
    pub id: String,
    pub spawn: Spawn,
}
#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PveBriefing {
    pub generation_version: u32,
    /// Owned ships only. This is presentation metadata, not a startable BattleSetup.
    pub setup: BattleSetup,
    pub groups: Vec<TaskGroup>,
    pub assignments: Vec<FleetShip>,
    pub totals: FleetTotals,
    pub eligible_presets: Vec<String>,
    pub deployment_min_z: f64,
    /// A scenario's conditions, clock and opening orders; its fleet is fixed.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scenario: Option<crate::scenario::ScenarioBriefing>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Role {
    Screen,
    Line,
    Carrier,
}

/// Capability-based initial pool, derived from the same definitions as combat.
/// Small armed hulls, torpedo warships, heavy-gun ships and carriers qualify.
/// Current merchants lack those capabilities; submerged warfare is a later slice.
fn role(def: &ShipDefinition) -> Option<Role> {
    if def.submarine.is_some() {
        return None;
    }
    if def.air_wing.is_some() {
        return Some(Role::Carrier);
    }
    let gun = def
        .mounts
        .iter()
        .filter(|m| crate::anti_aircraft::surface_allowed(def, m))
        .map(|m| m.weapon.caliber_m)
        .fold(0.0_f64, f64::max);
    if def.hull.mass_kg <= 5_000_000.0 && gun >= 0.1 {
        return Some(Role::Screen);
    }
    if gun >= 0.15 || def.torpedo_tubes.as_ref().is_some_and(|t| !t.is_empty()) {
        return Some(Role::Line);
    }
    None
}
pub fn eligible_presets(catalog: &Catalog) -> Vec<String> {
    catalog
        .definitions
        .iter()
        .filter(|(_, d)| role(d).is_some())
        .map(|(id, _)| id.clone())
        .collect()
}
/// A matching heuristic, never a damage modifier or a second player currency.
/// Tonnage is constrained separately; this distinguishes lightly armed support
/// hulls from gun/torpedo forces. Paired playtests still govern final tuning.
fn strength(def: &ShipDefinition) -> f64 {
    let gun: f64 = def
        .mounts
        .iter()
        .filter(|m| crate::anti_aircraft::surface_allowed(def, m))
        .map(|m| {
            m.weapon.caliber_m.powi(2) * m.weapon.barrel_count / m.weapon.reload_seconds.max(1.0)
        })
        .sum();
    let armor = def
        .armor
        .iter()
        .filter(|a| a.plate.as_ref().is_none_or(|p| p.mount_id.is_none()))
        .map(|a| a.thickness_mm)
        .fold(0.0_f64, f64::max);
    let aircraft = def
        .air_wing
        .as_ref()
        .map_or(0.0, |w| w.squadrons.iter().map(|s| s.count).sum::<f64>());
    (def.hull.mass_kg / 1000.0).sqrt() * 10.0
        + gun * 20_000.0
        + armor * 0.5
        + def.torpedo_tubes.as_ref().map_or(0, Vec::len) as f64 * 15.0
        + aircraft * 12.0
}
pub(crate) struct Random(pub(crate) u32);
impl Random {
    pub(crate) fn next(&mut self) -> u32 {
        self.0 = mix32(self.0.wrapping_add(0x9e37_79b9));
        self.0
    }
    pub(crate) fn index(&mut self, count: usize) -> usize {
        self.next() as usize % count
    }
    /// Uniform in 0..=1.
    pub(crate) fn unit(&mut self) -> f64 {
        self.next() as f64 / u32::MAX as f64
    }
    fn signed(&mut self, reach: f64) -> f64 {
        (self.next() as f64 / u32::MAX as f64 * 2.0 - 1.0) * reach
    }
}

/// Authority-owned frozen plan. There is deliberately no Serialize implementation.
#[derive(Clone)]
pub struct PvePlan {
    pub(crate) setup: BattleSetup,
    pub(crate) groups: Vec<TaskGroup>,
    pub(crate) assignments: Vec<FleetShip>,
    pub(crate) enemy_groups: Vec<TaskGroup>,
    pub(crate) enemy_assignments: Vec<FleetShip>,
    pub(crate) identities: Vec<ContentIdentity>,
    pub(crate) totals: FleetTotals,
    /// A hand-authored scenario: fixed deployment, scripted raid, victory points.
    pub(crate) scenario: Option<crate::scenario::ScenarioPlan>,
}
impl PvePlan {
    pub fn generate(catalog: &Catalog, request: PveRequest) -> Result<Self, String> {
        if request.version != 1
            || !matches!(
                request.difficulty,
                AiLevel::Easy | AiLevel::Normal | AiLevel::Hard
            )
        {
            return Err("Choose a supported mission version and difficulty".into());
        }
        if request.groups.is_empty()
            || request.groups.len() > 9
            || request.groups.iter().any(|g| {
                !valid_id(&g.id) || g.name.trim().is_empty() || g.name.chars().count() > 32
            })
            || request
                .groups
                .iter()
                .map(|g| &g.id)
                .collect::<BTreeSet<_>>()
                .len()
                != request.groups.len()
        {
            return Err("Use one to nine uniquely named task groups".into());
        }
        let rules = catalog
            .missions
            .get("pve-fleet-v1")
            .ok_or("PvE mission content is unavailable")?
            .clone();
        let ids: Vec<_> = request.ships.iter().map(|s| s.preset_id.clone()).collect();
        let totals = rules.budget.resolve(&ids, catalog)?;
        let eligible = eligible_presets(catalog);
        if request.ships.iter().any(|s| {
            !valid_id(&s.id)
                || s.id.starts_with("opponent-")
                || !eligible.contains(&s.preset_id)
                || !request.groups.iter().any(|g| g.id == s.group_id)
        }) || request
            .ships
            .iter()
            .map(|s| &s.id)
            .collect::<BTreeSet<_>>()
            .len()
            != request.ships.len()
        {
            return Err("Choose supported surface warships and assign each to a task group".into());
        }
        let environment = catalog
            .resolve_pve_environment(
                &request.map_id,
                &request.weather,
                request.seed,
                &rules,
                None,
            )
            .map_err(|e| e.to_string())?;
        let enemy = generate_enemy(
            catalog,
            &rules,
            &ids,
            &eligible,
            mix32(request.seed ^ 0x6172_6d73),
        )?;
        let (enemy_units, enemy_groups) =
            enemy_groups(catalog, enemy, mix32(request.seed ^ 0x666f_726d));
        let mut ships = place_groups(
            catalog,
            &rules,
            &environment.terrain,
            &request.ships,
            &request.groups,
            TeamId::A,
            AiLevel::Normal,
            mix32(request.seed ^ 0x6f77_6e73),
        )?;
        let opponents = place_groups(
            catalog,
            &rules,
            &environment.terrain,
            &enemy_units,
            &enemy_groups,
            TeamId::B,
            request.difficulty,
            mix32(request.seed ^ 0x6265_7274),
        )?;
        ships.extend(opponents);
        let selected: BTreeSet<_> = ships.iter().map(|s| &s.preset_id).collect();
        let identities = catalog
            .identities
            .iter()
            .filter(|id| selected.contains(&id.id))
            .cloned()
            .collect();
        Ok(Self {
            setup: BattleSetup {
                ships,
                seed: request.seed,
                map_id: request.map_id,
                weather: request.weather,
                spawn_distance: 16000.0,
                wind_speed: None,
                time_of_day: None,
                air_rules: Some(catalog.air_profiles[&rules.air_profile_id].clone()),
                mission_rules: Some(rules),
            },
            groups: request.groups,
            assignments: request.ships,
            enemy_groups,
            enemy_assignments: enemy_units,
            identities,
            totals,
            scenario: None,
        })
    }
    pub fn briefing(&self, catalog: &Catalog) -> PveBriefing {
        let mut setup = self.setup.clone();
        setup.ships.retain(|s| s.team == TeamId::A);
        PveBriefing {
            generation_version: 1,
            setup,
            groups: self.groups.clone(),
            assignments: self.assignments.clone(),
            totals: self.totals,
            // A scenario's fleet is fixed, so it offers no catalog to build from.
            eligible_presets: if self.scenario.is_some() {
                vec![]
            } else {
                eligible_presets(catalog)
            },
            deployment_min_z: 7000.0,
            scenario: self.scenario.as_ref().map(|s| s.briefing(&self.setup)),
        }
    }
    pub fn scenario_plan(&self) -> Option<&crate::scenario::ScenarioPlan> {
        self.scenario.as_ref()
    }
    /// Validate the complete proposed placement before changing the frozen setup.
    pub fn deploy(
        &mut self,
        catalog: &Catalog,
        placements: Vec<Placement>,
    ) -> Result<BattleSetup, String> {
        if placements.len() != self.assignments.len()
            || placements
                .iter()
                .map(|p| &p.id)
                .collect::<BTreeSet<_>>()
                .len()
                != placements.len()
            || placements
                .iter()
                .any(|p| !self.assignments.iter().any(|s| s.id == p.id))
        {
            return Err("Place every friendly ship exactly once".into());
        }
        // A scenario's order of battle is history: its ships start where they were.
        if self.scenario.is_some() {
            let authored = self
                .setup
                .ships
                .iter()
                .filter(|s| s.team == TeamId::A)
                .all(|ship| {
                    let placed = &placements.iter().find(|p| p.id == ship.id).unwrap().spawn;
                    ship.spawn.as_ref().is_some_and(|s| {
                        (s.x - placed.x).abs() < 1.0
                            && (s.z - placed.z).abs() < 1.0
                            && (s.heading - placed.heading).abs() < 1e-3
                    })
                });
            return if authored {
                Ok(self.setup.clone())
            } else {
                Err("A scenario's ships start at their historical positions".into())
            };
        }
        let rules = self.setup.mission_rules.as_ref().unwrap();
        let environment = catalog
            .resolve_pve_environment(
                &self.setup.map_id,
                &self.setup.weather,
                self.setup.seed,
                rules,
                self.setup.wind_speed,
            )
            .map_err(|e| e.to_string())?;
        let mut proposed = self.setup.clone();
        let mut accepted = Vec::new();
        for ship in proposed.ships.iter_mut().filter(|s| s.team == TeamId::A) {
            let placement = &placements.iter().find(|p| p.id == ship.id).unwrap().spawn;
            if placement.z < 7000.0
                || !valid_position(
                    placement,
                    &catalog.definitions[&ship.preset_id],
                    rules,
                    &environment.terrain,
                    &accepted,
                )
            {
                return Err(format!(
                    "{} must be in friendly water, clear of land and other ships",
                    ship.id
                ));
            }
            ship.spawn = Some(placement.clone());
            accepted.push(placement.clone());
        }
        self.setup = proposed;
        Ok(self.setup.clone())
    }
    /// Cruising formation per owned task group, chosen at deployment. Unknown
    /// group ids are ignored; the enemy's own groups are never addressed here.
    pub fn set_formations(
        &mut self,
        formations: &std::collections::BTreeMap<String, crate::navigation::Formation>,
    ) {
        for group in &mut self.groups {
            if let Some(formation) = formations.get(&group.id) {
                group.formation = Some(*formation);
            }
        }
    }
    pub fn restart_setup(&self) -> BattleSetup {
        self.setup.clone()
    }
    /// Only expose this after the battle outcome is final.
    pub fn debrief(&self, battle: &crate::battle::Battle) -> serde_json::Value {
        let mut debrief = serde_json::json!({"generationVersion":1,"setup":self.setup,"content":self.identities,"groups":self.groups,"assignments":self.assignments});
        if let Some(scenario) = &self.scenario {
            debrief["scenario"] = scenario.debrief(battle);
        }
        debrief
    }
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}
fn generate_enemy(
    catalog: &Catalog,
    rules: &MissionRules,
    own: &[String],
    eligible: &[String],
    seed: u32,
) -> Result<Vec<String>, String> {
    let own_totals = rules.budget.resolve(own, catalog)?;
    let own_strength: f64 = own
        .iter()
        .map(|id| strength(&catalog.definitions[id]))
        .sum();
    let mut random = Random(seed);
    // An identical legal complement is a capability-matched fallback, including
    // tiny fleets and catalogs with one available preset. Mutations diversify it.
    let mut candidates = vec![own.to_vec()];
    let mut identities = BTreeSet::new();
    let mut base = own.to_vec();
    base.sort();
    identities.insert(base);
    for _ in 0..256 {
        let mut candidate = candidates[random.index(candidates.len())].clone();
        for _ in 0..1 + random.index(3) {
            match random.index(5) {
                0 if candidate.len() < rules.budget.max_ships => {
                    candidate.push(eligible[random.index(eligible.len())].clone())
                }
                1 if candidate.len() > 1 => {
                    let index = random.index(candidate.len());
                    candidate.remove(index);
                }
                _ => {
                    let index = random.index(candidate.len());
                    let current_role = role(&catalog.definitions[&candidate[index]]);
                    let pool: Vec<_> = eligible
                        .iter()
                        .filter(|id| role(&catalog.definitions[*id]) == current_role)
                        .collect();
                    candidate[index] = if !pool.is_empty() && random.index(4) != 0 {
                        pool[random.index(pool.len())].clone()
                    } else {
                        eligible[random.index(eligible.len())].clone()
                    };
                }
            }
        }
        let Ok(total) = rules.budget.resolve(&candidate, catalog) else {
            continue;
        };
        let ratio = total.displacement_kg as f64 / own_totals.displacement_kg as f64;
        let power: f64 = candidate
            .iter()
            .map(|id| strength(&catalog.definitions[id]))
            .sum();
        if !(0.85..=1.15).contains(&ratio) || !(0.8..=1.2).contains(&(power / own_strength)) {
            continue;
        }
        // A generated carrier with companions should have a dedicated screen.
        if candidate.len() > 1
            && candidate
                .iter()
                .any(|id| role(&catalog.definitions[id]) == Some(Role::Carrier))
            && !candidate
                .iter()
                .any(|id| role(&catalog.definitions[id]) == Some(Role::Screen))
        {
            continue;
        }
        let mut identity = candidate.clone();
        identity.sort();
        if identities.insert(identity) {
            candidates.push(candidate);
        }
    }
    let index = if candidates.len() > 1 {
        1 + random.index(candidates.len() - 1)
    } else {
        0
    };
    Ok(candidates.swap_remove(index))
}
/// The cruising formation the opposing admiral puts a surface force in, drawn
/// from the mission seed so a given mission always meets the same shape. A pair
/// simply forms line ahead; a division has the room for two columns; a squadron
/// of five or more prefers the broader bodies. A line abreast is an occasional
/// sweep formation once there are enough hulls to spread out.
fn front_formation(size: usize, random: &mut Random) -> Formation {
    if size <= 2 {
        return Formation::Column;
    }
    match (size <= 4, random.index(8)) {
        (_, 0) => Formation::LineAbreast,
        (true, 1..=4) => Formation::Column,
        (true, _) => Formation::DoubleColumn,
        (false, 1..=4) => Formation::DoubleColumn,
        (false, _) => Formation::TripleColumn,
    }
}
fn enemy_groups(
    catalog: &Catalog,
    ids: Vec<String>,
    seed: u32,
) -> (Vec<FleetShip>, Vec<TaskGroup>) {
    let mut random = Random(seed);
    let mut groups = vec![TaskGroup {
        id: "enemy-front".into(),
        name: "Surface force".into(),
        station: GroupStation::Front,
        formation: None,
    }];
    let mut units: Vec<_> = ids
        .into_iter()
        .enumerate()
        .map(|(i, preset_id)| FleetShip {
            id: format!("opponent-{}", i + 1),
            preset_id,
            group_id: "enemy-front".into(),
        })
        .collect();
    let carriers: Vec<_> = units
        .iter()
        .enumerate()
        .filter(|(_, u)| role(&catalog.definitions[&u.preset_id]) == Some(Role::Carrier))
        .map(|(i, _)| i)
        .collect();
    for (index, carrier) in carriers.iter().enumerate() {
        let id = format!("enemy-rear-{}", index + 1);
        // A carrier keeps its escorts ringed around it rather than astern, so
        // the boats are between the flight deck and whatever finds it.
        groups.push(TaskGroup {
            id: id.clone(),
            name: "Carrier force".into(),
            station: GroupStation::Rear,
            formation: Some(Formation::Screen),
        });
        units[*carrier].group_id = id.clone();
        let escorts: Vec<_> = units
            .iter()
            .enumerate()
            .filter(|(_, u)| {
                u.group_id == "enemy-front"
                    && role(&catalog.definitions[&u.preset_id]) == Some(Role::Screen)
            })
            .map(|(i, _)| i)
            .collect();
        let remaining_carriers = carriers.len() - index;
        let assigned = if remaining_carriers > 1 {
            escorts.len().div_ceil(remaining_carriers).min(2)
        } else {
            escorts.len().min(2)
        };
        for escort in escorts.into_iter().take(assigned) {
            units[escort].group_id = id.clone();
        }
    }
    let front = units.iter().filter(|u| u.group_id == "enemy-front").count();
    groups[0].formation = Some(front_formation(front, &mut random));
    (units, groups)
}
/// Friendly water for a ship: inside the mission area with its hull, 350 m from
/// every ship already placed, and no land sample within `DEPLOYMENT_CLEARANCE_M`.
fn valid_position(
    p: &Spawn,
    def: &ShipDefinition,
    rules: &MissionRules,
    terrain: &Terrain,
    occupied: &[Spawn],
) -> bool {
    [p.x, p.z, p.heading].iter().all(|n| n.is_finite())
        && rules.area.contains([p.x, p.z], def.hull.length / 2.0)
        && occupied
            .iter()
            .all(|o| (o.x - p.x).hypot(o.z - p.z) >= 350.0)
        && !terrain.land_within(p.x, p.z, DEPLOYMENT_CLEARANCE_M)
}
/// Whether a spot lies in its group's deployment band: at least 7 km toward the
/// team's own side, and 14 km for a rear group.
fn in_band(p: &Spawn, sign: f64, station: GroupStation) -> bool {
    let depth = p.z * sign;
    depth >= 7000.0 && (station == GroupStation::Front || depth >= 14000.0)
}
/// Offsets from a desired point, nearest first: rings every `step` metres out to
/// `reach`, each ring starting on the bearing `toward` and alternating either side.
fn rings(step: f64, reach: f64, toward: f64) -> impl Iterator<Item = [f64; 2]> {
    (1..=(reach / step) as usize).flat_map(move |ring| {
        let radius = ring as f64 * step;
        let count = ((std::f64::consts::TAU * radius / step).round() as usize).max(8);
        (0..count).map(move |k| {
            let side = if k % 2 == 1 { 1.0 } else { -1.0 };
            let angle = toward + side * k.div_ceil(2) as f64 * std::f64::consts::TAU / count as f64;
            [radius * angle.cos(), radius * angle.sin()]
        })
    })
}
/// The order a task group forms up in, guide first: a flight deck leads, then
/// the heaviest hull, and ties break on ship id. `admiral::members` sorts
/// the living group the same way, so the ship laid out at the group centre is
/// the ship the group's directives make the guide.
pub(crate) fn member_order(
    a: (&ShipDefinition, &str),
    b: (&ShipDefinition, &str),
) -> std::cmp::Ordering {
    b.0.air_wing
        .is_some()
        .cmp(&a.0.air_wing.is_some())
        .then(b.0.hull.mass_kg.total_cmp(&a.0.hull.mass_kg))
        .then(a.1.cmp(b.1))
}
#[allow(clippy::too_many_arguments)]
fn place_groups(
    catalog: &Catalog,
    rules: &MissionRules,
    terrain: &Terrain,
    units: &[FleetShip],
    groups: &[TaskGroup],
    team: TeamId,
    level: AiLevel,
    seed: u32,
) -> Result<Vec<ShipSetup>, String> {
    let mut random = Random(seed);
    let sign = if team == TeamId::A { 1.0 } else { -1.0 };
    let mut result = vec![];
    let mut occupied = vec![];
    for (g, group) in groups.iter().enumerate() {
        let mut members: Vec<&FleetShip> =
            units.iter().filter(|u| u.group_id == group.id).collect();
        members.sort_by(|a, b| {
            member_order(
                (&catalog.definitions[&a.preset_id], &a.id),
                (&catalog.definitions[&b.preset_id], &b.id),
            )
        });
        let Some(guide) = members.first().copied() else {
            continue;
        };
        // The group starts the battle in the shape it will sail in: the guide at
        // the group centre and every follower on the station its class earns from
        // the shared table, so the first escort orders confirm the layout the
        // chart already shows. A player group with no chosen formation is a column.
        let class = |unit: &FleetShip| StationClass::of(&catalog.definitions[&unit.preset_id]);
        let followers: Vec<_> = members[1..]
            .iter()
            .map(|unit| (unit.id.clone(), class(unit)))
            .collect();
        let stations = formation_stations(
            group.formation.unwrap_or_default(),
            (&guide.id, class(guide)),
            &followers,
        );
        let center_x = (g as f64 - (groups.len() - 1) as f64 / 2.0) * 2600.0 + random.signed(500.0);
        // A station ahead of the guide must not carry the group across its own
        // deployment line, so the centre falls back by whatever the formation
        // reaches forward.
        let ahead = stations.iter().map(|s| s.offset[1]).fold(0.0, f64::min);
        let center_z = (if group.station == GroupStation::Front {
            8000.0
        } else {
            16500.0
        } + random.signed(500.0))
        .max(
            if group.station == GroupStation::Front {
                7200.0
            } else {
                14200.0
            } - ahead,
        );
        let heading = if team == TeamId::A { 0.0 } else { PI };
        // Both fleets steam at each other down the z axis, so the station's
        // [starboard, aft] frame rotates onto the world by the team's sign.
        let spot = |center: [f64; 2], unit: &FleetShip| {
            let offset = stations
                .iter()
                .find(|s| s.id == unit.id)
                .map_or([0.0, 0.0], |s| s.offset);
            Spawn {
                x: center[0] + offset[0] * sign,
                z: (center[1] + offset[1]) * sign,
                heading,
            }
        };
        // When land lies under a station, slide the whole group to the nearest
        // water that holds its shape before any single ship leaves its station.
        let ashore = |p: &Spawn| terrain.land_within(p.x, p.z, DEPLOYMENT_CLEARANCE_M);
        let fits = |center: [f64; 2]| {
            members.iter().all(|unit| {
                let p = spot(center, unit);
                let def = &catalog.definitions[&unit.preset_id];
                in_band(&p, sign, GroupStation::Front)
                    && rules.area.contains([p.x, p.z], def.hull.length / 2.0)
                    && !ashore(&p)
            })
        };
        let mut center = [center_x, center_z];
        if members.iter().any(|unit| ashore(&spot(center, unit))) {
            let toward = if center_x > 0.0 { PI } else { 0.0 };
            let rear_line = 14200.0 - ahead;
            if let Some(shift) = rings(500.0, 8000.0, toward).find(|[dx, dz]| {
                let moved = [center_x + dx, center_z + dz];
                (group.station == GroupStation::Front || moved[1] >= rear_line) && fits(moved)
            }) {
                center = [center_x + shift[0], center_z + shift[1]];
            }
        }
        for unit in members {
            let def = &catalog.definitions[&unit.preset_id];
            let desired = spot(center, unit);
            let legal = |p: &Spawn| {
                in_band(p, sign, group.station) && valid_position(p, def, rules, terrain, &occupied)
            };
            let placement = if valid_position(&desired, def, rules, terrain, &occupied) {
                Some(desired)
            } else {
                // Bounded searches, stable within this deployment stream: the
                // nearest legal water around the station, then a packing grid
                // across the whole deployment band.
                let toward = if desired.x > 0.0 { PI } else { 0.0 };
                rings(350.0, 6000.0, toward)
                    .map(|[dx, dz]| Spawn {
                        x: desired.x + dx,
                        z: desired.z + dz,
                        heading,
                    })
                    .find(|p| legal(p))
                    .or_else(|| {
                        (0..40 * 36)
                            .map(|i| Spawn {
                                x: (i % 40) as f64 * 750.0 - 14625.0,
                                z: (7000.0 + (i / 40) as f64 * 450.0) * sign,
                                heading,
                            })
                            .find(|p| legal(p))
                    })
            }
            .ok_or("No legal water remains for this task group on the selected map")?;
            occupied.push(placement.clone());
            result.push(ShipSetup {
                id: unit.id.clone(),
                preset_id: unit.preset_id.clone(),
                team,
                controller: Controller::Bot,
                ai_level: level,
                spawn: Some(placement),
            });
        }
    }
    Ok(result)
}
