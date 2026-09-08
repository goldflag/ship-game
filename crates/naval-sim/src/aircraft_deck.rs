use crate::{
    aircraft::Aircraft, aircraft_flight::FlightAttitude, definition::Vec3, geometry::*,
    vessel::Vessel,
};
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundPose {
    pub id: String,
    pub pitch: f64,
    pub clearance: f64,
    #[serde(default)]
    pub folding_wings: bool,
    pub torpedo: Option<crate::definition::TorpedoPart>,
    pub bomb: Option<AirBomb>,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AirBomb {
    pub label: String,
    pub caliber_m: f64,
    pub he: crate::definition::HEProjectile,
}
pub fn deck_attitude(carrier: Pose, ground: &GroundPose, heading: f64) -> FlightAttitude {
    let local = Pose {
        heading,
        pitch: ground.pitch,
        ..Default::default()
    };
    let right = rotate(rotate([1.0, 0.0, 0.0], local), carrier);
    let up = rotate(rotate([0.0, 1.0, 0.0], local), carrier);
    let back = rotate(rotate([0.0, 0.0, 1.0], local), carrier);
    FlightAttitude {
        heading: -back[0].atan2(back[2]),
        pitch: clamp(-back[1], -1.0, 1.0).asin(),
        bank: right[1].atan2(up[1]),
    }
}
pub fn deck_pose(p: &mut Aircraft, actor: &Vessel, local: Vec3, ground: &GroundPose) {
    p.deck_position = Some(local);
    p.position = local_to_world(local, actor.motion.pose());
    p.deck_heading = Some(0.0);
    let attitude = deck_attitude(actor.motion.pose(), ground, 0.0);
    p.heading = attitude.heading;
    p.pitch = attitude.pitch;
    p.bank = attitude.bank;
    p.velocity = actor.motion.velocity();
}
pub fn taxi(
    p: &mut Aircraft,
    actor: &Vessel,
    destination: Vec3,
    speed: f64,
    dt: f64,
    ground: &GroundPose,
) -> bool {
    let current = p
        .deck_position
        .unwrap_or_else(|| world_to_local(p.position, actor.motion.pose()));
    let delta = sub(destination, current);
    let distance = length(delta);
    let local = add(
        current,
        scale(
            delta,
            (speed * dt / if distance == 0.0 { 1.0 } else { distance }).min(1.0),
        ),
    );
    deck_pose(p, actor, local, ground);
    if distance > 0.1 {
        let heading = delta[0].atan2(-delta[2]);
        p.deck_heading = Some(heading);
        let attitude = deck_attitude(actor.motion.pose(), ground, heading);
        p.heading = attitude.heading;
        p.pitch = attitude.pitch;
        p.bank = attitude.bank;
    }
    distance <= speed * dt
}
