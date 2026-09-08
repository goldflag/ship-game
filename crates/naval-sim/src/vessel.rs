use crate::{
    contacts::ContactGeometry,
    damage::Combatant,
    definition::{ShipDefinition, Vec3},
    geometry::length,
    hydrostatics::HullHydrostatics,
    rules::TeamId,
    weapons::Obstructions,
};
use std::{
    ops::{Deref, DerefMut},
    sync::Arc,
};
/// Built once when trusted content loads, then shared by every vessel and match.
#[derive(Clone, Debug)]
pub struct CompiledShip {
    pub collision_profile: Vec<[f64; 2]>,
    pub torpedo_hull: Vec<crate::structure::StructuralSurface>,
    pub definition: Arc<ShipDefinition>,
    pub contacts: ContactGeometry,
    pub hydro: HullHydrostatics,
    pub shell_center: Vec3,
    pub shell_size: Vec3,
    pub shell_radius: f64,
    pub obstructions: Obstructions,
}
impl CompiledShip {
    pub fn new(definition: Arc<ShipDefinition>) -> Result<Self, String> {
        let d = &definition;
        let mut low = [
            -(d.hull.beam + 30.0) / 2.0,
            -20.0,
            -(d.hull.length + 40.0) / 2.0,
        ];
        let mut high = [-low[0], 40.0, -low[2]];
        for m in &d.modules {
            let launcher = m
                .torpedo_launcher_id
                .as_ref()
                .and_then(|id| d.torpedo_launchers.as_ref()?.iter().find(|l| &l.id == id));
            let radius = launcher.map_or(0.0, |l| {
                (m.center[0] - l.position[0]).hypot(m.center[2] - l.position[2])
                    + (m.size[0] / 2.0).hypot(m.size[2] / 2.0)
            });
            for i in 0..3 {
                let center = launcher
                    .filter(|_| i != 1)
                    .map_or(m.center[i], |l| l.position[i]);
                let half = if launcher.is_some() && i != 1 {
                    radius
                } else {
                    m.size[i] / 2.0
                };
                low[i] = low[i].min(center - half);
                high[i] = high[i].max(center + half);
            }
        }
        let shell_center = std::array::from_fn(|i| (low[i] + high[i]) / 2.0);
        let shell_size = std::array::from_fn(|i| high[i] - low[i]);
        let shell_radius = length(std::array::from_fn(|i| {
            shell_center[i].abs() + shell_size[i] / 2.0
        }));
        Ok(Self {
            torpedo_hull: crate::torpedoes::torpedo_hull(d)?,
            collision_profile: crate::collisions::profile(&d.hull),
            contacts: ContactGeometry::new(d)?,
            hydro: HullHydrostatics::new(&d.hull),
            obstructions: Obstructions::new(d),
            definition,
            shell_center,
            shell_size,
            shell_radius,
        })
    }
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Vessel {
    pub helm: crate::motion::HelmCommand,
    pub tube_launch_cooldown: f64,
    pub depth_charge_cooldown: f64,
    pub controller: Controller,
    pub bot: Option<crate::bots::BotState>,
    pub target_id: Option<String>,
    #[serde(flatten)]
    pub state: Combatant,
    pub preset_id: String,
    pub team: TeamId,
    #[serde(skip)]
    pub compiled: Arc<CompiledShip>,
}
impl Vessel {
    pub fn new(id: impl Into<String>, team: TeamId, compiled: Arc<CompiledShip>) -> Self {
        Self {
            helm: Default::default(),
            tube_launch_cooldown: 0.0,
            depth_charge_cooldown: 0.0,
            controller: Controller::Idle,
            bot: None,
            target_id: None,
            state: Combatant::new(id, &compiled.definition),
            preset_id: compiled.definition.id.clone(),
            team,
            compiled,
        }
    }
    pub fn definition(&self) -> &ShipDefinition {
        &self.compiled.definition
    }
}
impl Deref for Vessel {
    type Target = Combatant;
    fn deref(&self) -> &Combatant {
        &self.state
    }
}
impl DerefMut for Vessel {
    fn deref_mut(&mut self) -> &mut Combatant {
        &mut self.state
    }
}

#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize, ts_rs::TS,
)]
#[serde(rename_all = "lowercase")]
pub enum Controller {
    Player,
    Bot,
    #[default]
    Idle,
}
