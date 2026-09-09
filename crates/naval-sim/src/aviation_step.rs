use crate::{
    air_gunnery::{self, gunnery_seed, step_discipline},
    aircraft::*,
    aircraft_accuracy::{fighter_burst, strike_aim_error},
    aircraft_deck::{deck_pose, taxi},
    aircraft_flight::{
        self, FlightAttitude, FlightOptions, TAKEOFF_CLIMB_SECONDS, TAKEOFF_ROLL_SECONDS, fly,
    },
    aircraft_formation::{fly_formation, formation_leader},
    aircraft_tactics::*,
    aviation::{Aviation, service_available},
    definition::{TorpedoPart, Vec3},
    environment::SeaState,
    geometry::*,
    impact::{AircraftEffect, DamageEvent, ShellEffect, TorpedoEffect},
    shell::Shell,
    torpedoes::{Torpedo, clear_torpedo_lane, torpedo_intercept},
    vessel::{Controller, Vessel},
};
use std::collections::BTreeMap;
pub struct AirContext<'a> {
    pub knowledge: Option<crate::sensors::Knowledge<'a>>,
    pub actors: &'a [Vessel],
    pub shells: &'a mut Vec<Shell>,
    pub torpedoes: &'a mut Vec<Torpedo>,
    pub releases: &'a mut Vec<AirRelease>,
    pub sequence: &'a mut i64,
    pub events: &'a mut Vec<DamageEvent>,
    pub seed: u32,
    pub sea: Option<(&'a SeaState, f64)>,
}
impl AirContext<'_> {
    pub fn next_id(&mut self) -> i64 {
        *self.sequence += 1;
        *self.sequence
    }
    fn event(&mut self, p: &Aircraft, kind: &str, message: String) {
        self.events.push(DamageEvent {
            kind: kind.into(),
            position: p.position,
            ship_id: p.owner_id.clone(),
            message,
            aircraft: Some(AircraftEffect {
                id: p.id.clone(),
                ..Default::default()
            }),
            ..Default::default()
        });
    }
}
pub fn air_torpedo() -> TorpedoPart {
    TorpedoPart {
        id: "mark-13-game".into(),
        name: "Air-dropped torpedo".into(),
        kind: "torpedo".into(),
        diameter_m: 0.57,
        length_m: 4.1,
        speed: 23.0,
        range_m: 4500.0,
        arming_distance_m: 180.0,
        running_depth_m: 2.0,
        reload_seconds: 35.0,
        launch_interval_seconds: 3.0,
        damage: 480.0,
        breach_area_m2: 0.55,
    }
}
pub fn lose(p: &mut Aircraft, events: &mut Vec<DamageEvent>, reason: &str) {
    if p.phase == "lost" {
        return;
    }
    if airborne(p) && !on_flight_deck(p) {
        let mut seed = 0u32;
        for c in p.id.encode_utf16() {
            seed = seed.wrapping_mul(31).wrapping_add(u32::from(c));
        }
        p.wreck = Some(AirWreck {
            age: 0.0,
            roll_rate: if !seed.is_multiple_of(2) { 1.0 } else { -1.0 }
                * (0.45 + f64::from(seed % 7) * 0.065),
            impacted: false,
        });
    }
    p.hp = 0.0;
    p.phase = "lost".into();
    p.loss_reason = Some(reason.into());
    p.deck_slot = None;
    events.push(DamageEvent {
        kind: "aircraft-lost".into(),
        position: p.position,
        ship_id: p.owner_id.clone(),
        message: format!("{} · {reason}", p.model_id),
        aircraft: Some(AircraftEffect {
            id: p.id.clone(),
            ..Default::default()
        }),
        ..Default::default()
    });
}
fn step_wreck(p: &mut Aircraft, events: &mut Vec<DamageEvent>, dt: f64) {
    let Some(w) = p.wreck.as_mut().filter(|w| !w.impacted) else {
        return;
    };
    let from = p.position;
    let v = p.velocity;
    let drag = 0.055;
    let decay = (-drag * dt).exp();
    let travel = (1.0 - decay) / drag;
    let next = [
        from[0] + v[0] * travel,
        from[1] + (v[1] + 9.81 / drag) * travel - 9.81 / drag * dt,
        from[2] + v[2] * travel,
    ];
    p.velocity = [
        v[0] * decay,
        (v[1] + 9.81 / drag) * decay - 9.81 / drag,
        v[2] * decay,
    ];
    w.age += dt;
    p.bank = wrap_angle(p.bank + w.roll_rate * dt);
    let dive = p.velocity[1].atan2(p.velocity[0].hypot(p.velocity[2]));
    p.pitch += (dive - p.pitch) * (1.0 - (-dt * 1.8).exp());
    p.controls.propeller += (-w.age * 0.8).exp() * 20.0 * dt;
    if next[1] <= 0.0 {
        let denominator = from[1] - next[1];
        let fraction = clamp(
            from[1] / if denominator == 0.0 { 1.0 } else { denominator },
            0.0,
            1.0,
        );
        p.position = [
            from[0] + (next[0] - from[0]) * fraction,
            0.0,
            from[2] + (next[2] - from[2]) * fraction,
        ];
        w.impacted = true;
        events.push(DamageEvent {
            kind: "aircraft-crash".into(),
            position: p.position,
            ship_id: p.owner_id.clone(),
            message: format!("{} struck the sea", p.model_id),
            aircraft: Some(AircraftEffect {
                id: p.id.clone(),
                velocity: Some(p.velocity),
                ..Default::default()
            }),
            ..Default::default()
        });
    } else {
        p.position = next;
    }
}
impl Aviation {
    fn deck_spot(&self, actor: &Vessel, p: &Aircraft) -> Vec3 {
        let wing = actor.definition().air_wing.as_ref().unwrap();
        let index = p.deck_slot.unwrap_or(0);
        let count = self
            .deck_capacity(actor)
            .min(self.wing(&actor.motion.id).unwrap().planes.len());
        let span = (actor.definition().hull.length * 0.76).min((count as f64 - 1.0) * 14.0);
        [
            wing.launch_position[0] - 10.0,
            wing.launch_position[1] + self.ground[&p.model_id].clearance,
            wing.recovery_position[2] - 15.0 - span
                + if count > 1 {
                    index as f64 * span / (count - 1) as f64
                } else {
                    0.0
                },
        ]
    }
    fn spot_aircraft(&mut self, actor: &Vessel, p: &mut Aircraft) -> bool {
        if p.deck_slot.is_some() {
            return true;
        }
        let capacity = self.deck_capacity(actor);
        let state = self.wing_mut(&actor.motion.id).unwrap();
        let free = (0..capacity).find(|i| !state.planes.iter().any(|o| o.deck_slot == Some(*i)));
        if let Some(free) = free {
            p.deck_slot = Some(free);
        } else {
            let Some(reserve) = state
                .planes
                .iter_mut()
                .find(|o| o.deck_slot.is_some() && o.phase == "ready")
            else {
                return false;
            };
            p.deck_slot = reserve.deck_slot;
            reserve.deck_slot = None;
            reserve.deck_position = None;
        }
        let spot = self.deck_spot(actor, p);
        deck_pose(p, actor, spot, &self.ground[&p.model_id]);
        p.previous_position = p.position;
        true
    }
    fn recovery_queue(&self, owner: &str) -> Vec<usize> {
        let state = self.wing(owner).unwrap();
        let mut queue: Vec<_> = state
            .planes
            .iter()
            .enumerate()
            .filter(|(_, p)| matches!(p.phase.as_str(), "returning" | "landing"))
            .map(|(i, _)| i)
            .collect();
        queue.sort_by(|&a, &b| {
            let (a, b) = (&state.planes[a], &state.planes[b]);
            (b.phase == "landing")
                .cmp(&(a.phase == "landing"))
                .then_with(|| {
                    self.rules
                        .endurance
                        .needs_recall(b.flight_time, false)
                        .cmp(&self.rules.endurance.needs_recall(a.flight_time, false))
                })
                .then_with(|| {
                    if self.rules.endurance.needs_recall(a.flight_time, false)
                        && self.rules.endurance.needs_recall(b.flight_time, false)
                    {
                        b.flight_time.total_cmp(&a.flight_time)
                    } else {
                        std::cmp::Ordering::Equal
                    }
                })
                .then_with(|| {
                    a.recovery_requested_at
                        .unwrap_or(0.0)
                        .total_cmp(&b.recovery_requested_at.unwrap_or(0.0))
                })
                .then_with(|| a.id.cmp(&b.id))
        });
        queue
    }
    fn combine_landed(&mut self, actor: &Vessel) {
        let state = self.wing(&actor.motion.id).unwrap();
        if !state.planes.iter().any(|p| p.phase == "lost") {
            return;
        }
        let size = self.flight_size(actor);
        let mut candidates: Vec<_> = self
            .squadron_flights(actor)
            .into_iter()
            .filter_map(|f| {
                let survivors: Vec<_> = f
                    .plane_ids
                    .iter()
                    .filter_map(|id| state.planes.iter().find(|p| &p.id == id))
                    .filter(|p| p.phase != "lost")
                    .collect();
                if survivors.is_empty()
                    || survivors.len() >= size
                    || !survivors.iter().all(|p| {
                        matches!(p.phase.as_str(), "ready" | "rearming") && !on_flight_deck(p)
                    })
                {
                    return None;
                }
                let survivors = survivors.iter().map(|p| p.id.clone()).collect::<Vec<_>>();
                Some((f, survivors))
            })
            .collect();
        let state = self.wing_mut(&actor.motion.id).unwrap();
        for i in 0..candidates.len() {
            for j in i + 1..candidates.len() {
                let (left, right) = candidates.split_at_mut(j);
                let (target, source) = (&mut left[i], &mut right[0]);
                if target.0.merged_into.is_some()
                    || source.0.merged_into.is_some()
                    || target.1.len() + source.1.len() > size
                {
                    continue;
                }
                let first = state.planes.iter().find(|p| p.id == target.1[0]).unwrap();
                if !source.1.iter().all(|id| {
                    state
                        .planes
                        .iter()
                        .find(|p| &p.id == id)
                        .is_some_and(|p| p.model_id == first.model_id && p.role == first.role)
                }) {
                    continue;
                }
                for id in &source.1 {
                    let slot = target.0.plane_ids.iter().position(|id| {
                        state
                            .planes
                            .iter()
                            .any(|p| &p.id == id && p.phase == "lost")
                    });
                    if let Some(slot) = slot {
                        let lost_id = std::mem::replace(&mut target.0.plane_ids[slot], id.clone());
                        let source_slot = source.0.plane_ids.iter().position(|p| p == id).unwrap();
                        source.0.plane_ids[source_slot] = lost_id.clone();
                        state
                            .planes
                            .iter_mut()
                            .find(|p| p.id == lost_id)
                            .unwrap()
                            .flight_id = Some(source.0.id.clone());
                    } else {
                        target.0.plane_ids.push(id.clone());
                        source.0.plane_ids.retain(|p| p != id);
                    }
                    state
                        .planes
                        .iter_mut()
                        .find(|p| &p.id == id)
                        .unwrap()
                        .flight_id = Some(target.0.id.clone());
                }
                target.1.extend(source.1.clone());
                source.0.merged_into = Some(target.0.id.clone());
                for flight in [&target.0, &source.0] {
                    if let Some(f) = state.flights.iter_mut().find(|f| f.id == flight.id) {
                        *f = flight.clone();
                    } else {
                        state.flights.push(flight.clone());
                    }
                }
            }
        }
    }
}
fn occupies_launch_lane(p: &Aircraft, actor: &Vessel) -> bool {
    matches!(p.phase.as_str(), "taxi" | "rollout")
        || p.phase == "parking"
            && (p.deck_position.map_or(0.0, |p| p[0])
                - actor
                    .definition()
                    .air_wing
                    .as_ref()
                    .unwrap()
                    .launch_position[0])
                .abs()
                < 6.0
        || p.phase == "takeoff" && p.timer < TAKEOFF_ROLL_SECONDS + 1.0
}
impl Aviation {
    pub fn step(&mut self, ctx: &mut AirContext<'_>, dt: f64, time: f64) {
        if dt <= 0.0 {
            return;
        }
        for w in &mut self.wings {
            for p in &mut w.state.planes {
                p.previous_position = p.position;
                p.previous_attitude = Some(FlightAttitude {
                    heading: p.heading,
                    pitch: p.pitch,
                    bank: p.bank,
                });
                p.previous_controls = Some(p.controls);
                if p.phase == "lost" {
                    step_wreck(p, ctx.events, dt);
                } else {
                    let deck = on_flight_deck(p);
                    aircraft_flight::step_mechanisms(p, dt, deck);
                }
            }
        }
        let mut leaders = BTreeMap::new();
        for w in &self.wings {
            for f in &w.state.flights {
                if let Some(i) = formation_leader(f, &w.state.planes) {
                    leaders.insert(f.id.clone(), w.state.planes[i].clone());
                }
            }
        }
        for actor in ctx.actors {
            let Some(wi) = self
                .wings
                .iter()
                .position(|w| w.owner_id == actor.motion.id)
            else {
                continue;
            };
            let wing = actor.definition().air_wing.as_ref().unwrap();
            self.combine_landed(actor);
            let state = &mut self.wings[wi].state;
            state.launch_cooldown = (state.launch_cooldown - dt).max(0.0);
            state.transfer_cooldown = (state.transfer_cooldown - dt).max(0.0);
            for p in &mut state.planes {
                if matches!(p.phase.as_str(), "returning" | "landing") {
                    p.recovery_requested_at.get_or_insert(time);
                }
            }
            let recovery = self.recovery_queue(&actor.motion.id);
            let state = &self.wings[wi].state;
            let landing_clearance = recovery.iter().find_map(|&i| {
                let p = &state.planes[i];
                if p.phase != "returning" || p.pilot.recovery_stage.as_deref() != Some("final") {
                    return None;
                }
                let local = world_to_local(p.position, actor.motion.pose());
                let aft = local[2] - wing.recovery_position[2];
                (aft > 550.0
                    && (local[0] - wing.recovery_position[0]).abs() < 70.0
                    && wrap_angle(p.heading - actor.motion.heading).abs() < 0.2
                    && recovery.iter().all(|&j| {
                        state.planes[j].phase != "landing"
                            || (local[2]
                                - world_to_local(state.planes[j].position, actor.motion.pose())[2])
                                .abs()
                                > 60.0
                    }))
                .then(|| p.id.clone())
            });
            let approaching = state.planes.iter().any(|p| {
                p.phase == "landing"
                    && world_to_local(p.position, actor.motion.pose())[2]
                        - wing.recovery_position[2]
                        < 650.0
            });
            let level = actor
                .bot
                .as_ref()
                .map_or(crate::bots::AiLevel::Normal, |b| b.ai_level);
            if actor.controller == Controller::Bot
                && ctx.knowledge.is_none()
                && !level.passive()
                && time >= 5.0 * crate::bots::reaction_scale(level)
            {
                let valid = |a: &&Vessel| {
                    a.team != actor.team && a.physical_loss().is_none() && a.motion.y > -8.0
                };
                let target = ctx
                    .actors
                    .iter()
                    .filter(valid)
                    .find(|a| Some(&a.motion.id) == actor.target_id.as_ref())
                    .or_else(|| ctx.actors.iter().find(valid));
                for s in &wing.squadrons {
                    if !self.wings[wi].state.planes.iter().any(|p| {
                        p.squadron_id == s.id
                            && !matches!(p.phase.as_str(), "ready" | "rearming" | "lost")
                    }) {
                        self.launch_squadron(actor, &s.id, target, None, ctx.actors, None, ctx.sea);
                    }
                }
            }
            for i in 0..self.wings[wi].state.planes.len() {
                let mut p = self.wings[wi].state.planes[i].clone();
                self.step_plane(
                    &mut p,
                    actor,
                    i,
                    approaching,
                    landing_clearance.as_deref(),
                    &leaders,
                    ctx,
                    dt,
                    time,
                );
                self.wings[wi].state.planes[i] = p;
            }
        }
        for i in (0..ctx.releases.len()).rev() {
            let r = &mut ctx.releases[i];
            r.velocity[1] -= 9.81 * dt;
            r.position = add(r.position, scale(r.velocity, dt));
            if r.position[1] <= 0.0 {
                let weapon = r.weapon.clone().unwrap_or_else(air_torpedo);
                let velocity = scale(normalize([r.velocity[0], 0.0, r.velocity[2]]), weapon.speed);
                let position = [r.position[0], -weapon.running_depth_m, r.position[2]];
                ctx.torpedoes.push(Torpedo {
                    id: r.id,
                    owner_id: r.owner_id.clone(),
                    tube_id: "aircraft.payload".into(),
                    position,
                    velocity,
                    distance: 0.0,
                    age: 0.0,
                    weapon: weapon.clone(),
                });
                ctx.events.push(DamageEvent {
                    kind: "torpedo-launch".into(),
                    position,
                    ship_id: r.owner_id.clone(),
                    message: "Air torpedo entered water".into(),
                    torpedo: Some(TorpedoEffect {
                        id: r.id,
                        velocity,
                        diameter_m: weapon.diameter_m,
                    }),
                    ..Default::default()
                });
                ctx.releases.remove(i);
            }
        }
    }
    #[allow(clippy::too_many_arguments)]
    fn step_plane(
        &mut self,
        p: &mut Aircraft,
        actor: &Vessel,
        index: usize,
        approaching: bool,
        landing_clearance: Option<&str>,
        leaders: &BTreeMap<String, Aircraft>,
        ctx: &mut AirContext<'_>,
        dt: f64,
        time: f64,
    ) {
        let wing = actor.definition().air_wing.as_ref().unwrap();
        let ground = self.ground[&p.model_id].clone();
        p.cooldown = (p.cooldown - dt).max(0.0);
        if p.phase == "lost" {
            return;
        }
        let fold = if ground.folding_wings
            && matches!(
                p.phase.as_str(),
                "ready" | "queued" | "parking" | "rearming"
            ) {
            1.0
        } else {
            0.0
        };
        let seconds = if p.phase == "takeoff" {
            TAKEOFF_ROLL_SECONDS - 0.5
        } else {
            4.0
        };
        p.wing_fold += clamp(fold - p.wing_fold, -dt / seconds, dt / seconds);
        if actor.damage.sunk && (on_flight_deck(p) || !airborne(p)) {
            p.hp = 0.0;
            p.phase = "lost".into();
            p.deck_slot = None;
            p.loss_reason = Some("Carrier lost".into());
            return;
        }
        if matches!(p.phase.as_str(), "ready" | "queued" | "rearming") {
            if p.deck_slot.is_some() {
                deck_pose(p, actor, self.deck_spot(actor, p), &ground);
            }
            if p.phase == "rearming" && service_available(actor, ctx.sea) {
                p.timer -= dt;
                if p.timer <= 0.0 {
                    p.phase = "ready".into();
                    p.timer = 0.0;
                    p.deck_slot = None;
                    p.deck_position = None;
                    p.flight_time = 0.0;
                    p.ammo = if p.role == "fighter" {
                        FIGHTER_AMMO_BURSTS
                    } else {
                        0.0
                    };
                    p.payload = p.role != "fighter";
                    p.hp = p.hp.max(self.rules.repair_ceiling_hp);
                }
            }
            let state = self.wing(&actor.motion.id).unwrap();
            if p.phase == "queued"
                && state.launch_cooldown <= 0.0
                && service_available(actor, ctx.sea)
                && !approaching
                && !state
                    .planes
                    .iter()
                    .any(|o| matches!(o.phase.as_str(), "taxi" | "rollout" | "parking"))
                && self.spot_aircraft(actor, p)
            {
                p.phase = "takeoff".into();
                p.timer = 0.0;
                p.flight_time = 0.0;
                self.wing_mut(&actor.motion.id).unwrap().launch_cooldown =
                    (self.rules.launch_group_seconds
                        - TAKEOFF_ROLL_SECONDS
                        - TAKEOFF_CLIMB_SECONDS)
                        .max(0.0)
                        / (self.flight_size(actor) as f64 - 1.0).max(1.0);
                deck_pose(
                    p,
                    actor,
                    add(wing.launch_position, [0.0, ground.clearance, 0.0]),
                    &ground,
                );
                p.previous_position = p.position;
                ctx.event(p, "aircraft-launch", format!("{} launched", p.model_id));
            }
            return;
        }
        if matches!(p.phase.as_str(), "taxi" | "parking" | "rollout") {
            if p.phase == "taxi" && p.wing_fold > 0.0
                || p.phase == "parking" && ground.folding_wings && p.wing_fold < 1.0
            {
                deck_pose(p, actor, p.deck_position.unwrap(), &ground);
                return;
            }
            if p.phase == "rollout" {
                p.timer += dt;
                let local = p.deck_position.unwrap();
                deck_pose(
                    p,
                    actor,
                    [
                        local[0],
                        local[1],
                        local[2] - (35.0 * (1.0 - p.timer / 1.2)).max(0.0) * dt,
                    ],
                    &ground,
                );
                if p.timer >= 1.2 {
                    service_plane(p, wing.rearm_seconds);
                }
            } else {
                let destination = if p.phase == "parking" {
                    self.deck_spot(actor, p)
                } else {
                    add(wing.launch_position, [0.0, ground.clearance, 0.0])
                };
                let current = p.deck_position.unwrap();
                let waypoint = if (current[0] - destination[0]).abs() > 0.1 {
                    [destination[0], destination[1], current[2]]
                } else {
                    destination
                };
                let arrived = taxi(
                    p,
                    actor,
                    waypoint,
                    if p.phase == "taxi" { 35.0 } else { 12.0 },
                    dt,
                    &ground,
                ) && length(sub(waypoint, destination)) < 0.1;
                if arrived && p.phase == "parking" {
                    service_plane(p, wing.rearm_seconds);
                } else if arrived && !service_available(actor, ctx.sea) {
                    p.phase = "parking".into();
                } else if arrived {
                    p.phase = "takeoff".into();
                    p.timer = 0.0;
                    p.flight_time = 0.0;
                    self.wing_mut(&actor.motion.id).unwrap().launch_cooldown =
                        wing.launch_interval_seconds;
                    deck_pose(p, actor, destination, &ground);
                    ctx.event(p, "aircraft-launch", format!("{} launched", p.model_id));
                }
            }
            return;
        }
        p.flight_time += dt;
        p.timer += dt;
        if self.rules.endurance.exhausted(p.flight_time) {
            lose(p, ctx.events, "Endurance exhausted");
            return;
        }
        if (self.rules.endurance.needs_recall(p.flight_time, false) || p.hp < 25.0)
            && p.phase != "landing"
        {
            p.phase = "returning".into();
        }
        let carrier = local_to_world(
            add(wing.recovery_position, [0.0, ground.clearance, 0.0]),
            actor.motion.pose(),
        );
        if p.hp <= 0.0 {
            lose(p, ctx.events, "Shot down");
            return;
        }
        if p.phase == "takeoff" {
            if p.timer <= TAKEOFF_ROLL_SECONDS {
                let acceleration = 2.0 * 140.0 / TAKEOFF_ROLL_SECONDS.powi(2);
                let local = [
                    wing.launch_position[0],
                    wing.launch_position[1] + ground.clearance,
                    wing.launch_position[2] - 0.5 * acceleration * p.timer * p.timer,
                ];
                deck_pose(p, actor, local, &ground);
                p.velocity = add(
                    actor.motion.velocity(),
                    [
                        p.heading.sin() * acceleration * p.timer,
                        0.0,
                        -p.heading.cos() * acceleration * p.timer,
                    ],
                );
            } else {
                let point = local_to_world(
                    [
                        wing.launch_position[0],
                        wing.launch_position[1] + ground.clearance + 80.0,
                        -600.0,
                    ],
                    actor.motion.pose(),
                );
                fly(
                    p,
                    point,
                    78.0 + (p.timer - TAKEOFF_ROLL_SECONDS) * 5.0,
                    dt,
                    FlightOptions::default(),
                );
            }
            if p.timer > TAKEOFF_ROLL_SECONDS + TAKEOFF_CLIMB_SECONDS {
                p.phase = "outbound".into();
                p.timer = 0.0;
                p.deck_position = None;
                p.deck_slot = None;
            }
            return;
        }
        if matches!(p.phase.as_str(), "returning" | "landing") {
            self.recover_plane(p, actor, index, landing_clearance, carrier, ctx, dt);
            return;
        }
        let mut flight = self
            .wing(&actor.motion.id)
            .unwrap()
            .flights
            .iter()
            .find(|f| Some(&f.id) == p.flight_id.as_ref())
            .cloned();
        self.mission_plane(p, actor, carrier, &mut flight, leaders, ctx, dt, time);
        if let Some(flight) = flight
            && let Some(f) = self
                .wing_mut(&actor.motion.id)
                .unwrap()
                .flights
                .iter_mut()
                .find(|f| f.id == flight.id)
        {
            *f = flight;
        }
    }
}
fn service_plane(p: &mut Aircraft, seconds: f64) {
    p.phase = "rearming".into();
    p.timer = aircraft_service_seconds(seconds, p.hp);
    p.deck_slot = None;
    p.deck_position = None;
    p.recovery_requested_at = None;
}
impl Aviation {
    #[allow(clippy::too_many_arguments)]
    fn recover_plane(
        &mut self,
        p: &mut Aircraft,
        actor: &Vessel,
        index: usize,
        landing_clearance: Option<&str>,
        carrier: Vec3,
        ctx: &mut AirContext<'_>,
        dt: f64,
    ) {
        if actor.damage.sunk {
            fly(
                p,
                [carrier[0], 180.0, carrier[2]],
                80.0,
                dt,
                FlightOptions::default(),
            );
            return;
        }
        let wing = actor.definition().air_wing.as_ref().unwrap();
        let ground = self.ground[&p.model_id].clone();
        let local = world_to_local(p.position, actor.motion.pose());
        let aft = local[2] - wing.recovery_position[2];
        let side = *p
            .pilot
            .recovery_side
            .get_or_insert(if local[0] < 0.0 { -1.0 } else { 1.0 });
        let approach = local_to_world(
            [
                wing.recovery_position[0],
                wing.recovery_position[1] + 180.0,
                wing.recovery_position[2] + 3000.0,
            ],
            actor.motion.pose(),
        );
        let busy = self
            .wing(&actor.motion.id)
            .unwrap()
            .planes
            .iter()
            .any(|o| o.id != p.id && occupies_launch_lane(o, actor));
        let available = service_available(actor, ctx.sea);
        if p.phase == "returning" {
            if !available {
                p.pilot.recovery_stage = Some("marshal".into());
                let anchor = local_to_world(
                    [
                        850.0,
                        220.0 + (index % 3) as f64 * 45.0,
                        wing.recovery_position[2] + 1600.0,
                    ],
                    actor.motion.pose(),
                );
                fly(
                    p,
                    orbit_point(p, anchor, 650.0 + (index % 3) as f64 * 90.0, 1.0),
                    70.0,
                    dt,
                    FlightOptions::default(),
                );
            } else {
                if p.pilot
                    .recovery_stage
                    .as_ref()
                    .is_none_or(|s| s == "marshal")
                {
                    p.pilot.recovery_stage = Some(
                        if aft > 700.0
                            && (local[0] - wing.recovery_position[0]).abs() < 100.0
                            && wrap_angle(p.heading - actor.motion.heading).abs() < 0.25
                        {
                            "final"
                        } else {
                            "downwind"
                        }
                        .into(),
                    );
                }
                match p.pilot.recovery_stage.as_deref() {
                    Some("downwind") => {
                        let downwind = local_to_world(
                            [
                                wing.recovery_position[0] + side * 900.0,
                                wing.recovery_position[1] + 180.0 + (index % 3) as f64 * 25.0,
                                wing.recovery_position[2] + 2800.0,
                            ],
                            actor.motion.pose(),
                        );
                        fly(
                            p,
                            downwind,
                            70.0 + actor.motion.speed.max(0.0),
                            dt,
                            FlightOptions::default(),
                        );
                        if length(sub(p.position, downwind)) < 300.0 {
                            p.pilot.recovery_stage = Some("base".into());
                        }
                    }
                    Some("base") => {
                        fly(
                            p,
                            approach,
                            58.0 + actor.motion.speed.max(0.0),
                            dt,
                            FlightOptions::default(),
                        );
                        if length(sub(p.position, approach)) < 250.0 {
                            p.pilot.recovery_stage = Some("final".into());
                        }
                    }
                    Some("final") => {
                        let intercept = local_to_world(
                            [
                                wing.recovery_position[0],
                                wing.recovery_position[1] + 90.0_f64.max(aft * 0.06),
                                wing.recovery_position[2] + 150.0_f64.max(aft - 600.0),
                            ],
                            actor.motion.pose(),
                        );
                        fly(
                            p,
                            intercept,
                            38.0 + actor.motion.speed.max(0.0),
                            dt,
                            FlightOptions::default(),
                        );
                        let separated =
                            self.wing(&actor.motion.id).unwrap().planes.iter().all(|o| {
                                o.id == p.id
                                    || o.phase != "landing"
                                    || (aft
                                        - (world_to_local(o.position, actor.motion.pose())[2]
                                            - wing.recovery_position[2]))
                                        .abs()
                                        > 60.0
                            });
                        if landing_clearance == Some(p.id.as_str())
                            && separated
                            && (!busy || aft > 900.0)
                            && aft > 550.0
                            && (local[0] - wing.recovery_position[0]).abs() < 70.0
                            && wrap_angle(p.heading - actor.motion.heading).abs() < 0.2
                        {
                            p.phase = "landing".into();
                            p.timer = 0.0;
                        } else if aft < 500.0 {
                            p.pilot.recovery_stage = Some("marshal".into());
                        }
                    }
                    _ => {}
                }
            }
        } else if !available {
            p.phase = "returning".into();
            p.pilot.recovery_stage = Some("marshal".into());
            fly(p, approach, 70.0, dt, FlightOptions::default());
        } else {
            let look = 140.0;
            let next_aft = aft - look;
            let height = next_aft * 0.06;
            let lead = look / (length(p.velocity) - actor.motion.speed).max(20.0);
            let aim = add(
                local_to_world(
                    [
                        wing.recovery_position[0],
                        wing.recovery_position[1] + ground.clearance + height,
                        wing.recovery_position[2] + next_aft,
                    ],
                    actor.motion.pose(),
                ),
                scale(actor.motion.velocity(), lead),
            );
            fly(
                p,
                aim,
                40.0 + actor.motion.speed.max(0.0),
                dt,
                FlightOptions {
                    landing: true,
                    ..Default::default()
                },
            );
            let next = world_to_local(p.position, actor.motion.pose());
            let deck_y = wing.recovery_position[1] + ground.clearance;
            if next[2] <= wing.recovery_position[2] + 12.0
                && next[2] >= wing.recovery_position[2] - 30.0
                && (next[0] - wing.recovery_position[0]).abs() < 7.0
                && (next[1] - deck_y).abs() < 0.35
                && wrap_angle(p.heading - actor.motion.heading).abs() < 0.12
            {
                if busy || !self.spot_aircraft(actor, p) {
                    p.phase = "returning".into();
                    p.pilot.recovery_stage = Some("marshal".into());
                    return;
                }
                p.phase = "rollout".into();
                p.timer = 0.0;
                deck_pose(p, actor, [next[0], deck_y, next[2]], &ground);
                ctx.event(p, "aircraft-recovered", format!("{} landed", p.model_id));
            } else if next[2] < wing.recovery_position[2] - 30.0
                || aft < 250.0 && (next[0] - wing.recovery_position[0]).abs() > 30.0
            {
                p.phase = "returning".into();
                p.pilot.recovery_stage = Some("marshal".into());
            }
        }
    }
}
fn follow(
    p: &mut Aircraft,
    flight: Option<&AirFlight>,
    leader: Option<&Aircraft>,
    dt: f64,
    time: f64,
    seed: u32,
) -> bool {
    let (Some(f), Some(l)) = (flight, leader) else {
        return false;
    };
    if l.id == p.id || l.hp <= 0.0 {
        return false;
    }
    fly_formation(p, l, f, dt, time, seed);
    true
}
impl Aviation {
    #[allow(clippy::too_many_arguments)]
    fn mission_plane(
        &mut self,
        p: &mut Aircraft,
        actor: &Vessel,
        carrier: Vec3,
        flight: &mut Option<AirFlight>,
        leaders: &BTreeMap<String, Aircraft>,
        ctx: &mut AirContext<'_>,
        dt: f64,
        time: f64,
    ) {
        let leader = flight.as_ref().and_then(|f| leaders.get(&f.id));
        if p.role != "fighter"
            && let Some(AirOrder::Patrol { point }) = flight.as_ref().map(|f| &f.order)
        {
            let anchor = [
                point[0],
                if p.role == "dive-bomber" {
                    850.0
                } else {
                    420.0
                },
                point[2],
            ];
            p.phase = "outbound".into();
            if !follow(p, flight.as_ref(), leader, dt, time, ctx.seed) {
                let point = orbit_point(p, anchor, 850.0, 1.0);
                fly(
                    p,
                    point,
                    80.0,
                    dt,
                    FlightOptions {
                        bank_limit: Some(0.45),
                        ..Default::default()
                    },
                );
            }
            return;
        }
        if p.role == "fighter" {
            self.fighter_mission(p, carrier, flight, leader, ctx, dt, time);
            return;
        }
        let target = ctx.actors.iter().find(|a| {
            Some(&a.motion.id) == p.target_id.as_ref()
                && a.team != p.team
                && a.physical_loss().is_none()
                && a.motion.y > -8.0
        });
        if target.is_none() || !p.payload {
            if target.is_none()
                && p.payload
                && let Some(f) = flight
            {
                f.notice = Some("Target unavailable · Returning armed".into());
            }
            p.phase = "returning".into();
            return;
        }
        let target = target.unwrap();
        let target_point = add(
            [
                target.motion.x,
                (target.motion.y + target.definition().hull.depth - target.definition().hull.draft)
                    .max(0.0),
                target.motion.z,
            ],
            strike_aim_error(p, target.motion.heading, ctx.seed, p.sortie.unwrap_or(0)),
        );
        let distance = (target_point[0] - p.position[0]).hypot(target_point[2] - p.position[2]);
        if let Some(l) = leader
            && l.id != p.id
            && l.target_id == p.target_id
            && l.pilot.attack_heading.is_some()
            && p.pilot.attempts == l.pilot.attempts
            && p.pilot.attack_stage.as_deref() != Some("egress")
        {
            p.pilot.attack_heading = l.pilot.attack_heading;
            p.pilot.attack_stage.get_or_insert("ingress".into());
            if l.pilot.attack_stage.as_deref() == Some("run") {
                p.pilot.attack_stage = Some("run".into());
            }
        }
        let ingress = strike_ingress(p, target.motion.heading, target_point);
        let heading = p.pilot.attack_heading.unwrap();
        let forward = [heading.sin(), 0.0, -heading.cos()];
        if let Some(l) = leader
            && l.id != p.id
            && l.target_id == p.target_id
            && l.payload
            && p.pilot.attempts == l.pilot.attempts
            && p.pilot.attack_stage.as_deref() != Some("egress")
            && (l.pilot.attack_stage.as_deref() == Some("ingress")
                || l.pilot.attack_stage.as_deref() == Some("run")
                    && (l.position[0] - target_point[0]).hypot(l.position[2] - target_point[2])
                        > if p.role == "dive-bomber" {
                            1700.0
                        } else {
                            2100.0
                        })
        {
            p.phase = "outbound".into();
            if follow(p, flight.as_ref(), leader, dt, time, ctx.seed) {
                return;
            }
        }
        if p.pilot.attack_stage.as_deref() == Some("egress") {
            let mut exit = add(target_point, scale(forward, 2200.0));
            exit[1] = 350.0;
            fly(p, exit, 95.0, dt, FlightOptions::default());
            if distance > 1800.0 {
                p.pilot.attempts += 1;
                if p.pilot.attempts >= 2 {
                    p.phase = "returning".into();
                } else {
                    p.pilot.attack_stage = Some("ingress".into());
                }
            }
            return;
        }
        if p.pilot.attack_stage.as_deref() == Some("ingress") {
            p.phase = "outbound".into();
            fly(
                p,
                ingress,
                if p.role == "dive-bomber" { 85.0 } else { 75.0 },
                dt,
                FlightOptions {
                    bank_limit: Some(0.65),
                    ..Default::default()
                },
            );
            if (p.position[0] - ingress[0]).hypot(p.position[2] - ingress[2])
                < if p.role == "dive-bomber" {
                    1000.0
                } else {
                    240.0
                }
                && (p.position[1] - ingress[1]).abs() < 120.0
            {
                p.pilot.attack_stage = Some("run".into());
            }
            return;
        }
        if p.role == "dive-bomber" && p.phase != "attack" {
            let bearing = (target_point[0] - p.position[0]).atan2(p.position[2] - target_point[2]);
            if distance > 1600.0
                || wrap_angle(bearing - p.heading).abs() > 0.12
                || p.bank.abs() > 0.15
            {
                fly(
                    p,
                    [target_point[0], 850.0, target_point[2]],
                    85.0,
                    dt,
                    FlightOptions {
                        bank_limit: Some(0.65),
                        ..Default::default()
                    },
                );
                return;
            }
        }
        p.phase = "attack".into();
        if p.role == "dive-bomber" {
            let height = (p.position[1] - 1.0 - target_point[1]).max(0.0);
            let fall = (p.velocity[1] + (p.velocity[1].powi(2) + 19.62 * height).sqrt()) / 9.81;
            let aim = add(target_point, scale(target.motion.velocity(), fall));
            fly(
                p,
                [aim[0], target_point[1], aim[2]],
                104.0,
                dt,
                FlightOptions {
                    dive: true,
                    bank_limit: Some(0.5),
                    ..Default::default()
                },
            );
            let release_height = (p.position[1] - 1.0 - target_point[1]).max(0.0);
            let release_fall =
                (p.velocity[1] + (p.velocity[1].powi(2) + 19.62 * release_height).sqrt()) / 9.81;
            let landing = add(p.position, scale(p.velocity, release_fall));
            let impact_aim = add(target_point, scale(target.motion.velocity(), release_fall));
            let error = (landing[0] - impact_aim[0]).hypot(landing[2] - impact_aim[2]);
            if error < 22.0 && p.pitch < -0.25 && p.position[1] > target_point[1] + 90.0 {
                let id = ctx.next_id();
                let bomb = self.ground[&p.model_id]
                    .bomb
                    .as_ref()
                    .expect("Missing aircraft bomb definition");
                let shell = Shell {
                    id,
                    owner_id: p.owner_id.clone(),
                    weapon_label: Some(bomb.label.clone()),
                    bomb: Some(FlightAttitude {
                        heading: p.heading,
                        pitch: p.pitch,
                        bank: p.bank,
                    }),
                    position: add(p.position, [0.0, -1.0, 0.0]),
                    velocity: p.velocity,
                    damage: bomb.he.damage,
                    caliber_m: bomb.caliber_m,
                    ammunition: Some(crate::weapons::Ammunition::He),
                    shell_type: Some("HE".into()),
                    he: Some(bomb.he.clone()),
                    ..Default::default()
                };
                let effect = ShellEffect::from_shell(&shell);
                ctx.shells.push(shell);
                p.payload = false;
                p.phase = "returning".into();
                ctx.events.push(DamageEvent {
                    kind: "bomb-release".into(),
                    position: p.position,
                    ship_id: p.owner_id.clone(),
                    message: "Bomb away".into(),
                    shell: Some(effect),
                    aircraft: Some(AircraftEffect {
                        id: p.id.clone(),
                        ..Default::default()
                    }),
                    ..Default::default()
                });
            } else if p.position[1] < target_point[1] + 100.0
                || dot(sub(target_point, p.position), forward) < -100.0
            {
                p.pilot.attack_stage = Some("egress".into());
            }
        } else {
            let weapon = self.ground[&p.model_id]
                .torpedo
                .clone()
                .unwrap_or_else(air_torpedo);
            let fall = (-3.0 + (9.0 + 19.62 * p.position[1].max(0.0)).sqrt()) / 9.81;
            let entry = add(p.position, scale([p.velocity[0], 0.0, p.velocity[2]], fall));
            let future = add(target_point, scale(target.motion.velocity(), fall));
            let aim = torpedo_intercept(entry, future, target.motion.velocity(), weapon.speed)
                .unwrap_or(future);
            fly(
                p,
                [aim[0], 26.0, aim[2]],
                70.0,
                dt,
                FlightOptions {
                    bank_limit: Some(if distance > 1600.0 { 0.72 } else { 0.35 }),
                    altitude_lookahead: Some(450.0),
                    ..Default::default()
                },
            );
            let aligned = dot(
                normalize([p.velocity[0], 0.0, p.velocity[2]]),
                normalize([aim[0] - p.position[0], 0.0, aim[2] - p.position[2]]),
            ) > 0.999;
            if distance < 1050.0
                && distance > 650.0
                && p.position[1] < 38.0
                && p.position[1] > 15.0
                && p.bank.abs() < 0.12
                && p.pitch.abs() < 0.08
                && aligned
                && clear_torpedo_lane(actor, entry, aim, weapon.speed, ctx.actors)
            {
                let id = ctx.next_id();
                ctx.releases.push(AirRelease {
                    id,
                    owner_id: p.owner_id.clone(),
                    position: p.position,
                    velocity: [p.velocity[0], -3.0, p.velocity[2]],
                    weapon: Some(weapon),
                });
                p.payload = false;
                p.phase = "returning".into();
                ctx.event(p, "aircraft-release", "Torpedo away".into());
            }
            if distance < 550.0 && p.payload {
                p.pilot.attack_stage = Some("egress".into());
            }
        }
    }
}
impl Aviation {
    #[allow(clippy::too_many_arguments)]
    fn fighter_mission(
        &mut self,
        p: &mut Aircraft,
        carrier: Vec3,
        flight: &mut Option<AirFlight>,
        leader: Option<&Aircraft>,
        ctx: &mut AirContext<'_>,
        dt: f64,
        time: f64,
    ) {
        if p.ammo == 0.0 || self.rules.endurance.needs_recall(p.flight_time, true) {
            p.phase = "returning".into();
            return;
        }
        let mut patrol = carrier;
        if let Some(f) = flight {
            match &f.order {
                AirOrder::Patrol { point } => patrol = *point,
                AirOrder::Defend {
                    target_id: Some(id),
                } => {
                    if let Some(a) = ctx
                        .actors
                        .iter()
                        .find(|a| &a.motion.id == id && a.physical_loss().is_none())
                    {
                        patrol = [a.motion.x, 0.0, a.motion.z];
                    } else {
                        f.order = AirOrder::Defend { target_id: None };
                        f.notice = Some("Ship unavailable · Defending carrier".into());
                    }
                }
                AirOrder::Intercept { flight_id: id } => {
                    let target = self.planes().into_iter().find(|o| {
                        o.flight_id.as_ref() == Some(id)
                            && o.team != p.team
                            && airborne(o)
                            && o.hp > 0.0
                    });
                    if let Some(target) = target {
                        patrol = target.position;
                    } else if !self.wings.iter().any(|w| {
                        w.state
                            .flights
                            .iter()
                            .any(|f| &f.id == id && active_flight(f, &w.state.planes))
                    }) {
                        f.order = AirOrder::Patrol {
                            point: [p.position[0], 420.0, p.position[2]],
                        };
                        f.notice = Some("Interception complete · Loitering".into());
                    }
                }
                AirOrder::Escort { flight_id: id } => {
                    let target = self.planes().into_iter().find(|o| {
                        o.flight_id.as_ref() == Some(id) && airborne(o) && !on_flight_deck(o)
                    });
                    if let Some(target) = target {
                        patrol = target.position;
                    } else if !self.wings.iter().any(|w| {
                        w.state
                            .flights
                            .iter()
                            .any(|f| &f.id == id && active_flight(f, &w.state.planes))
                    }) {
                        f.order = AirOrder::Defend { target_id: None };
                        f.notice = Some("Escort complete · Defending carrier".into());
                    }
                }
                _ => {}
            }
        }
        let planes = self.planes();
        let target_flight = flight.as_ref().and_then(|f| match &f.order {
            AirOrder::Intercept { flight_id } => Some(flight_id.as_str()),
            _ => None,
        });
        let target =
            fighter_target(p, &planes, patrol, dt, target_flight).map(|i| planes[i].clone());
        let pressure = 1.0 - p.hp / 100.0
            + if target
                .as_ref()
                .is_some_and(|t| length(sub(t.position, p.position)) < 350.0)
            {
                0.5
            } else {
                0.0
            };
        step_discipline(
            p.pilot.fire_discipline.get_or_insert_default(),
            dt,
            pressure,
            gunnery_seed(&p.id, ctx.seed),
            target.is_some(),
        );
        let panic = p.pilot.fire_discipline.as_ref().unwrap().panic;
        if let Some(mut hostile) = target {
            p.phase = "attack".into();
            let pursuing = steer_fighter(p, &hostile, &planes, dt);
            let gun = fighter_gun_aim(p, &hostile);
            let on_aim = pursuing
                && gun.distance > 80.0
                && gun.distance < 600.0
                && gun.alignment > if panic { 0.94 } else { 0.996 }
                && clear_fighter_lane(p, gun.point, &planes);
            p.pilot.aim_time = if on_aim { p.pilot.aim_time + dt } else { 0.0 };
            if on_aim && p.pilot.aim_time >= if panic { 0.04 } else { 0.12 } && p.cooldown <= 0.0 {
                let burst = fighter_burst(p, gun.point, ctx.seed, p.sortie.unwrap_or(0));
                if !clear_fighter_lane(p, burst.end, &planes) {
                    return;
                }
                p.ammo -= 1.0;
                p.cooldown = 0.4;
                if burst.hit {
                    hostile.hp -= air_gunnery::FIGHTER_DAMAGE
                        * clamp((gun.alignment - 0.996) / 0.004, 0.3, 1.0)
                        * clamp(1.3 - gun.distance / 900.0, 0.5, 1.0);
                }
                ctx.events.push(DamageEvent {
                    kind: "aircraft-fire".into(),
                    position: p.position,
                    ship_id: p.owner_id.clone(),
                    message: "Fighter guns".into(),
                    aircraft: Some(AircraftEffect {
                        id: p.id.clone(),
                        target: Some(burst.end),
                        panic: Some(panic),
                        direction: Some(normalize(sub(
                            sub(burst.end, p.position),
                            scale(p.velocity, gun.time),
                        ))),
                        velocity: Some(p.velocity),
                        attitude: Some(FlightAttitude {
                            heading: p.heading,
                            pitch: p.pitch,
                            bank: p.bank,
                        }),
                        ..Default::default()
                    }),
                    ..Default::default()
                });
                if hostile.hp <= 0.0 {
                    p.kills += 1;
                    lose(&mut hostile, ctx.events, "Shot down");
                }
                let id = hostile.id.clone();
                *self.plane_mut(&id).unwrap() = hostile;
            }
        } else {
            p.phase = "outbound".into();
            p.pilot.aim_time = 0.0;
            let anchor = [patrol[0], 420.0_f64.max(patrol[1] + 80.0), patrol[2]];
            if leader.is_none_or(|l| l.phase == "attack")
                || !follow(p, flight.as_ref(), leader, dt, time, ctx.seed)
            {
                let point = orbit_point(p, anchor, 1000.0, 1.0);
                fly(
                    p,
                    point,
                    85.0,
                    dt,
                    FlightOptions {
                        bank_limit: Some(0.5),
                        ..Default::default()
                    },
                );
            }
        }
    }
}
