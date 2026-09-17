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
/// Guns occupy the same circular footprint as their fixed support. Other
/// equipment keeps its catalog box; never carve a square hole around a round trunk.
pub fn space_cell(
    catalog: &ConstructionCatalog,
    part: &ConstructionEquipmentPart,
    space: &ConstructionEquipmentPartOccupancyItem,
) -> cg::Cell {
    if part.kind == "gun" {
        if let Some(weapon) = catalog.weapons.parts.iter()
            .find(|w| Some(w.id.as_str()) == part.gun_part_id.as_deref()) {
            return cylinder(weapon.barbette_radius,
                space.center[1] - space.size[1] / 2.,
                space.center[1] + space.size[1] / 2.);
        }
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
        for space in &mut spaces {
            if let Some(floor) =
                floor_under_space(hull, e, space, deck, c.default_thickness_mm / 1000.)
            {
                let old_low = space.center[1] - space.size[1] / 2.;
                // Keep the entire magazine/well above the inner bottom, including
                // the rising bilges beneath its corners. Preserve minimum depth.
                let low = old_low.min(floor - e.position[1]);
                space.center[1] -= (old_low - low) / 2.;
                space.size[1] += old_low - low;
            }
        }
    }
    spaces
}
/// The lowest horizontal floor that clears the bottom under the whole footprint.
/// A polyhedral bottom can change slope inside the well, so inspect the clipped
/// facet vertices as well as the corners rather than just the center column.
fn floor_under_space(
    hull: &[cg::Cell],
    e: &ConstructionEquipment,
    space: &ConstructionEquipmentPartOccupancyItem,
    deck: f64,
    skin: f64,
) -> Option<f64> {
    let footprint = cg::transform(
        &cg::box_cell(
            [space.center[0], 0., space.center[2]],
            [space.size[0], 1., space.size[2]],
        ),
        [e.position[0], 0., e.position[2]],
        [1.; 3],
        -e.bearing_deg.to_radians(),
    );
    let sides: Vec<_> = footprint
        .faces
        .iter()
        .filter_map(|f| {
            let n = cg::normal(&f.vertices);
            (n[1].abs() < 1e-8).then(|| (n, dot(n, f.vertices[0])))
        })
        .collect();
    let mut points: Vec<_> = footprint
        .faces
        .iter()
        .flat_map(|f| f.vertices.iter().map(|v| [v[0], v[2]]))
        .collect();
    points.push([e.position[0], e.position[2]]);
    for face in hull.iter().flat_map(|c| c.faces.iter()) {
        if cg::normal(&face.vertices)[1] >= -1e-8 {
            continue;
        }
        let mut patch = face.vertices.clone();
        for &(normal, distance) in &sides {
            patch = cg::clip_polygon(&patch, normal, distance);
            if patch.len() < 3 {
                break;
            }
        }
        points.extend(patch.iter().map(|v| [v[0], v[2]]));
    }
    points.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    points.dedup_by(|a, b| (a[0] - b[0]).abs() < 1e-8 && (a[1] - b[1]).abs() < 1e-8);
    points
        .into_iter()
        .filter_map(|[x, z]| floor_below(hull, x, z, deck, skin))
        .max_by(f64::total_cmp)
}
/// Follow the connected vertical hull column down from the supporting deck.
fn floor_below(hull: &[cg::Cell], x: f64, z: f64, deck: f64, skin: f64) -> Option<f64> {
    let mut intervals = vec![];
    for cell in hull {
        let (mut low, mut high) = (f64::NEG_INFINITY, f64::INFINITY);
        let mut inner_low = f64::NEG_INFINITY;
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
                inner_low = inner_low.max((d - skin) / n[1]);
            }
        }
        if inside && low <= high {
            intervals.push((low, high, inner_low));
        }
    }
    let mut floor = deck;
    let mut found = false;
    loop {
        let before = floor;
        for &(low, high, _) in &intervals {
            if low <= floor + 1e-6 && high >= floor - 0.05 {
                floor = floor.min(low);
                found = true;
            }
        }
        if (floor - before).abs() < 1e-7 {
            break;
        }
    }
    if !found {
        return None;
    }
    // Offset only the terminal bottom planes. Insetting all convex cells before
    // following the column would introduce false gaps at decomposition seams.
    intervals
        .iter()
        .filter(|(low, high, _)| *low <= floor + 1e-7 && *high >= floor - 1e-7)
        .map(|(_, _, inner_low)| *inner_low)
        .min_by(f64::total_cmp)
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
                paint: e.gun.as_ref().and_then(|g| g.barbette_paint.as_deref()).unwrap_or("naval-gray").into(),
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
