use crate::{
    breaches::add_breach,
    contacts::{ContactKind, ShipContact, contact_armor},
    damage::Combatant,
    damage_control::heat_module,
    definition::{ShipDefinition, Vec3},
    geometry::*,
    machinery::equipment_pose,
    protection::plate_response,
    shell::{LocalDamageEvidence, LodgedShell, Shell, damage_shell_hull, local_damage_evidence},
    weapons::Ammunition,
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreachAssignment {
    pub compartment_id: String,
    pub area_m2: f64,
    pub position: Vec3,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactRecord {
    pub shell_id: i64,
    pub ship_id: String,
    pub target_id: String,
    pub target_name: String,
    pub kind: String,
    pub position: Vec3,
    pub thickness_mm: Option<f64>,
    pub material: Option<String>,
    pub obliquity_deg: Option<f64>,
    pub resistance_mm: Option<f64>,
    pub fragment_budget_mm: Option<f64>,
    pub impact_speed_mps: Option<f64>,
    pub exit_speed_mps: Option<f64>,
    pub fuze: Option<String>,
    pub fuze_remaining_seconds: Option<f64>,
    pub penetration_before_mm: f64,
    pub penetration_after_mm: f64,
    pub outcome: String,
    pub damage: Option<f64>,
    pub compartment_id: Option<String>,
    pub breach_area_m2: Option<f64>,
    pub terminal: Option<bool>,
    pub hull_damage: Option<f64>,
    pub local_damage: Option<LocalDamageEvidence>,
    pub through_wreckage: Option<bool>,
    pub connection_ids: Option<Vec<String>>,
    pub breach_assignments: Option<Vec<BreachAssignment>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceImpact {
    pub position: Vec3,
    pub normal: Vec3,
    pub direction: Vec3,
    pub mount_id: Option<String>,
    pub outcome: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellEffect {
    pub id: i64,
    pub caliber_m: f64,
    pub velocity: Vec3,
    pub ammunition: Option<Ammunition>,
    #[serde(rename = "type")]
    pub shell_type: String,
}
impl ShellEffect {
    pub fn from_shell(s: &Shell) -> Self {
        Self {
            id: s.id,
            caliber_m: s.caliber_m,
            velocity: s.velocity,
            ammunition: s.ammunition,
            shell_type: s.shell_type.clone().unwrap_or_else(|| {
                if s.ammunition == Some(Ammunition::He) {
                    "HE"
                } else {
                    "AP"
                }
                .into()
            }),
        }
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DamageEvent {
    pub hull_damage: Option<f64>,
    pub defeat_cause: Option<String>,
    pub depth_charge: Option<DepthChargeEffect>,
    pub aircraft: Option<AircraftEffect>,
    pub torpedo: Option<TorpedoEffect>,
    pub kind: String,
    pub position: Vec3,
    pub message: String,
    pub ship_id: String,
    pub impact: Option<ImpactRecord>,
    pub shell: Option<ShellEffect>,
    pub surface_impact: Option<SurfaceImpact>,
    pub normal: Option<Vec3>,
    pub detonation: Option<bool>,
    pub blast_radius_m: Option<f64>,
    pub water_burst_y: Option<f64>,
}
fn nearest_room(def: &ShipDefinition, point: Vec3) -> Option<usize> {
    def.compartments
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            let distance = |c: &crate::definition::Compartment| {
                let cells: Vec<_> = c.cells.as_ref().map_or_else(
                    || vec![(c.center, c.size)],
                    |cells| cells.iter().map(|c| (c.center, c.size)).collect(),
                );
                cells
                    .into_iter()
                    .map(|(center, size)| {
                        length(std::array::from_fn(|i| {
                            ((point[i] - center[i]).abs() - size[i] / 2.0).max(0.0)
                        }))
                    })
                    .fold(f64::INFINITY, f64::min)
            };
            distance(a).total_cmp(&distance(b))
        })
        .map(|(i, _)| i)
}
pub fn exterior_breaches(
    actor: &mut Combatant,
    def: &ShipDefinition,
    point: Vec3,
    normal: Vec3,
    shell: &Shell,
) -> Vec<BreachAssignment> {
    let area = shell.caliber_m.powi(2);
    let radius = (area / std::f64::consts::PI).sqrt();
    let (bottom, top) = (point[1] - radius, point[1] + radius);
    let mut assignments = vec![];
    let mut assign = |i: usize, point: Vec3, area: f64, radius: f64| {
        let c = &mut actor.damage.compartments[i];
        assignments.push(BreachAssignment {
            compartment_id: c.id.clone(),
            area_m2: add_breach(c, point, area, shell.id, Some(radius), Some(normal), false),
            position: point,
        });
    };
    let Some(regions) = def
        .flood_regions
        .as_ref()
        .filter(|_| normal[1].abs() <= 0.5)
    else {
        if let Some(i) = nearest_room(def, point) {
            assign(i, point, area, radius);
        }
        return assignments;
    };
    let regions: Vec<_> = regions
        .iter()
        .filter(|r| {
            r.face.as_ref().is_none_or(|face| match face.as_str() {
                "bow" => point[2] < 0.0,
                "stern" => point[2] >= 0.0,
                "port" => normal[0].abs() > 0.5 && point[0] < 0.0,
                _ => normal[0].abs() > 0.5 && point[0] >= 0.0,
            }) && [0, 2]
                .into_iter()
                .all(|i| (point[i] - r.center[i]).abs() <= r.size[i] / 2.0)
        })
        .collect();
    let mut cuts = vec![bottom, top];
    cuts.extend(
        regions
            .iter()
            .flat_map(|r| [r.center[1] - r.size[1] / 2.0, r.center[1] + r.size[1] / 2.0])
            .filter(|y| *y > bottom && *y < top),
    );
    cuts.sort_by(f64::total_cmp);
    cuts.dedup();
    for c in cuts.windows(2) {
        let p = [point[0], (c[0] + c[1]) / 2.0, point[2]];
        let region = regions.iter().find(|r| contains(r.center, r.size, p));
        let i = if let Some(r) = region {
            def.compartments
                .iter()
                .position(|c| c.id == r.compartment_id)
        } else {
            nearest_room(def, p)
        };
        if let Some(i) = i {
            assign(
                i,
                p,
                area * (c[1] - c[0]) / (2.0 * radius),
                (c[1] - c[0]) / 2.0,
            );
        }
    }
    assignments
}
fn arm(shell: &mut Shell, resistance: f64) {
    if let Some(ap) = &shell.ap
        && shell.detonate_at_age.is_none()
        && resistance >= ap.arming_resistance_mm
    {
        shell.detonate_at_age = Some(shell.age + ap.fuze_delay_seconds);
    }
}
fn pay(shell: &mut Shell, resistance: f64) {
    let before = shell.penetration_mm;
    shell.penetration_mm = (before - resistance).max(0.0);
    shell.velocity = if shell.penetration_mm > 0.0 && before > 0.0 {
        scale(
            shell.velocity,
            (shell.penetration_mm / before).powf(1.0 / 1.4),
        )
    } else {
        [0.0; 3]
    };
}
fn equipment_damage(shell: &mut Shell, hp: f64, kinetic: f64) -> f64 {
    let budget = shell.remaining_module_damage.unwrap_or(kinetic);
    let amount = hp.min(budget);
    shell.remaining_module_damage = Some((budget - amount).max(0.0));
    amount
}
fn mount_id(def: &ShipDefinition, hit: &ShipContact) -> Option<String> {
    match hit.kind {
        ContactKind::Mount => Some(def.mounts[hit.index as usize].id.clone()),
        ContactKind::Armor => contact_armor(def, hit).plate.and_then(|p| p.mount_id),
        _ => None,
    }
}
fn mount_pose(actor: &Combatant, def: &ShipDefinition, id: &str) -> Option<Pose> {
    let i = def.mounts.iter().position(|m| m.id == id)?;
    Some(crate::mount_frames::mount_frame(def, i, &|j| {
        actor.mounts[j].train
    }))
}
struct Resolution<'a> {
    hit: &'a ShipContact,
    def: &'a ShipDefinition,
    direction: Vec3,
    position: Vec3,
    incoming: Vec3,
    kinetic: f64,
    evidence: ImpactRecord,
}
impl Resolution<'_> {
    fn report(
        &mut self,
        shell: &mut Shell,
        actor: &mut Combatant,
        kind: &str,
        message: String,
    ) -> DamageEvent {
        if self.evidence.damage.unwrap_or(0.0) > 0.0 {
            let sum = shell
                .equipment_damage
                .entry(actor.motion.id.clone())
                .or_default();
            *sum += self.evidence.damage.unwrap();
            let total = shell.damage * 0.85 * (*sum / self.kinetic).min(1.0);
            let hp = damage_shell_hull(shell, actor, total, self.evidence.local_damage.as_ref());
            self.evidence.hull_damage = Some(self.evidence.hull_damage.unwrap_or(0.0) + hp);
        }
        let mut impact = self.evidence.clone();
        impact.penetration_after_mm = shell.penetration_mm;
        impact.exit_speed_mps = Some(length(shell.velocity));
        if shell.ap.is_some() {
            impact.fuze = Some(
                if shell.detonate_at_age.is_some() {
                    "armed"
                } else {
                    "unarmed"
                }
                .into(),
            );
            impact.fuze_remaining_seconds =
                shell.detonate_at_age.map(|age| (age - shell.age).max(0.0));
        }
        let surface = if matches!(self.hit.kind, ContactKind::Mount | ContactKind::Armor)
            && impact.outcome != "backing"
        {
            let id = mount_id(self.def, self.hit);
            let pose = id.as_ref().and_then(|id| mount_pose(actor, self.def, id));
            let local = pose.unwrap_or_default();
            let rotation = Pose {
                x: 0.0,
                y: 0.0,
                z: 0.0,
                ..local
            };
            Some(SurfaceImpact {
                position: world_to_local(self.hit.point, local),
                normal: world_to_local(self.hit.normal, rotation),
                direction: world_to_local(self.direction, rotation),
                mount_id: id,
                outcome: match kind {
                    "ricochet" => "ricochet",
                    "stopped" => "stopped",
                    _ => "penetration",
                }
                .into(),
            })
        } else {
            None
        };
        let normal = (self.hit.kind == ContactKind::Mount
            || self.hit.kind == ContactKind::Armor
                && kind != "module"
                && impact.outcome != "backing")
            .then(|| rotate(self.hit.normal, actor.motion.pose()));
        let mut effect = ShellEffect::from_shell(shell);
        effect.velocity = self.incoming;
        DamageEvent {
            kind: kind.into(),
            position: self.position,
            message,
            ship_id: actor.motion.id.clone(),
            impact: Some(impact),
            shell: Some(effect),
            surface_impact: surface,
            normal,
            ..Default::default()
        }
    }
    fn stop(&mut self, shell: &mut Shell, actor: &mut Combatant, message: String) -> DamageEvent {
        pay(shell, shell.penetration_mm);
        if shell.detonate_at_age.is_some() {
            let id = mount_id(self.def, self.hit);
            let module = (self.hit.kind == ContactKind::Module)
                .then(|| &self.def.modules[self.hit.index as usize]);
            let pose = module
                .and_then(|m| equipment_pose(actor, self.def, m))
                .or_else(|| id.as_ref().and_then(|id| mount_pose(actor, self.def, id)));
            let origin = add(self.hit.point, scale(self.direction, -1e-4));
            shell.lodged = Some(LodgedShell {
                ship_id: actor.motion.id.clone(),
                position: pose.map_or(origin, |p| world_to_local(origin, p)),
                mount_id: id,
                module_id: module.map(|m| m.id.clone()),
            });
        }
        self.evidence.outcome = "stopped".into();
        self.evidence.terminal = Some(shell.lodged.is_none());
        shell.position = self.position;
        self.report(shell, actor, "stopped", message)
    }
    fn breaches(&mut self, actor: &mut Combatant, shell: &Shell) {
        let assignments =
            exterior_breaches(actor, self.def, self.hit.point, self.hit.normal, shell);
        self.evidence.compartment_id = assignments.first().map(|a| a.compartment_id.clone());
        self.evidence.breach_area_m2 = Some(assignments.iter().map(|a| a.area_m2).sum());
        self.evidence.breach_assignments = Some(assignments);
    }
}
/// Resolve one ordered contact, retaining energy, fuze and per-victim damage budgets.
pub fn resolve_ship_contact(
    shell: &mut Shell,
    hit: &ShipContact,
    actor: &mut Combatant,
    def: &ShipDefinition,
    local_direction: Option<Vec3>,
) -> (bool, DamageEvent) {
    let direction = local_direction.unwrap_or_else(|| {
        normalize(world_to_local(
            add(
                [actor.motion.x, actor.motion.y, actor.motion.z],
                shell.velocity,
            ),
            actor.motion.pose(),
        ))
    });
    shell.visited.push(hit.key.clone());
    shell.visited.extend(hit.seam_keys.iter().cloned());
    shell.last_hit_ship_id = Some(actor.motion.id.clone());
    let position = local_to_world(hit.point, actor.motion.pose());
    let i = hit.index.max(0) as usize;
    let (target_id, target_name) = match hit.kind {
        ContactKind::Armor => {
            let a = contact_armor(def, hit);
            (a.id, a.name)
        }
        ContactKind::Module => (def.modules[i].id.clone(), def.modules[i].name.clone()),
        ContactKind::Mount => (def.mounts[i].id.clone(), def.mounts[i].name.clone()),
        ContactKind::Boundary => {
            let id = actor.damage.connections[i].id.clone();
            (id.clone(), format!("Watertight boundary {id}"))
        }
    };
    let local = local_damage_evidence(
        actor,
        def,
        hit.point,
        mount_id(def, hit).as_deref(),
        (hit.kind == ContactKind::Module).then(|| def.modules[i].id.as_str()),
    );
    let through = shell.wreckage_ships.contains(&actor.motion.id);
    if local.as_ref().is_some_and(|l| l.condition < 0.1) && !through {
        shell.wreckage_ships.push(actor.motion.id.clone());
    }
    let evidence = ImpactRecord {
        shell_id: shell.id,
        ship_id: actor.motion.id.clone(),
        target_id,
        target_name: target_name.clone(),
        kind: match hit.kind {
            ContactKind::Armor => "armor",
            ContactKind::Module => "module",
            ContactKind::Mount => "mount",
            ContactKind::Boundary => "boundary",
        }
        .into(),
        position: hit.point,
        impact_speed_mps: Some(length(shell.velocity)),
        penetration_before_mm: shell.penetration_mm,
        penetration_after_mm: shell.penetration_mm,
        outcome: "damaged".into(),
        local_damage: local,
        through_wreckage: through.then_some(true),
        ..Default::default()
    };
    let kinetic = shell.damage * if shell.ap.is_some() { 0.75 } else { 1.0 };
    let mut r = Resolution {
        hit,
        def,
        direction,
        position,
        incoming: shell.velocity,
        kinetic,
        evidence,
    };
    if let Some(he) = shell.he.clone() {
        shell.detonate_at_age = Some(shell.age);
        r.evidence.outcome = "detonation".into();
        r.evidence.fuze = Some("armed".into());
        r.evidence.fuze_remaining_seconds = Some(0.0);
        r.evidence.fragment_budget_mm = Some(he.fragment_penetration_mm);
        if hit.kind == ContactKind::Armor {
            let a = contact_armor(def, hit);
            let material = a.plate.as_ref().map_or("steel", |p| p.material.as_str());
            let resistance = plate_response(a.thickness_mm, material, 1.0, 0.01).resistance_mm;
            r.evidence.thickness_mm = Some(a.thickness_mm);
            r.evidence.material = Some(material.into());
            r.evidence.resistance_mm = Some(resistance);
            if he.fragment_penetration_mm > resistance && resistance > 0.0 {
                r.evidence.hull_damage = Some(damage_shell_hull(
                    shell,
                    actor,
                    he.damage * 0.35,
                    r.evidence.local_damage.as_ref(),
                ));
            }
            if he.fragment_penetration_mm > resistance && exterior(&a, hit) {
                r.breaches(actor, shell);
            }
        }
        return (
            true,
            r.report(
                shell,
                actor,
                "contact",
                format!("HE contact · {target_name}"),
            ),
        );
    }
    match hit.kind {
        ContactKind::Armor => {
            let a = contact_armor(def, hit);
            let cosine = dot(direction, hit.normal).abs();
            let material = a.plate.as_ref().map_or("steel", |p| p.material.as_str());
            let response = plate_response(a.thickness_mm, material, cosine, shell.caliber_m);
            let resistance = response.resistance_mm;
            r.evidence.thickness_mm = Some(a.thickness_mm);
            r.evidence.material = Some(material.into());
            r.evidence.obliquity_deg =
                Some(clamp(cosine, 0.0, 1.0).acos() * 180.0 / std::f64::consts::PI);
            r.evidence.resistance_mm = Some(resistance);
            if material == "teak" {
                r.evidence.outcome = "backing".into();
                return (
                    false,
                    r.report(shell, actor, "penetration", format!("Passed {}", a.name)),
                );
            }
            if response.ricochet {
                let normal = normalize(rotate(hit.normal, actor.motion.pose()));
                let along = dot(shell.velocity, normal);
                let before = length(shell.velocity);
                shell.velocity = scale(sub(shell.velocity, scale(normal, 1.5 * along)), 0.78);
                shell.penetration_mm *= (length(shell.velocity) / before).powf(1.4);
                shell.position = add(
                    position,
                    scale(
                        normal,
                        if along == 0.0 {
                            0.0
                        } else {
                            (-along).signum() * 0.002
                        },
                    ),
                );
                r.evidence.outcome = "ricochet".into();
                r.evidence.terminal = Some(false);
                return (
                    false,
                    r.report(shell, actor, "ricochet", format!("Deflected by {}", a.name)),
                );
            }
            arm(shell, resistance);
            if shell.penetration_mm <= resistance {
                return (true, r.stop(shell, actor, format!("Stopped by {}", a.name)));
            }
            pay(shell, resistance);
            r.evidence.outcome = "penetrated".into();
            let arming = shell
                .ap
                .as_ref()
                .map_or(shell.caliber_m * 1000.0 / 6.0, |p| p.arming_resistance_mm);
            let total = shell.damage * if resistance >= arming { 0.65 } else { 0.15 };
            r.evidence.hull_damage = Some(damage_shell_hull(
                shell,
                actor,
                total,
                r.evidence.local_damage.as_ref(),
            ));
            for (j, c) in def.connections.iter().enumerate() {
                if c.armor_id.as_ref() != Some(&a.id)
                    || c.bounds
                        .as_ref()
                        .is_some_and(|b| !contains(b.center, b.size, hit.point))
                {
                    continue;
                }
                let s = &mut actor.damage.connections[j];
                s.state = "damaged".into();
                s.damage_area_m2 = c.area_m2.min(s.damage_area_m2 + shell.caliber_m.powi(2));
                r.evidence
                    .connection_ids
                    .get_or_insert_default()
                    .push(s.id.clone());
            }
            if let Some(id) = a.plate.as_ref().and_then(|p| p.mount_id.as_ref()) {
                let j = def.mounts.iter().position(|m| &m.id == id).unwrap();
                let state = &mut actor.mounts[j];
                let key = format!("{}:mount-damage:{id}", actor.motion.id);
                let amount = if shell.visited.contains(&key) {
                    0.0
                } else {
                    equipment_damage(shell, state.hp, kinetic)
                };
                if amount > 0.0 {
                    shell.visited.push(key);
                }
                r.evidence.damage = Some(state.hp.min(amount));
                state.hp = (state.hp - amount).max(0.0);
                let disabled = state.hp == 0.0;
                r.evidence.outcome = if disabled { "destroyed" } else { "damaged" }.into();
                return (
                    false,
                    r.report(
                        shell,
                        actor,
                        "penetration",
                        format!(
                            "Penetrated {} · {} {}",
                            a.name,
                            def.mounts[j].name,
                            if disabled { "disabled" } else { "damaged" }
                        ),
                    ),
                );
            }
            if exterior(&a, hit) {
                r.breaches(actor, shell);
            }
            (
                false,
                r.report(
                    shell,
                    actor,
                    "penetration",
                    format!("Penetrated {}", a.name),
                ),
            )
        }
        ContactKind::Module => {
            let m = &def.modules[i];
            let resistance = m.protection_mm.unwrap_or(50.0);
            r.evidence.resistance_mm = Some(resistance);
            arm(shell, resistance);
            if m.protection_mm.is_some_and(|p| shell.penetration_mm <= p) {
                return (
                    true,
                    r.stop(shell, actor, format!("Stopped by {} protection", m.name)),
                );
            }
            let state = &mut actor.damage.modules[i];
            let damage = equipment_damage(shell, state.hp, kinetic);
            r.evidence.damage = Some(damage);
            r.evidence.compartment_id = m.compartment_id.clone();
            state.hp = (state.hp - damage).max(0.0);
            let disabled = state.hp == 0.0;
            r.evidence.outcome = if disabled { "destroyed" } else { "damaged" }.into();
            pay(shell, resistance);
            r.evidence.terminal = Some(shell.penetration_mm == 0.0);
            if shell.penetration_mm == 0.0 && shell.detonate_at_age.is_some() {
                shell.lodged = Some(LodgedShell {
                    ship_id: actor.motion.id.clone(),
                    position: hit.point,
                    mount_id: None,
                    module_id: None,
                });
                r.evidence.terminal = Some(false);
            }
            let event = r.report(
                shell,
                actor,
                "module",
                format!(
                    "{} {}",
                    m.name,
                    if disabled { "disabled" } else { "damaged" }
                ),
            );
            if shell.ap.is_some() || shell.he.is_some() {
                heat_module(actor, def, i, damage * 0.15);
            }
            (shell.penetration_mm == 0.0, event)
        }
        ContactKind::Boundary => {
            let c = &def.connections[i];
            let thickness = c.thickness_mm.unwrap();
            let resistance = thickness / 0.2_f64.max(dot(direction, hit.normal).abs());
            r.evidence.thickness_mm = Some(thickness);
            r.evidence.material = Some("steel".into());
            r.evidence.resistance_mm = Some(resistance);
            r.evidence.connection_ids = Some(vec![actor.damage.connections[i].id.clone()]);
            arm(shell, resistance);
            if shell.penetration_mm <= resistance {
                return (
                    true,
                    r.stop(shell, actor, format!("Stopped by {target_name}")),
                );
            }
            pay(shell, resistance);
            let s = &mut actor.damage.connections[i];
            s.state = "damaged".into();
            s.damage_area_m2 = c.area_m2.min(s.damage_area_m2 + shell.caliber_m.powi(2));
            r.evidence.outcome = "penetrated".into();
            r.evidence.breach_area_m2 = Some(s.damage_area_m2);
            (
                false,
                r.report(
                    shell,
                    actor,
                    "penetration",
                    format!("Breached {target_name}"),
                ),
            )
        }
        ContactKind::Mount => {
            let m = &def.mounts[i];
            let armor = m.weapon.armor_mm;
            r.evidence.thickness_mm = Some(armor);
            r.evidence.material = Some("steel".into());
            r.evidence.resistance_mm = Some(armor);
            arm(shell, armor);
            if shell.penetration_mm <= armor {
                return (
                    true,
                    r.stop(shell, actor, format!("Stopped by {} armor", m.name)),
                );
            }
            pay(shell, armor);
            let state = &mut actor.mounts[i];
            let key = format!("{}:mount-damage:{}", actor.motion.id, m.id);
            let amount = if shell.visited.contains(&key) {
                0.0
            } else {
                equipment_damage(shell, state.hp, kinetic)
            };
            if amount > 0.0 {
                shell.visited.push(key);
            }
            r.evidence.damage = Some(state.hp.min(amount));
            state.hp = (state.hp - amount).max(0.0);
            let disabled = state.hp == 0.0;
            r.evidence.outcome = if disabled { "destroyed" } else { "damaged" }.into();
            (
                false,
                r.report(
                    shell,
                    actor,
                    "module",
                    format!(
                        "{} {}",
                        m.name,
                        if disabled { "disabled" } else { "damaged" }
                    ),
                ),
            )
        }
    }
}
fn exterior(a: &crate::definition::Armor, hit: &ShipContact) -> bool {
    a.plate.as_ref().is_some_and(|p| p.exterior == Some(true))
        || a.exterior == Some(true)
        || a.exterior.is_none() && a.plate.is_none() && hit.key.ends_with(":entry")
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AircraftEffect {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caliber_m: Option<f64>,
    pub id: String,
    pub target: Option<Vec3>,
    pub direction: Option<Vec3>,
    pub velocity: Option<Vec3>,
    pub attitude: Option<crate::aircraft_flight::FlightAttitude>,
    pub panic: Option<bool>,
    pub tracer_speed: Option<f64>,
    pub drag_per_second: Option<f64>,
    pub airburst: Option<AirburstEffect>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AirburstEffect {
    pub flight_time: f64,
    pub caliber_m: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorpedoEffect {
    pub id: i64,
    pub velocity: Vec3,
    pub diameter_m: f64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepthChargeEffect {
    pub id: i64,
    pub radius_m: f64,
}
