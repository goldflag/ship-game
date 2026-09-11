use crate::{
    damage::Combatant,
    definition::{ChargeDefinition, DepthChargePart, ShipDefinition, Vec3},
    environment::SeaState,
    geometry::*,
    machinery::{equipment_condition, launcher_available},
    motion::ShipState,
    torpedoes::damage_underwater_blast,
    vessel::{Fleet, Vessel},
};
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DepthChargeLauncherState {
    pub id: String,
    pub ammo: f64,
    pub reload: f64,
    pub status: String,
}
impl DepthChargeLauncherState {
    pub fn new(l: &ChargeDefinition) -> Self {
        Self {
            id: l.id.clone(),
            ammo: l.ammo,
            reload: 0.0,
            status: if l.ammo > 0.0 { "ready" } else { "empty" }.into(),
        }
    }
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepthCharge {
    pub id: i64,
    pub owner_id: String,
    pub launcher_id: String,
    pub position: Vec3,
    pub velocity: Vec3,
    pub age: f64,
    pub submerged: bool,
    pub weapon: DepthChargePart,
}
pub fn update_launcher(
    actor: &Combatant,
    def: &ShipDefinition,
    l: &ChargeDefinition,
    state: &mut DepthChargeLauncherState,
    dt: f64,
    cooldown: f64,
    sea: Option<(&SeaState, f64)>,
) {
    state.reload = (state.reload - dt).max(0.0);
    let magazine = def.modules.iter().find(|m| m.id == l.magazine_id);
    state.status = if actor.damage.sunk
        || actor.damage.stability.combat_lost
        || !launcher_available(actor, def, l.launcher_module_id.as_deref(), false, sea)
        || magazine.is_none_or(|m| equipment_condition(actor, def, m, sea).availability <= 0.0)
    {
        "disabled"
    } else if state.ammo <= 0.0 {
        "empty"
    } else if state.reload > 0.0 || cooldown > 0.0 {
        "reloading"
    } else {
        "ready"
    }
    .into();
}
pub fn launch(actor: &Combatant, l: &ChargeDefinition, id: i64) -> DepthCharge {
    DepthCharge {
        id,
        owner_id: actor.motion.id.clone(),
        launcher_id: l.id.clone(),
        position: local_to_world(l.position, actor.motion.pose()),
        velocity: add(
            rotate(l.velocity, actor.motion.pose()),
            actor.motion.velocity(),
        ),
        age: 0.0,
        submerged: false,
        weapon: l.weapon.clone(),
    }
}
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct ChargeStep {
    pub splash: Option<Vec3>,
    pub detonated: bool,
}
pub fn step(charge: &mut DepthCharge, dt: f64) -> ChargeStep {
    let mut remaining = dt;
    let mut splash = None;
    let p = &mut charge.position;
    let v = &mut charge.velocity;
    if !charge.submerged {
        let entry = ((v[1] + (v[1].powi(2) + 2.0 * 9.81 * p[1].max(0.0)).sqrt()) / 9.81).max(0.0);
        let air = remaining.min(entry);
        p[0] += v[0] * air;
        p[2] += v[2] * air;
        p[1] += v[1] * air - 0.5 * 9.81 * air.powi(2);
        v[1] -= 9.81 * air;
        remaining -= air;
        if entry <= dt {
            p[1] = 0.0;
            charge.submerged = true;
            splash = Some(*p);
        }
    }
    if charge.submerged {
        let time = remaining
            .min(((charge.weapon.detonation_depth_m + p[1]) / charge.weapon.sink_speed).max(0.0));
        let drag = (-1.6 * time).exp();
        p[0] += v[0] * (1.0 - drag) / 1.6;
        p[2] += v[2] * (1.0 - drag) / 1.6;
        v[0] *= drag;
        v[2] *= drag;
        v[1] = -charge.weapon.sink_speed;
        p[1] = (-charge.weapon.detonation_depth_m).max(p[1] - charge.weapon.sink_speed * time);
    }
    charge.age += dt;
    ChargeStep {
        splash,
        detonated: charge.submerged && p[1] <= -charge.weapon.detonation_depth_m + 1e-8,
    }
}
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct ChargeReach {
    pub point: Vec3,
    pub distance: f64,
}
pub fn reach(position: Vec3, motion: &ShipState, def: &ShipDefinition) -> ChargeReach {
    let local = world_to_local(position, motion.pose());
    let h = &def.hull;
    let z = clamp(local[2], -h.length / 2.0, h.length / 2.0);
    let station = h.length / 2.0 - z;
    let interpolate = |points: &[[f64; 2]]| {
        let i = points
            .windows(2)
            .position(|p| station >= p[0][0] && station <= p[1][0])
            .unwrap_or(0);
        let (a, b) = (points[i], points[i + 1]);
        a[1] + (b[1] - a[1]) * clamp((station - a[0]) / (b[0] - a[0]), 0.0, 1.0)
    };
    let width = interpolate(&h.half_breadths);
    let keel = interpolate(&h.keel_heights);
    let top = interpolate(&h.deck_heights).min(-motion.y);
    let point = [
        clamp(local[0], -width, width),
        clamp(local[1], keel, keel.max(top)),
        z,
    ];
    ChargeReach {
        point,
        distance: length(sub(local, point)),
    }
}
pub fn damage_depth_charge(
    charge: &DepthCharge,
    actor: &mut Combatant,
    def: &ShipDefinition,
) -> Option<String> {
    let r = reach(charge.position, &actor.motion, def);
    let w = &charge.weapon;
    if r.distance >= w.blast_radius_m {
        return None;
    }
    let strength = (1.0 - r.distance / w.blast_radius_m).powi(2);
    Some(damage_underwater_blast(
        actor,
        def,
        r.point,
        w.damage * strength,
        w.breach_area_m2 * strength,
        "Depth charge hit",
        charge.id,
    ))
}
pub fn bot_should_drop(
    actor: &Vessel,
    target: &Vessel,
    l: &ChargeDefinition,
    actors: Fleet<'_>,
) -> bool {
    if (actor.motion.x - target.motion.x).hypot(actor.motion.z - target.motion.z)
        > actor.definition().hull.length + target.definition().hull.length + l.weapon.blast_radius_m
    {
        return false;
    }
    let mut charge = launch(actor, l, 0);
    let air = ((charge.velocity[1]
        + (charge.velocity[1].powi(2) + 19.62 * charge.position[1].max(0.0)).sqrt())
        / 9.81)
        .max(0.0);
    let time = air + l.weapon.detonation_depth_m / l.weapon.sink_speed;
    step(&mut charge, time + 0.001);
    let predict = |a: &Vessel| {
        let mut p = a.motion.clone();
        let v = scale(p.velocity(), time);
        p.x += v[0];
        p.z += v[2];
        reach(charge.position, &p, a.definition()).distance
    };
    predict(target) < l.weapon.blast_radius_m * 0.75
        && predict(actor) >= l.weapon.blast_radius_m
        // The dropping ship is outside the fleet view on purpose: the clause
        // above is its own clearance check, at its own threshold.
        && !actors
            .iter()
            .any(|a| a.team == actor.team && predict(a) < l.weapon.blast_radius_m)
}
