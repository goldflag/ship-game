use naval_sim::{
    rules::{Rules, Survivor, evaluate_outcome, select_environment},
    trace::{MotionTrace, motion_trace},
};
use wasm_bindgen::prelude::*;
fn error(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}
/// Development port inspection uses the same physical movement resolver as combat.
#[wasm_bindgen]
pub fn preview_articulation_json(
    definition: &str,
    current: &str,
    requested: &str,
) -> Result<String, JsValue> {
    use naval_sim::{
        definition::ShipDefinition,
        mount_clearance::{
            ClearancePose, ClearanceResult, MountClearance, move_mount_with_clearance,
        },
        weapons::MountState,
    };
    let def: ShipDefinition = serde_json::from_str(definition).map_err(error)?;
    let mut poses: Vec<ClearancePose> = serde_json::from_str(current).map_err(error)?;
    let mut targets: Vec<ClearancePose> = serde_json::from_str(requested).map_err(error)?;
    if poses.len() != def.mounts.len() || targets.len() != poses.len() {
        return Err(error("Articulation requires one pose per mount"));
    }
    if !poses.iter().chain(&targets).all(|p| {
        [p.train, p.elevation, p.recoil]
            .iter()
            .all(|v| v.is_finite())
    }) {
        return Err(error("Articulation poses must be finite"));
    }
    for (index, target) in targets.iter_mut().enumerate() {
        let weapon = &def.mounts[index].weapon;
        let limits = def.mounts[index]
            .traverse_limits_deg
            .unwrap_or([-weapon.traverse_deg, weapon.traverse_deg]);
        *target = ClearancePose {
            train: target
                .train
                .clamp(limits[0].to_radians(), limits[1].to_radians()),
            elevation: target.elevation.clamp(
                weapon.elevation_min_deg.to_radians(),
                weapon.elevation_max_deg.to_radians(),
            ),
            recoil: target.recoil.clamp(0.0, 1.0),
        };
    }
    // Validate either profile encoding before entering its native resolver.
    let clearance = MountClearance::new(&def).map_err(error)?;
    if def
        .mount_clearance
        .as_ref()
        .is_some_and(|p| p.mounts.is_some())
    {
        let mut states: Vec<_> = def
            .mounts
            .iter()
            .zip(&poses)
            .map(|(mount, pose)| {
                let mut state = MountState::new(mount);
                state.train = pose.train;
                state.elevation = pose.elevation;
                state.recoil = pose.recoil;
                state
            })
            .collect();
        // Interleave small actuator steps against the independently moving neighbors.
        // The native helper encloses each intervening arc and the full recoil stroke.
        let step = 0.5_f64.to_radians();
        for _ in 0..1440 {
            let mut moved = false;
            for (index, target) in targets.iter().enumerate() {
                let mut state = states[index].clone();
                let before = (state.train, state.elevation);
                let next = (
                    state.train + (target.train - state.train).clamp(-step, step),
                    state.elevation + (target.elevation - state.elevation).clamp(-step, step),
                );
                if !move_mount_with_clearance(&def, index, &mut state, next, &states) {
                    let train_only = (next.0, state.elevation);
                    move_mount_with_clearance(&def, index, &mut state, train_only, &states);
                    let elevation_only = (state.train, next.1);
                    move_mount_with_clearance(&def, index, &mut state, elevation_only, &states);
                }
                moved |= (state.train - before.0).abs() + (state.elevation - before.1).abs() > 1e-9;
                states[index] = state;
            }
            if !moved {
                break;
            }
        }
        let results: Vec<_> = states
            .iter()
            .zip(&targets)
            .map(|(state, target)| ClearanceResult {
                pose: ClearancePose {
                    train: state.train,
                    elevation: state.elevation,
                    recoil: target.recoil,
                },
                blocked: (state.train - target.train).abs()
                    + (state.elevation - target.elevation).abs()
                    >= 1e-7,
                obstruction_id: None,
            })
            .collect();
        return serde_json::to_string(&results).map_err(error);
    }
    let mut results = Vec::with_capacity(poses.len());
    for (index, target) in targets.into_iter().enumerate() {
        let result = clearance.as_ref().map_or_else(
            || ClearanceResult {
                pose: target,
                blocked: false,
                obstruction_id: None,
            },
            |cache| cache.resolve(&def, index, &poses, target),
        );
        poses[index] = result.pose;
        results.push(result);
    }
    serde_json::to_string(&results).map_err(error)
}
#[wasm_bindgen]
pub fn rules_json() -> String {
    naval_sim::rules::RULES_JSON.to_owned()
}
#[wasm_bindgen]
pub fn motion_trace_json(json: &str) -> Result<String, JsValue> {
    let input: MotionTrace = serde_json::from_str(json).map_err(error)?;
    serde_json::to_string(&motion_trace(input).map_err(error)?).map_err(error)
}
#[wasm_bindgen]
pub fn evaluate_outcome_json(tick: u32, json: &str) -> Result<String, JsValue> {
    let ships: Vec<Survivor> = serde_json::from_str(json).map_err(error)?;
    if ships.len() > 60
        || ships
            .iter()
            .any(|s| s.displacement_kg == 0 || s.displacement_kg > 1_000_000_000_000)
    {
        return Err(error("Invalid vessel scoring data"));
    }
    serde_json::to_string(&evaluate_outcome(tick.into(), &ships, &Rules::default())).map_err(error)
}
#[wasm_bindgen]
pub fn environment_json(seed: u32, maps: &str, weather: &str) -> Result<String, JsValue> {
    let maps: Vec<String> = serde_json::from_str(maps).map_err(error)?;
    let weather: Vec<String> = serde_json::from_str(weather).map_err(error)?;
    serde_json::to_string(
        &select_environment(seed, &maps, &weather, &Rules::default()).map_err(error)?,
    )
    .map_err(error)
}
/// Migration harness only. Battle sessions will own live input queues and stepping.
#[wasm_bindgen]
pub struct ProjectileMigration {
    catalog: naval_sim::catalog::Catalog,
    compiled: std::collections::BTreeMap<String, std::sync::Arc<naval_sim::vessel::CompiledShip>>,
}
#[wasm_bindgen]
impl ProjectileMigration {
    #[wasm_bindgen(constructor)]
    pub fn new(manifest: &[u8]) -> Result<ProjectileMigration, JsValue> {
        Ok(Self {
            catalog: naval_sim::catalog::Catalog::load(manifest).map_err(error)?,
            compiled: Default::default(),
        })
    }
    pub fn run(&mut self, json: &str) -> Result<String, JsValue> {
        if json.len() > 16384 {
            return Err(error("Trace input exceeds limit"));
        }
        let input: naval_sim::trace::ProjectileTrace = serde_json::from_str(json).map_err(error)?;
        let definition = self
            .catalog
            .definitions
            .get(&input.preset_id)
            .ok_or_else(|| error("Unknown preset"))?;
        if !self.compiled.contains_key(&input.preset_id) {
            let content =
                naval_sim::vessel::CompiledShip::new(definition.clone()).map_err(error)?;
            self.compiled
                .insert(input.preset_id.clone(), std::sync::Arc::new(content));
        }
        let compiled = self.compiled[&input.preset_id].clone();
        serde_json::to_string(&naval_sim::trace::projectile_trace(input, compiled).map_err(error)?)
            .map_err(error)
    }
}

