mod armor_index;
mod installations;
mod surfaces;
use crate::{
    damage::Combatant,
    definition::{Armor, ArmorPlate, ShipDefinition, Vec3},
    geometry::*,
    hull_contact::HullContacts,
    machinery::{equipment_box, equipment_pose},
    mount_frames::mount_frame,
    protection::{PlateHit, plate_hit, same_plate_seam},
    shell::Shell,
    structure::{
        EXTERIOR_PLATING_REPLACEMENT_M, StructuralSurface, structural_hits, structural_surfaces,
    },
};
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ContactKind {
    Armor,
    Module,
    Mount,
    Boundary,
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipContact {
    pub t: f64,
    pub key: String,
    pub kind: ContactKind,
    pub index: isize,
    pub point: Vec3,
    pub normal: Vec3,
    pub on_edge: bool,
    pub seam_keys: Vec<String>,
    pub armor: Option<Armor>,
}
impl ShipContact {
    fn new(hit: PlateHit, key: String, kind: ContactKind, index: isize) -> Self {
        Self {
            t: hit.t,
            point: hit.point,
            normal: hit.normal,
            on_edge: hit.on_edge,
            key,
            kind,
            index,
            seam_keys: vec![],
            armor: None,
        }
    }
    pub fn plate(&self) -> PlateHit {
        PlateHit {
            t: self.t,
            point: self.point,
            normal: self.normal,
            on_edge: self.on_edge,
        }
    }
}
#[derive(Clone, Debug)]
pub struct ContactGeometry {
    armor_index: Option<armor_index::ArmorIndex>,
    installations: installations::InstallationContacts,
    surfaces: surfaces::SurfaceContacts,
    pub structural: Vec<StructuralSurface>,
    pub hull: Option<HullContacts>,
    /// Mounts whose gunhouse is authored as armor plates, parallel to `mounts`;
    /// those take hits on their plates rather than on the gunhouse box.
    pub plated_mounts: Vec<bool>,
}
impl ContactGeometry {
    pub fn new(def: &ShipDefinition) -> Result<Self, String> {
        let installations = installations::InstallationContacts::new(def);
        let surfaces = surfaces::SurfaceContacts::new(def);
        let excluded: Vec<_> = installations
            .replaced
            .iter()
            .zip(&surfaces.replaced)
            .map(|(&a, &b)| a || b)
            .collect();
        Ok(Self {
            armor_index: armor_index::ArmorIndex::new(&def.armor, &excluded),
            installations,
            surfaces,
            plated_mounts: def
                .mounts
                .iter()
                .map(|m| {
                    def.armor
                        .iter()
                        .any(|a| a.plate.as_ref().and_then(|p| p.mount_id.as_ref()) == Some(&m.id))
                })
                .collect(),
            structural: structural_surfaces(def)?,
            hull: if def.stability.is_some()
                && def.structural_plating.is_none()
                && def.hull.volume.is_none()
            {
                Some(HullContacts::new(&def.hull))
            } else {
                None
            },
        })
    }

    /// Runtime armor shapes, including analytic installation walls and annuli.
    /// The definition retains every authored plate for visuals and damage identity.
    pub fn armor_shape_count(&self, def: &ShipDefinition) -> usize {
        if self.installations.matches(&def.armor) {
            def.armor.len() - self.installations.replaced.iter().filter(|&&v| v).count()
                + self.installations.shape_count()
                - self.surfaces.reduction()
        } else {
            def.armor.len()
        }
    }
}
pub fn contact_armor(def: &ShipDefinition, hit: &ShipContact) -> Armor {
    hit.armor.clone().unwrap_or_else(|| {
        if hit.index >= 0 {
            def.armor[hit.index as usize].clone()
        } else {
            Armor {
                id: hit.key.split(':').skip(1).collect::<Vec<_>>().join("-"),
                name: "Hull shell · estimated".into(),
                thickness_mm: def
                    .stability
                    .as_ref()
                    .expect("hull shell profile")
                    .shell_thickness_mm,
                center: hit.point,
                size: [0.001; 3],
                plate: Some(ArmorPlate {
                    material: "steel".into(),
                    exterior: Some(true),
                    ..Default::default()
                }),
                ..Default::default()
            }
        }
    })
}
fn enters_box(from: Vec3, to: Vec3, center: Vec3, size: Vec3) -> bool {
    !contains(center, size, from)
        || (0..3).any(|i| {
            ((from[i] - center[i]).abs() - size[i] / 2.0).abs() < 1e-7
                && (from[i] - center[i]) * (to[i] - from[i]) < 0.0
        })
}
#[allow(clippy::too_many_arguments)]
fn box_contacts(
    shell: &Shell,
    from: Vec3,
    to: Vec3,
    center: Vec3,
    size: Vec3,
    prefix: &str,
    kind: ContactKind,
    index: usize,
    pose: Option<Pose>,
    hits: &mut Vec<ShipContact>,
) {
    let Some(hit) = segment_box(from, to, center, size) else {
        return;
    };
    let key = format!("{prefix}:entry");
    let basis = Basis::of(pose.unwrap_or_default());
    let transform = |point, normal, t| PlateHit {
        t,
        point: basis.local_to_world(point),
        normal: basis.rotate(normal),
        on_edge: false,
    };
    if enters_box(from, to, center, size) && !shell.visited.contains(&key) {
        hits.push(ShipContact::new(
            transform(hit.point, hit.normal, hit.t),
            key,
            kind,
            index as isize,
        ));
    }
    let key = format!("{prefix}:exit");
    if hit.exit < 1.0 && !shell.visited.contains(&key) {
        let p = add(from, scale(sub(to, from), hit.exit));
        let mut axis = 0;
        let distances: Vec3 =
            std::array::from_fn(|i| ((p[i] - center[i]).abs() - size[i] / 2.0).abs());
        for i in 1..3 {
            if distances[i] < distances[axis] {
                axis = i;
            }
        }
        let mut normal = [0.0; 3];
        normal[axis] = if p[axis] == center[axis] {
            0.0
        } else {
            (p[axis] - center[axis]).signum()
        };
        hits.push(ShipContact::new(
            transform(p, normal, hit.exit),
            key,
            kind,
            index as isize,
        ));
    }
}
pub fn ship_contacts(
    shell: &Shell,
    from_world: Vec3,
    to_world: Vec3,
    actor: &Combatant,
    def: &ShipDefinition,
    geometry: &ContactGeometry,
) -> Vec<ShipContact> {
    let hull = actor.motion.basis();
    let from = hull.world_to_local(from_world);
    let to = hull.world_to_local(to_world);
    let trains: Vec<_> = actor.mounts.iter().map(|m| m.train).collect();
    let mut hits = vec![];
    let ship = &actor.motion.id;
    let installations = geometry
        .installations
        .matches(&def.armor)
        .then_some(&geometry.installations);
    if let Some(installations) = installations {
        installations.contacts(shell, from, to, ship, &def.armor, &mut hits);
    }
    let surfaces = geometry
        .surfaces
        .matches(&def.armor)
        .then_some(&geometry.surfaces);
    if let Some(surfaces) = surfaces {
        surfaces.contacts(shell, from, to, ship, def, &mut hits);
    }
    let candidates = geometry
        .armor_index
        .as_ref()
        .filter(|index| index.matches(&def.armor))
        .map(|index| index.query(from, to));
    let count = candidates.as_ref().map_or(def.armor.len(), Vec::len);
    for position in 0..count {
        let i = candidates.as_ref().map_or(position, |ids| ids[position]);
        if installations.is_some_and(|p| p.replaced[i]) || surfaces.is_some_and(|p| p.replaced[i]) {
            continue;
        }
        let a = &def.armor[i];
        if a.plate.is_some() {
            // Geometry first: a shell crosses a handful of a hull's plates, and
            // naming every plate it misses cost more than the misses themselves.
            if let Some(hit) = plate_hit(from, to, a, def, &trains) {
                let key = format!("{ship}:armor:{}:plate", a.id);
                if !shell.visited.contains(&key) {
                    hits.push(ShipContact::new(hit, key, ContactKind::Armor, i as isize));
                }
            }
        } else if segment_box(from, to, a.center, a.size).is_some() {
            box_contacts(
                shell,
                from,
                to,
                a.center,
                a.size,
                &format!("{ship}:armor:{}", a.id),
                ContactKind::Armor,
                i,
                None,
                &mut hits,
            );
        }
    }
    for (i, m) in def.modules.iter().enumerate() {
        let pose = equipment_pose(actor, def, m);
        let (center, size) = equipment_box(def, m);
        let (a, b) = pose.map_or((from, to), |p| {
            let basis = Basis::of(p);
            (basis.world_to_local(from), basis.world_to_local(to))
        });
        let Some(hit) = segment_box(a, b, center, size) else {
            continue;
        };
        let key = format!("{ship}:module:{}", m.id);
        if !shell.visited.contains(&key) {
            let basis = Basis::of(pose.unwrap_or_default());
            hits.push(ShipContact::new(
                PlateHit {
                    t: hit.t,
                    point: basis.local_to_world(hit.point),
                    normal: basis.rotate(hit.normal),
                    on_edge: false,
                },
                key,
                ContactKind::Module,
                i as isize,
            ));
        }
    }
    for (i, c) in def.connections.iter().enumerate() {
        let Some(bounds) = &c.bounds else {
            continue;
        };
        if c.thickness_mm.is_none() || actor.damage.connections[i].state == "open" {
            continue;
        }
        let Some(hit) = segment_box(from, to, bounds.center, bounds.size) else {
            continue;
        };
        let key = format!("{ship}:boundary:{}", actor.damage.connections[i].id);
        if !shell.visited.contains(&key) {
            hits.push(ShipContact::new(
                PlateHit {
                    t: hit.t,
                    point: hit.point,
                    normal: hit.normal,
                    on_edge: false,
                },
                key,
                ContactKind::Boundary,
                i as isize,
            ));
        }
    }
    for (i, m) in def.mounts.iter().enumerate() {
        if geometry.plated_mounts[i] {
            continue;
        }
        let pose = mount_frame(def, i, &|j| trains[j]);
        let basis = Basis::of(pose);
        let w = &m.weapon;
        box_contacts(
            shell,
            basis.world_to_local(from),
            basis.world_to_local(to),
            [0.0, w.gunhouse_size[2] / 2.0, 0.0],
            [w.gunhouse_size[1], w.gunhouse_size[2], w.gunhouse_size[0]],
            &format!("{ship}:mount:{}", m.id),
            ContactKind::Mount,
            i,
            Some(pose),
            &mut hits,
        );
    }
    let crossings: Vec<_> = if def.structural_plating.is_some() {
        structural_hits(from, to, &geometry.structural)
            .into_iter()
            .map(|h| (h.hit, h.triangle, Some(h.surface)))
            .collect()
    } else {
        geometry.hull.as_ref().map_or(vec![], |h| {
            h.query(from, to)
                .into_iter()
                .map(|h| {
                    (
                        PlateHit {
                            t: h.t,
                            point: h.point,
                            normal: h.normal,
                            on_edge: false,
                        },
                        h.index,
                        None,
                    )
                })
                .collect()
        })
    };
    let mut previous: Option<usize> = None;
    for (h, index, surface) in crossings {
        let key = format!(
            "{ship}:hull:{}:{index}",
            surface.map_or("shell", |s| s.id.as_str())
        );
        if shell.visited.contains(&key) {
            continue;
        }
        let allowance = if def.structural_plating.is_some() {
            EXTERIOR_PLATING_REPLACEMENT_M
        } else {
            5.0
        };
        let path = normalize(sub(to, from));
        let a = add(h.point, scale(path, -allowance));
        let b = add(h.point, scale(path, allowance));
        let covered = surface.is_none_or(|s| s.hull)
            && def.armor.iter().any(|armor| {
                let plate = armor.plate.as_ref();
                if plate.is_some_and(|p| p.mount_id.is_some())
                    || !(plate.is_some_and(|p| p.exterior == Some(true))
                        || armor.exterior == Some(true)
                        || plate.is_none())
                    || !(0..3).all(|i| {
                        (armor.center[i] - h.point[i]).abs() <= armor.size[i] / 2.0 + allowance
                    })
                {
                    return false;
                }
                let normal = if plate.is_some() {
                    plate_hit(a, b, armor, def, &trains).map(|p| p.normal)
                } else {
                    segment_box(a, b, armor.center, armor.size).map(|p| p.normal)
                };
                normal.is_some_and(|n| dot(n, h.normal).abs() > 0.5)
            });
        if covered {
            continue;
        }
        if let Some(i) = previous
            && hits[i].armor.as_ref().map(|a| a.id.as_str()) == surface.map(|s| s.id.as_str())
            && length(sub(hits[i].point, h.point)) < 1e-5
        {
            hits[i].seam_keys.push(key);
            continue;
        }
        let mut contact = ShipContact::new(h, key, ContactKind::Armor, -1);
        contact.armor = surface.map(|s| Armor {
            id: s.id.clone(),
            name: format!("{} plating", s.name),
            thickness_mm: s.thickness_mm,
            center: h.point,
            size: [0.001; 3],
            plate: Some(ArmorPlate {
                material: "steel".into(),
                exterior: Some(s.hull),
                ..Default::default()
            }),
            ..Default::default()
        });
        previous = Some(hits.len());
        hits.push(contact);
    }
    hits.sort_by(|a, b| {
        a.t.total_cmp(&b.t)
            .then_with(|| (b.kind == ContactKind::Armor).cmp(&(a.kind == ContactKind::Armor)))
            .then_with(|| {
                if a.kind == ContactKind::Armor && b.kind == ContactKind::Armor {
                    contact_armor(def, b)
                        .thickness_mm
                        .total_cmp(&contact_armor(def, a).thickness_mm)
                } else {
                    std::cmp::Ordering::Equal
                }
            })
            .then_with(|| a.key.cmp(&b.key))
    });
    let mut unique: Vec<ShipContact> = vec![];
    for hit in hits {
        let armor = (hit.kind == ContactKind::Armor).then(|| contact_armor(def, &hit));
        let previous = armor
            .as_ref()
            .and_then(|a| a.plate.as_ref())
            .filter(|_| hit.on_edge)
            .and_then(|plate| {
                unique.iter().position(|p| {
                    if p.kind != ContactKind::Armor {
                        return false;
                    }
                    let a = contact_armor(def, p);
                    a.plate.as_ref().is_some_and(|ap| {
                        ap.material == plate.material
                            && same_plate_seam(
                                &p.plate(),
                                &hit.plate(),
                                plate.surface_id.is_some() && plate.surface_id == ap.surface_id,
                            )
                    })
                })
            });
        if let Some(i) = previous {
            unique[i].seam_keys.push(hit.key);
        } else {
            unique.push(hit);
        }
    }
    unique
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexed_armor_matches_exhaustive_contacts_at_edges_and_moving_mounts() {
        for source in [
            include_str!("../../../public/models/valiant.json"),
            include_str!("../../../public/models/iowa.json"),
            include_str!("../../../public/models/bismarck.json"),
        ] {
            let def: ShipDefinition = serde_json::from_str(source).unwrap();
            let geometry = ContactGeometry::new(&def).unwrap();
            assert!(geometry.armor_index.is_some());
            let mut linear = geometry.clone();
            linear.armor_index = None;
            let mut actor = Combatant::new("indexed", &def);
            let shell = Shell::default();
            let mut rays = vec![];
            for i in 0..192 {
                let z = (i as f64 / 191. - 0.5) * def.hull.length * 1.2;
                let y = (i % 17) as f64 - def.hull.draft - 1.;
                rays.push((
                    [-def.hull.beam, y, z],
                    [def.hull.beam, y + (i % 3) as f64, z + 7.],
                ));
                rays.push((
                    [z * 0.1, def.hull.depth + 15., z],
                    [z * 0.1, -def.hull.draft - 5., z - 3.],
                ));
            }
            for a in def.armor.iter().step_by(11) {
                // Exact box edges, the plate broad-phase padding, and rays
                // whose end only reaches the plane within its t tolerance.
                for epsilon in [-1.01e-5, -1e-9, 0., 1e-9, 1.01e-5] {
                    let edge = a.center[0] + a.size[0] / 2. + epsilon;
                    rays.push((
                        [edge, a.center[1], a.center[2] - a.size[2] - 5.],
                        [edge, a.center[1], a.center[2] + a.size[2] + 5.],
                    ));
                }
                if let Some(plate) = &a.plate
                    && plate.vertices.len() >= 3
                {
                    let normal = normalize(cross(
                        sub(plate.vertices[1], plate.vertices[0]),
                        sub(plate.vertices[2], plate.vertices[0]),
                    ));
                    for &v in &plate.vertices {
                        rays.push((add(v, scale(normal, 30.)), add(v, scale(normal, 1e-9))));
                        rays.push((add(v, scale(normal, 30.)), add(v, scale(normal, -30.))));
                    }
                }
            }
            for (yaw, roll, pitch) in [(0., 0., 0.), (0.7, 0.2, -0.08)] {
                actor.motion.x = 327.;
                actor.motion.z = -724.;
                actor.motion.heading = yaw;
                actor.motion.roll = roll;
                actor.motion.pitch = pitch;
                for (i, m) in actor.mounts.iter_mut().enumerate() {
                    m.train = yaw * if i % 2 == 0 { 1. } else { -1. };
                }
                let basis = actor.motion.basis();
                for &(from, to) in &rays {
                    let (from, to) = (basis.local_to_world(from), basis.local_to_world(to));
                    let indexed = ship_contacts(&shell, from, to, &actor, &def, &geometry);
                    let exhaustive = ship_contacts(&shell, from, to, &actor, &def, &linear);
                    assert_eq!(
                        serde_json::to_value(indexed).unwrap(),
                        serde_json::to_value(exhaustive).unwrap(),
                        "{}: {from:?} -> {to:?}",
                        def.id
                    );
                }
            }
            let from = [def.hull.beam * 3., 0., 0.];
            let candidates = geometry
                .armor_index
                .as_ref()
                .unwrap()
                .query(from, add(from, [1., 0., 0.]));
            assert!(
                candidates.len() < def.armor.len(),
                "the broad phase must prune misses"
            );
        }
    }
}
