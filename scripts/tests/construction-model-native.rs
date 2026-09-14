//! Read {definition,cases:[{motion,poses}]} from stdin; emit authoritative native muzzle positions.
//! The runner builds this diagnostic outside the production crate/workspace under ignored .build.
use naval_sim::{definition::ShipDefinition, geometry::{Pose, local_to_world, add, scale}, weapons::{MountState, muzzle_local, shot_direction}};
use naval_sim::{damage::Combatant, torpedoes::tube_local_position};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, Read};

#[derive(Deserialize)]
struct Input { definition: ShipDefinition, node_ids: Vec<Vec<String>>, cases: Vec<Case> }
#[derive(Deserialize)]
struct Case { motion: Pose, poses: Vec<JointPose>, #[serde(default, rename = "launcherTrains")] launcher_trains: std::collections::BTreeMap<String, f64> }
#[derive(Deserialize)]
struct JointPose { train: f64, elevation: f64, recoil: f64 }

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut raw = String::new(); io::stdin().read_to_string(&mut raw)?;
    let input: Input = serde_json::from_str(&raw)?;
    let mut output = Vec::<Value>::new();
    for case in input.cases {
        assert_eq!(case.poses.len(), input.definition.mounts.len());
        let mut muzzles = Vec::<Value>::new();
        for (i, (mount, pose)) in input.definition.mounts.iter().zip(&case.poses).enumerate() {
            let mut state = MountState::new(mount);
            state.train = pose.train; state.elevation = pose.elevation; state.recoil = pose.recoil;
            let count = mount.weapon.barrel_count.unwrap_or(2.) as usize;
            for barrel in 0..count {
                let position = add(local_to_world(muzzle_local(mount, &state, barrel), case.motion),
                    scale(shot_direction(mount, &state, case.motion), -pose.recoil * mount.weapon.recoil_m));
                muzzles.push(json!({"id":input.node_ids[i][barrel], "position":position}));
            }
        }
        let mut actor = Combatant::new("native-tube-oracle", &input.definition);
        actor.launcher_trains.extend(case.launcher_trains);
        for tube in input.definition.torpedo_tubes.iter().flatten() {
            let position = local_to_world(tube_local_position(&actor, &input.definition, tube), case.motion);
            muzzles.push(json!({"id":format!("{}.muzzle",tube.id), "position":position}));
        }
        output.push(json!({"motion":case.motion, "launcherTrains":actor.launcher_trains, "poses":case.poses.iter().map(|p|json!({"train":p.train,"elevation":p.elevation,"recoil":p.recoil})).collect::<Vec<_>>(),"muzzles":muzzles}));
    }
    println!("{}", serde_json::to_string(&output)?); Ok(())
}