#[wasm_bindgen]
pub fn simulation_build() -> String {
    naval_sim::SIMULATION_BUILD.into()
}
/// Full custom-battle authority. The browser worker schedules fixed ticks; this
/// adapter exposes only addressed input and read-only snapshots.
#[wasm_bindgen]
pub struct BattleRuntime {
    battle: naval_sim::battle::Battle,
}
#[wasm_bindgen]
impl BattleRuntime {
    #[wasm_bindgen(constructor)]
    pub fn new(manifest: &[u8], setup: &str) -> Result<BattleRuntime, JsValue> {
        use std::{collections::BTreeMap, sync::Arc};
        if setup.len() > 65536 {
            return Err(error("Fleet setup exceeds limit"));
        }
        let setup: naval_sim::battle::BattleSetup = serde_json::from_str(setup).map_err(error)?;
        let catalog = Arc::new(naval_sim::catalog::Catalog::load(manifest).map_err(error)?);
        let mut compiled = BTreeMap::new();
        for s in &setup.ships {
            if !compiled.contains_key(&s.preset_id) {
                let def = catalog
                    .definitions
                    .get(&s.preset_id)
                    .ok_or_else(|| error("Unknown ship preset"))?;
                compiled.insert(
                    s.preset_id.clone(),
                    Arc::new(naval_sim::vessel::CompiledShip::new(def.clone()).map_err(error)?),
                );
            }
        }
        Ok(Self {
            battle: naval_sim::battle::Battle::new(catalog, &compiled, setup).map_err(error)?,
        })
    }
    pub fn step(&mut self, json: &str, ticks: u32) -> Result<(), JsValue> {
        if json.len() > 32768 || ticks > 6 {
            return Err(error("Input batch exceeds limit"));
        }
        let orders: std::collections::BTreeMap<String, naval_sim::battle::Orders> =
            serde_json::from_str(json).map_err(error)?;
        if orders.len() > 60 {
            return Err(error("Too many addressed orders"));
        }
        for (id, o) in &orders {
            if !self.battle.actors.iter().any(|a| a.motion.id == *id) {
                return Err(error("Unknown ship"));
            }
            if o.helm.is_some_and(|h| {
                !h.throttle.is_finite()
                    || h.throttle.abs() > 1.0
                    || !h.rudder.is_finite()
                    || h.rudder.abs() > 1.0
                    || h.depth_m
                        .is_some_and(|d| !d.is_finite() || !(0.0..=1000.0).contains(&d))
            }) || o
                .guns
                .as_ref()
                .and_then(|g| g.aim)
                .is_some_and(|p| p.iter().any(|n| !n.is_finite() || n.abs() > 40000.0))
            {
                return Err(error("Input outside allowed bounds"));
            }
        }
        for _ in 0..ticks {
            self.battle.step(&orders)
        }
        Ok(())
    }
    pub fn snapshot(&self) -> Result<String, JsValue> {
        serde_json::to_string(
            &self
                .battle
                .presentation_value(if self.battle.mission_rules.is_some() {
                    naval_sim::snapshot::PresentationView::Team(naval_sim::rules::TeamId::A)
                } else {
                    naval_sim::snapshot::PresentationView::FullKnowledge
                })
                .map_err(error)?,
        )
        .map_err(error)
    }
    /// Full state for deliberate migration checks; never sent by the server.
    pub fn migration_snapshot(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.battle.snapshot()).map_err(error)
    }
    pub fn command_air(
        &mut self,
        actor_id: &str,
        flight_id: &str,
        json: &str,
    ) -> Result<bool, JsValue> {
        if json.len() > 1024 {
            return Err(error("Air order exceeds limit"));
        }
        let order = serde_json::from_str(json).map_err(error)?;
        Ok(self.battle.command_air(actor_id, flight_id, order))
    }
    pub fn recall(&mut self, actor_id: &str, flight_id: Option<String>) {
        if self.battle.outcome.is_none() {
            self.battle.aviation.recall(actor_id, flight_id.as_deref());
        }
    }
}

