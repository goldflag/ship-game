use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const RULES_JSON: &str = include_str!("../../../assets/gameplay/battle-rules.v1.json");
pub const TICK_RATE: u64 = 60;
pub const DT: f64 = 1.0 / TICK_RATE as f64;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rules {
    pub version: u32,
    pub tick_rate: u64,
    pub duration_seconds: u64,
    pub max_fleet_kg: u64,
    pub max_vessels: usize,
    pub max_carriers: usize,
    pub spawn_distance_m: u64,
    pub load_timeout_seconds: u64,
    pub reconnect_grace_seconds: u64,
    pub held_input_timeout_ms: u64,
    pub times: Vec<WeightedTime>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WeightedTime {
    pub id: String,
    pub weight: u32,
}

impl Default for Rules {
    fn default() -> Self {
        serde_json::from_str(RULES_JSON).expect("versioned rules must parse")
    }
}
impl Rules {
    pub fn deadline_tick(&self) -> u64 {
        self.tick_rate * self.duration_seconds
    }
}

/// Stable identities are independent of a client's friendly/enemy presentation.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, ts_rs::TS,
)]
#[serde(rename_all = "lowercase")]
pub enum TeamId {
    A,
    B,
}
impl TeamId {
    pub fn index(self) -> usize {
        match self {
            Self::A => 0,
            Self::B => 1,
        }
    }
    pub fn other(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FleetEntry {
    pub ship_id: String,
    pub displacement_kg: u64,
    pub carrier: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Fleet {
    pub entries: Vec<FleetEntry>,
    pub displacement_kg: u64,
    pub carriers: usize,
}
#[derive(Clone, Debug, thiserror::Error, PartialEq, Eq)]
pub enum RuleError {
    #[error("Choose at least one vessel.")]
    EmptyFleet,
    #[error("A fleet may contain at most {0} vessels.")]
    TooManyVessels(usize),
    #[error("A fleet may contain at most {0} carriers.")]
    TooManyCarriers(usize),
    #[error("Fleet exceeds the {0} kg displacement budget.")]
    OverBudget(u64),
    #[error("Ship is not in the match catalog: {0}")]
    UnknownShip(String),
    #[error("Invalid catalog displacement for {0}")]
    InvalidDisplacement(String),
    #[error("No eligible maps or weather presets are registered.")]
    EmptyEnvironment,
}

/// Explicit match scoring quantization; physical hull mass is never rewritten.
pub fn match_displacement_kg(mass_kg: f64) -> Option<u64> {
    if !mass_kg.is_finite() || mass_kg < 0.5 || mass_kg > 1e12 {
        return None;
    }
    Some(mass_kg.round() as u64)
}

/// Resolve every value from trusted content. The client submits only preset IDs.
pub fn validate_fleet(
    ids: &[String],
    catalog: &BTreeMap<String, FleetEntry>,
    rules: &Rules,
) -> Result<Fleet, RuleError> {
    if ids.is_empty() {
        return Err(RuleError::EmptyFleet);
    }
    if ids.len() > rules.max_vessels {
        return Err(RuleError::TooManyVessels(rules.max_vessels));
    }
    let mut fleet = Fleet {
        entries: Vec::with_capacity(ids.len()),
        displacement_kg: 0,
        carriers: 0,
    };
    for id in ids {
        let entry = catalog
            .get(id)
            .ok_or_else(|| RuleError::UnknownShip(id.clone()))?;
        if entry.displacement_kg == 0 {
            return Err(RuleError::InvalidDisplacement(id.clone()));
        }
        fleet.displacement_kg = fleet
            .displacement_kg
            .checked_add(entry.displacement_kg)
            .ok_or(RuleError::OverBudget(rules.max_fleet_kg))?;
        fleet.carriers += usize::from(entry.carrier);
        fleet.entries.push(entry.clone());
    }
    if fleet.carriers > rules.max_carriers {
        return Err(RuleError::TooManyCarriers(rules.max_carriers));
    }
    if fleet.displacement_kg > rules.max_fleet_kg {
        return Err(RuleError::OverBudget(rules.max_fleet_kg));
    }
    Ok(fleet)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PhysicalLoss {
    HullFailure,
    Flooding,
    Capsize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Survivor {
    pub team: TeamId,
    pub displacement_kg: u64,
    pub physical_loss: Option<PhysicalLoss>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FinishReason {
    Destruction,
    TimeLimit,
    Forfeit,
    Abandoned,
    Infrastructure,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub winner_team_id: Option<TeamId>,
    pub reason: FinishReason,
    pub final_tick: u64,
    pub afloat_kg: [u64; 2],
}

pub fn afloat_kg(ships: &[Survivor]) -> [u64; 2] {
    let mut totals = [0; 2];
    for ship in ships.iter().filter(|s| s.physical_loss.is_none()) {
        totals[ship.team.index()] += ship.displacement_kg;
    }
    totals
}
/// Call only after all systems finish the tick. A host freezes the first result.
pub fn evaluate_outcome(completed_tick: u64, ships: &[Survivor], rules: &Rules) -> Option<Outcome> {
    let totals = afloat_kg(ships);
    let reason = if totals.contains(&0) {
        FinishReason::Destruction
    } else if completed_tick >= rules.deadline_tick() {
        FinishReason::TimeLimit
    } else {
        return None;
    };
    let winner = match totals[0].cmp(&totals[1]) {
        std::cmp::Ordering::Greater => Some(TeamId::A),
        std::cmp::Ordering::Less => Some(TeamId::B),
        std::cmp::Ordering::Equal => None,
    };
    Some(Outcome {
        winner_team_id: winner,
        reason,
        final_tick: completed_tick,
        afloat_kg: totals,
    })
}

/// Stable wrapping integer mixer; the browser has matching codec/rule fixtures.
pub fn mix32(mut x: u32) -> u32 {
    x = (x ^ (x >> 16)).wrapping_mul(0x21f0_aaad);
    x = (x ^ (x >> 15)).wrapping_mul(0x735a_2d97);
    x ^ (x >> 15)
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSelection {
    pub map_id: String,
    pub weather: String,
    pub time_of_day: String,
    pub sea_seed: u32,
    pub first_player_team: TeamId,
}

pub fn select_environment(
    seed: u32,
    maps: &[String],
    weather: &[String],
    rules: &Rules,
) -> Result<EnvironmentSelection, RuleError> {
    let weather: Vec<_> = weather.iter().filter(|id| id.as_str() != "map").collect();
    if maps.is_empty() || weather.is_empty() || rules.times.is_empty() {
        return Err(RuleError::EmptyEnvironment);
    }
    let total: u32 = rules.times.iter().map(|t| t.weight).sum();
    if total == 0 {
        return Err(RuleError::EmptyEnvironment);
    }
    let mut draw = mix32(seed ^ 0x5449_4d45) % total;
    let time = rules
        .times
        .iter()
        .find(|t| {
            if draw < t.weight {
                true
            } else {
                draw -= t.weight;
                false
            }
        })
        .expect("weighted draw in range");
    Ok(EnvironmentSelection {
        map_id: maps[mix32(seed ^ 0x4d41_5053) as usize % maps.len()].clone(),
        weather: weather[mix32(seed ^ 0x5745_4154) as usize % weather.len()].clone(),
        time_of_day: time.id.clone(),
        sea_seed: mix32(seed ^ 0x5345_4153),
        first_player_team: if mix32(seed ^ 0x5349_4445) & 1 == 0 {
            TeamId::A
        } else {
            TeamId::B
        },
    })
}
