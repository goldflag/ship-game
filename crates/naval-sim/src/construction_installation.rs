//! Original gun installation support, kept inside its declared working space.
use crate::{construction_geometry as cg, definition::*, geometry::*};
const SIDES: usize = 64;
pub struct Installation {
    pub id: String,
    pub solids: Vec<cg::Cell>,
    pub surfaces: Vec<ConstructionSurface>,
    pub bore: cg::Cell,
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
        let spaces = part.occupancy.as_deref().unwrap_or_default();
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
        let collar = cg::subtract_all(vec![collar], std::slice::from_ref(&bore))?;
        let mut solids = collar.clone();
        let mut surfaces = vec![];
        let mut surface = |face: &str, vertices: Vec<Vec3>| {
            if cg::area(&vertices) <= 1e-10 {
                return;
            }
            surfaces.push(ConstructionSurface {
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
        });
    }
    Ok(result)
}
