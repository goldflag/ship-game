//! Closed, scalable wall details and persisted bilateral editor relationships.
use crate::{construction_geometry as cg, definition::*, geometry::*};

pub(crate) fn installed(e: &ConstructionEquipment, part: &ConstructionEquipmentPart, source: &ConstructionData, surfaces: &[ConstructionSurface]) -> Result<ConstructionEquipmentPart, ConstructionDiagnostic> {
    let mut p = part.clone();
    let Some(w) = &e.wall else { return Ok(p); };
    let error = |message: &str| ConstructionDiagnostic { severity: "error".into(), code: "wall-fitting".into(), message: message.into(), source_id: Some(e.id.clone()) };
    let socket = p.sockets.as_ref().and_then(|s| s.iter().find(|s| s.id == "attachment"));
    if !(matches!(p.wall_mount.as_deref(), Some("door" | "porthole" | "window")) || p.id == "generic-watertight-door") || p.kind != "deck-fitting" || p.path.is_some() || socket.is_none_or(|s| s.direction[1].abs() > 1e-6 || s.direction[2] < 0.99999)
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
    for u in [-0.5, 0., 0.5] { for v in [-0.5, 0., 0.5] {
        let x = p.bounds_center[0]+p.size[0]*u;
        let y = p.bounds_center[1]+p.size[1]*v;
        let z = socket.position[2];
        let point = add(e.position, [x*r.cos()+z*r.sin(), y, -x*r.sin()+z*r.cos()]);
        if !surfaces.iter().any(|s| !s.open && dot(s.normal, normal) > 1.-1e-5
            && length(sub(cg::closest_point(&cg::prism(&s.vertices, 0.001), point), point)) <= 0.005) {
            return Err(error("Door or window needs a flat vertical wall behind its entire frame; move it away from edges or restore its supporting wall"));
        }
    } }
    Ok(p)
}
