//! CPU yaw frames for independently trained mounts carried by other mounts.
//! Neutral positions and bearings remain absolute ship-space authoring datums.
use crate::{
    definition::{MountDefinition, ShipDefinition, Vec3},
    geometry::{Pose, local_to_world, radians, sub},
    weapons::MountState,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CarrierFrame {
    pub position: Vec3,
    pub heading: f64,
}

/// Definitions require parent-first order. Resolve directly from authoritative
/// trains so damage queries do not depend on a cached firing pose.
pub fn mount_frame(def: &ShipDefinition, index: usize, train: &impl Fn(usize) -> f64) -> Pose {
    let mount = &def.mounts[index];
    let mut position = mount.position;
    let mut inherited = 0.0;
    if let Some(parent_id) = &mount.parent_mount_id {
        let parent_index = def.mounts[..index]
            .iter()
            .position(|m| &m.id == parent_id)
            .expect("validated parent-first mount hierarchy");
        let parent = &def.mounts[parent_index];
        let pose = mount_frame(def, parent_index, train);
        inherited = pose.heading - radians(parent.bearing_deg);
        position = local_to_world(
            sub(position, parent.position),
            Pose {
                heading: inherited,
                ..pose
            },
        );
    }
    Pose {
        x: position[0],
        y: position[1],
        z: position[2],
        heading: radians(mount.bearing_deg) + inherited + train(index),
        ..Pose::default()
    }
}

/// Refresh before operating each mount, after its parent's traversal this tick.
pub fn update_mount_carrier(def: &ShipDefinition, index: usize, states: &mut [MountState]) {
    states[index].carrier = def.mounts[index].parent_mount_id.as_ref().map(|_| {
        let pose = mount_frame(def, index, &|i| states[i].train);
        CarrierFrame {
            position: [pose.x, pose.y, pose.z],
            heading: pose.heading - radians(def.mounts[index].bearing_deg) - states[index].train,
        }
    });
}

pub fn mount_position(mount: &MountDefinition, state: &MountState) -> Vec3 {
    state.carrier.map_or(mount.position, |c| c.position)
}

pub fn mount_bearing(mount: &MountDefinition, state: &MountState) -> f64 {
    radians(mount.bearing_deg) + state.carrier.map_or(0.0, |c| c.heading) + state.train
}
