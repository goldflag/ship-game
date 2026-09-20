//! Original gun installation support, kept inside its declared working space.
use crate::{construction_geometry as cg, definition::*, geometry::*};
const SIDES: usize = 64;
pub struct Installation {
    pub id: String,
    pub solids: Vec<cg::Cell>,
    pub surfaces: Vec<ConstructionSurface>,
    pub bore: cg::Cell,
    pub raised_space: Option<cg::Cell>,
}
pub fn internal(s: &ConstructionSurface) -> bool {
    s.face.starts_with("installation-")
}
pub fn protective(s: &ConstructionSurface) -> bool {
    matches!(s.face.as_str(), "installation-outer" | "installation-top")
}
/// Space directly above a deck penetration can contain the exposed collar.
/// Its vertical footprint stops at the deck edge, preserving side/bottom checks.
pub fn deck_backing(polygon: &[Vec3], top: f64) -> cg::Cell {
    let top = polygon.iter().map(|v| v[1]).fold(top, f64::max) + cg::EPS * 4.;
    let cap: Vec<_> = polygon.iter().map(|v| [v[0], top, v[2]]).collect();
    let mut faces = vec![
        ConvexVolumeFacesItem {
            vertices: cap.clone(),
        },
        ConvexVolumeFacesItem {
            vertices: polygon.iter().copied().rev().collect(),
        },
    ];
    for i in 0..polygon.len() {
        let j = (i + 1) % polygon.len();
        faces.push(ConvexVolumeFacesItem {
            vertices: vec![cap[i], polygon[i], polygon[j], cap[j]],
        });
    }
    cg::Cell {
        faces: faces.into(),
    }
}
fn cylinder(radius: f64, low: f64, high: f64) -> cg::Cell {
    let top: Vec<_> = (0..SIDES)
        .rev()
        .map(|i| {
            let a = i as f64 * std::f64::consts::TAU / SIDES as f64;
            [radius * a.cos(), high, radius * a.sin()]
        })
        .collect();
    cg::prism(&top, high - low)
}
/// Guns use their fixed circular support; the retained funnel casings enclose
/// oval uptakes. Deck cuts and reserved space must share that outline, otherwise
/// square corners protrude from the casing or the retained deck fails fit checks.
pub fn space_cell(
    catalog: &ConstructionCatalog,
    part: &ConstructionEquipmentPart,
    space: &ConstructionEquipmentPartOccupancyItem,
) -> cg::Cell {
    if part.kind == "gun"
        && let Some(weapon) = catalog
            .weapons
            .parts
            .iter()
            .find(|w| Some(w.id.as_str()) == part.gun_part_id.as_deref())
    {
        return cylinder(
            weapon.barbette_radius,
            space.center[1] - space.size[1] / 2.,
            space.center[1] + space.size[1] / 2.,
        );
    }
    if part.kind == "funnel" {
        return cg::transform(
            &cylinder(1., -space.size[1] / 2., space.size[1] / 2.),
            space.center,
            [space.size[0] / 2., 1., space.size[2] / 2.],
            0.,
        );
    }
    cg::box_cell(space.center, space.size)
}
/// Extra exposed trunk above the original deck datum. The lower end stays fixed.
pub fn raised(e: &ConstructionEquipment) -> f64 {
    e.gun
        .as_ref()
        .and_then(|g| g.barbette_height_m)
        .unwrap_or(0.)
}
/// Explicit catalog wells take precedence. An explicitly empty occupancy declares
/// a deck mount; older catalogs without occupancy use a provisional light-gun
/// default below 100 mm. Version-1 installations retain their authored behavior.
pub fn deck_mounted(
    c: &ConstructionData,
    catalog: &ConstructionCatalog,
    p: &ConstructionEquipmentPart,
) -> bool {
    c.version >= 2.
        && p.kind == "gun"
        && match &p.occupancy {
            Some(spaces) => spaces.is_empty(),
            None => catalog
                .weapons
                .parts
                .iter()
                .any(|w| Some(w.id.as_str()) == p.gun_part_id.as_deref() && w.caliber_m < 0.1),
        }
}
pub fn spaces(
    c: &ConstructionData,
    catalog: &ConstructionCatalog,
    p: &ConstructionEquipmentPart,
    e: &ConstructionEquipment,
) -> Vec<ConstructionEquipmentPartOccupancyItem> {
    let mut spaces = p.occupancy.clone().unwrap_or_default();
    if p.kind != "gun" {
        return spaces;
    }
    let raise = raised(e);
    if c.version >= 2.
        && spaces.is_empty()
        && let Some(w) = catalog
            .weapons
            .parts
            .iter()
            .find(|w| Some(w.id.as_str()) == p.gun_part_id.as_deref())
    {
        let top = attachment(p);
        // A deck mount already includes its pedestal. Only an explicit rise
        // adds a support, entirely above the deck. Other omitted wells keep
        // the existing size-based working-depth estimate, independent of hull.
        let depth = if deck_mounted(c, catalog, p) {
            0.
        } else {
            (w.barbette_radius * 1.2).max(0.75)
        };
        if depth + raise == 0. {
            return spaces;
        }
        spaces.push(ConstructionEquipmentPartOccupancyItem {
            center: [0., top - depth / 2., 0.],
            size: [w.barbette_radius * 2., depth, w.barbette_radius * 2.],
        });
    }
    for space in &mut spaces {
        space.center[1] -= raise / 2.;
        space.size[1] += raise;
    }
    spaces
}
pub fn attachment(p: &ConstructionEquipmentPart) -> f64 {
    p.sockets
        .iter()
        .flatten()
        .find(|s| s.id == "attachment")
        .map_or(0., |s| s.position[1])
}
/// A compact magazine inside a working well, or ready ammunition at a deck mount.
/// Sizes are gameplay package estimates, not reconstructed historical magazines.
pub fn magazine(
    c: &ConstructionData,
    catalog: &ConstructionCatalog,
    p: &ConstructionEquipmentPart,
    e: &ConstructionEquipment,
) -> Option<(Vec3, Vec3)> {
    if deck_mounted(c, catalog, p) {
        let w = catalog
            .weapons
            .parts
            .iter()
            .find(|w| Some(w.id.as_str()) == p.gun_part_id.as_deref())?;
        // Ready ammunition is a compact fixed package at the mount base. It
        // follows the fitting (including rise), with no invented hull opening.
        let width = (w.barbette_radius * 1.4).min(p.size[0]).min(p.size[2]);
        let height = 0.3_f64.min(p.size[1]);
        return Some((
            add(e.position, [0., attachment(p) + height / 2., 0.]),
            [width, height, width],
        ));
    }
    let well = spaces(c, catalog, p, e).first()?.clone();
    let w = catalog
        .weapons
        .parts
        .iter()
        .find(|w| Some(w.id.as_str()) == p.gun_part_id.as_deref())?;
    let skin = c.default_thickness_mm / 1000.;
    let width = (w.barbette_radius - skin * 2.) * 1.4;
    let depth = well.size[1] - raised(e);
    let height = (depth * 0.4).clamp(0.2, 2.);
    let center = [
        0.,
        well.center[1] - well.size[1] / 2. + skin + height / 2.,
        0.,
    ];
    let pose = Pose {
        x: e.position[0],
        y: e.position[1],
        z: e.position[2],
        heading: e.bearing_deg.to_radians(),
        ..Default::default()
    };
    Some((local_to_world(center, pose), [width, height, width]))
}
pub fn derive(
    source: &ConstructionData,
    catalog: &ConstructionCatalog,
) -> Result<Vec<Installation>, String> {
    let mut result = vec![];
    for e in &source.equipment {
        let Some(part) = catalog
            .equipment
            .iter()
            .find(|p| p.id == e.part_id && p.kind == "gun")
        else {
            continue;
        };
        let spaces = spaces(source, catalog, part, e);
        if spaces.is_empty() {
            continue;
        }
        if spaces.len() != 1 {
            return Err(format!(
                "{} needs one explicit original turret working well",
                e.id
            ));
        }
        let space = &spaces[0];
        let weapon = catalog
            .weapons
            .parts
            .iter()
            .find(|w| Some(w.id.as_str()) == part.gun_part_id.as_deref())
            .ok_or_else(|| format!("{} has no canonical gun", e.id))?;
        let radius = weapon.barbette_radius;
        let thickness = source.default_thickness_mm / 1000.;
        let inner = radius - thickness / (std::f64::consts::PI / SIDES as f64).cos();
        let top = part
            .sockets
            .iter()
            .flatten()
            .find(|s| s.id == "attachment")
            .map_or(0., |s| s.position[1]);
        let low = space.center[1] - space.size[1] * 0.5;
        if inner <= 0.
            || top - low
                <= if deck_mounted(source, catalog, part) {
                    0.
                } else {
                    thickness
                }
            || space.center[0].abs() + radius > space.size[0] * 0.5 + 1e-7
            || space.center[2].abs() + radius > space.size[2] * 0.5 + 1e-7
        {
            return Err(format!(
                "{} working well cannot contain its canonical barbette and structural thickness",
                e.id
            ));
        }
        let bore = cylinder(inner, low - thickness, top + thickness);
        let mut solids = vec![];
        let mut surfaces = vec![];
        let mut surface = |face: &str, vertices: Vec<Vec3>| {
            if cg::area(&vertices) <= 1e-10 {
                return;
            }
            surfaces.push(ConstructionSurface {
                panel_id: None,
                id: format!("equipment:{}:{}:{}", e.id, face, surfaces.len()),
                primitive_id: format!("equipment:{}", e.id),
                face: face.into(),
                normal: cg::normal(&vertices),
                area_m2: cg::area(&vertices),
                vertices,
                thickness_mm: source.default_thickness_mm,
                material: "steel".into(),
                // A barbette wears its turret's paint.
                paint: e
                    .paint
                    .as_deref()
                    .unwrap_or_else(|| crate::construction::ship_paint(source))
                    .into(),
                open: false,
            });
        };
        if source.version >= 2. {
            let floor = cylinder(inner, low, (low + thickness).min(top));
            for face in floor.faces.iter() {
                surface("installation-floor", face.vertices.clone());
            }
            solids.push(floor);
        }
        for i in 0..SIDES {
            let a = i as f64 * std::f64::consts::TAU / SIDES as f64;
            let b = (i + 1) as f64 * std::f64::consts::TAU / SIDES as f64;
            let at = |r: f64, y: f64, t: f64| [r * t.cos(), y, r * t.sin()];
            let ring = vec![
                at(radius, top, a),
                at(inner, top, a),
                at(inner, top, b),
                at(radius, top, b),
            ];
            surface("installation-top", ring.clone());
            solids.push(cg::prism(&ring, top - low));
            surface(
                "installation-outer",
                vec![
                    at(radius, low, a),
                    at(radius, top, a),
                    at(radius, top, b),
                    at(radius, low, b),
                ],
            );
            surface(
                "installation-inner",
                vec![
                    at(inner, low, b),
                    at(inner, top, b),
                    at(inner, top, a),
                    at(inner, low, a),
                ],
            );
            surface(
                "installation-bottom",
                vec![
                    at(radius, low, b),
                    at(inner, low, b),
                    at(inner, low, a),
                    at(radius, low, a),
                ],
            );
        }
        let pose = Pose {
            x: e.position[0],
            y: e.position[1],
            z: e.position[2],
            heading: e.bearing_deg.to_radians(),
            ..Default::default()
        };
        for s in &mut surfaces {
            s.vertices = s
                .vertices
                .iter()
                .map(|v| local_to_world(*v, pose))
                .collect();
            s.normal = cg::normal(&s.vertices);
        }
        let transform =
            |cell: &cg::Cell| cg::transform(cell, e.position, [1.; 3], -e.bearing_deg.to_radians());
        result.push(Installation {
            id: e.id.clone(),
            solids: solids.iter().map(transform).collect(),
            surfaces,
            bore: transform(&bore),
            raised_space: (raised(e) > 0.).then(|| {
                transform(&cg::box_cell(
                    [0., top - raised(e) / 2., 0.],
                    [space.size[0], raised(e) + thickness * 2., space.size[2]],
                ))
            }),
        });
    }
    Ok(result)
}
