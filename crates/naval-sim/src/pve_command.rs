//! Initial task-group orders and an observation-limited opposing admiral.
use crate::{
    battle::Battle,
    bots::AiLevel,
    navigation::Movement,
    pve::{FleetShip, GroupStation, PvePlan, TaskGroup},
    rules::TeamId,
    vessel::Vessel,
};
use std::collections::BTreeMap;
type Directives = BTreeMap<String, (Movement, Option<String>)>;

fn members<'a>(
    battle: &'a Battle,
    units: &[FleetShip],
    group: &TaskGroup,
    team: TeamId,
) -> Vec<&'a Vessel> {
    let mut members: Vec<_> = battle
        .actors
        .iter()
        .filter(|a| {
            a.team == team
                && a.physical_loss().is_none()
                && !crate::mission::permanently_incapable(a, battle.aviation.wing(&a.motion.id))
                && units
                    .iter()
                    .any(|s| s.id == a.motion.id && s.group_id == group.id)
        })
        .collect();
    members.sort_by(|a, b| {
        b.definition()
            .air_wing
            .is_some()
            .cmp(&a.definition().air_wing.is_some())
            .then(
                b.definition()
                    .hull
                    .mass_kg
                    .total_cmp(&a.definition().hull.mass_kg),
            )
            .then(a.motion.id.cmp(&b.motion.id))
    });
    members
}
fn inside(point: [f64; 2], battle: &Battle) -> [f64; 2] {
    let radius = battle.mission_rules.as_ref().unwrap().area.radius_m - 2500.0;
    let scale = (radius / point[0].hypot(point[1]).max(1.0)).min(1.0);
    [point[0] * scale, point[1] * scale]
}
fn patrol(leader: &Vessel, battle: &Battle) -> Movement {
    let x = leader.motion.x;
    let z = leader.motion.z;
    Movement::Route {
        waypoints: [
            [x - 2500.0, z - 1200.0],
            [x + 2500.0, z - 1200.0],
            [x + 2500.0, z + 1200.0],
            [x - 2500.0, z + 1200.0],
        ]
        .into_iter()
        .map(|p| inside(p, battle))
        .collect(),
        speed_mps: leader.definition().handling.forward_speed.min(12.0),
        looped: true,
    }
}
fn search(leader: &Vessel, battle: &Battle) -> Movement {
    // The enemy knows the deployment half, not individual friendly positions.
    // A bounded sweep continues into the rear if the surface force finds nothing.
    let x = leader.motion.x.clamp(-6000.0, 6000.0);
    Movement::Route {
        waypoints: [
            [x, 0.0],
            [x, 9000.0],
            [6000.0, 16000.0],
            [0.0, 21000.0],
            [-6000.0, 16000.0],
            [-6000.0, 7000.0],
        ]
        .into_iter()
        .map(|p| inside(p, battle))
        .collect(),
        speed_mps: leader.definition().handling.forward_speed.min(16.0),
        looped: true,
    }
}
fn escort(ship: &Vessel, leader: &Vessel, plan: &PvePlan, index: usize) -> Movement {
    let initial = plan
        .setup
        .ships
        .iter()
        .find(|s| s.id == ship.motion.id)
        .and_then(|s| s.spawn.as_ref());
    let lead_initial = plan
        .setup
        .ships
        .iter()
        .find(|s| s.id == leader.motion.id)
        .and_then(|s| s.spawn.as_ref());
    let offset = match (initial, lead_initial) {
        (Some(a), Some(b)) => {
            let dx = a.x - b.x;
            let dz = a.z - b.z;
            [
                dx * b.heading.cos() + dz * b.heading.sin(),
                -dx * b.heading.sin() + dz * b.heading.cos(),
            ]
        }
        _ => [
            if index.is_multiple_of(2) {
                -650.0
            } else {
                650.0
            },
            500.0 + (index / 2) as f64 * 500.0,
        ],
    };
    Movement::Escort {
        leader_id: leader.motion.id.clone(),
        offset,
        radius_m: 180.0,
    }
}
/// A shared report priority lets surface groups and carrier strikes concentrate
/// on the same known threat without consulting hidden hull condition or orders.
pub(crate) fn priority_contact(battle: &Battle) -> Option<crate::sensors::ContactTrack> {
    battle
        .sensors
        .contacts(TeamId::B)
        .into_iter()
        .filter(|c| {
            c.targetable()
                && battle.tick.saturating_sub(c.last_observed_tick) <= 30 * crate::rules::TICK_RATE
        })
        .max_by(|a, b| {
            let carrier = |c: &crate::sensors::ContactTrack| {
                c.identified_preset_id
                    .as_ref()
                    .and_then(|id| battle.catalog.definitions.get(id))
                    .is_some_and(|d| d.air_wing.is_some())
            };
            carrier(a)
                .cmp(&carrier(b))
                .then(b.uncertainty_m.total_cmp(&a.uncertainty_m))
                .then(b.id.cmp(&a.id))
        })
}
fn withdraw(leader: &Vessel, battle: &Battle, threat: [f64; 3]) -> Movement {
    let delta = [leader.motion.x - threat[0], leader.motion.z - threat[2]];
    let range = delta[0].hypot(delta[1]).max(1.0);
    if let Some(Movement::Route {
        waypoints,
        speed_mps,
        looped: false,
    }) = leader.navigation.as_ref().map(|n| &n.order)
    {
        if waypoints.len() == 1 {
            let p = waypoints[0];
            let remaining = (p[0] - leader.motion.x).hypot(p[1] - leader.motion.z);
            if remaining > 300.0
                && (p[0] - leader.motion.x) * delta[0] + (p[1] - leader.motion.z) * delta[1] > 0.0
            {
                return Movement::Route {
                    waypoints: waypoints.clone(),
                    speed_mps: *speed_mps,
                    looped: false,
                };
            }
        }
    }
    // Try several retreat bearings around authored land, not an invisible enemy
    // route. Navigation still owns the full island detour and collision checks.
    for angle in [0.0_f64, 0.6, -0.6, 1.2, -1.2] {
        let (sin, cos) = angle.sin_cos();
        let p = inside(
            [
                leader.motion.x + (delta[0] * cos - delta[1] * sin) / range * 4000.0,
                leader.motion.z + (delta[0] * sin + delta[1] * cos) / range * 4000.0,
            ],
            battle,
        );
        if crate::navigation::destination_is_clear(leader, p, &battle.islands) {
            return Movement::Route {
                waypoints: vec![p],
                speed_mps: crate::navigation::maximum_speed(leader) * 0.85,
                looped: false,
            };
        }
    }
    Movement::HoldArea {
        position: [leader.motion.x, leader.motion.z],
        radius_m: 500.0,
    }
}
impl PvePlan {
    pub fn initial_directives(&self, battle: &Battle) -> Directives {
        let mut orders = BTreeMap::new();
        for (team, units, groups) in [
            (TeamId::A, &self.assignments, &self.groups),
            (TeamId::B, &self.enemy_assignments, &self.enemy_groups),
        ] {
            for group in groups {
                let ships = members(battle, units, group, team);
                let Some(leader) = ships.first() else {
                    continue;
                };
                let movement = if group.station == GroupStation::Rear {
                    patrol(leader, battle)
                } else if team == TeamId::B {
                    search(leader, battle)
                } else {
                    Movement::HoldArea {
                        position: [leader.motion.x, leader.motion.z],
                        radius_m: 500.0,
                    }
                };
                orders.insert(leader.motion.id.clone(), (movement, None));
                for (i, ship) in ships.iter().skip(1).enumerate() {
                    orders.insert(
                        ship.motion.id.clone(),
                        (escort(ship, leader, self, i), None),
                    );
                }
            }
        }
        orders
    }
    /// Difficulty changes decision cadence. All targets come from the same
    /// report store and the same contact priority policy as human captains.
    pub fn enemy_directives(&self, battle: &Battle) -> Directives {
        let level = self
            .setup
            .ships
            .iter()
            .find(|s| s.team == TeamId::B)
            .map_or(AiLevel::Normal, |s| s.ai_level);
        let cadence = match level {
            AiLevel::Static | AiLevel::Moving => return BTreeMap::new(),
            AiLevel::Easy => 600,
            AiLevel::Hard => 180,
            _ => 300,
        };
        if !battle.tick.is_multiple_of(cadence) {
            return BTreeMap::new();
        }
        let mut orders = BTreeMap::new();
        let shared_contact = priority_contact(battle);
        let front_ids: Vec<_> = self
            .enemy_assignments
            .iter()
            .filter(|a| {
                self.enemy_groups
                    .iter()
                    .any(|g| g.id == a.group_id && g.station == GroupStation::Front)
            })
            .map(|a| a.id.as_str())
            .collect();
        let original_front: f64 = self
            .setup
            .ships
            .iter()
            .filter(|a| front_ids.contains(&a.id.as_str()))
            .map(|a| battle.catalog.definitions[&a.preset_id].hull.mass_kg)
            .sum();
        let remaining_front: f64 = battle
            .actors
            .iter()
            .filter(|a| {
                front_ids.contains(&a.motion.id.as_str())
                    && a.physical_loss().is_none()
                    && !crate::mission::permanently_incapable(a, battle.aviation.wing(&a.motion.id))
            })
            .map(|a| a.definition().hull.mass_kg)
            .sum();
        let front_collapsed = original_front > 0.0 && remaining_front < original_front * 0.5;
        for group in &self.enemy_groups {
            let ships = members(battle, &self.enemy_assignments, group, TeamId::B);
            let Some(leader) = ships.first() else {
                continue;
            };
            let contact = shared_contact.as_ref().or_else(|| {
                battle.sensors.surface_target(
                    TeamId::B,
                    [leader.motion.x, leader.motion.y, leader.motion.z],
                    None,
                    leader.target_id.as_deref(),
                )
            });
            if group.station == GroupStation::Front {
                let movement = if front_collapsed && contact.is_some() {
                    withdraw(leader, battle, contact.unwrap().estimated_position)
                } else if contact.is_some() {
                    Movement::Autonomous
                } else if leader
                    .navigation
                    .as_ref()
                    .is_some_and(|n| matches!(n.order, Movement::Route { .. }))
                {
                    leader.navigation.as_ref().unwrap().order.clone()
                } else {
                    search(leader, battle)
                };
                orders.insert(
                    leader.motion.id.clone(),
                    (movement, contact.map(|c| c.id.clone())),
                );
            } else if let Some(threat) = contact.filter(|c| {
                front_collapsed
                    || (c.estimated_position[0] - leader.motion.x)
                        .hypot(c.estimated_position[2] - leader.motion.z)
                        < 9000.0
            }) {
                orders.insert(
                    leader.motion.id.clone(),
                    (
                        withdraw(leader, battle, threat.estimated_position),
                        Some(threat.id.clone()),
                    ),
                );
            } else if !leader
                .navigation
                .as_ref()
                .is_some_and(|n| matches!(n.order, Movement::Route { .. }))
            {
                orders.insert(
                    leader.motion.id.clone(),
                    (patrol(leader, battle), contact.map(|c| c.id.clone())),
                );
            }
            for (i, ship) in ships.iter().skip(1).enumerate() {
                orders.insert(
                    ship.motion.id.clone(),
                    (escort(ship, leader, self, i), contact.map(|c| c.id.clone())),
                );
            }
        }
        orders
    }
}