/// Local battles use the exact addressed command handler used by match workers.
#[wasm_bindgen]
pub struct LocalRuntime {
    session: naval_protocol::session::Session,
    pve_plan: Option<naval_sim::pve::PvePlan>,
    enemy_air_sequence: u32,
}
#[wasm_bindgen]
impl LocalRuntime {
    #[wasm_bindgen(constructor)]
    pub fn new(manifest: &[u8], setup: &str) -> Result<LocalRuntime, JsValue> {
        let runtime = BattleRuntime::new(manifest, setup)?;
        Self::from_battle(runtime.battle, None)
    }
    pub fn command(&mut self, json: &str) -> Result<(), JsValue> {
        if json.len() > naval_protocol::MAX_COMMAND_BYTES {
            return Err(error("Command exceeds limit"));
        }
        self.session
            .apply(0, serde_json::from_str(json).map_err(error)?)
            .map_err(error)
    }
    pub fn step(&mut self, ticks: u32) -> Result<(), JsValue> {
        if ticks > 6 {
            return Err(error("Tick batch exceeds limit"));
        }
        for _ in 0..ticks {
            if let Some(plan) = &self.pve_plan {
                for directive in plan.enemy_air_directives(&self.session.battle) {
                    self.enemy_air_sequence += 1;
                    let command = match directive.intent {
                        naval_sim::pve_air::AirIntent::Order(order) => {
                            naval_protocol::Command::Air {
                                flight_id: directive.flight_id,
                                order,
                            }
                        }
                        naval_sim::pve_air::AirIntent::Deck(action) => {
                            naval_protocol::Command::Deck {
                                flight_id: directive.flight_id,
                                action,
                            }
                        }
                    };
                    // The enemy uses the same ownership, report, role and deck
                    // validation as player commands. It never changes the helm.
                    let _ = self.session.apply(
                        1,
                        naval_protocol::CommandEnvelope {
                            sequence: self.enemy_air_sequence,
                            connection_epoch: self.session.control.players[1].epoch,
                            ship_id: directive.carrier_id,
                            command,
                        },
                    );
                }
                for (id, (movement, target)) in plan.enemy_directives(&self.session.battle) {
                    if let Some(ship) = self.session.control.ships.get_mut(&id) {
                        ship.movement = movement;
                        ship.target_id = target;
                    }
                }
            }
            self.session.step();
        }
        Ok(())
    }
    /// Reuse the frozen opponent and the accepted friendly deployment. No seed
    /// is drawn and no full setup ever crosses into the render thread.
    pub fn restart_pve(&mut self) -> Result<(), JsValue> {
        let plan = self
            .pve_plan
            .as_ref()
            .ok_or_else(|| error("This battle has no saved PvE mission"))?;
        let compiled = self
            .session
            .battle
            .actors
            .iter()
            .map(|a| (a.preset_id.clone(), a.compiled.clone()))
            .collect();
        let battle = naval_sim::battle::Battle::new(
            self.session.battle.catalog.clone(),
            &compiled,
            plan.restart_setup(),
        )
        .map_err(error)?;
        *self = Self::from_battle(battle, Some(plan.clone()))?;
        Ok(())
    }
    pub fn snapshot(&self) -> Result<String, JsValue> {
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct LocalFrame<'a, T: serde::Serialize> {
            #[serde(flatten)]
            frame: T,
            selected_ship_ids: [Option<&'a str>; 2],
            fleet_orders:
                std::collections::BTreeMap<String, naval_protocol::session::FleetOrderState>,
            fleet_notices: &'a [naval_protocol::session::FleetNotice],
            phase: &'static str,
        }
        let selected = &self.session.control.players;
        let phase = if self.session.battle.outcome.is_some() {
            "finished"
        } else {
            "running"
        };
        let fleet_orders = self.session.fleet_orders(0);
        let fleet_notices = self.session.fleet_notices(0);
        if self.session.battle.mission_rules.is_some() && self.session.battle.outcome.is_none() {
            return serde_json::to_string(&LocalFrame {
                frame: self
                    .session
                    .battle
                    .team_presentation_snapshot(naval_sim::rules::TeamId::A),
                selected_ship_ids: [selected[0].selected_ship_id.as_deref(), None],
                fleet_orders,
                fleet_notices,
                phase,
            })
            .map_err(error);
        }
        if self.session.battle.mission_rules.is_some() {
            // Team projection is the information boundary. Never replace it
            // with the full-knowledge streaming serializer for a live mission.
            let mut frame = self
                .session
                .battle
                .presentation_value(naval_sim::snapshot::PresentationView::Team(
                    naval_sim::rules::TeamId::A,
                ))
                .map_err(error)?;
            if self.session.battle.outcome.is_some()
                && let Some(plan) = &self.pve_plan
            {
                frame["debrief"]["mission"] = plan.debrief();
            }
            return serde_json::to_string(&LocalFrame {
                frame,
                selected_ship_ids: [selected[0].selected_ship_id.as_deref(), None],
                fleet_orders,
                fleet_notices,
                phase,
            })
            .map_err(error);
        }
        let frame = LocalFrame {
            frame: self.session.battle.presentation_snapshot(),
            selected_ship_ids: [
                selected[0].selected_ship_id.as_deref(),
                selected[1].selected_ship_id.as_deref(),
            ],
            fleet_orders,
            fleet_notices,
            phase,
        };
        serde_json::to_string(&frame).map_err(error)
    }
}
impl LocalRuntime {
    /// Complete authority state for native diagnostics and the simulation
    /// equality gate. Not exported to JavaScript: a live mission must never
    /// hand the client full knowledge.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn migration_snapshot_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.session.battle.snapshot()).map_err(error)
    }
    /// The match worker's full-knowledge tree projection, for native benchmarks
    /// of the server publication path.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn full_knowledge_value(&self) -> Result<serde_json::Value, JsValue> {
        self.session
            .battle
            .presentation_value(naval_sim::snapshot::PresentationView::FullKnowledge)
            .map_err(error)
    }
    fn from_battle(
        battle: naval_sim::battle::Battle,
        pve_plan: Option<naval_sim::pve::PvePlan>,
    ) -> Result<Self, JsValue> {
        let selected = battle
            .actors
            .iter()
            .find(|a| a.controller == naval_sim::vessel::Controller::Player)
            .map(|a| a.motion.id.clone());
        let mut session = naval_protocol::session::Session::new(
            battle,
            [naval_sim::rules::TeamId::A, naval_sim::rules::TeamId::B],
        )
        .map_err(error)?;
        session.input_ready[1] = false;
        if session.battle.mission_rules.is_none() {
            session.control.players[0].selected_ship_id = selected;
        }
        if let Some(plan) = &pve_plan {
            for (id, (movement, target)) in plan.initial_directives(&session.battle) {
                if let Some(ship) = session.control.ships.get_mut(&id) {
                    ship.movement = movement;
                    ship.target_id = target;
                }
            }
        }
        Ok(Self {
            session,
            pve_plan,
            enemy_air_sequence: 0,
        })
    }
}

