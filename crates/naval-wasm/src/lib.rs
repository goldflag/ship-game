use wasm_bindgen::prelude::*;
fn error(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}
/// Pure authoritative source compilation. JSON outputs always echo the source revision.
#[wasm_bindgen]
pub fn compile_construction(source_json: &str, catalog_json: &str) -> Result<String, JsValue> {
    naval_sim::construction::compile_json(source_json, catalog_json).map_err(error)
}

/// Display-only shape library generated from the native construction recipes.
#[wasm_bindgen]
pub fn construction_shape_library() -> String {
    naval_sim::construction_shapes::display_library()
}
#[wasm_bindgen]
pub fn suggest_construction(
    source_json: &str,
    catalog_json: &str,
    part_ids_json: &str,
) -> Result<String, JsValue> {
    naval_sim::construction::suggest_json(source_json, catalog_json, part_ids_json).map_err(error)
}
/// Development port inspection uses the same physical movement resolver as combat.
#[wasm_bindgen]
pub fn preview_articulation_json(
    definition: &str,
    current: &str,
    requested: &str,
) -> Result<String, JsValue> {
    ArticulationPreview::new(definition)?.resolve(current, requested)
}

/// One immutable reviewed definition and its native collision acceleration data.
/// Repeated sample poses retain exactly the stateless resolver's behavior.
#[wasm_bindgen]
pub struct ArticulationPreview {
    definition: naval_sim::definition::ShipDefinition,
    clearance: Option<naval_sim::mount_clearance::MountClearance>,
}
#[wasm_bindgen]
impl ArticulationPreview {
    #[wasm_bindgen(constructor)]
    pub fn new(definition: &str) -> Result<ArticulationPreview, JsValue> {
        let definition = serde_json::from_str(definition).map_err(error)?;
        let clearance =
            naval_sim::mount_clearance::MountClearance::new(&definition).map_err(error)?;
        Ok(Self {
            definition,
            clearance,
        })
    }
    pub fn resolve(&self, current: &str, requested: &str) -> Result<String, JsValue> {
        use naval_sim::{
            mount_clearance::{ClearancePose, ClearanceResult, move_mount_with_clearance},
            weapons::MountState,
        };
        let def = &self.definition;
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
        let clearance = &self.clearance;
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
                    moved |=
                        (state.train - before.0).abs() + (state.elevation - before.1).abs() > 1e-9;
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
}
#[wasm_bindgen]
pub fn simulation_build() -> String {
    naval_sim::SIMULATION_BUILD.into()
}
/// Compiles the setup's presets and builds a battle for local authority.
fn build_battle(manifest: &[u8], setup: &str) -> Result<naval_sim::battle::Battle, JsValue> {
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
                Arc::new(
                    naval_sim::vessel::CompiledShip::new(
                        def.clone(),
                        catalog.hydrostatics.get(&s.preset_id),
                    )
                    .map_err(error)?,
                ),
            );
        }
    }
    naval_sim::battle::Battle::new(catalog, &compiled, setup).map_err(error)
}

/// Local battles use the exact addressed command handler used by match workers.
#[wasm_bindgen]
pub struct LocalRuntime {
    trial: bool,
    trial_setup: Option<naval_sim::battle::BattleSetup>,
    session: naval_protocol::session::Session,
    pve_plan: Option<naval_sim::pve::PvePlan>,
    enemy_air_sequence: u32,
    /// The frame this runtime last published, so the next one can travel as a
    /// patch. Dropped with the runtime on init, deploy and restart, which is
    /// exactly when the client discards its own baseline.
    delta: naval_sim::frame_delta::FrameDelta,
}

