//! Exterior triangles block entry into a solid, but an initially enclosed
//! barrel has no triangle contact. Cache convex hull planes for that case.
use super::*;
use crate::{construction_geometry as cg, definition::ConstructionSurface};

#[derive(Clone, Debug)]
struct Solid {
    bounds: Box3,
    planes: Vec<(Vec3, f64)>,
    open_top: bool,
}

impl Solid {
    /// Interval of the capsule axis inside this convex body. `inset` reserves
    /// the tube radius when checking an allowed working well.
    fn interval(&self, capsule: Capsule, inset: f64) -> Option<(f64, f64)> {
        if capsule.bounds().separation(self.bounds) > 1e-8 {
            return None;
        }
        let direction = sub(capsule.b, capsule.a);
        let (mut low, mut high): (f64, f64) = (0., 1.);
        for &(normal, distance) in &self.planes {
            let margin = if self.open_top && normal == [0., 1., 0.] {
                0.
            } else {
                inset
            };
            let from = dot(normal, capsule.a) - distance + margin;
            let along = dot(normal, direction);
            if along.abs() < 1e-14 {
                if from > 1e-8 {
                    return None;
                }
            } else if along > 0. {
                high = high.min(-from / along);
            } else {
                low = low.max(-from / along);
            }
            if low > high + 1e-10 {
                return None;
            }
        }
        Some((low.max(0.), high.min(1.)))
    }
}

#[derive(Clone, Debug)]
pub(super) struct HullContainment {
    solids: Vec<Solid>,
    index: Option<BodyIndex>,
    wells: Vec<Option<Solid>>,
}

impl HullContainment {
    pub fn new(def: &ShipDefinition, bodies: &mut Vec<Body>) -> Option<Self> {
        // Historical cell-face profiles keep their original behavior. This
        // guard accompanies only the compiler's exterior-union encoding.
        if def.mount_clearance.as_ref()?.hull_interior_guard != Some(true) {
            return None;
        }
        let hull = def.hull.volume.as_ref()?;
        let solids: Vec<_> = hull
            .cells
            .iter()
            .map(|cell| Solid {
                bounds: Box3::points(cell.faces.iter().flat_map(|f| f.vertices.iter().copied())),
                planes: cell
                    .faces
                    .iter()
                    .map(|f| {
                        let normal = cg::normal(&f.vertices);
                        (normal, dot(normal, f.vertices[0]))
                    })
                    .collect(),
                open_top: false,
            })
            .collect();
        let index = BodyIndex::from_bounds(
            &solids.iter().map(|s| s.bounds).collect::<Vec<_>>(),
            (0..solids.len()).collect(),
        );
        let wells = def
            .mounts
            .iter()
            .map(|mount| {
                let id = format!("equipment:{}", mount.id);
                let surfaces: Vec<_> = hull
                    .surfaces
                    .iter()
                    .filter(|s| s.primitive_id == id)
                    .collect();
                let (well, triangles) = working_well(&surfaces)?;
                // These fixed inner walls also bound the permitted gap while
                // the breech is inside its well. Without them, a cached positive
                // sweep bound could skip from that allowed void into steel.
                bodies.push(Body::new(
                    format!("{}.working-well", mount.id),
                    None,
                    false,
                    triangles,
                ));
                Some(well)
            })
            .collect();
        Some(Self {
            solids,
            index,
            wells,
        })
    }

    pub fn candidates(&self, bounds: Box3, out: &mut Vec<usize>) {
        if let Some(index) = &self.index {
            index.query(bounds, 0., out);
            out.retain(|&i| bounds.separation(self.solids[i].bounds) <= 1e-8);
        }
    }

    pub fn blocked(&self, mount: usize, capsule: Capsule, candidates: &[usize]) -> Option<usize> {
        if candidates.is_empty() {
            return None;
        }
        let allowed = self.wells[mount]
            .as_ref()
            .and_then(|well| well.interval(capsule, capsule.radius));
        candidates.iter().copied().find(|&i| {
            let Some((lo, hi)) = self.solids[i].interval(capsule, 0.) else {
                return false;
            };
            !allowed.is_some_and(|(a, b)| lo >= a - 1e-10 && hi <= b + 1e-10)
        })
    }
}

