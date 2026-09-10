//! Short captain corrections from reported aircraft motion and locally visible
//! torpedo wakes. Neither targeting intent nor hidden payload state is consulted.
use crate::{
    environment::{Island, TerrainField},
    geometry::wrap_angle,
    motion::HelmCommand,
    navigation::{NavigationState, NavigationStatus},
    rules::TICK_RATE,
    sensors::{Affiliation, ContactKind, ContactTrack, line_visible},
    torpedoes::Torpedo,
    vessel::Vessel,
};

#[derive(Clone, Debug)]
pub struct Evasion {
    until_tick: u64,
    heading: f64,
    torpedo: bool,
}
#[derive(Clone, Copy, Debug)]
pub struct ObservedThreat {
    pub position: [f64; 3],
    pub velocity: [f64; 3],
    pub torpedo: bool,
}
/// Short range visual wake acquisition. The 1.5 km daylight range is gameplay
/// tuning, capped by authored weather visibility and actual terrain occlusion.
pub fn visible_wakes(
    actor: &Vessel,
    torpedoes: &[Torpedo],
    islands: &[Island],
    terrain: &[TerrainField],
    visibility_m: f64,
) -> Vec<ObservedThreat> {
    let eye = [actor.motion.x, actor.motion.y + 8.0, actor.motion.z];
    torpedoes
        .iter()
        .filter(|t| {
            t.owner_id != actor.motion.id
                && (t.position[0] - eye[0]).hypot(t.position[2] - eye[2])
                    <= visibility_m.min(1500.0)
                && line_visible(eye, [t.position[0], 0.05, t.position[2]], islands, terrain)
        })
        .map(|t| ObservedThreat {
            position: t.position,
            velocity: t.velocity,
            torpedo: true,
        })
        .collect()
}
/// Select only converging measured motion. Receding CAP and stale reports do
/// not keep a fleet permanently zig-zagging. Memory is private captain state.
pub fn command(
    actor: &Vessel,
    reports: &[ContactTrack],
    wakes: &[ObservedThreat],
    tick: u64,
    state: &mut NavigationState,
    normal: HelmCommand,
) -> HelmCommand {
    if state.evasion.as_ref().is_some_and(|e| tick >= e.until_tick) {
        state.evasion = None;
        if matches!(
            state.status,
            NavigationStatus::EvadingAircraft | NavigationStatus::EvadingTorpedo
        ) {
            state.status = NavigationStatus::FollowingRoute;
        }
    }
    if matches!(
        state.status,
        NavigationStatus::Avoiding | NavigationStatus::Immobile
    ) {
        return normal;
    }
    if state.evasion.is_none() {
        let own = actor.motion.velocity();
        let aircraft = reports
            .iter()
            .filter(|c| {
                c.kind == ContactKind::Aircraft
                    && c.affiliation == Affiliation::Hostile
                    && tick.saturating_sub(c.last_observed_tick) <= 4 * TICK_RATE
                    && c.estimated_position[1] < 1600.0
            })
            .map(|c| ObservedThreat {
                position: c.estimated_position,
                velocity: c.velocity,
                torpedo: false,
            });
        let danger = wakes
            .iter()
            .copied()
            .chain(aircraft)
            .filter_map(|t| {
                let r = [
                    t.position[0] - actor.motion.x,
                    t.position[2] - actor.motion.z,
                ];
                let v = [t.velocity[0] - own[0], t.velocity[2] - own[2]];
                let speed2 = v[0] * v[0] + v[1] * v[1];
                let closing = -(r[0] * v[0] + r[1] * v[1]);
                if speed2 < 1.0
                    || closing <= 0.0
                    || r[0].hypot(r[1]) > if t.torpedo { 1500.0 } else { 2500.0 }
                {
                    return None;
                }
                let time = closing / speed2;
                let closest = (r[0] + v[0] * time).hypot(r[1] + v[1] * time);
                (time < if t.torpedo { 50.0 } else { 25.0 }
                    && closest
                        < actor.definition().hull.length * 0.5
                            + if t.torpedo { 80.0 } else { 250.0 })
                .then_some((t, time))
            })
            .min_by(|(a, ta), (b, tb)| b.torpedo.cmp(&a.torpedo).then(ta.total_cmp(tb)));
        if let Some((threat, _)) = danger {
            let bearing =
                (threat.position[0] - actor.motion.x).atan2(actor.motion.z - threat.position[2]);
            // Turn away from the observed approach side; dead-ahead ties choose
            // starboard deterministically. Eight seconds makes a visible dodge
            // without replacing or repeatedly restarting a persistent route.
            let side = if wrap_angle(bearing - actor.motion.heading) > 0.05 {
                -1.0
            } else {
                1.0
            };
            state.evasion = Some(Evasion {
                until_tick: tick + 8 * TICK_RATE,
                heading: actor.motion.heading + side * 0.85,
                torpedo: threat.torpedo,
            });
        }
    }
    let Some(evasion) = &state.evasion else {
        return normal;
    };
    state.status = if evasion.torpedo {
        NavigationStatus::EvadingTorpedo
    } else {
        NavigationStatus::EvadingAircraft
    };
    HelmCommand {
        rudder: (wrap_angle(evasion.heading - actor.motion.heading) * 2.0
            - actor.motion.yaw_rate * 5.0)
            .clamp(-1.0, 1.0),
        throttle: normal.throttle.max(0.8),
        ..normal
    }
}
