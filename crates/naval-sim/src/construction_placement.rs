//! Seats equipment on the compiler's own support geometry, so a returned position is
//! one the attachment check accepts. Only positions (and wall bearings) are resolved
//! here; the caller builds the candidate source and validates it with a full compile.
use crate::{construction as cc, construction_geometry as cg, definition::*, geometry::*};
use serde::{Deserialize, Serialize};

pub const MAX_ITEMS: usize = 128;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlacementRequest {
    pub items: Vec<PlacementItem>,
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlacementItem {
    /// Complete record; its position is provisional along the attachment direction.
    pub equipment: ConstructionEquipment,
    /// Restrict supports to one hull primitive or internal deck (boundary) ID.
    pub on: Option<String>,
    /// `first` support met from outside along the attachment direction, the `last`
    /// one, or the one `nearest` to the provisional attachment point.
    pub select: Option<String>,
    /// When nothing lies along the attachment direction, move to the closest support.
    #[serde(default)]
    pub slide: bool,
    /// Exact reflection across X=0 of an earlier item; its own gap is only measured.
    pub mirror_of: Option<String>,
    /// Wall fittings: face outward from the nearest hull side.
    #[serde(default)]
    pub auto_bearing: bool,
    /// Supports farther than this along the attachment direction are not this record's support.
    pub max_travel_m: Option<f64>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementSupport {
    /// `surface` (exterior plating), `plating` (inner face of the shell) or `deck` (internal deck).
    pub kind: String,
    pub id: String,
    pub primitive_id: Option<String>,
    pub face: Option<String>,
    pub panel_id: Option<String>,
    pub normal: Vec3,
    pub point: Vec3,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub id: String,
    pub part_id: String,
    /// `seated`, `slid`, `mirrored`, `kept` (nothing to seat) or `unsupported`.
    pub status: String,
    pub from: Vec3,
    pub position: Vec3,
    pub bearing_deg: f64,
    /// Signed distance from the provisional attachment point to the support along the
    /// attachment direction: positive floated short of it, negative was buried.
    pub gap_m: Option<f64>,
    /// Distance left after seating; differs from zero only for mirrored twins.
    pub residual_m: Option<f64>,
    pub attachment: Vec3,
    pub direction: Vec3,
    pub support: Option<PlacementSupport>,
    pub message: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementReport {
    pub placements: Vec<Placement>,
    pub diagnostics: Vec<ConstructionDiagnostic>,
}

struct Support {
    kind: &'static str,
    id: String,
    primitive_id: Option<String>,
    face: Option<String>,
    panel_id: Option<String>,
    boundary_id: Option<String>,
    vertices: Vec<Vec3>,
    /// Faces the equipment; the physical plane is the polygon moved by `shift`.
    normal: Vec3,
    shift: Vec3,
}
impl Support {
    fn report(&self, point: Vec3) -> PlacementSupport {
        PlacementSupport {
            kind: self.kind.into(),
            id: self.id.clone(),
            primitive_id: self.primitive_id.clone(),
            face: self.face.clone(),
            panel_id: self.panel_id.clone(),
            normal: self.normal,
            point,
        }
    }
    fn named(&self, id: &str) -> bool {
        self.primitive_id.as_deref() == Some(id) || self.boundary_id.as_deref() == Some(id)
    }
    /// Line parameter and point where `origin + t * direction` meets this support.
    fn meet(&self, origin: Vec3, direction: Vec3) -> Option<(f64, Vec3)> {
        let facing = dot(self.normal, direction);
        if facing > -0.5 {
            return None;
        }
        let t = dot(sub(add(self.vertices[0], self.shift), origin), self.normal) / facing;
        let point = add(origin, scale(direction, t));
        let flat = sub(point, self.shift);
        (length(sub(
            cg::closest_point(&cg::prism(&self.vertices, 0.001), flat),
            flat,
        )) <= 1e-5)
            .then_some((t, point))
    }
    fn closest(&self, point: Vec3) -> Vec3 {
        let flat = sub(point, self.shift);
        let prism = cg::prism(&self.vertices, 0.001);
        // Inside the 1 mm backing prism the plane point is the support point.
        let q = cg::closest_point(&prism, flat);
        let n = cg::normal(&self.vertices);
        add(
            sub(q, scale(n, dot(sub(q, self.vertices[0]), n))),
            self.shift,
        )
    }
}

fn diagnostic(
    severity: &str,
    code: &str,
    message: impl Into<String>,
    id: Option<&str>,
) -> ConstructionDiagnostic {
    ConstructionDiagnostic {
        severity: severity.into(),
        code: code.into(),
        message: message.into(),
        source_id: id.map(str::to_owned),
        ..Default::default()
    }
}
fn round(v: f64) -> f64 {
    let r = (v * 1e6).round() / 1e6;
    if r == 0. { 0. } else { r }
}
fn bearing(v: f64) -> f64 {
    round(v.rem_euclid(360.))
}

/// Attachment point and direction in the part frame, as the attachment check reads them.
fn attachment(e: &ConstructionEquipment, p: &ConstructionEquipmentPart) -> (Vec3, Vec3) {
    let socket = p
        .sockets
        .as_ref()
        .and_then(|s| s.iter().find(|s| s.id == "attachment"));
    let mut position = socket.map_or(
        if p.placement == "internal" {
            [
                p.bounds_center[0],
                p.bounds_center[1] - p.size[1] / 2.,
                p.bounds_center[2],
            ]
        } else {
            [0.; 3]
        },
        |s| s.position,
    );
    let mut direction = socket.map_or([0., -1., 0.], |s| normalize(s.direction));
    if let Some(w) = &e.wall {
        // Same scale and quarter turn as the installed wall fitting.
        let sx = w.width_m / p.size[0];
        let sy = w.height_m / p.size[1];
        let sz = if p.wall_sizing.as_deref() == Some("uniform") {
            sx
        } else {
            1.
        };
        position = [position[0] * sx, position[1] * sy, position[2] * sz];
        for _ in 0..((w.turn_deg.unwrap_or(0.) / 90.).round() as i64).rem_euclid(4) {
            position = [-position[1], position[0], position[2]];
            direction = [-direction[1], direction[0], direction[2]];
        }
    }
    position[1] -= e
        .gun
        .as_ref()
        .and_then(|g| g.barbette_height_m)
        .unwrap_or(0.);
    (position, direction)
}
fn pose(e: &ConstructionEquipment) -> Pose {
    Pose {
        x: e.position[0],
        y: e.position[1],
        z: e.position[2],
        heading: e.bearing_deg.to_radians(),
        ..Default::default()
    }
}

fn supports(result: &ConstructionResult, internal: bool) -> Vec<Support> {
    let mut out = vec![];
    for s in result
        .surfaces
        .iter()
        .filter(|s| !s.open && s.vertices.len() >= 3)
    {
        let inward = scale(s.normal, -1.);
        out.push(Support {
            kind: if internal { "plating" } else { "surface" },
            id: s.id.clone(),
            primitive_id: Some(s.primitive_id.clone()),
            face: Some(s.face.clone()),
            panel_id: s.panel_id.clone(),
            boundary_id: None,
            vertices: s.vertices.clone(),
            normal: if internal { inward } else { s.normal },
            shift: if internal {
                scale(inward, s.thickness_mm / 1000.)
            } else {
                [0.; 3]
            },
        });
    }
    if internal && let Some(def) = &result.definition {
        for a in &def.armor {
            let Some(plate) = a.plate.as_ref().filter(|p| {
                p.exterior == Some(false)
                    && p.vertices.len() >= 3
                    && cg::normal(&p.vertices)[1].abs() > 0.95
            }) else {
                continue;
            };
            out.push(Support {
                kind: "deck",
                id: plate.surface_id.clone().unwrap_or_else(|| a.id.clone()),
                primitive_id: None,
                face: None,
                panel_id: None,
                boundary_id: plate.surface_id.clone(),
                vertices: plate.vertices.clone(),
                normal: [0., 1., 0.],
                shift: [0., a.thickness_mm / 2000., 0.],
            });
        }
    }
    out
}

pub fn place_json(source: &str, catalog: &str, request: &str) -> Result<String, String> {
    if source.len() > cc::MAX_SOURCE_BYTES
        || catalog.len() > cc::MAX_CATALOG_BYTES
        || request.len() > 4_000_000
    {
        return Err("Placement input exceeds size limit".into());
    }
    let source: ConstructionSource = serde_json::from_str(source).map_err(|e| e.to_string())?;
    let catalog: ConstructionCatalog = serde_json::from_str(catalog).map_err(|e| e.to_string())?;
    let request: PlacementRequest = serde_json::from_str(request).map_err(|e| e.to_string())?;
    cc::to_json(&place(&source, &catalog, &request))
}

/// Deterministic. Supports come from a compile of the hull alone: the attachment
/// check never counts other equipment as support, and a draft whose equipment has
/// lost its support still has a hull to seat on.
pub fn place(
    source: &ConstructionSource,
    catalog: &ConstructionCatalog,
    request: &PlacementRequest,
) -> PlacementReport {
    let mut report = PlacementReport::default();
    if request.items.is_empty() || request.items.len() > MAX_ITEMS {
        report.diagnostics.push(diagnostic(
            "error",
            "placement-limit",
            format!("Seat 1–{MAX_ITEMS} equipment records at once"),
            None,
        ));
        return report;
    }
    let mut hull = source.clone();
    hull.construction.equipment.clear();
    let compiled = cc::compile(&hull, catalog);
    let catalog =
        &*crate::construction_custom_fittings::effective_catalog(&source.construction, catalog);
    if compiled.surfaces.is_empty() {
        report.diagnostics.extend(compiled.diagnostics);
        report.diagnostics.push(diagnostic(
            "error",
            "placement-hull",
            "The hull alone does not compile to any support surface; repair the hull first",
            None,
        ));
        return report;
    }
    let exterior = supports(&compiled, false);
    let interior = supports(&compiled, true);
    if compiled.definition.is_none() {
        report.diagnostics.push(diagnostic(
            "warning",
            "placement-hull",
            "The hull alone is not launchable; internal decks are unavailable as supports",
            None,
        ));
    }
    for item in &request.items {
        let mut e = item.equipment.clone();
        let from = e.position;
        let Some(p) = catalog.equipment.iter().find(|p| p.id == e.part_id) else {
            report.diagnostics.push(diagnostic(
                "error",
                "missing-part",
                format!("Unknown catalog part {}", e.part_id),
                Some(&e.id),
            ));
            continue;
        };
        let mut placement = Placement {
            id: e.id.clone(),
            part_id: p.id.clone(),
            from,
            ..Default::default()
        };
        let fail = |report: &mut PlacementReport, mut placement: Placement, message: String| {
            report.diagnostics.push(diagnostic(
                "error",
                "placement-support",
                message.clone(),
                Some(&placement.id),
            ));
            placement.status = "unsupported".into();
            placement.message = Some(message);
            report.placements.push(placement);
        };
        if p.path.is_some() || e.path.is_some() {
            placement.position = from;
            placement.bearing_deg = e.bearing_deg;
            fail(
                &mut report,
                placement,
                "Connected fittings are drawn between points and have no single seat".into(),
            );
            continue;
        }
        let pool = if p.placement == "internal" {
            &interior
        } else {
            &exterior
        };
        let allowed = |s: &&Support| item.on.as_deref().is_none_or(|id| s.named(id));
        if let Some(id) = &item.on
            && !pool.iter().any(|s| s.named(id))
        {
            placement.position = from;
            placement.bearing_deg = e.bearing_deg;
            fail(
                &mut report,
                placement,
                format!("{id} offers no closed support surface for this part"),
            );
            continue;
        }
        if let Some(primary) = &item.mirror_of {
            let Some(twin) = report
                .placements
                .iter()
                .find(|q| &q.id == primary && q.status != "unsupported")
            else {
                placement.position = from;
                placement.bearing_deg = e.bearing_deg;
                fail(
                    &mut report,
                    placement,
                    format!("Mirror source {primary} was not seated"),
                );
                continue;
            };
            e.position = [-twin.position[0], twin.position[1], twin.position[2]];
            e.bearing_deg = bearing(-twin.bearing_deg);
        } else if item.auto_bearing {
            let near = exterior
                .iter()
                .filter(|s| s.normal[1].abs() < 0.9)
                .filter(allowed)
                .map(|s| (length(sub(s.closest(from), from)), s))
                .min_by(|a, b| a.0.total_cmp(&b.0));
            let Some((_, side)) = near else {
                placement.position = from;
                fail(&mut report, placement, "No closed hull side to face".into());
                continue;
            };
            e.bearing_deg = bearing(side.normal[0].atan2(-side.normal[2]).to_degrees());
        }
        let (local, local_direction) = attachment(&e, p);
        let world = local_to_world(local, pose(&e));
        let direction = normalize(sub(local_to_world(local_direction, pose(&e)), e.position));
        placement.bearing_deg = e.bearing_deg;
        placement.direction = direction.map(round);
        if p.kind == "propeller" {
            // Same rule as the editor: hang the blade sweep below the hull; the
            // compiler derives the shaft and struts to the closed hull afterwards.
            let up = [0., 1., 0.];
            let hit = exterior
                .iter()
                .filter(allowed)
                .filter_map(|s| s.meet(e.position, up).map(|(t, point)| (t, point, s)))
                .min_by(|a, b| a.0.total_cmp(&b.0));
            if item.mirror_of.is_none()
                && let Some((_, point, _)) = &hit
            {
                e.position[1] = round(point[1] - p.size[0].max(p.size[1]) * 0.65);
            }
            placement.status = if item.mirror_of.is_some() {
                "mirrored"
            } else if hit.is_some() {
                "seated"
            } else {
                "kept"
            }
            .into();
            placement.message = Some(
                if hit.is_some() {
                    "Hung 0.65 diameters below the hull; shaft and struts are derived by the compiler"
                } else {
                    "Outboard of the hull: the authored height is already valid and is kept, and the compiler derives the shaft and struts"
                }
                .into(),
            );
            placement.support = hit.map(|(_, point, s)| s.report(point.map(round)));
            placement.position = e.position;
            placement.attachment = local_to_world(local, pose(&e)).map(round);
            report.placements.push(placement);
            continue;
        }
        let hits: Vec<_> = pool
            .iter()
            .filter(allowed)
            .filter(|s| e.wall.is_none() || s.normal[1].abs() < 0.9)
            .filter_map(|s| s.meet(world, direction).map(|(t, point)| (t, point, s)))
            .filter(|(t, ..)| item.max_travel_m.is_none_or(|m| t.abs() <= m + 1e-9))
            .collect();
        let select = if item.mirror_of.is_some() {
            "nearest"
        } else {
            item.select.as_deref().unwrap_or("nearest")
        };
        let chosen = match select {
            "first" => hits.iter().min_by(|a, b| a.0.total_cmp(&b.0)),
            "last" => hits.iter().max_by(|a, b| a.0.total_cmp(&b.0)),
            _ => hits.iter().min_by(|a, b| a.0.abs().total_cmp(&b.0.abs())),
        };
        if let Some((t, point, support)) = chosen {
            placement.gap_m = Some(round(*t));
            placement.support = Some(support.report(point.map(round)));
            if item.mirror_of.is_some() {
                placement.status = "mirrored".into();
                placement.residual_m = Some(round(*t));
                if t.abs() > 0.05 {
                    report.diagnostics.push(diagnostic(
                        "error",
                        "placement-mirror",
                        format!(
                            "The mirrored twin is {:.3} m from its support; the hull is not symmetric here, place each side separately",
                            t
                        ),
                        Some(&e.id),
                    ));
                }
            } else {
                placement.status = "seated".into();
                placement.residual_m = Some(0.);
                let mut travel = *t;
                if p.placement == "internal" {
                    // Internal packages must clear the plating everywhere, not only at
                    // their datum: a hull floor is convex, so its highest point under a
                    // rectangular base lies at a corner. A raised package keeps 1 mm of clearance.
                    for (sx, sz) in [(-0.5, -0.5), (-0.5, 0.5), (0.5, -0.5), (0.5, 0.5)] {
                        let corner = local_to_world(
                            [
                                p.bounds_center[0] + p.size[0] * sx,
                                local[1],
                                p.bounds_center[2] + p.size[2] * sz,
                            ],
                            pose(&e),
                        );
                        if let Some(c) = pool
                            .iter()
                            .filter(allowed)
                            .filter_map(|s| s.meet(corner, direction).map(|(t, _)| t))
                            .min_by(|a, b| (a - t).abs().total_cmp(&(b - t).abs()))
                        {
                            travel = travel.min(c);
                        }
                    }
                    if travel < *t - 1e-6 {
                        placement.residual_m = Some(round(t - travel + 0.001));
                        placement.message = Some(
                            "Raised until every base corner clears the plating; the datum floats by residualM"
                                .into(),
                        );
                        travel -= 0.001;
                    } else {
                        travel = *t;
                    }
                }
                for (value, d) in e.position.iter_mut().zip(direction) {
                    if d.abs() > 1e-9 {
                        *value = round(*value + d * travel);
                    }
                }
            }
        } else if item.slide && item.mirror_of.is_none() {
            let near = pool
                .iter()
                .filter(allowed)
                .filter(|s| dot(s.normal, direction) <= -0.5)
                .filter(|s| e.wall.is_none() || s.normal[1].abs() < 0.9)
                .map(|s| {
                    let q = s.closest(world);
                    (length(sub(q, world)), q, s)
                })
                .min_by(|a, b| a.0.total_cmp(&b.0));
            let Some((distance, point, support)) = near else {
                placement.position = from;
                fail(
                    &mut report,
                    placement,
                    "No closed support faces this part's attachment anywhere on the hull".into(),
                );
                continue;
            };
            // Step 1 cm inside the edge so the seat is not on the boundary itself.
            let center = scale(
                support.vertices.iter().fold([0.; 3], |a, v| add(a, *v)),
                1. / support.vertices.len() as f64,
            );
            let inward = sub(add(center, support.shift), point);
            let point = if length(inward) > 0.02 {
                support.closest(add(point, scale(normalize(inward), 0.01)))
            } else {
                point
            };
            e.position = add(e.position, sub(point, world)).map(round);
            placement.status = "slid".into();
            placement.gap_m = Some(round(distance));
            placement.residual_m = Some(0.);
            placement.support = Some(support.report(point.map(round)));
        } else {
            placement.position = from;
            fail(
                &mut report,
                placement,
                format!(
                    "No closed support lies {} the attachment point [{:.3}, {:.3}, {:.3}]{}",
                    if direction[1] < -0.5 {
                        "under"
                    } else if direction[1] > 0.5 {
                        "above"
                    } else {
                        "behind"
                    },
                    world[0],
                    world[1],
                    world[2],
                    if item.mirror_of.is_some() {
                        "; the hull is not symmetric here".into()
                    } else {
                        item.max_travel_m.map_or(String::new(), |m| {
                            format!(" within {m:.2} m; move it to its new support explicitly")
                        })
                    }
                ),
            );
            continue;
        }
        placement.position = e.position;
        placement.attachment = local_to_world(local, pose(&e)).map(round);
        report.placements.push(placement);
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(id: &str, kind: &str, socket: Option<(Vec3, Vec3)>) -> ConstructionEquipmentPart {
        ConstructionEquipmentPart {
            id: id.into(),
            name: id.into(),
            kind: kind.into(),
            size: [1., 1., 1.],
            bounds_center: [0., 0.5, 0.],
            center_of_gravity: [0., 0.5, 0.],
            mass_kg: Some(100.),
            placement: "deck".into(),
            sockets: socket.map(|(position, direction)| {
                vec![ConstructionEquipmentPartSocketsItem {
                    id: "attachment".into(),
                    kind: "attachment".into(),
                    position,
                    direction,
                }]
            }),
            ..Default::default()
        }
    }
    fn item(id: &str, part: &str, position: Vec3) -> PlacementItem {
        PlacementItem {
            equipment: ConstructionEquipment {
                id: id.into(),
                part_id: part.into(),
                position,
                ..Default::default()
            },
            select: Some("first".into()),
            ..Default::default()
        }
    }
    fn fixture() -> (ConstructionSource, ConstructionCatalog) {
        let block = |id: &str, position: Vec3, size: Vec3| ConstructionPrimitive {
            id: id.into(),
            kind: "box".into(),
            position,
            size,
            ..Default::default()
        };
        let mut source = ConstructionSource {
            schema_version: 1.,
            id: "placement".into(),
            name: "Placement".into(),
            coordinates: "meters-y-up-bow-negative-z".into(),
            revision: "one".into(),
            construction: ConstructionData {
                version: 1.,
                catalog_revision: "test".into(),
                default_thickness_mm: 10.,
                primitives: vec![block("box", [0.; 3], [10., 4., 20.])],
                ..Default::default()
            },
        };
        let mut catalog = ConstructionCatalog {
            schema_version: 1.,
            revision: "test".into(),
            weapons: PartCatalog {
                schema_version: 1.,
                ..Default::default()
            },
            ..Default::default()
        };
        // Hull box top at y=2; a deckhouse on it with its top at y=4.
        let mut house = source.construction.primitives[0].clone();
        house.id = "house".into();
        house.size = [4., 2., 4.];
        house.position = [0., 3., 0.];
        source.construction.primitives.push(house);
        catalog.equipment = vec![
            part(
                "bitts",
                "deck-fitting",
                Some(([0., 0.1, 0.], [0., -1., 0.])),
            ),
            part("plain", "mast", None),
        ];
        (source, catalog)
    }

    #[test]
    fn seats_on_the_topmost_named_or_nearest_support_and_passes_the_compiler() {
        let (mut source, catalog) = fixture();
        let mut on_hull = item("c", "bitts", [3.5, 0., 0.5]);
        on_hull.on = Some("box".into());
        let mut nearest = item("d", "bitts", [3., 2.3, 6.]);
        nearest.select = Some("nearest".into());
        let report = place(
            &source,
            &catalog,
            &PlacementRequest {
                items: vec![
                    item("a", "bitts", [0., 50., 0.]),
                    item("b", "plain", [3., -7., 6.]),
                    on_hull,
                    nearest,
                ],
            },
        );
        assert!(report.diagnostics.is_empty(), "{:?}", report.diagnostics);
        let y: Vec<_> = report.placements.iter().map(|p| p.position[1]).collect();
        // The socket sits 0.1 above the datum; the house roof is y=4, the hull deck y=2.
        assert_eq!(y, vec![3.9, 2., 1.9, 1.9]);
        assert_eq!(
            report.placements[0]
                .support
                .as_ref()
                .unwrap()
                .primitive_id
                .as_deref(),
            Some("house")
        );
        assert_eq!(report.placements[3].gap_m, Some(0.4));
        for p in &report.placements {
            source.construction.equipment.push(ConstructionEquipment {
                id: p.id.clone(),
                part_id: p.part_id.clone(),
                position: p.position,
                bearing_deg: p.bearing_deg,
                ..Default::default()
            });
        }
        let compiled = cc::compile(&source, &catalog);
        assert!(
            !compiled
                .diagnostics
                .iter()
                .any(|d| d.code == "equipment-attachment"),
            "{:?}",
            compiled.diagnostics
        );
    }

    #[test]
    fn mirrors_exactly_slides_only_on_request_and_reports_missing_support() {
        let (source, catalog) = fixture();
        let mut twin = item("port", "bitts", [0.; 3]);
        twin.mirror_of = Some("starboard".into());
        let mut starboard = item("starboard", "bitts", [3., 9., -6.]);
        starboard.equipment.bearing_deg = 30.;
        let mut slid = item("slid", "bitts", [7., 2., 0.]);
        slid.slide = true;
        let report = place(
            &source,
            &catalog,
            &PlacementRequest {
                items: vec![starboard, twin, item("off", "bitts", [7., 2., 0.]), slid],
            },
        );
        let [a, b, off, slid] = &report.placements[..] else {
            panic!()
        };
        assert_eq!(b.position, [-a.position[0], a.position[1], a.position[2]]);
        assert_eq!((b.bearing_deg, b.status.as_str()), (330., "mirrored"));
        assert_eq!(b.residual_m, Some(0.));
        assert_eq!(off.status, "unsupported");
        assert_eq!(off.position, [7., 2., 0.]);
        assert_eq!(report.diagnostics.len(), 1);
        assert_eq!(report.diagnostics[0].source_id.as_deref(), Some("off"));
        assert_eq!(slid.status, "slid");
        assert!((4.98..5.).contains(&slid.position[0]) && (slid.position[1] - 1.9).abs() < 1e-6);
    }

    #[test]
    fn wall_fittings_face_and_seat_on_the_nearest_side() {
        let (source, mut catalog) = fixture();
        let mut door = part("door", "deck-fitting", Some(([0.; 3], [0., 0., 1.])));
        door.wall_mount = Some("door".into());
        catalog.equipment.push(door);
        let mut request = item("door-1", "door", [5.6, 0.5, 3.]);
        request.select = Some("nearest".into());
        request.auto_bearing = true;
        request.equipment.wall = Some(ConstructionEquipmentWall {
            version: 1.,
            width_m: 1.,
            height_m: 1.,
            mirror_id: None,
            turn_deg: None,
        });
        let report = place(
            &source,
            &catalog,
            &PlacementRequest {
                items: vec![request],
            },
        );
        assert!(report.diagnostics.is_empty(), "{:?}", report.diagnostics);
        let p = &report.placements[0];
        assert_eq!((p.position, p.bearing_deg), ([5., 0.5, 3.], 90.));
        assert_eq!(p.gap_m, Some(0.6));
    }
}