/// Preparatory worker state. `briefing` exposes owned deployment only; starting
/// yields a production runtime that owns both private fleets and restart data.
#[wasm_bindgen]
pub struct PvePlanner {
    catalog: std::sync::Arc<naval_sim::catalog::Catalog>,
    plan: naval_sim::pve::PvePlan,
    compiled: std::collections::BTreeMap<String, std::sync::Arc<naval_sim::vessel::CompiledShip>>,
}
#[wasm_bindgen]
impl PvePlanner {
    pub fn options(manifest: &[u8]) -> Result<String, JsValue> {
        let catalog = naval_sim::catalog::Catalog::load(manifest).map_err(error)?;
        let rules = catalog
            .missions
            .get("pve-fleet-v1")
            .ok_or_else(|| error("PvE mission content is unavailable"))?;
        serde_json::to_string(&serde_json::json!({
            "rules": rules,
            "eligiblePresets": naval_sim::pve::eligible_presets(&catalog)
        }))
        .map_err(error)
    }
    #[wasm_bindgen(constructor)]
    pub fn new(manifest: &[u8], request: &str) -> Result<PvePlanner, JsValue> {
        if request.len() > 65536 {
            return Err(error("Mission request exceeds limit"));
        }
        let catalog =
            std::sync::Arc::new(naval_sim::catalog::Catalog::load(manifest).map_err(error)?);
        let plan = naval_sim::pve::PvePlan::generate(
            &catalog,
            serde_json::from_str(request).map_err(error)?,
        )
        .map_err(error)?;
        Ok(Self {
            catalog,
            plan,
            compiled: Default::default(),
        })
    }
    pub fn briefing(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.plan.briefing(&self.catalog)).map_err(error)
    }
    pub fn validate_placement(&mut self, placements: &str) -> Result<(), JsValue> {
        if placements.len() > 16384 {
            return Err(error("Deployment exceeds limit"));
        }
        self.plan
            .deploy(
                &self.catalog,
                serde_json::from_str(placements).map_err(error)?,
            )
            .map_err(error)?;
        Ok(())
    }
    /// `formations` is an optional `{ groupId: Formation }` map chosen on the
    /// deployment screen. It is applied before the opening task-group directives
    /// are derived, so each group sails in the cruising formation the player set.
    pub fn start(
        &mut self,
        placements: &str,
        formations: Option<String>,
    ) -> Result<LocalRuntime, JsValue> {
        if placements.len() > 16384 {
            return Err(error("Deployment exceeds limit"));
        }
        let chosen: std::collections::BTreeMap<String, naval_sim::navigation::Formation> =
            match &formations {
                Some(json) if json.len() > 4096 => {
                    return Err(error("Formation selection exceeds limit"));
                }
                Some(json) => serde_json::from_str(json).map_err(error)?,
                None => Default::default(),
            };
        let setup = self
            .plan
            .deploy(
                &self.catalog,
                serde_json::from_str(placements).map_err(error)?,
            )
            .map_err(error)?;
        // Only an accepted deployment changes the frozen plan.
        self.plan.set_formations(&chosen);
        for ship in &setup.ships {
            if !self.compiled.contains_key(&ship.preset_id) {
                let def = self
                    .catalog
                    .definitions
                    .get(&ship.preset_id)
                    .ok_or_else(|| error("Unknown ship preset"))?;
                self.compiled.insert(
                    ship.preset_id.clone(),
                    std::sync::Arc::new(
                        naval_sim::vessel::CompiledShip::new(def.clone()).map_err(error)?,
                    ),
                );
            }
        }
        let battle = naval_sim::battle::Battle::new(self.catalog.clone(), &self.compiled, setup)
            .map_err(error)?;
        LocalRuntime::from_battle(battle, Some(self.plan.clone()))
    }
}

#[wasm_bindgen]
pub fn protocol_version() -> u32 {
    naval_protocol::PROTOCOL_VERSION
}
