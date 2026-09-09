//! Frozen operating policy, separate from authored inventory and deck geometry.
use crate::{catalog::Catalog, definition::ShipDefinition};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ActiveFlights {
    Authored,
    Limited { maximum: usize },
    Unlimited,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EndurancePolicy {
    Disabled,
    Timed {
        order_limit_seconds: f64,
        recall_seconds: f64,
        fighter_recall_seconds: f64,
        exhaustion_seconds: f64,
    },
}
impl EndurancePolicy {
    pub fn rejects_order(&self, elapsed: f64) -> bool {
        matches!(self, Self::Timed { order_limit_seconds, .. } if elapsed > *order_limit_seconds)
    }
    pub fn needs_recall(&self, elapsed: f64, fighter: bool) -> bool {
        match self {
            Self::Disabled => false,
            Self::Timed {
                recall_seconds,
                fighter_recall_seconds,
                ..
            } => {
                elapsed
                    > if fighter {
                        *fighter_recall_seconds
                    } else {
                        *recall_seconds
                    }
            }
        }
    }
    pub fn exhausted(&self, elapsed: f64) -> bool {
        matches!(self, Self::Timed { exhaustion_seconds, .. } if elapsed > *exhaustion_seconds)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AirRules {
    pub version: u32,
    pub id: String,
    /// Null uses the existing authored operating value; inventory is never overridden.
    pub group_size: Option<usize>,
    pub deck_capacity: Option<usize>,
    pub active_flights: ActiveFlights,
    pub endurance: EndurancePolicy,
    pub launch_group_seconds: f64,
    pub repair_ceiling_hp: f64,
}
#[derive(Clone, Debug)]
pub struct CarrierAirRules {
    pub group_size: usize,
    pub deck_capacity: usize,
    pub active_flights: Option<usize>,
}
impl AirRules {
    /// Explicit compatibility default for setups written before air profiles.
    pub fn legacy() -> Self {
        serde_json::from_str(include_str!("../../../assets/gameplay/legacy-air.v1.json")).unwrap()
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || self.id.is_empty()
            || self.id.len() > 64
            || self.group_size.is_some_and(|n| !(1..=12).contains(&n))
            || self.deck_capacity.is_some_and(|n| !(1..=100).contains(&n))
            || matches!(self.active_flights, ActiveFlights::Limited { maximum } if !(1..=100).contains(&maximum))
            || !self.launch_group_seconds.is_finite()
            || !(5.0..=120.0).contains(&self.launch_group_seconds)
            || !self.repair_ceiling_hp.is_finite()
            || !(0.0..=100.0).contains(&self.repair_ceiling_hp)
        {
            return Err("Invalid air operations profile".into());
        }
        if let EndurancePolicy::Timed {
            order_limit_seconds,
            recall_seconds,
            fighter_recall_seconds,
            exhaustion_seconds,
        } = self.endurance
            && (![
                order_limit_seconds,
                recall_seconds,
                fighter_recall_seconds,
                exhaustion_seconds,
            ]
            .iter()
            .all(|v| v.is_finite() && *v > 0.0 && *v <= 21600.0)
                || order_limit_seconds > exhaustion_seconds
                || recall_seconds >= exhaustion_seconds
                || fighter_recall_seconds >= exhaustion_seconds)
        {
            return Err("Invalid aircraft endurance policy".into());
        }
        Ok(())
    }
    pub fn validate_selection(&self, catalog: &Catalog) -> Result<(), String> {
        self.validate()?;
        match catalog.air_profiles.get(&self.id) {
            Some(profile) if profile == self => Ok(()),
            Some(_) => Err("Air rules do not match installed content".into()),
            None => Err("Unknown air operations profile".into()),
        }
    }
    pub fn resolve(&self, definition: &ShipDefinition) -> Result<CarrierAirRules, String> {
        self.validate()?;
        let wing = definition.air_wing.as_ref().ok_or("Ship has no air wing")?;
        let integer = |value: f64, maximum: usize| -> Result<usize, String> {
            if !value.is_finite() || value.fract() != 0.0 || value < 1.0 || value > maximum as f64 {
                Err("Invalid authored carrier operating capacity".into())
            } else {
                Ok(value as usize)
            }
        };
        let group_size = self
            .group_size
            .unwrap_or(integer(wing.flight_size.unwrap_or(3.0), 12)?);
        let physical_capacity = integer(wing.deck_capacity.unwrap_or(18.0), 100)?;
        let deck_capacity = self.deck_capacity.unwrap_or(physical_capacity);
        if deck_capacity > physical_capacity {
            return Err("Air profile exceeds the authored deck capacity".into());
        }
        let active_flights = match self.active_flights {
            ActiveFlights::Authored => Some(integer(wing.max_active_flights.unwrap_or(4.0), 100)?),
            ActiveFlights::Limited { maximum } => Some(maximum),
            ActiveFlights::Unlimited => None,
        };
        Ok(CarrierAirRules {
            group_size,
            deck_capacity,
            active_flights,
        })
    }
}
