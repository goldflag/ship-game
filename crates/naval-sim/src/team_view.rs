//! Team projection is an authority boundary. Nothing here reconstructs enemy
//! damage, ammunition, orders or motion from a hidden Vessel for presentation.
use crate::{
    battle::Battle,
    impact::DamageEvent,
    rules::{TeamId, mix32},
    sensors::ContactKind,
    snapshot::PresentationView,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;

impl Battle {
    pub(crate) fn point_observable(&self, point: [f64; 3], team: TeamId) -> bool {
        let entities = crate::sensors::entities(&self.actors, &self.aviation);
        self.point_visible_to(point, team, &entities)
    }
    fn point_visible_to(
        &self,
        point: [f64; 3],
        team: TeamId,
        entities: &[crate::sensors::VisualEntity],
    ) -> bool {
        let conditions = self.visual_conditions;
        entities
            .iter()
            .filter(|e| e.team == team && e.can_observe())
            .any(|observer| {
                let distance = (point[0] - observer.eye[0]).hypot(point[2] - observer.eye[2]);
                let reach: f64 = if observer.kind == ContactKind::Aircraft {
                    12000.0
                } else {
                    6000.0
                };
                let horizon = 3570.0 * (observer.eye[1].max(0.0).sqrt() + point[1].max(0.0).sqrt());
                distance <= reach.min(conditions.visibility_m).min(horizon)
                    && crate::sensors::line_visible(
                        observer.eye,
                        point,
                        &self.islands,
                        &self.catalog.terrain,
                    )
            })
    }
    pub(crate) fn public_entity_id(&self, id: &str, team: TeamId) -> Option<String> {
        if self
            .actors
            .iter()
            .any(|a| a.team == team && a.motion.id == id)
            || self
                .aviation
                .wings
                .iter()
                .flat_map(|w| &w.state.planes)
                .any(|p| p.team == team && p.id == id)
        {
            return Some(id.into());
        }
        self.sensors
            .track(team, id)
            .map(|c| c.id.clone())
            .or_else(|| self.sensors.contact(team, id).map(|c| c.id.clone()))
    }
    fn public_projectile_id(&self, id: i64, team: TeamId) -> i64 {
        // The integer mixer is a permutation, avoiding count-revealing gaps and
        // preserving cross-frame/effect identity within a battle.
        mix32(id as u32 ^ self.seed ^ (0xa17f_8329_u32.wrapping_mul(team.index() as u32 + 1)))
            as i64
    }
    pub(crate) fn observed_event(&self, event: &DamageEvent, team: TeamId) -> Option<DamageEvent> {
        let own = self
            .actors
            .iter()
            .any(|a| a.team == team && a.motion.id == event.ship_id);
        if !own && !self.point_observable(event.position, team) {
            return None;
        }
        let mut e = event.clone();
        e.ship_id = self.public_entity_id(&e.ship_id, team).unwrap_or_default();
        e.message = match e.kind.as_str() {
            "shot" => "Gunfire",
            "sunk" => "Ship sinking",
            "module" => "Damage aboard",
            "contact" => "Hull contact",
            "torpedo-launch" => "Torpedo away",
            "aircraft-fire" => "Aircraft fire",
            "aircraft-release" => "Weapon released",
            "burst" => "Explosion",
            "penetration" => "Armor hit",
            "ricochet" => "Ricochet",
            _ => "Combat report",
        }
        .into();
        if !own {
            e.hull_damage = None;
            e.defeat_cause = None;
            e.impact = None;
        }
        if let Some(effect) = e.shell.as_mut() {
            effect.id = self.public_projectile_id(effect.id, team);
        }
        if let Some(effect) = e.torpedo.as_mut() {
            effect.id = self.public_projectile_id(effect.id, team);
        }
        if let Some(effect) = e.depth_charge.as_mut() {
            effect.id = self.public_projectile_id(effect.id, team);
        }
        if let Some(impact) = e.impact.as_mut() {
            impact.shell_id = self.public_projectile_id(impact.shell_id, team);
        }
        if let Some(effect) = e.aircraft.as_mut() {
            effect.id = self
                .public_entity_id(&effect.id, team)
                .unwrap_or_else(|| "unidentified-aircraft".into());
        }
        // Impact evidence describes the owned damaged hull only. Incoming source
        // identity and enemy exact damage are not ordinary combat feedback.
        Some(e)
    }
    pub(crate) fn team_presentation(
        &self,
        mut full: Value,
        team: TeamId,
    ) -> Result<Value, serde_json::Error> {
        let own: BTreeSet<_> = self
            .actors
            .iter()
            .filter(|a| a.team == team)
            .map(|a| a.motion.id.as_str())
            .collect();
        let mut actors = vec![];
        for mut actor in full["actors"].as_array_mut().unwrap().drain(..) {
            if !own.contains(actor["motion"]["id"].as_str().unwrap_or_default()) {
                continue;
            }
            // A captain's target is an opaque observation ID in PvE.
            if let Some(id) = actor["targetId"].as_str() {
                actor["targetId"] = self
                    .public_entity_id(id, team)
                    .map_or(Value::Null, Value::String);
            }
            actors.push(actor);
        }
        let mut wings = vec![];
        for mut wing in full["wings"].as_array_mut().unwrap().drain(..) {
            if !own.contains(wing["ownerId"].as_str().unwrap_or_default()) {
                continue;
            }
            for plane in wing["state"]["planes"].as_array_mut().unwrap() {
                let plane = plane.as_object_mut().unwrap();
                // Owned pilot navigation now derives only from own positions
                // and team reports, so the command map can show its actual leg.
                plane.remove("kills");
                if let Some(id) = plane.get("targetId").and_then(Value::as_str) {
                    let id = self.public_entity_id(id, team);
                    plane.insert("targetId".into(), id.map_or(Value::Null, Value::String));
                }
            }
            wings.push(wing);
        }
        let observers = crate::sensors::entities(&self.actors, &self.aviation);
        let projectiles = |key: &str| -> Vec<Value> {
            full[key]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|p| {
                    let point: [f64; 3] = serde_json::from_value(p["position"].clone()).ok()?;
                    if !self.point_visible_to(point, team, &observers) {
                        return None;
                    }
                    let mut p = p.clone();
                    let object = p.as_object_mut().unwrap();
                    if let Some(id) = object.get("id").and_then(Value::as_i64) {
                        object.insert("id".into(), json!(self.public_projectile_id(id, team)));
                    }
                    let owner_id = object
                        .get("ownerId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    object.insert(
                        "ownerId".into(),
                        self.public_entity_id(&owner_id, team)
                            .map_or(json!(""), Value::String),
                    );
                    if !own.contains(owner_id.as_str()) {
                        if let Some(weapon) =
                            object.get_mut("weapon").and_then(Value::as_object_mut)
                        {
                            weapon.retain(|key, _| {
                                matches!(key.as_str(), "diameterM" | "lengthM" | "speed")
                            });
                        }
                        for field in [
                            "weaponLabel",
                            "damage",
                            "penetrationMm",
                            "ap",
                            "he",
                            "tubeId",
                            "launcherId",
                        ] {
                            object.remove(field);
                        }
                    }
                    Some(p)
                })
                .collect()
        };
        let contacts = self.sensors.contacts(team);
        let observed_ships: Vec<_> = self
            .sensors
            .observed(team)
            .filter(|(c, _)| {
                c.kind == ContactKind::Surface
                    && !c
                        .visible_condition
                        .as_ref()
                        .is_some_and(|condition| condition.sinking)
            })
            .map(|(c, e)| {
                json!({"id":c.id,"presetId":e.preset_id,"position":e.position,
                "heading":e.motion.heading,"pitch":e.motion.pitch,"roll":e.motion.roll,
                "velocity":e.motion.velocity,"observedTick":c.last_observed_tick,"health":e.health,
                "mounts":e.mounts,"launchers":e.launchers,
                "observers":c.sources.iter().map(|s| &s.observer_id).collect::<Vec<_>>()})
            })
            .collect();
        let observed_aircraft: Vec<_> = self
            .sensors
            .observed(team)
            .filter_map(|(c, e)| {
                e.aircraft.as_ref().map(|aircraft| {
                    json!({
                        "id":c.id,"modelId":aircraft.model_id,"position":e.position,
                        "heading":e.motion.heading,"pitch":e.motion.pitch,"roll":e.motion.roll,
                        "velocity":e.motion.velocity,"observedTick":c.last_observed_tick,"health":e.health,
                        "controls":aircraft.controls,"wingFold":aircraft.wing_fold,"payload":aircraft.payload,
                        "observers":c.sources.iter().map(|s| &s.observer_id).collect::<Vec<_>>()
                    })
                })
            })
            .collect();
        let mut tonnage: [Option<u64>; 2] = [None, None];
        tonnage[team.index()] = Some(crate::rules::afloat_kg(&self.survivors())[team.index()]);
        // Own vessels keep their live score sheet: damage dealt, ships sunk and a
        // hit log addressed through public contact IDs. Other teams' records and
        // the shell history stay private until the debrief.
        let scores: serde_json::Map<String, Value> = self
            .records
            .scores
            .iter()
            .filter(|(id, _)| own.contains(id.as_str()))
            .map(|(id, score)| {
                let log: Vec<Value> = score
                    .damage_log
                    .iter()
                    .filter_map(|entry| {
                        let source = self.public_entity_id(&entry.source_id, team)?;
                        let target = self.public_entity_id(&entry.target_id, team)?;
                        Some(json!({"id":entry.id,"tick":entry.tick,"sourceId":source,"targetId":target,
                            "weapon":entry.weapon,"damage":entry.damage,"hits":entry.hits}))
                    })
                    .collect();
                (
                    id.clone(),
                    json!({"damageDealt":score.damage_dealt,"frags":score.frags,"damageLog":log}),
                )
            })
            .collect();
        let mut frame = json!({
            "view":"team", "team":team, "tick":self.tick, "actors":actors, "wings":wings,
            "contacts":contacts, "observedShips":observed_ships, "observedAircraft":observed_aircraft, "reconCoverage": self.sensors.coverage(team),
            "shells":projectiles("shells"), "torpedoes":projectiles("torpedoes"),
            "depthCharges":projectiles("depthCharges"), "releases":projectiles("releases"),
            "events":self.team_events[team.index()], "records":{"scores":scores,"shellHistory":[]},
            "outcome":self.outcome, "afloatKg":tonnage, "remainingSeconds":self.remaining_seconds(),
            "missionRules":self.mission_rules,
        });
        if self.outcome.is_some() {
            // Full information belongs in the debrief, never in the active world.
            frame["debrief"] = self.presentation_value(PresentationView::FullKnowledge)?;
            frame["debrief"]["shipOutcomes"] = json!(
                self.actors
                    .iter()
                    .map(|actor| {
                        let status = if actor.physical_loss().is_some() {
                            "sunk"
                        } else if crate::mission::permanently_incapable(
                            actor,
                            self.aviation.wing(&actor.motion.id),
                        ) {
                            "incapacitated"
                        } else {
                            "operational"
                        };
                        (&actor.motion.id, status)
                    })
                    .collect::<std::collections::BTreeMap<_, _>>()
            );
        }
        Ok(frame)
    }
}