#[cfg(test)]
mod construction_trial_tests {
    use super::*;
    #[test]
    fn articulation_preview_keeps_requests_independent() {
        let json = std::fs::read_to_string("../../public/models/fletcher.json").unwrap();
        let preview = ArticulationPreview::new(&json).unwrap();
        let count = preview.definition.mounts.len();
        let rest = serde_json::to_string(&vec![
            naval_sim::mount_clearance::ClearancePose {
                train: 0.,
                elevation: 0.,
                recoil: 0.,
            };
            count
        ])
        .unwrap();
        let target = serde_json::to_string(&vec![
            naval_sim::mount_clearance::ClearancePose {
                train: 0.02,
                elevation: 0.1,
                recoil: 0.5,
            };
            count
        ])
        .unwrap();
        let first = preview.resolve(&rest, &target).unwrap();
        preview.resolve(&target, &rest).unwrap();
        assert_eq!(first, preview.resolve(&rest, &target).unwrap());
        assert_eq!(
            first,
            preview_articulation_json(&json, &rest, &target).unwrap()
        );
    }
    #[test]
    fn trial_uses_hp_units_resets_delta_and_disables_opponent_orders() {
        use naval_sim::{
            battle::{BattleSetup, ShipSetup},
            bots::AiLevel,
            rules::TeamId,
            vessel::Controller,
        };
        let setup = BattleSetup {
            ships: [("player", TeamId::A), ("target", TeamId::B)]
                .into_iter()
                .map(|(id, team)| ShipSetup {
                    id: id.into(),
                    preset_id: "fletcher".into(),
                    team,
                    controller: if team == TeamId::A {
                        Controller::Player
                    } else {
                        Controller::Bot
                    },
                    ai_level: AiLevel::Normal,
                    spawn: None,
                })
                .collect(),
            seed: 7,
            map_id: "north-atlantic".into(),
            weather: "clear".into(),
            spawn_distance: 3000.,
            wind_speed: Some(0.),
            mission_rules: None,
            air_rules: None,
        };
        let manifest = std::fs::read("../../.build/naval-content/manifest.json").unwrap();
        let setup = serde_json::to_string(&setup).unwrap();
        let mut runtime =
            LocalRuntime::with_construction(&manifest, &setup, "[]", "[]", true).unwrap();
        let health = runtime.session.battle.actors[0].damage.integrity;
        runtime.snapshot_delta(vec![]).unwrap();
        runtime
            .trial_action(r#"{"kind":"damage","actorId":"player","amount":10}"#)
            .unwrap();
        assert_eq!(
            runtime.session.battle.actors[0].damage.integrity,
            health - 10.
        );
        let delta: serde_json::Value =
            serde_json::from_str(&runtime.snapshot_delta(vec![]).unwrap()).unwrap();
        assert!(delta["baseTick"].is_null());
        let target = &runtime.session.control.ships["target"];
        assert!(!target.weapons.guns && !target.weapons.aa && !target.weapons.torpedoes);
        assert!(matches!(
            target.movement,
            naval_sim::navigation::Movement::Hold
        ));
        let compiled = runtime.session.battle.actors[0].compiled.clone();
        runtime.reset_trial().unwrap();
        assert_eq!(runtime.session.battle.tick, 0);
        assert_eq!(runtime.session.battle.actors[0].damage.integrity, health);
        assert!(std::sync::Arc::ptr_eq(
            &compiled,
            &runtime.session.battle.actors[0].compiled
        ));
        let frame: serde_json::Value =
            serde_json::from_str(&runtime.snapshot_delta(vec![]).unwrap()).unwrap();
        assert!(frame["baseTick"].is_null());
        assert!(!runtime.session.control.ships["target"].weapons.guns);
    }
}

/// What to do with the assembled frame. The three information-boundary branches
/// build different frame types, so the destination is a parameter rather than a
/// second copy of the branches.
trait FrameSink {
    type Out;
    fn take<T: serde::Serialize>(self, frame: &T) -> Result<Self::Out, JsValue>;
}
struct AsText;
impl FrameSink for AsText {
    type Out = String;
    fn take<T: serde::Serialize>(self, frame: &T) -> Result<String, JsValue> {
        serde_json::to_string(frame).map_err(error)
    }
}
struct AsDelta<'a>(&'a mut naval_sim::frame_delta::FrameDelta);
impl FrameSink for AsDelta<'_> {
    /// The tick the client is holding, and whether anything moved. The patch
    /// itself stays in the runtime's reused buffer.
    type Out = (Option<u64>, bool);
    fn take<T: serde::Serialize>(self, frame: &T) -> Result<Self::Out, JsValue> {
        let baseline = self.0.baseline_tick();
        let changed = self.0.encode(frame).map_err(error)?;
        Ok((baseline, changed))
    }
}
#[wasm_bindgen]
impl LocalRuntime {
    #[wasm_bindgen(constructor)]
    pub fn new(manifest: &[u8], setup: &str) -> Result<LocalRuntime, JsValue> {
        Self::from_battle(build_battle(manifest, setup)?, None)
    }
    /// Local source admission is deliberately absent from the online protocol.
    pub fn with_construction(
        manifest: &[u8],
        setup: &str,
        sources_json: &str,
        catalog_json: &str,
        trial: bool,
    ) -> Result<LocalRuntime, JsValue> {
        use std::{collections::BTreeMap, sync::Arc};
        if setup.len() > 65536
            || sources_json.len() > naval_sim::construction::MAX_SOURCE_BYTES * 4
            || catalog_json.len() > naval_sim::construction::MAX_CATALOG_BYTES * 8
        {
            return Err(error("Local construction input exceeds size limit"));
        }
        let mut setup: naval_sim::battle::BattleSetup =
            serde_json::from_str(setup).map_err(error)?;
        if setup.mission_rules.is_some() {
            return Err(error(
                "Construction is available only in local custom battles and trials",
            ));
        }
        if trial {
            for ship in &mut setup.ships {
                if ship.team == naval_sim::rules::TeamId::B {
                    ship.ai_level = naval_sim::bots::AiLevel::Static;
                    ship.controller = naval_sim::vessel::Controller::Bot;
                }
            }
        }
        let sources: Vec<naval_sim::definition::ConstructionSource> =
            serde_json::from_str(sources_json).map_err(error)?;
        let parts: Vec<naval_sim::definition::ConstructionCatalog> =
            if catalog_json.trim_start().starts_with('[') {
                serde_json::from_str(catalog_json).map_err(error)?
            } else {
                vec![serde_json::from_str(catalog_json).map_err(error)?]
            };
        let catalog = Arc::new(
            naval_sim::catalog::Catalog::load(manifest)
                .map_err(error)?
                .with_construction_catalogs(&sources, &parts)
                .map_err(error)?,
        );
        let mut compiled = BTreeMap::new();
        for ship in &setup.ships {
            if !compiled.contains_key(&ship.preset_id) {
                compiled.insert(
                    ship.preset_id.clone(),
                    Arc::new(catalog.compile(&ship.preset_id).map_err(error)?),
                );
            }
        }
        let trial_setup = trial.then(|| setup.clone());
        let battle = naval_sim::battle::Battle::new(catalog, &compiled, setup).map_err(error)?;
        let mut runtime = Self::from_battle(battle, None)?;
        runtime.trial = trial;
        runtime.trial_setup = trial_setup;
        if trial {
            runtime.hold_trial_opponents();
        }
        Ok(runtime)
    }
    fn hold_trial_opponents(&mut self) {
        for actor in self
            .session
            .battle
            .actors
            .iter()
            .filter(|a| a.team == naval_sim::rules::TeamId::B)
        {
            if let Some(control) = self.session.control.ships.get_mut(&actor.motion.id) {
                control.movement = naval_sim::navigation::Movement::Hold;
                control.weapons = naval_sim::navigation::WeaponsPolicy {
                    guns: false,
                    aa: false,
                    torpedoes: false,
                };
            }
        }
    }
    /// Reset combat state against the same verified immutable ship definitions.
    /// A trial reset must not rerun source CSG or observe later catalog edits.
    pub fn reset_trial(&mut self) -> Result<(), JsValue> {
        let setup = self
            .trial_setup
            .clone()
            .ok_or_else(|| error("No local trial to reset"))?;
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
            setup.clone(),
        )
        .map_err(error)?;
        let mut next = Self::from_battle(battle, None)?;
        next.trial = true;
        next.trial_setup = Some(setup);
        next.hold_trial_opponents();
        *self = next;
        Ok(())
    }
    pub fn construction_definitions(&self) -> Result<String, JsValue> {
        let definitions: std::collections::BTreeMap<_, _> = self
            .session
            .battle
            .actors
            .iter()
            .filter(|a| a.definition().hull.volume.is_some())
            .map(|a| (a.preset_id.clone(), a.definition()))
            .collect();
        naval_sim::construction::to_json(&definitions).map_err(error)
    }
    /// Trial controls never enter the network command envelope. Damage cannot modify source.
    pub fn trial_action(&mut self, json: &str) -> Result<(), JsValue> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Action {
            kind: String,
            actor_id: String,
            compartment_id: Option<String>,
            module_id: Option<String>,
            amount: f64,
        }
        if !self.trial || self.pve_plan.is_some() {
            return Err(error("Trial controls are unavailable in this session"));
        }
        if json.len() > 4096 {
            return Err(error("Trial action exceeds size limit"));
        }
        let action: Action = serde_json::from_str(json).map_err(error)?;
        if !action.amount.is_finite() || action.amount < 0. || action.amount > 1e9 {
            return Err(error("Invalid trial amount"));
        }
        let actor = self
            .session
            .battle
            .actors
            .iter_mut()
            .find(|a| a.motion.id == action.actor_id)
            .ok_or_else(|| error("Unknown trial actor"))?;
        match action.kind.as_str() {
            "flood" => {
                let i = actor
                    .definition()
                    .compartments
                    .iter()
                    .position(|c| Some(c.id.as_str()) == action.compartment_id.as_deref())
                    .ok_or_else(|| error("Unknown trial compartment"))?;
                actor.damage.compartments[i].water_m3 = action
                    .amount
                    .min(actor.definition().compartments[i].capacity_m3);
                actor.damage.stability.elapsed = 1.;
            }
            "damage" => {
                // The trial API accepts displayed HP, while the shared combat
                // helper accepts the historical unscaled damage unit.
                naval_sim::damage::damage_hull(
                    actor,
                    action.amount / naval_sim::damage::HULL_HP_SCALE,
                    None,
                );
            }
            "module-damage" => {
                let i = actor
                    .definition()
                    .modules
                    .iter()
                    .position(|m| Some(m.id.as_str()) == action.module_id.as_deref())
                    .ok_or_else(|| error("Unknown trial module"))?;
                actor.damage.modules[i].hp = (actor.damage.modules[i].hp - action.amount).max(0.);
            }
            _ => return Err(error("Unknown trial action")),
        }
        self.delta = Default::default();
        Ok(())
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
                        naval_sim::aviation::AirIntent::Order(order) => {
                            naval_protocol::Command::Air {
                                flight_id: directive.flight_id,
                                order,
                            }
                        }
                        naval_sim::aviation::AirIntent::Deck(action) => {
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
        self.detailed_snapshot(Vec::new())
    }
    /// `detail` names the hulls whose damage-control rooms, portable pumping and
    /// flood connections the client actually reads: the followed or helm ship
    /// and, in a custom battle, the inspected target. Half of a fleet-command
    /// frame is those three fields; an empty list keeps them for every ship.
    pub fn detailed_snapshot(&self, detail: Vec<String>) -> Result<String, JsValue> {
        present(&self.session, &self.pve_plan, &detail, AsText)
    }
    /// The same frame as [`Self::detailed_snapshot`], as an ordered patch against
    /// the one this runtime published last, in the shape `localSnapshotDelta.ts`
    /// applies: `{"baseTick":n|null,"tick":n,"delta":<patch>}`. `delta` is absent
    /// when nothing moved, and `baseTick` is null for the first frame of a
    /// battle, which travels whole. The worker parses the patch instead of
    /// parsing, null-stripping and diffing a whole frame.
    pub fn snapshot_delta(&mut self, detail: Vec<String>) -> Result<String, JsValue> {
        let (baseline, changed) = present(
            &self.session,
            &self.pve_plan,
            &detail,
            AsDelta(&mut self.delta),
        )?;
        let mut out = String::from("{\"baseTick\":");
        match baseline {
            Some(tick) => out.push_str(&tick.to_string()),
            None => out.push_str("null"),
        }
        out.push_str(",\"tick\":");
        out.push_str(&self.session.battle.tick.to_string());
        if changed {
            out.push_str(",\"delta\":");
            out.push_str(self.delta.patch());
        }
        out.push('}');
        Ok(out)
    }
}