fn working_well(surfaces: &[&ConstructionSurface]) -> Option<(Solid, Vec<[Vec3; 3]>)> {
    let inner: Vec<_> = surfaces
        .iter()
        .filter(|s| s.face == "installation-inner")
        .copied()
        .collect();
    if inner.len() < 3 {
        return None;
    }
    let bounds = Box3::points(inner.iter().flat_map(|s| s.vertices.iter().copied()));
    let mut bottom = bounds.center[1] - bounds.size[1] / 2.;
    let top = bounds.center[1] + bounds.size[1] / 2.;
    let mut planes: Vec<_> = inner
        .iter()
        .map(|s| {
            // Installation normals point out of the surrounding ring, into
            // the bore; reverse them to bound the empty working space.
            let n = scale(cg::normal(&s.vertices), -1.);
            (n, dot(n, s.vertices[0]))
        })
        .collect();
    let floor: Vec<_> = surfaces
        .iter()
        .filter(|s| s.face == "installation-floor" && cg::normal(&s.vertices)[1] > 0.95)
        .copied()
        .collect();
    for surface in &floor {
        bottom = bottom.max(surface.vertices.iter().map(|p| p[1]).fold(bottom, f64::max));
    }
    planes.push(([0., -1., 0.], -bottom));
    planes.push(([0., 1., 0.], top));
    let triangles = inner
        .iter()
        .chain(&floor)
        .flat_map(|s| {
            (1..s.vertices.len() - 1).map(|i| [s.vertices[0], s.vertices[i], s.vertices[i + 1]])
        })
        .collect();
    Some((
        Solid {
            bounds,
            planes,
            open_top: true,
        },
        triangles,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::definition::*;

    fn definition() -> ShipDefinition {
        let mut def = ShipDefinition::default();
        def.mounts.push(MountDefinition {
            id: "test".into(),
            weapon: GunPart {
                barrel_count: 1.,
                caliber_m: 0.02,
                barrel_base_radius: Some(0.1),
                mounting_style: Some("open".into()),
                muzzle_forward: 2.,
                elevation_min_deg: -90.,
                elevation_max_deg: 90.,
                traverse_deg: 180.,
                gunhouse_size: [1.; 3],
                ..Default::default()
            },
            ..Default::default()
        });
        def.hull.volume = Some(ConstructionGeometry {
            version: 1.,
            cells: vec![
                cg::box_cell([-5., 0., 0.], [10., 20., 20.]),
                cg::box_cell([5., 0., 0.], [10., 20., 20.]),
            ],
            surfaces: vec![],
        });
        let triangles = box_triangles([0.; 3], [20.; 3]);
        def.mount_clearance = Some(MountClearanceProfile {
            hull_interior_guard: Some(true),
            version: 1.,
            margin_m: 0.01,
            basis: "Exact test fixture against the exact hull exterior".into(),
            mount_ids: Some(vec!["test".into()]),
            bodies: Some(vec![MountClearanceProfileBodiesItem {
                id: "hull-exterior".into(),
                surface: AuthoredSurface {
                    vertices: triangles.iter().flatten().copied().collect(),
                    triangles: (0..triangles.len())
                        .map(|i| [(i * 3) as f64, (i * 3 + 1) as f64, (i * 3 + 2) as f64])
                        .collect(),
                },
                ..Default::default()
            }]),
            ..Default::default()
        });
        def
    }

    #[test]
    fn exterior_profile_blocks_barrel_wholly_inside_adjacent_cells() {
        let mut def = definition();
        let poses = vec![ClearancePose::default()];
        let guarded = MountClearance::new(&def).unwrap().unwrap();
        let contact = guarded.minimum_clearance(&def, 0, &poses, 100.);
        assert!(contact.0 < 0., "{contact:?}");
        assert!(contact.1.unwrap().starts_with("hull-cell-"));
        let result = guarded.resolve(
            &def,
            0,
            &poses,
            ClearancePose {
                train: 0.2,
                ..poses[0]
            },
        );
        assert!(result.blocked);
        // Retained cell-face/historical profiles are not reinterpreted.
        def.mount_clearance.as_mut().unwrap().hull_interior_guard = None;
        let old = MountClearance::new(&def).unwrap().unwrap();
        assert!(old.minimum_clearance(&def, 0, &poses, 100.).0 > 0.);
    }

    #[test]
    fn exterior_crossing_still_hits_and_a_courtyard_stays_empty() {
        let mut def = definition();
        def.mounts[0].position[2] = 10.;
        let poses = vec![ClearancePose::default()];
        let guard = MountClearance::new(&def).unwrap().unwrap();
        assert!(guard.minimum_clearance(&def, 0, &poses, 100.).0 < 0.);

        // A gap between distinct solids is not filled by the hull AABB.
        def.mounts[0].position = [0.; 3];
        def.hull.volume.as_mut().unwrap().cells = vec![
            cg::box_cell([-7., 0., 0.], [6., 20., 20.]),
            cg::box_cell([7., 0., 0.], [6., 20., 20.]),
        ];
        let guard = MountClearance::new(&def).unwrap().unwrap();
        assert!(guard.minimum_clearance(&def, 0, &poses, 100.).0 > 0.);
    }

    #[test]
    fn intentional_working_well_exempts_only_its_bore_and_retains_wall_distance() {
        let mut def = definition();
        let bore = cg::box_cell([0.; 3], [8., 8., 8.]);
        let surfaces = &mut def.hull.volume.as_mut().unwrap().surfaces;
        for face in bore.faces.iter() {
            let normal = cg::normal(&face.vertices);
            if normal[1] > 0.9 {
                continue;
            }
            surfaces.push(ConstructionSurface {
                primitive_id: "equipment:test".into(),
                face: if normal[1] < -0.9 {
                    "installation-floor"
                } else {
                    "installation-inner"
                }
                .into(),
                vertices: face.vertices.iter().copied().rev().collect(),
                ..Default::default()
            });
        }
        let poses = vec![ClearancePose::default()];
        let guard = MountClearance::new(&def).unwrap().unwrap();
        let contact = guard.minimum_clearance(&def, 0, &poses, 100.);
        assert!(contact.0 > 0. && contact.0 < 3., "{contact:?}");
        assert_eq!(contact.1.as_deref(), Some("test.working-well"));
        // Physical walls must also bound a cached sweep's allowed motion.
        let mut cached = None;
        let result = guard.resolve_for(
            0,
            &def,
            0,
            &poses,
            ClearancePose {
                train: 0.1,
                ..poses[0]
            },
            &mut cached,
        );
        assert!(!result.blocked);
        assert!(cached.as_ref().unwrap().gap < 3.);
        def.mounts[0].position[1] = -4.;
        let guard = MountClearance::new(&def).unwrap().unwrap();
        let floor = guard.minimum_clearance(&def, 0, &poses, 100.);
        assert!(floor.0 < 0. && floor.1.as_deref() == Some("test.working-well"));
        // The same well never exempts a barrel protruding into surrounding solid.
        def.mounts[0].position[1] = 0.;
        def.mounts[0].position[0] = 5.;
        let guard = MountClearance::new(&def).unwrap().unwrap();
        assert!(guard.minimum_clearance(&def, 0, &poses, 100.).0 < 0.);
    }
}
