use crate::{
    contacts::ContactGeometry,
    damage::Combatant,
    definition::{ShipDefinition, Vec3},
    geometry::length,
    hydro_table::HydrostaticTable,
    hydrostatics::HullHydrostatics,
    rules::TeamId,
    weapons::Obstructions,
};
use std::{
    collections::HashMap,
    ops::{Deref, DerefMut},
    sync::Arc,
};
/// Content-derived lookup tables. Every entry reproduces the first-match
/// semantics of the `find`/`position` scans it replaces, so results are
/// unchanged; only the repeated string comparisons disappear.
#[derive(Clone, Debug, Default)]
pub struct ShipIndex {
    /// Identity of the definition this was built from: the heap buffer of
    /// `modules` survives moves of the definition and only a clone changes it.
    modules_ptr: usize,
    pub modules: usize,
    pub compartments: usize,
    pub mounts: usize,
    module_by_id: HashMap<String, usize>,
    mount_by_id: HashMap<String, usize>,
    /// Per module index, the first module with the same id (usually itself).
    module_first: Vec<usize>,
    /// Per module index, its compartment, or `None` when unauthored or unknown.
    module_room: Vec<Option<usize>>,
    /// Per mount index, the module index of its magazine.
    pub mount_magazine: Vec<Option<usize>>,
    /// Per module index, the mounts drawing from it as their magazine.
    magazine_mounts: Vec<Vec<usize>>,
    by_kind: HashMap<String, Vec<usize>>,
    empty: Vec<usize>,
    pub directors: Vec<usize>,
    pub coverage: bool,
    mount_directors: Vec<Vec<usize>>,
    /// `(submerged, surface)` engine modules for submarines.
    pub submarine_engines: Option<(Vec<Option<usize>>, Vec<Option<usize>>)>,
    pub propulsion: Vec<PropulsionIndex>,
}
#[derive(Clone, Debug, Default)]
pub struct PropulsionIndex {
    pub share: f64,
    pub boilers: Vec<Option<usize>>,
    pub drives: Vec<Option<usize>>,
    pub shafts: Vec<Option<usize>>,
}
impl ShipIndex {
    pub fn new(d: &ShipDefinition) -> Self {
        let mut module_by_id: HashMap<String, usize> = HashMap::new();
        for (i, m) in d.modules.iter().enumerate() {
            module_by_id.entry(m.id.clone()).or_insert(i);
        }
        let mut mount_by_id: HashMap<String, usize> = HashMap::new();
        for (i, m) in d.mounts.iter().enumerate() {
            mount_by_id.entry(m.id.clone()).or_insert(i);
        }
        let mut room_by_id: HashMap<&str, usize> = HashMap::new();
        for (i, c) in d.compartments.iter().enumerate() {
            room_by_id.entry(c.id.as_str()).or_insert(i);
        }
        let mut by_kind: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, m) in d.modules.iter().enumerate() {
            by_kind.entry(m.kind.clone()).or_default().push(i);
        }
        let module_index = |id: &String| module_by_id.get(id).copied();
        let mut magazine_mounts = vec![vec![]; d.modules.len()];
        let mount_magazine: Vec<_> = d
            .mounts
            .iter()
            .map(|m| m.magazine_id.as_ref().and_then(&module_index))
            .collect();
        for (i, m) in d.mounts.iter().enumerate() {
            let Some(id) = &m.magazine_id else { continue };
            for (j, module) in d.modules.iter().enumerate() {
                if &module.id == id {
                    magazine_mounts[j].push(i);
                }
            }
        }
        let directors: Vec<_> = by_kind.get("fire-control").cloned().unwrap_or_default();
        let coverage = directors
            .iter()
            .any(|i| d.modules[*i].serves_mount_ids.is_some());
        let mount_directors = d
            .mounts
            .iter()
            .map(|mount| {
                directors
                    .iter()
                    .copied()
                    .filter(|i| {
                        d.modules[*i]
                            .serves_mount_ids
                            .as_ref()
                            .is_some_and(|ids| ids.iter().any(|s| *s == mount.id))
                    })
                    .collect()
            })
            .collect();
        Self {
            modules_ptr: d.modules.as_ptr() as usize,
            modules: d.modules.len(),
            compartments: d.compartments.len(),
            mounts: d.mounts.len(),
            module_first: d
                .modules
                .iter()
                .map(|m| module_by_id[&m.id])
                .collect::<Vec<_>>(),
            module_room: d
                .modules
                .iter()
                .map(|m| {
                    m.compartment_id
                        .as_ref()
                        .and_then(|id| room_by_id.get(id.as_str()).copied())
                })
                .collect(),
            mount_magazine,
            magazine_mounts,
            directors,
            coverage,
            mount_directors,
            submarine_engines: d.submarine.as_ref().map(|s| {
                (
                    s.submerged_engine_ids.iter().map(&module_index).collect(),
                    s.surface_engine_ids.iter().map(&module_index).collect(),
                )
            }),
            propulsion: d
                .propulsion
                .iter()
                .flat_map(|p| &p.groups)
                .map(|g| PropulsionIndex {
                    share: g.share,
                    boilers: g.boiler_ids.iter().map(&module_index).collect(),
                    drives: g.drive_ids.iter().map(&module_index).collect(),
                    shafts: g.shaft_ids.iter().map(&module_index).collect(),
                })
                .collect(),
            by_kind,
            module_by_id,
            mount_by_id,
            empty: vec![],
        }
    }
    /// `Some` only for the definition this index was compiled from; every
    /// caller falls back to the original scan otherwise.
    pub fn of<'a>(&'a self, d: &ShipDefinition) -> Option<&'a Self> {
        (self.modules_ptr == d.modules.as_ptr() as usize).then_some(self)
    }
    /// Position of a module borrowed from `d.modules`, without scanning.
    pub fn position(&self, module: &crate::definition::Module) -> Option<usize> {
        let stride = size_of::<crate::definition::Module>();
        let offset = (module as *const _ as usize).checked_sub(self.modules_ptr)?;
        let i = offset / stride;
        (offset % stride == 0 && i < self.modules).then_some(i)
    }
    /// Module state parallel to `d.modules`, resolved like `find(|m| m.id == id)`.
    pub fn module_state(&self, i: usize) -> usize {
        self.module_first[i]
    }
    pub fn module(&self, id: &str) -> Option<usize> {
        self.module_by_id.get(id).copied()
    }
    pub fn mount(&self, id: &str) -> Option<usize> {
        self.mount_by_id.get(id).copied()
    }
    pub fn room(&self, i: usize) -> Option<usize> {
        self.module_room[i]
    }
    pub fn magazine_mounts(&self, i: usize) -> &[usize] {
        &self.magazine_mounts[i]
    }
    pub fn kind(&self, kind: &str) -> &[usize] {
        self.by_kind.get(kind).unwrap_or(&self.empty)
    }
    /// Directors serving `mount`, matching the `mount_support` filter exactly.
    pub fn served(&self, mount: Option<&str>) -> Option<&[usize]> {
        match mount {
            Some(id) if self.coverage => Some(&self.mount_directors[self.mount(id)?]),
            _ => Some(&self.directors),
        }
    }
}
/// Built once when trusted content loads, then shared by every vessel and match.
#[derive(Clone, Debug)]
pub struct CompiledShip {
    pub deck_surface: Option<crate::deck_contact::DeckSurface>,
    pub collision_profile: Vec<[f64; 2]>,
    pub torpedo_hull: Vec<crate::structure::StructuralSurface>,
    pub definition: Arc<ShipDefinition>,
    pub contacts: ContactGeometry,
    pub hydro: HullHydrostatics,
    pub shell_center: Vec3,
    pub shell_size: Vec3,
    pub shell_radius: f64,
    pub obstructions: Obstructions,
    pub weapon_group_ids: Vec<String>,
}
impl CompiledShip {
    /// `hydrostatics` is the class's published lookup. Without it the hull
    /// falls back to clipping its sections, which is the reference solver but
    /// far too slow for a battle.
    pub fn new(
        definition: Arc<ShipDefinition>,
        hydrostatics: Option<&HydrostaticTable>,
    ) -> Result<Self, String> {
        let d = &definition;
        let deck_surface = crate::deck_contact::DeckSurface::new(d);
        if d.air_wing
            .as_ref()
            .is_some_and(|wing| wing.deck_layout.is_some())
            && deck_surface.is_none()
        {
            return Err("Invalid authored flight-deck contact surface".into());
        }
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
            deck_surface,
            torpedo_hull: crate::torpedoes::torpedo_hull(d)?,
            collision_profile: crate::collisions::profile(&d.hull),
            contacts: ContactGeometry::new(d)?,
            hydro: HullHydrostatics::new(&d.hull, hydrostatics),
            obstructions: Obstructions::new(d),
            weapon_group_ids: d.mounts.iter().map(crate::gunnery::group_id).collect(),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub navigation: Option<crate::navigation::NavigationState>,
    pub helm: crate::motion::HelmCommand,
    pub tube_launch_cooldown: f64,
    pub depth_charge_cooldown: f64,
    pub controller: Controller,
    pub bot: Option<crate::bots::BotState>,
    #[serde(skip)]
    pub firing_visibility_seconds: f64,
    #[serde(skip)]
    pub secondary_bot: Option<crate::bots::BotState>,
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
            navigation: None,
            helm: Default::default(),
            tube_launch_cooldown: 0.0,
            depth_charge_cooldown: 0.0,
            controller: Controller::Idle,
            bot: None,
            target_id: None,
            firing_visibility_seconds: 0.0,
            secondary_bot: None,
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
/// The fleet as seen from one ship that is borrowed mutably out of it: every
/// other actor, in the order they hold in `Battle::actors`.
///
/// The ship-operating loop used to lift its actor out of the vector with
/// `remove` and put it back with `insert`, two whole-vector memmoves per ship
/// per tick, purely so the callees could hold `&[Vessel]` while the actor was
/// `&mut`. `Fleet` is that view without the moves: `split` cuts the vector
/// around the index and hands back the actor plus the two surrounding slices,
/// which iterate as one sequence in the original order.
#[derive(Clone, Copy)]
pub struct Fleet<'a> {
    before: &'a [Vessel],
    after: &'a [Vessel],
    /// The index `before` and `after` are cut around, so `get` still answers in
    /// the whole vector's coordinates. `usize::MAX` for a whole fleet.
    index: usize,
}
impl<'a> Fleet<'a> {
    /// The whole fleet, for a caller that is not one of its ships.
    pub fn all(actors: &'a [Vessel]) -> Self {
        Self {
            before: actors,
            after: &[],
            index: usize::MAX,
        }
    }
    /// The actor at `index`, mutably, and every other actor in original order.
    pub fn split(actors: &'a mut [Vessel], index: usize) -> (&'a mut Vessel, Self) {
        let (before, rest) = actors.split_at_mut(index);
        let (actor, after) = rest.split_first_mut().expect("index within the fleet");
        (
            actor,
            Self {
                before,
                after,
                index,
            },
        )
    }
    pub fn iter(&self) -> impl Iterator<Item = &'a Vessel> {
        self.before.iter().chain(self.after.iter())
    }
    /// The actor at a whole-vector index, or `None` for the split-out one.
    pub fn get(&self, index: usize) -> Option<&'a Vessel> {
        match index.cmp(&self.index) {
            std::cmp::Ordering::Less => self.before.get(index),
            std::cmp::Ordering::Equal => None,
            std::cmp::Ordering::Greater => self.after.get(index - self.index - 1),
        }
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
