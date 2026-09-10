use crate::{
    breaches::add_breach,
    damage::Combatant,
    definition::{FireProfile, ShipDefinition, Vec3},
    environment::SeaState,
    geometry::{clamp, local_to_world},
    hull::hull_contains,
    machinery::{EquipmentReason, equipment_condition},
};
use serde::{Deserialize, Serialize};
/// Closed set, written only here and published as the same JSON strings.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FireTrend {
    Growing,
    Contained,
    Cooling,
    #[default]
    Out,
}
/// Damage-control job kinds. Variants are declared in the byte order of their
/// serialized names so the `Ord` used to break score ties is unchanged.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobKind {
    FireMount,
    FireRoom,
    Isolate,
    Patch,
    Pump,
    RepairModule,
    RepairMount,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FireState {
    pub heat: f64,
    pub fuel: f64,
    pub intensity: f64,
    pub initial_fuel: f64,
    pub ignition_heat: f64,
    pub heat_per_damage: f64,
    pub trend: FireTrend,
    pub suppressed: bool,
}
impl FireState {
    fn new(fuel: f64, profile: Option<&FireProfile>) -> Self {
        let fuel = profile.map_or(fuel, |p| p.fuel_seconds);
        Self {
            heat: 0.0,
            fuel,
            intensity: 0.0,
            initial_fuel: fuel,
            ignition_heat: profile.map_or(0.6, |p| p.ignition_heat),
            heat_per_damage: profile.map_or(0.01, |p| p.heat_per_damage),
            trend: FireTrend::Out,
            suppressed: false,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ControlJob {
    pub kind: JobKind,
    pub index: usize,
    pub setup: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ControlState {
    pub priority: String,
    pub focus: String,
    pub spares: f64,
    pub rooms: Vec<FireState>,
    pub mounts: Vec<FireState>,
    pub teams: Vec<Option<ControlJob>>,
    pub pumping: Vec<f64>,
}
impl ControlState {
    pub fn new(def: &ShipDefinition) -> Self {
        let d = def.damage_control.as_ref();
        Self {
            priority: "balanced".into(),
            focus: String::new(),
            spares: d.map_or(0.0, |d| d.repair_points),
            rooms: def
                .compartments
                .iter()
                .map(|c| FireState::new(d.map_or(0.0, |d| d.room_fuel_seconds), c.fire.as_ref()))
                .collect(),
            mounts: def
                .mounts
                .iter()
                .map(|m| FireState::new(d.map_or(0.0, |d| d.mount_fuel_seconds), m.fire.as_ref()))
                .collect(),
            teams: vec![None; d.map_or(0, |d| d.teams as usize)],
            pumping: vec![0.0; def.compartments.len()],
        }
    }
}
#[derive(Clone, Debug)]
struct Offer {
    job: ControlJob,
    score: f64,
}
fn key(job: &ControlJob) -> (JobKind, usize) {
    (job.kind, job.index)
}
fn assign_teams(teams: &[Option<ControlJob>], jobs: &[Offer]) -> Vec<Option<ControlJob>> {
    let mut claimed = std::collections::BTreeSet::new();
    let mut assigned: Vec<_> = teams
        .iter()
        .map(|j| {
            let j = j.as_ref()?;
            let offer = jobs.iter().find(|o| key(&o.job) == key(j))?;
            if !claimed.insert(key(j)) {
                return None;
            }
            Some(Offer {
                job: j.clone(),
                score: offer.score,
            })
        })
        .collect();
    for offer in jobs {
        if claimed.contains(&key(&offer.job)) {
            continue;
        }
        let team = assigned.iter().position(Option::is_none).or_else(|| {
            let i = assigned
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| {
                    a.as_ref()
                        .unwrap()
                        .score
                        .total_cmp(&b.as_ref().unwrap().score)
                })?
                .0;
            (offer.score >= assigned[i].as_ref().unwrap().score + 30.0).then_some(i)
        });
        if let Some(i) = team {
            if let Some(previous) = &assigned[i] {
                claimed.remove(&key(&previous.job));
            }
            assigned[i] = Some(offer.clone());
            claimed.insert(key(&offer.job));
        }
    }
    assigned.into_iter().map(|o| o.map(|o| o.job)).collect()
}
/// The compartment a module sits in, from the compiled index when it applies.
fn compartment_of(
    index: Option<&crate::vessel::ShipIndex>,
    def: &ShipDefinition,
    i: usize,
) -> Option<usize> {
    if let Some(ix) = index {
        return ix.room(i);
    }
    let id = def.modules[i].compartment_id.as_ref();
    def.compartments.iter().position(|r| Some(&r.id) == id)
}
fn wet(actor: &Combatant, def: &ShipDefinition, i: usize) -> f64 {
    actor.damage.compartments[i].water_m3 / def.compartments[i].capacity_m3
}
pub fn heat_room(actor: &mut Combatant, def: &ShipDefinition, i: usize, damage: f64) {
    if def.damage_control.is_none() || wet(actor, def, i) >= 0.25 {
        return;
    }
    if let Some(f) = actor.damage.control.rooms.get_mut(i)
        && f.fuel > 0.0
    {
        f.heat = (f.heat + damage.max(0.0) * f.heat_per_damage).min(2.0);
    }
}
pub fn heat_module(actor: &mut Combatant, def: &ShipDefinition, i: usize, damage: f64) {
    if def.damage_control.is_none() {
        return;
    }
    let m = &def.modules[i];
    let Some(room) = compartment_of(actor.index.of(def), def, i) else {
        return;
    };
    if wet(actor, def, room) >= 0.25 {
        return;
    }
    heat_room(actor, def, room, damage);
    if m.kind == "magazine" {
        actor.damage.modules[i].ignition += damage / 150.0;
    }
}
pub fn heat_mount(actor: &mut Combatant, i: usize, damage: f64) {
    if let Some(f) = actor.damage.control.mounts.get_mut(i)
        && f.fuel > 0.0
    {
        f.heat = (f.heat + damage.max(0.0) * f.heat_per_damage).min(2.0);
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MagazineIgnition {
    pub ship_id: String,
    pub module_id: String,
    pub position: Vec3,
}
pub fn update_damage_control(
    actor: &mut Combatant,
    def: &ShipDefinition,
    dt: f64,
    sea: Option<(&SeaState, f64)>,
) -> Vec<MagazineIgnition> {
    actor.damage.control.pumping.fill(0.0);
    // Held by value so the compiled index outlives the mutable borrows below.
    let compiled = actor.index.clone();
    let index = compiled.of(def);
    let magazines = index.filter(|ix| {
        ix.mounts == def.mounts.len() && actor.damage.modules.len() == ix.modules
    });
    let mut scratch: Vec<usize> = vec![];
    let mut events = vec![];
    let Some(d) = &def.damage_control else {
        return events;
    };
    if actor.damage.sunk || dt <= 0.0 {
        return events;
    }
    let c = &actor.damage.control;
    let mut jobs = vec![];
    let mut offer = |kind: JobKind, index: usize, id: &str, score: f64, category: &str| {
        jobs.push(Offer {
            job: ControlJob {
                kind,
                index,
                setup: d.setup_seconds,
            },
            score: score
                + if c.priority == category { 100.0 } else { 0.0 }
                + if !c.focus.is_empty() && c.focus == id {
                    200.0
                } else {
                    0.0
                },
        })
    };
    for (i, f) in c.rooms.iter().enumerate() {
        let w = wet(actor, def, i);
        let room = &def.compartments[i];
        let state = &actor.damage.compartments[i];
        if f.heat > 0.15 && w < 0.6 {
            offer(
                JobKind::FireRoom,
                i,
                &room.id,
                60.0 + f.heat * 10.0,
                "fires",
            );
        }
        if w > 0.001 && w < 0.9 {
            offer(JobKind::Pump, i, &room.id, 20.0 + w * 20.0, "flooding");
        }
        if w < 0.6
            && state
                .breaches
                .iter()
                .any(|b| b.area_m2 > 0.0 && b.area_m2 <= d.max_patch_m2)
            && c.spares > 0.0
        {
            offer(JobKind::Patch, i, &room.id, 50.0, "flooding");
        }
    }
    for (i, f) in c.mounts.iter().enumerate() {
        if f.heat > 0.15 {
            offer(
                JobKind::FireMount,
                i,
                &def.mounts[i].id,
                60.0 + f.heat * 10.0,
                "fires",
            );
        }
    }
    for (i, s) in actor.damage.connections.iter().enumerate() {
        if s.state != "open" {
            continue;
        }
        let fire = c.rooms[s.from_index].intensity > 0.0 || c.rooms[s.to_index].intensity > 0.0;
        if fire || (wet(actor, def, s.from_index) - wet(actor, def, s.to_index)).abs() > 0.02 {
            offer(
                JobKind::Isolate,
                i,
                &def.compartments[s.from_index].id,
                80.0,
                if fire { "fires" } else { "flooding" },
            );
        }
    }
    if c.spares > 0.0 {
        for (i, m) in def.modules.iter().enumerate() {
            let room = compartment_of(index, def, i);
            let hp = actor.damage.modules[i].hp;
            if hp > 0.0
                && hp < m.hp * d.repair_ceiling
                && equipment_condition(actor, def, m, sea).reason != EquipmentReason::Flooded
                && room.is_none_or(|r| c.rooms[r].heat < 0.15 && wet(actor, def, r) < 0.2)
            {
                offer(
                    JobKind::RepairModule,
                    i,
                    m.compartment_id.as_ref().unwrap_or(&m.id),
                    10.0,
                    "repairs",
                );
            }
        }
        for (i, m) in actor.mounts.iter().enumerate() {
            if m.hp > 0.0 && m.hp < 100.0 * d.repair_ceiling && c.mounts[i].heat < 0.15 {
                offer(JobKind::RepairMount, i, &def.mounts[i].id, 10.0, "repairs");
            }
        }
    }
    jobs.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| a.job.kind.cmp(&b.job.kind))
            .then_with(|| a.job.index.cmp(&b.job.index))
    });
    let c = &mut actor.damage.control;
    c.teams = assign_teams(&c.teams, &jobs);
    let mut suppress_rooms = vec![0.0; c.rooms.len()];
    let mut suppress_mounts = vec![0.0; c.mounts.len()];
    for job in c.teams.iter_mut().flatten() {
        let work = (dt - job.setup).max(0.0);
        job.setup = (job.setup - dt).max(0.0);
        if job.setup > 0.0 {
            continue;
        }
        let i = job.index;
        match job.kind {
            JobKind::FireRoom => suppress_rooms[i] = work,
            JobKind::FireMount => suppress_mounts[i] = work,
            JobKind::Pump => c.pumping[i] = d.portable_pump_m3_per_second * work / dt,
            JobKind::Isolate => actor.damage.connections[i].state = "closed".into(),
            JobKind::Patch => {
                let room = &mut actor.damage.compartments[i];
                if let Some(b) = room
                    .breaches
                    .iter_mut()
                    .find(|b| b.area_m2 > 0.0 && b.area_m2 <= d.max_patch_m2)
                {
                    let area = b
                        .area_m2
                        .min(d.patch_m2_per_second * work)
                        .min(c.spares / 100.0);
                    b.area_m2 -= area;
                    room.breach_area_m2 = (room.breach_area_m2 - area).max(0.0);
                    c.spares -= area * 100.0;
                    room.breaches.retain(|b| b.area_m2 > 1e-10);
                }
            }
            _ => {
                let module = job.kind == JobKind::RepairModule;
                let hp = if module {
                    &mut actor.damage.modules[i].hp
                } else {
                    &mut actor.mounts[i].hp
                };
                let maximum = if module { def.modules[i].hp } else { 100.0 } * d.repair_ceiling;
                let amount = (maximum - *hp)
                    .min(d.repair_hp_per_second * work)
                    .min(c.spares);
                *hp += amount;
                c.spares = (c.spares - amount).max(0.0);
            }
        }
    }
    let burn = |f: &mut FireState, water: f64, suppression: f64| {
        let before = f.heat;
        let burning = f.heat >= f.ignition_heat && f.fuel > 0.0 && water < 0.25;
        let intensity = if burning { f.heat.min(1.0) } else { 0.0 };
        f.intensity = intensity.min(f.fuel / dt);
        let seconds = if intensity > 0.0 {
            f.intensity * dt / intensity
        } else {
            0.0
        };
        f.fuel = (f.fuel - f.intensity * dt).max(0.0);
        f.heat = clamp(
            f.heat + 0.022 * seconds
                - (0.01 + water * 0.3) * dt
                - d.suppression_per_second * suppression,
            0.0,
            2.0,
        );
        f.suppressed = suppression > 0.0;
        f.trend = if f.intensity > 0.0 {
            if f.heat > before + 1e-9 && !f.suppressed {
                FireTrend::Growing
            } else {
                FireTrend::Contained
            }
        } else if f.heat > 0.15 {
            FireTrend::Cooling
        } else {
            FireTrend::Out
        };
    };
    for (i, f) in c.rooms.iter_mut().enumerate() {
        burn(
            f,
            actor.damage.compartments[i].water_m3 / def.compartments[i].capacity_m3,
            suppress_rooms[i],
        );
    }
    for (i, f) in c.mounts.iter_mut().enumerate() {
        burn(f, 0.0, suppress_mounts[i]);
        actor.mounts[i].hp = (actor.mounts[i].hp - f.intensity * 0.8 * dt).max(0.0);
        if let Some(id) = &def.mounts[i].magazine_id
            && f.intensity > 0.0
            && actor.mounts[i].ammo > 0.0
        {
            let magazine = match magazines {
                Some(ix) => ix.mount_magazine[i],
                None => actor.damage.modules.iter().position(|m| &m.id == id),
            };
            if let Some(j) = magazine {
                actor.damage.modules[j].ignition +=
                    f.intensity * (1.0 - d.flash_protection) * 0.015 * dt;
            }
        }
    }
    for s in &actor.damage.connections {
        if s.state == "closed" {
            continue;
        }
        let path = if s.state == "damaged" {
            (s.damage_area_m2 / 0.5).min(1.0)
        } else {
            1.0
        };
        if c.rooms[s.from_index].intensity > 0.0 && c.rooms[s.to_index].fuel > 0.0 {
            c.rooms[s.to_index].heat = (c.rooms[s.to_index].heat
                + c.rooms[s.from_index].intensity * path * 0.02 * dt)
                .min(2.0);
        }
        if c.rooms[s.to_index].intensity > 0.0 && c.rooms[s.from_index].fuel > 0.0 {
            c.rooms[s.from_index].heat = (c.rooms[s.from_index].heat
                + c.rooms[s.to_index].intensity * path * 0.02 * dt)
                .min(2.0);
        }
    }
    for (i, m) in def.modules.iter().enumerate() {
        let Some(ri) = compartment_of(index, def, i) else {
            continue;
        };
        let state = &mut actor.damage.modules[i];
        let f = &mut c.rooms[ri];
        let w = actor.damage.compartments[ri].water_m3 / def.compartments[ri].capacity_m3;
        state.hp = (state.hp - f.intensity * 0.8 * dt).max(0.0);
        if m.kind != "magazine" || state.detonated {
            continue;
        }
        state.ignition = if w >= 0.25 {
            0.0
        } else {
            (state.ignition + (f.intensity * 0.025 - 0.003) * dt - 0.05 * suppress_rooms[ri])
                .max(0.0)
        };
        let linked: &[usize] = match magazines {
            Some(ix) => ix.magazine_mounts(i),
            None => {
                scratch = def
                    .mounts
                    .iter()
                    .enumerate()
                    .filter(|(_, mount)| mount.magazine_id.as_ref() == Some(&m.id))
                    .map(|(j, _)| j)
                    .collect();
                &scratch
            }
        };
        if state.ignition < 1.0
            || !linked.is_empty() && linked.iter().all(|j| actor.mounts[*j].ammo == 0.0)
        {
            continue;
        }
        state.detonated = true;
        state.hp = 0.0;
        for j in linked {
            actor.mounts[*j].hp = 0.0;
            actor.mounts[*j].ammo = 0.0;
            actor.mounts[*j].he_ammo = 0.0;
        }
        let (mut low, mut high) = (0.0, def.hull.beam / 2.0);
        for _ in 0..20 {
            let x = (low + high) / 2.0;
            if hull_contains(&def.hull, [x, m.center[1], m.center[2]]) {
                low = x;
            } else {
                high = x;
            }
        }
        add_breach(
            &mut actor.damage.compartments[ri],
            [
                if m.center[0] < 0.0 { -low } else { low },
                m.center[1],
                m.center[2],
            ],
            2.0,
            -1,
            None,
            None,
            false,
        );
        for (j, s) in actor.damage.connections.iter_mut().enumerate() {
            if s.from_index == ri || s.to_index == ri {
                s.state = "damaged".into();
                s.damage_area_m2 = def.connections[j].area_m2;
            }
        }
        f.heat = 2.0;
        events.push(MagazineIgnition {
            ship_id: actor.motion.id.clone(),
            module_id: m.id.clone(),
            position: local_to_world(m.center, actor.motion.pose()),
        });
    }
    events
}
