//! Versioned gameplay airframe calibration, independent of visual asset recipes.
use crate::aircraft::Aircraft;
use serde::Deserialize;
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FlightPerformance {
    pub max_speed: f64,
    pub speed_scale: f64,
    pub max_bank: f64,
    pub roll_rate: f64,
    pub climb_pitch: f64,
    pub climb_rate: f64,
    pub acceleration: f64,
    pub min_speed: f64,
    pub turn_drag: f64,
    pub payload_penalty: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Profiles {
    version: u32,
    description: String,
    profiles: BTreeMap<String, FlightPerformance>,
}
fn profiles() -> &'static Profiles {
    static DATA: OnceLock<Profiles> = OnceLock::new();
    DATA.get_or_init(|| {
        let data: Profiles = serde_json::from_str(include_str!(
            "../../../assets/gameplay/aircraft-performance.v1.json"
        ))
        .expect("valid aircraft performance calibration");
        assert_eq!(data.version, 1);
        assert!(!data.description.is_empty());
        data
    })
}

/// Resolved own-aircraft capability; never infer an unseen opponent's profile.
/// Stores and damage reduce performance without changing recovery minimum speed.
pub fn performance_for(p: &Aircraft) -> FlightPerformance {
    let data = &profiles().profiles;
    let mut v = *data
        .get(&p.model_id)
        .unwrap_or_else(|| data.get(&p.role).unwrap_or(&data["torpedo-bomber"]));
    let load = if p.payload && p.role != "fighter" {
        v.payload_penalty
    } else {
        0.0
    };
    let damage = 1.0 - p.hp.clamp(0.0, 100.0) / 100.0;
    v.max_speed *= (1.0 - load * 0.5) * (1.0 - damage * 0.22);
    v.speed_scale *= (1.0 - load * 0.3) * (1.0 - damage * 0.12);
    v.acceleration *= (1.0 - load) * (1.0 - damage * 0.45);
    v.climb_rate *= (1.0 - load) * (1.0 - damage * 0.4);
    v.climb_pitch *= (1.0 - load) * (1.0 - damage * 0.25);
    v.roll_rate *= (1.0 - load * 0.5) * (1.0 - damage * 0.3);
    v.max_bank *= (1.0 - load * 0.25) * (1.0 - damage * 0.12);
    v.turn_drag *= 1.0 + load + damage * 0.5;
    v
}
