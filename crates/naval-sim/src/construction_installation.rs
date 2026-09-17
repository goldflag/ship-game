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
/// Extra exposed trunk above the original deck datum. The lower end stays fixed.
pub fn raised(e: &ConstructionEquipment) -> f64 {
    e.gun
        .as_ref()
        .and_then(|g| g.barbette_height_m)
        .unwrap_or(0.)
}
pub fn spaces(
    c: &ConstructionData,
    catalog: &ConstructionCatalog,
    p: &ConstructionEquipmentPart,
    e: &ConstructionEquipment,
    hull: &[cg::Cell],
) -> Vec<ConstructionEquipmentPartOccupancyItem> {
    let mut spaces = p.occupancy.clone().unwrap_or_default();
    if p.kind != "gun" {
        return spaces;
    }
    if c.version >= 2. && spaces.is_empty() {
        if let Some(w) = catalog
            .weapons
            .parts
            .iter()
            .find(|w| Some(w.id.as_str()) == p.gun_part_id.as_deref())
        {
            let top = attachment(p);
            let depth = (w.barbette_radius * 1.2).max(0.75);
            spaces.push(ConstructionEquipmentPartOccupancyItem {
                center: [0., top - depth / 2., 0.],
                size: [w.barbette_radius * 2., depth, w.barbette_radius * 2.],
            });
        }
    }
    let raise = raised(e);
    for space in &mut spaces {
        space.center[1] -= raise / 2.;
        space.size[1] += raise;
    }
    if c.version >= 2. {
        let deck = e.position[1] + attachment(p) - raise;
        if let Some(floor) = floor_below(hull, e.position[0], e.position[2], deck) {
            for space in &mut spaces {
                let old_low = space.center[1] - space.size[1] / 2.;
                // Extend down to the inner bottom, but never shorten the part's minimum well.
                let low = old_low.min(floor + c.default_thickness_mm / 1000. - e.position[1]);
                space.center[1] -= (old_low - low) / 2.;
                space.size[1] += old_low - low;
            }
        }
    }
    spaces
}
/// Follow the connected vertical hull column down from the supporting deck.
fn floor_below(hull: &[cg::Cell], x: f64, z: f64, deck: f64) -> Option<f64> {
    let mut intervals = vec![];
    for cell in hull {
        let (mut low, mut high) = (f64::NEG_INFINITY, f64::INFINITY);
        let mut inside = true;
        for face in cell.faces.iter() {
            let n = cg::normal(&face.vertices);
            let d = dot(n, face.vertices[0]) - n[0] * x - n[2] * z;
            if n[1].abs() < 1e-8 {
                if d < -1e-7 {
                    inside = false;
                    break;
                }
            } else if n[1] > 0. {
                high = high.min(d / n[1]);
            } else {
                low = low.max(d / n[1]);
            }
        }
        if inside && low <= high {
            intervals.push((low, high));
        }
    }
    let mut floor = deck;
    let mut found = false;
    loop {
        let before = floor;
        for &(low, high) in &intervals {
            if low <= floor + 1e-6 && high >= floor - 0.05 {
                floor = floor.min(low);
                found = true;
            }
        }
        if (floor - before).abs() < 1e-7 {
            break;
        }
    }
    found.then_some(floor)
}
pub fn attachment(p: &ConstructionEquipmentPart) -> f64 {
    p.sockets
        .iter()
        .flatten()
        .find(|s| s.id == "attachment")
        .map_or(0., |s| s.position[1])
}
/// A compact ammunition room at the foot of the trunk, inside its structural skin.
/// Sizes are gameplay package estimates, not reconstructed historical magazines.
pub fn magazine(
    c: &ConstructionData,
    catalog: &ConstructionCatalog,
    p: &ConstructionEquipmentPart,
    e: &ConstructionEquipment,
    hull: &[cg::Cell],
) -> Option<(Vec3, Vec3)> {
    let well = spaces(c, catalog, p, e, hull).first()?.clone();
    let w = catalog
        .weapons
        .parts
        .iter()
        .find(|w| Some(w.id.as_str()) == p.gun_part_id.as_deref())?;
    let skin = c.default_thickness_mm / 1000.;
    let width = (w.barbette_radius - skin * 2.) * 1.4;
    let depth = well.size[1] - raised(e);
    let height = (depth * 0.4).min(2.).max(0.2);
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
    hull: &[cg::Cell],
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
        let spaces = spaces(source, catalog, part, e, hull);
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
            || top - low <= thickness
            || space.center[0].abs() + radius > space.size[0] * 0.5 + 1e-7
            || space.center[2].abs() + radius > space.size[2] * 0.5 + 1e-7
        {
            return Err(format!(
                "{} working well cannot contain its canonical barbette and structural thickness",
                e.id
            ));
        }
        let bore = cylinder(inner, low - thickness, top + thickness);
        let collar = cg::box_cell(
            [space.center[0], top - thickness * 0.5, space.center[2]],
            [space.size[0], thickness, space.size[2]],
        );
        let mut collar = cg::subtract_all(vec![collar], std::slice::from_ref(&bore))?;
        if raised(e) > 0. {
            let deck_collar = cg::box_cell(
                [
                    space.center[0],
                    top - raised(e) - thickness * 0.5,
                    space.center[2],
                ],
                [space.size[0], thickness, space.size[2]],
            );
            collar.extend(cg::subtract_all(
                vec![deck_collar],
                &[cylinder(radius, low - thickness, top + thickness)],
            )?);
        }
        let mut solids = collar.clone();
        let mut surfaces = vec![];
        let mut surface = |face: &str, vertices: Vec<Vec3>| {
            if cg::area(&vertices) <= 1e-10 {
                return;
            }
            surfaces.push(ConstructionSurface { panel_id: None,
                id: format!("equipment:{}:{}:{}", e.id, face, surfaces.len()),
                primitive_id: format!("equipment:{}", e.id),
                face: face.into(),
                normal: cg::normal(&vertices),
                area_m2: cg::area(&vertices),
                vertices,
                thickness_mm: source.default_thickness_mm,
                material: "steel".into(),
                paint: "naval-gray".into(),
                open: false,
            });
        };
        if source.version >= 2. {
            let floor = cylinder(inner, low, low + thickness);
            for face in floor.faces.iter() {
                surface("installation-floor", face.vertices.clone());
            }
            solids.push(floor);
        }
        let outer = cylinder(radius, low - thickness, top + thickness);
        for cell in &collar {
            for face in cell.faces.iter() {
                let n = cg::normal(&face.vertices);
                if n[1] > 0.99 {
                    surface("installation-top", face.vertices.clone());
                }
                if n[1] < -0.99 {
                    for polygon in cg::exposed(&face.vertices, &outer, false) {
                        surface("installation-bottom", polygon);
                    }
                }
            }
        }
        for i in 0..SIDES {
            let a = i as f64 * std::f64::consts::TAU / SIDES as f64;
            let b = (i + 1) as f64 * std::f64::consts::TAU / SIDES as f64;
            let at = |r: f64, y: f64, t: f64| [r * t.cos(), y, r * t.sin()];
            let ring = vec![
                at(radius, top - thickness, a),
                at(inner, top - thickness, a),
                at(inner, top - thickness, b),
                at(radius, top - thickness, b),
            ];
            solids.push(cg::prism(&ring, top - thickness - low));
            surface(
                "installation-outer",
                vec![
                    at(radius, low, a),
                    at(radius, top - thickness, a),
                    at(radius, top - thickness, b),
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
