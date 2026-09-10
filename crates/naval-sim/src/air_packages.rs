//! Small, carrier-local attack packages. Geometry enters only through the
//! caller's permitted strike solution; package membership discloses no target.
use super::*;
use crate::{
    aircraft_flight::{FlightOptions, fly},
    aircraft_tactics::orbit_point,
    definition::Vec3,
    geometry::wrap_angle,
};
use std::{collections::BTreeMap, f64::consts::FRAC_PI_2};

#[derive(Clone, Debug)]
pub struct PackageMember {
    pub flight_id: String,
    pub role: String,
    ready: bool,
    heading: Option<f64>,
}
#[derive(Clone, Debug)]
pub struct AttackPackage {
    pub id: u64,
    pub owner_id: String,
    order: AirOrder,
    pub members: Vec<PackageMember>,
    created_at: f64,
    rendezvous_at: Option<f64>,
    committed_at: Option<f64>,
    first_release_at: Option<f64>,
    target: Option<Vec3>,
    /// Individual aircraft leave immediately; nobody circles the target waiting
    /// for a wingmate. This clock bounds the shared withdrawal transition.
    exits: BTreeMap<String, (f64, Vec3)>,
}
impl Aviation {
    pub(crate) fn record_package_order(&mut self, actor: &Vessel, id: &str, order: &AirOrder) {
        if !matches!(order, AirOrder::Attack { .. } | AirOrder::Strike { .. }) {
            return;
        }
        let Some(role) = self
            .wing(&actor.motion.id)
            .and_then(|w| w.planes.iter().find(|p| p.flight_id.as_deref() == Some(id)))
            .map(|p| p.role.clone())
        else {
            return;
        };
        if role == "fighter" {
            return;
        }
        let now = self.operations.now;
        let member = PackageMember {
            flight_id: id.into(),
            role,
            ready: false,
            heading: None,
        };
        if let Some(package) = self.operations.packages.iter_mut().rev().find(|p| {
            p.owner_id == actor.motion.id
                && p.order == *order
                && p.members.len() < 3
                && now - p.created_at <= 30.0
                && p.committed_at.is_none()
        }) {
            package.members.push(member);
        } else {
            self.operations.package_sequence += 1;
            self.operations.packages.push(AttackPackage {
                id: self.operations.package_sequence,
                owner_id: actor.motion.id.clone(),
                order: order.clone(),
                members: vec![member],
                created_at: now,
                rendezvous_at: None,
                committed_at: None,
                first_release_at: None,
                target: None,
                exits: BTreeMap::new(),
            });
        }
    }
    pub(crate) fn refresh_packages(&mut self) {
        let now = self.operations.now;
        let wings = &self.wings;
        for package in &mut self.operations.packages {
            let Some(w) = wings.iter().find(|w| w.owner_id == package.owner_id) else {
                package.members.clear();
                continue;
            };
            package.members.retain(|m| {
                w.state.flights.iter().any(|f| f.id == m.flight_id)
                    && w.state.planes.iter().any(|p| {
                        p.flight_id.as_deref() == Some(&m.flight_id)
                            && !terminal(p)
                            && !matches!(
                                p.phase.as_str(),
                                "ready" | "hangar" | "repairing" | "rearming"
                            )
                    })
            });
            for m in &mut package.members {
                // A surviving wingmate assumes readiness when a leader is lost.
                m.ready = package.target.is_some_and(|target| {
                    w.state.planes.iter().any(|p| {
                        p.flight_id.as_deref() == Some(&m.flight_id)
                            && matches!(p.phase.as_str(), "outbound" | "attack")
                            && p.payload
                            && p.hp >= 25.0
                            && (p.position[0] - target[0]).hypot(p.position[2] - target[2]) < 6000.0
                    })
                });
            }
            if package.first_release_at.is_none()
                && w.state.planes.iter().any(|p| {
                    !p.payload
                        && !terminal(p)
                        && crate::aircraft::airborne(p)
                        && package
                            .members
                            .iter()
                            .any(|m| p.flight_id.as_deref() == Some(&m.flight_id))
                })
            {
                package.first_release_at = Some(now);
            }
        }
        self.operations.packages.retain(|p| !p.members.is_empty());
        for package in &self.operations.packages {
            if package.members.len() < 2 {
                continue;
            }
            let state = if package.first_release_at.is_some_and(|at| now - at >= 25.0) {
                "withdrawing"
            } else if package.first_release_at.is_some() {
                "release window"
            } else if package.committed_at.is_some() {
                "attack committed"
            } else {
                "assembling · rendezvous limited to 26s"
            };
            if let Some(w) = self
                .wings
                .iter_mut()
                .find(|w| w.owner_id == package.owner_id)
            {
                for f in &mut w.state.flights {
                    if package.members.iter().any(|m| m.flight_id == f.id)
                        && f.notice
                            .as_deref()
                            .is_none_or(|n| n.starts_with("Attack package "))
                    {
                        f.notice = Some(format!("Attack package {} · {}", package.id, state));
                    }
                }
            }
        }
    }
    /// Call after obtaining a permitted target solution and before ordinary
    /// strike ingress. True means this hook flew a bounded rendezvous leg or
    /// ordered withdrawal; false leaves the ordinary attack controller in charge.
    pub fn package_guidance(
        &mut self,
        p: &mut Aircraft,
        target: Vec3,
        target_heading: f64,
        dt: f64,
    ) -> bool {
        let now = self.operations.now;
        let Some(package) = self.operations.packages.iter_mut().find(|g| {
            g.owner_id == p.owner_id
                && g.members
                    .iter()
                    .any(|m| p.flight_id.as_deref() == Some(&m.flight_id))
        }) else {
            return false;
        };
        package.target = Some(target);
        if package.members.len() > 1 && package.first_release_at.is_some_and(|at| now - at >= 25.0)
        {
            p.phase = "returning".into();
            return true;
        }
        let index = package
            .members
            .iter()
            .position(|m| p.flight_id.as_deref() == Some(&m.flight_id))
            .unwrap();
        let coordinated = package.members.len() > 1;
        // Single flights retain their original ingress and have no rendezvous.
        if coordinated && p.pilot.attack_heading.is_none() {
            let role = &package.members[index].role;
            let peers = package.members[..index]
                .iter()
                .filter(|m| m.role == *role)
                .count();
            let side = if (p.position[0] - target[0]) * target_heading.cos()
                + (p.position[2] - target[2]) * target_heading.sin()
                > 0.0
            {
                -1.0
            } else {
                1.0
            };
            let heading = package.members[index].heading.unwrap_or_else(|| {
                if role == "torpedo-bomber" {
                    target_heading + side * FRAC_PI_2 + peers as f64 * 0.12
                } else {
                    let bearing = (target[0] - p.position[0]).atan2(p.position[2] - target[2]);
                    // Dive flights flank the torpedo axis without forcing a
                    // distant crossing to the opposite side of the formation.
                    let torpedo_axis = target_heading + side * FRAC_PI_2;
                    let delta = wrap_angle(bearing - torpedo_axis);
                    if delta.abs() < 0.55 {
                        torpedo_axis + if delta < 0.0 { -0.65 } else { 0.65 }
                    } else {
                        bearing + peers as f64 * 0.2
                    }
                }
            });
            package.members[index].heading = Some(heading);
            p.pilot.attack_heading = Some(heading);
            p.pilot.attack_stage = Some("ingress".into());
        }
        let distance = (p.position[0] - target[0]).hypot(p.position[2] - target[2]);
        if !coordinated
            || distance < 3000.0
            || distance > 6500.0
            || p.pilot
                .attack_stage
                .as_deref()
                .is_some_and(|s| s != "ingress")
        {
            return false;
        }
        package.members[index].ready = true;
        let started = *package.rendezvous_at.get_or_insert(now);
        let committed = package.committed_at;
        if committed.is_none() && (package.members.iter().all(|m| m.ready) || now - started >= 20.0)
        {
            package.committed_at = Some(now.min(started + 20.0));
        }
        // Torpedo aircraft begin first; higher dive flights follow six seconds
        // later. The entire rendezvous, including role offset, stays <=26 sec.
        let wait = package.committed_at.is_none()
            || package.committed_at.is_some_and(|at| {
                p.role == "dive-bomber"
                    && package.members.iter().any(|m| m.role == "torpedo-bomber")
                    && now < at + 6.0
            });
        if wait {
            let heading = p.pilot.attack_heading.unwrap_or(p.heading);
            let anchor = [
                target[0] - heading.sin() * 4800.0,
                if p.role == "dive-bomber" {
                    850.0
                } else {
                    200.0
                },
                target[2] + heading.cos() * 4800.0,
            ];
            let point = orbit_point(p, anchor, 450.0, 1.0);
            fly(
                p,
                point,
                if p.role == "dive-bomber" { 85.0 } else { 75.0 },
                dt,
                FlightOptions {
                    bank_limit: Some(0.55),
                    ..Default::default()
                },
            );
            return true;
        }
        false
    }
    /// Call in the returning branch before normal recovery navigation. Uses only
    /// the last permitted target fix and own position. A 20-second outward leg
    /// avoids circling over the fleet; emergency recovery always takes priority.
    pub fn package_withdrawal(&mut self, p: &mut Aircraft, dt: f64) -> bool {
        if p.hp < 25.0 || self.rules.endurance.needs_recall(p.flight_time, false) {
            return false;
        }
        let now = self.operations.now;
        let Some(package) = self.operations.packages.iter_mut().find(|g| {
            g.owner_id == p.owner_id
                && g.members
                    .iter()
                    .any(|m| p.flight_id.as_deref() == Some(&m.flight_id))
        }) else {
            return false;
        };
        let Some(target) = package.target else {
            return false;
        };
        let distance = (p.position[0] - target[0]).hypot(p.position[2] - target[2]);
        if distance > 3500.0 {
            return false;
        }
        let (started, exit) = package.exits.entry(p.id.clone()).or_insert_with(|| {
            // Turn toward the nearer clear flank, not back across the target.
            // Shared target/withdrawal window; each aircraft retains safe spacing.
            let radial = (p.position[0] - target[0]).atan2(target[2] - p.position[2]);
            let turn = wrap_angle(radial - p.heading).clamp(-1.1, 1.1);
            let heading = p.heading + turn;
            (
                now,
                [
                    p.position[0] + heading.sin() * 4500.0,
                    300.0,
                    p.position[2] - heading.cos() * 4500.0,
                ],
            )
        });
        if now - *started >= 20.0 {
            return false;
        }
        fly(
            p,
            *exit,
            100.0,
            dt,
            FlightOptions {
                bank_limit: Some(0.65),
                ..Default::default()
            },
        );
        true
    }
}
