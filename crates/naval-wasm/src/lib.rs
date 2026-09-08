use naval_sim::{
    rules::{Rules, Survivor, evaluate_outcome, select_environment},
    trace::{MotionTrace, motion_trace},
};
use wasm_bindgen::prelude::*;
fn error(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
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
        serde_json::to_string(&self.battle.presentation_value().map_err(error)?).map_err(error)
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
}
#[wasm_bindgen]
impl LocalRuntime {
    #[wasm_bindgen(constructor)]
    pub fn new(manifest: &[u8], setup: &str) -> Result<LocalRuntime, JsValue> {
        let runtime = BattleRuntime::new(manifest, setup)?;
        let selected = runtime
            .battle
            .actors
            .iter()
            .find(|a| a.controller == naval_sim::vessel::Controller::Player)
            .map(|a| a.motion.id.clone());
        let mut session = naval_protocol::session::Session::new(
            runtime.battle,
            [naval_sim::rules::TeamId::A, naval_sim::rules::TeamId::B],
        )
        .map_err(error)?;
        session.input_ready[1] = false;
        session.control.players[0].selected_ship_id = selected;
        Ok(Self { session })
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
            self.session.step();
        }
        Ok(())
    }
    pub fn snapshot(&self) -> Result<String, JsValue> {
        let mut frame = self.session.battle.presentation_value().map_err(error)?;
        frame["selectedShipIds"] = serde_json::json!([
            self.session.control.players[0].selected_ship_id,
            self.session.control.players[1].selected_ship_id
        ]);
        frame["fleetOrders"] = serde_json::to_value(self.session.fleet_orders(0)).map_err(error)?;
        frame["phase"] = serde_json::json!(if self.session.battle.outcome.is_some() {
            "finished"
        } else {
            "running"
        });
        serde_json::to_string(&frame).map_err(error)
    }
}

#[wasm_bindgen]
pub fn protocol_version() -> u32 {
    naval_protocol::PROTOCOL_VERSION
}
