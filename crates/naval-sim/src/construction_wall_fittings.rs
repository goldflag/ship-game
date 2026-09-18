//! Closed, scalable wall details and persisted bilateral editor relationships.
use crate::{construction_geometry as cg, definition::*, geometry::*};

pub(crate) fn installed(e: &ConstructionEquipment, part: &ConstructionEquipmentPart, source: &ConstructionData, surfaces: &[ConstructionSurface]) -> Result<ConstructionEquipmentPart, ConstructionDiagnostic> {
    let mut p = part.clone();
    let Some(w) = &e.wall else { return Ok(p); };
    let error = |message: &str| ConstructionDiagnostic { severity: "error".into(), code: "wall-fitting".into(), message: message.into(), source_id: Some(e.id.clone()) };
    let socket = p.sockets.as_ref().and_then(|s| s.iter().find(|s| s.id == "attachment"));
    if !(matches!(p.wall_mount.as_deref(), Some("door" | "porthole" | "window" | "vent")) || p.id == "generic-watertight-door") || p.kind != "deck-fitting" || p.path.is_some() || socket.is_none_or(|s| s.direction[1].abs() > 1e-6 || s.direction[2] < 0.99999)
        || w.version != 1 || !w.width_m.is_finite() || !w.height_m.is_finite()
        || !(0.15..=5.).contains(&w.width_m) || !(0.15..=5.).contains(&w.height_m) {
        return Err(error("Wall fittings require a wall-facing attachment and dimensions between 0.15 and 5 m"));
    }
    if p.wall_mount.as_deref() == Some("porthole") && (w.width_m - w.height_m).abs() > 1e-6 {
        return Err(error("Round portholes require equal width and height"));
    }
    if let Some(id) = &w.mirror_id {
        let twin = source.equipment.iter().find(|t| &t.id == id && t.id != e.id);
        if twin.is_none_or(|t| t.part_id != e.part_id || t.paint != e.paint || length(sub(t.position, [-e.position[0], e.position[1], e.position[2]])) > 1e-6
            || (t.bearing_deg + e.bearing_deg).to_radians().sin().abs() > 1e-6 || (t.bearing_deg + e.bearing_deg).to_radians().cos() < 0.999999
            || t.wall.as_ref().is_none_or(|tw| tw.mirror_id.as_deref() != Some(e.id.as_str()) || (tw.width_m-w.width_m).abs()>1e-6 || (tw.height_m-w.height_m).abs()>1e-6)) {
            return Err(error("Linked wall fittings must be a matching mirrored pair"));
        }
    }
    let scale = [w.width_m / p.size[0], w.height_m / p.size[1], 1.];
    let scaled = |v: Vec3| [v[0]*scale[0], v[1]*scale[1], v[2]];
    p.size = scaled(p.size); p.bounds_center = scaled(p.bounds_center); p.center_of_gravity = scaled(p.center_of_gravity);
    p.mass_kg = p.mass_kg.map(|m| m*scale[0]*scale[1]);
    if let Some(sockets) = &mut p.sockets { for s in sockets { s.position = scaled(s.position); } }
    if let Some(boxes) = &mut p.fitting { for b in boxes { b.center = scaled(b.center); b.size = scaled(b.size); } }
    let socket = p.sockets.as_ref().unwrap().iter().find(|s| s.id == "attachment").unwrap();
    let r = -e.bearing_deg.to_radians();
    let normal = [e.bearing_deg.to_radians().sin(), 0., -e.bearing_deg.to_radians().cos()];

    let attachment = add(e.position, [socket.position[0]*r.cos()+socket.position[2]*r.sin(),socket.position[1],-socket.position[0]*r.sin()+socket.position[2]*r.cos()]);
    if project(surfaces, attachment, normal, 0.005).is_none() { return Err(error("Door or window must touch a closed hull side or wall")); }
    for u in [-0.5, 0., 0.5] { for v in [-0.5, 0., 0.5] {
        let x = p.bounds_center[0]+p.size[0]*u;
        let y = p.bounds_center[1]+p.size[1]*v;
        let z = socket.position[2];
        let point = add(e.position, [x*r.cos()+z*r.sin(), y, -x*r.sin()+z*r.cos()]);
        let Some(projected) = project(surfaces, point, normal, (p.size[0].max(p.size[1])*0.75).max(0.15)) else {
            return Err(error("Door or window extends beyond its supporting hull side; move it away from the edge or reduce its size"));
        };
        if w.mirror_id.is_some() && project(surfaces, [-projected[0],projected[1],projected[2]],[-normal[0],normal[1],normal[2]],0.005).is_none() { return Err(error("Mirrored fittings need matching hull geometry on both sides")); }
    } }
    Ok(p)
}

/// Parallel projection onto the nearest closed side panel, shared with ladders.
pub(crate) fn project(surfaces: &[ConstructionSurface], point: Vec3, normal: Vec3, depth: f64) -> Option<Vec3> {
    surfaces.iter().filter(|s| !s.open && s.normal[1].abs() < 0.9 && dot(s.normal, normal) > 0.35).filter_map(|s| {
        let distance = dot(sub(s.vertices[0], point), s.normal) / dot(normal, s.normal);
        let projected = add(point, normal.map(|v| v * distance));
        (distance.abs() <= depth + 1e-6 && length(sub(cg::closest_point(&cg::prism(&s.vertices, 0.001), projected), projected)) <= 1e-5).then_some((distance.abs(),projected))
    }).min_by(|a,b| a.0.total_cmp(&b.0)).map(|x| x.1)
}
