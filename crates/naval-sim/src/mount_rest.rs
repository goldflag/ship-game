//! Where an idle gun rests. One fleet-wide rule, computed from data every mount
//! already carries, so presets and player designs share it without new fields:
//!
//! - A side secondary — secondary battery, heavier than light AA, riding on the
//!   hull rather than on another mount, and off the centreline — rests trained
//!   toward the nearer end of the ship: toward the bow when it sits in the
//!   forward half of the hull's length, toward the stern in the after half.
//! - The rest is a train relative to `bearingDeg`, clamped to the installed
//!   limits, because a narrow arc about the beam (the King George V's 5.25-inch
//!   turrets, ±80°) cannot reach the end it points toward. `bearingDeg` stays
//!   the arc centre and the authored neutral.
//! - The rest must be reachable and clear: the mount trains from neutral
//!   toward it, after the mounts before it in definition order have taken
//!   their own rests, through the movement interlock a battle uses (swept
//!   bodies or installation envelopes). A mount without an interlock stops
//!   before its barrels, breech to muzzle, would first enter the hull, an
//!   authored obstruction or another gunhouse (the firing check's boxes).
//!   Where it stops is its rest: Baltimore's forward wing 5-inch mounts stop
//!   at 141° off the bow, short of the after pair's gunhouses.
//! - Every other mount — main battery, light AA, carried and centreline mounts —
//!   rests at neutral, as before.
//!
//! `CompiledShip` solves the rests once per design; `Vessel::new` starts every
//! spawn, reset and the port at them, and gunnery trains an idle side secondary
//! back to its rest after [`IDLE_REST_SECONDS`] without an aim.
use crate::{
    definition::{MountDefinition, ShipDefinition},
    geometry::{clamp, radians, wrap_angle},
    mount_clearance::{ClearancePose, move_mount_with_clearance},
    mount_frames::update_mount_carrier,
    weapons::{MountState, Obstructions},
};
use std::f64::consts::{PI, TAU};

/// Guns at or below this calibre are light AA, never surface guns while a
/// heavier gun is fitted (`anti_aircraft::surface_allowed`). They rest at
/// neutral.
pub const LIGHT_AA_MAX_CALIBER_M: f64 = 0.08;
/// A mount this close to the centreline is a centreline mount.
pub const CENTRELINE_M: f64 = 0.5;
/// Seconds a resting side secondary goes without an aim, surface or air,
/// before it trains back to its rest.
pub const IDLE_REST_SECONDS: f64 = 5.0;
/// Step, in degrees, of the barrel sweep for mounts without an interlock.
const FOUL_STEP_DEG: f64 = 0.5;

/// Whether the rest rule turns this mount toward an end of the ship.
pub fn rests_toward_end(m: &MountDefinition) -> bool {
    m.battery == "secondary"
        && m.weapon.caliber_m > LIGHT_AA_MAX_CALIBER_M
        && m.parent_mount_id.is_none()
        && m.position[0].abs() > CENTRELINE_M
}

/// The elevation every mount spawns and rests at: its seated stow angle, or 1°.
pub fn rest_elevation(m: &MountDefinition) -> f64 {
    radians(m.initial_elevation_deg.unwrap_or(1.0))
}

/// The installed train limits, radians relative to `bearingDeg`.
pub fn train_limits(m: &MountDefinition) -> [f64; 2] {
    let w = &m.weapon;
    m.traverse_limits_deg
        .unwrap_or([-w.traverse_deg, w.traverse_deg])
        .map(radians)
}

/// The longitudinal middle of the hull, from its plan-view outline (`[x, z]`
/// points, bow toward −z). Authored hulls run from −L/2 to L/2; a constructed
/// hull sits where its designer built it.
pub fn midship_z(outline: &[[f64; 2]]) -> f64 {
    let (low, high) = outline
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(low, high), p| {
            (low.min(p[1]), high.max(p[1]))
        });
    if low.is_finite() && high.is_finite() {
        (low + high) / 2.0
    } else {
        0.0
    }
}

