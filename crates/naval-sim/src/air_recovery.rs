//! A missing home is not an endurance timer. Sorties may finish an observed
//! combat task; aircraft with no usable task or recovery become unavailable.
use crate::{
    aircraft::*,
    aviation::{Aviation, service_available},
    environment::SeaState,
    vessel::Vessel,
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CarrierRecovery {
    Open,
    Delayed,
    Closed { reason: String },
}
pub fn status(actor: &Vessel, sea: Option<(&SeaState, f64)>) -> CarrierRecovery {
    let reason = if actor.physical_loss().is_some() {
        Some("Carrier lost")
    } else if actor.definition().air_wing.as_ref().is_none_or(|wing| {
        !actor
            .damage
            .modules
            .iter()
            .any(|m| m.id == wing.service_module_id && m.hp > 0.0)
    }) {
        Some("Recovery equipment destroyed")
    } else {
        None
    };
    if let Some(reason) = reason {
        CarrierRecovery::Closed {
            reason: reason.into(),
        }
    } else if service_available(actor, sea)
        && !crate::aircraft_recovery::turn_delays_recovery(actor)
    {
        CarrierRecovery::Open
    } else {
        CarrierRecovery::Delayed
    }
}
fn withdraw(p: &mut Aircraft, ctx: &mut crate::aviation_step::AirContext<'_>, reason: &str) {
    if terminal(p) {
        return;
    }
    p.phase = "withdrawn".into();
    p.loss_reason = Some(format!("Unavailable · {reason}"));
    p.target_id = None;
    p.navigation_target = None;
    p.search = None;
    p.deck_slot = None;
    p.deck_datum = None;
    p.deck_position = None;
    p.deck_heading = None;
    p.recovery_requested_at = None;
    p.timer = 0.0;
    p.wreck = None;
    p.velocity = [0.0; 3];
    // Preserve actual HP/payload/ammunition. Unavailable is not a fabricated kill.
    ctx.events.push(crate::impact::DamageEvent {
        kind: "aircraft-unavailable".into(),
        position: p.position,
        ship_id: p.owner_id.clone(),
        message: format!("{} · {reason}", p.model_id),
        aircraft: Some(crate::impact::AircraftEffect {
            id: p.id.clone(),
            ..Default::default()
        }),
        ..Default::default()
    });
}
impl Aviation {
    /// Called only in observation-mode battles. Returns true after retirement.
    pub(crate) fn retire_without_home(
        &self,
        p: &mut Aircraft,
        actor: &Vessel,
        ctx: &mut crate::aviation_step::AirContext<'_>,
    ) -> bool {
        let Some(crate::air_recovery::CarrierRecovery::Closed { reason }) = self
            .wing(&actor.motion.id)
            .and_then(|w| w.recovery.as_ref())
        else {
            return false;
        };
        if p.hp <= 0.0 {
            crate::aviation_step::lose(
                p,
                ctx.events,
                if airborne(p) && !on_flight_deck(p) {
                    "Shot down"
                } else {
                    "Destroyed aboard carrier"
                },
            );
            return true;
        }
        if !airborne(p) || on_flight_deck(p) {
            if actor.physical_loss().is_some() {
                crate::aviation_step::lose(p, ctx.events, "Carrier lost");
            } else {
                withdraw(p, ctx, reason);
            }
            return true;
        }
        let order = self
            .wing(&actor.motion.id)
            .and_then(|w| {
                w.flights
                    .iter()
                    .find(|f| Some(&f.id) == p.flight_id.as_ref())
            })
            .map(|f| &f.order);
        let k = ctx.knowledge.unwrap();
        let report = |id: &str, kind| {
            k.sensors.contact(p.team, id).is_some_and(|c| {
                c.kind == kind
                    && c.affiliation == crate::sensors::Affiliation::Hostile
                    && k.tick.saturating_sub(c.last_observed_tick)
                        <= (if kind == crate::sensors::ContactKind::Aircraft {
                            45
                        } else {
                            90
                        }) * crate::rules::TICK_RATE
            })
        };
        let feasible = p.hp >= 25.0
            && !matches!(p.phase.as_str(), "returning" | "landing")
            && match order {
                Some(AirOrder::Strike { contact_id }) => {
                    p.payload && report(contact_id, crate::sensors::ContactKind::Surface)
                }
                Some(AirOrder::InterceptContact { contact_id }) => {
                    p.ammo > 0.0 && report(contact_id, crate::sensors::ContactKind::Aircraft)
                }
                Some(AirOrder::SearchArea {
                    policy: SearchPolicy::Strike,
                    ..
                }) => p.payload,
                Some(AirOrder::Defend {
                    target_id: Some(id),
                }) => {
                    p.ammo > 0.0
                        && ctx.actors.iter().any(|a| {
                            &a.motion.id == id && a.team == p.team && a.physical_loss().is_none()
                        })
                }
                Some(AirOrder::Escort { flight_id }) => {
                    p.ammo > 0.0
                        && self.planes().iter().any(|a| {
                            a.team == p.team
                                && a.flight_id.as_ref() == Some(flight_id)
                                && a.hp > 0.0
                                && matches!(a.phase.as_str(), "outbound" | "attack" | "takeoff")
                        })
                }
                _ => false,
            };
        if feasible {
            return false;
        }
        withdraw(p, ctx, reason);
        true
    }
}