/// Assemble the local frame behind the information boundary and hand it to
/// `sink`. A live mission never reaches the full-knowledge serializer.
fn present<S: FrameSink>(
    session: &naval_protocol::session::Session,
    pve_plan: &Option<naval_sim::pve::PvePlan>,
    detail: &[String],
    sink: S,
) -> Result<S::Out, JsValue> {
    if detail.len() > 4 || detail.iter().any(|id| id.len() > 64) {
        return Err(error("Invalid snapshot detail"));
    }
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct LocalFrame<'a, T: serde::Serialize> {
        #[serde(flatten)]
        frame: T,
        selected_ship_ids: [Option<&'a str>; 2],
        fleet_orders: std::collections::BTreeMap<String, naval_protocol::session::FleetOrderState>,
        fleet_notices: &'a [naval_protocol::session::FleetNotice],
        phase: &'static str,
    }
    let selected = &session.control.players;
    let phase = if session.battle.outcome.is_some() {
        "finished"
    } else {
        "running"
    };
    let fleet_orders = session.fleet_orders(0);
    let fleet_notices = session.fleet_notices(0);
    if session.battle.mission_rules.is_some() && session.battle.outcome.is_none() {
        return sink.take(&LocalFrame {
            frame: session
                .battle
                .detailed_team_presentation_snapshot(naval_sim::rules::TeamId::A, detail),
            selected_ship_ids: [selected[0].selected_ship_id.as_deref(), None],
            fleet_orders,
            fleet_notices,
            phase,
        });
    }
    if session.battle.mission_rules.is_some() {
        // Team projection is the information boundary. Never replace it
        // with the full-knowledge streaming serializer for a live mission.
        let mut frame = session
            .battle
            .detailed_presentation_value(
                naval_sim::snapshot::PresentationView::Team(naval_sim::rules::TeamId::A),
                detail,
            )
            .map_err(error)?;
        if session.battle.outcome.is_some()
            && let Some(plan) = pve_plan
        {
            frame["debrief"]["mission"] = plan.debrief();
        }
        return sink.take(&LocalFrame {
            frame,
            selected_ship_ids: [selected[0].selected_ship_id.as_deref(), None],
            fleet_orders,
            fleet_notices,
            phase,
        });
    }
    sink.take(&LocalFrame {
        frame: session.battle.detailed_presentation_snapshot(detail),
        selected_ship_ids: [
            selected[0].selected_ship_id.as_deref(),
            selected[1].selected_ship_id.as_deref(),
        ],
        fleet_orders,
        fleet_notices,
        phase,
    })
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
            trial: false,
            trial_setup: None,
            pve_plan,
            enemy_air_sequence: 0,
            delta: Default::default(),
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
                        naval_sim::vessel::CompiledShip::new(
                            def.clone(),
                            self.catalog.hydrostatics.get(&ship.preset_id),
                        )
                        .map_err(error)?,
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