/// The train within the installed limits that brings the gun nearest the
/// nearer end of the ship: bearing 0 (the bow) for a mount at or forward of
/// `midship_z`, 180° (the stern) abaft it.
pub fn end_train(m: &MountDefinition, midship_z: f64) -> f64 {
    let end = if m.position[2] <= midship_z { 0.0 } else { PI };
    let [lo, hi] = train_limits(m);
    let wanted = wrap_angle(end - radians(m.bearing_deg));
    // Stern ahead of a bow-facing mount wraps to ±180°; take the turn the
    // limits allow, and on a tie the one nearer neutral.
    [wanted - TAU, wanted, wanted + TAU]
        .into_iter()
        .map(|t| {
            let reached = clamp(t, lo, hi);
            (reached, (reached - t).abs())
        })
        .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.abs().total_cmp(&b.0.abs())))
        .map_or(0.0, |(reached, _)| reached)
}

/// Every mount's rest train, `None` where the mount rests at neutral and
/// holds its last aim when idle. Solved once per design.
pub fn rest_trains(
    d: &ShipDefinition,
    midship_z: f64,
    obstructions: &Obstructions,
) -> Vec<Option<f64>> {
    let mut rest = vec![None; d.mounts.len()];
    if !d.mounts.iter().any(rests_toward_end) {
        return rest;
    }
    let mut states: Vec<MountState> = d.mounts.iter().map(MountState::new).collect();
    for i in 0..states.len() {
        update_mount_carrier(d, i, &mut states);
    }
    for (i, m) in d.mounts.iter().enumerate() {
        if !rests_toward_end(m) {
            continue;
        }
        let target = end_train(m, midship_z);
        let reached = train_toward(d, i, target, &states, obstructions);
        states[i].train = reached;
        for j in 0..states.len() {
            update_mount_carrier(d, j, &mut states);
        }
        rest[i] = Some(reached);
    }
    rest
}

/// Train mount `index` from its current pose toward `target` and return where
/// it stops: through the battle's own movement interlock where the mount has
/// one, otherwise before its barrels would first run into the hull, an
/// authored obstruction or another gunhouse (the firing check's boxes, taken
/// breech to muzzle).
fn train_toward(
    d: &ShipDefinition,
    index: usize,
    target: f64,
    states: &[MountState],
    obstructions: &Obstructions,
) -> f64 {
    let s = &states[index];
    if let Some(clearance) = obstructions.clearance.as_ref().filter(|c| c.enabled(index)) {
        let poses: Vec<ClearancePose> = states.iter().map(ClearancePose::from).collect();
        return clearance
            .resolve(
                d,
                index,
                &poses,
                ClearancePose {
                    train: target,
                    elevation: s.elevation,
                    recoil: 0.0,
                },
            )
            .pose
            .train;
    }
    if obstructions.clearance.is_none() && installation_interlocked(d, index) {
        let mut moved = s.clone();
        move_mount_with_clearance(d, index, &mut moved, (target, s.elevation), states);
        return moved.train;
    }
    let mut posed = s.clone();
    if obstructions.barrels_fouled(d, index, &posed, states) {
        // Boxes that already cross the barrels at neutral cannot judge them.
        return target;
    }
    let start = s.train;
    let steps = ((target - start).abs() / radians(FOUL_STEP_DEG)).ceil() as usize;
    let mut clear = start;
    for step in 1..=steps {
        posed.train = start + (target - start) * step as f64 / steps as f64;
        if obstructions.barrels_fouled(d, index, &posed, states) {
            return clear;
        }
        clear = posed.train;
    }
    target
}

/// Whether an installation clearance profile lists this mount, so that
/// `move_mount_with_clearance` stops it.
fn installation_interlocked(d: &ShipDefinition, index: usize) -> bool {
    d.mount_clearance
        .as_ref()
        .and_then(|p| p.mounts.as_deref())
        .is_some_and(|entries| entries.iter().any(|e| e.mount_id == d.mounts[index].id))
}
