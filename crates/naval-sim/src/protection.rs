use crate::{
    definition::{Armor, ShipDefinition, Vec3},
    geometry::*,
};
#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlateHit {
    pub t: f64,
    pub point: Vec3,
    pub normal: Vec3,
    pub on_edge: bool,
}
pub fn segment_plate(from: Vec3, to: Vec3, vertices: &[Vec3]) -> Option<PlateHit> {
    if vertices.len() < 3 {
        return None;
    }
    let normal = normalize(cross(
        sub(vertices[1], vertices[0]),
        sub(vertices[2], vertices[0]),
    ));
    let delta = sub(to, from);
    let denominator = dot(normal, delta);
    if denominator.abs() < 1e-10 {
        return None;
    }
    let t = dot(normal, sub(vertices[0], from)) / denominator;
    if !(-1e-9..=1.0 + 1e-9).contains(&t) {
        return None;
    }
    let point = add(from, scale(delta, t.clamp(0.0, 1.0)));
    let mut on_edge = false;
    for i in 0..vertices.len() {
        let side = dot(
            cross(
                sub(vertices[(i + 1) % vertices.len()], vertices[i]),
                sub(point, vertices[i]),
            ),
            normal,
        );
        if side < -1e-7 {
            return None;
        }
        on_edge |= side.abs() < 1e-7;
    }
    Some(PlateHit {
        t: t.clamp(0.0, 1.0),
        point,
        normal,
        on_edge,
    })
}
pub fn same_plate_seam(a: &PlateHit, b: &PlateHit, joined: bool) -> bool {
    a.on_edge
        && b.on_edge
        && (joined || dot(a.normal, b.normal).abs() > 1.0 - 1e-8)
        && (0..3).all(|i| (a.point[i] - b.point[i]).abs() < 1e-6)
}
pub fn plate_hit(
    from: Vec3,
    to: Vec3,
    armor: &Armor,
    def: &ShipDefinition,
    trains: &[f64],
) -> Option<PlateHit> {
    let plate = armor.plate.as_ref()?;
    let index = plate
        .mount_id
        .as_ref()
        .and_then(|id| def.mounts.iter().position(|m| &m.id == id));
    if let Some(i) = index {
        let m = &def.mounts[i];
        let pose = Pose {
            x: m.position[0],
            y: m.position[1],
            z: m.position[2],
            heading: radians(m.bearing_deg) + trains[i],
            ..Pose::default()
        };
        let a = world_to_local(from, pose);
        let b = world_to_local(to, pose);
        if !segment_overlaps_box(a, b, armor.center, armor.size) {
            return None;
        }
        let hit = segment_plate(a, b, &plate.vertices)?;
        Some(PlateHit {
            point: local_to_world(hit.point, pose),
            normal: rotate(hit.normal, pose),
            ..hit
        })
    } else {
        if !segment_overlaps_box(from, to, armor.center, armor.size) {
            return None;
        }
        segment_plate(from, to, &plate.vertices)
    }
}
#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlateResponse {
    pub resistance_mm: f64,
    pub ricochet: bool,
}
pub fn plate_response(thickness: f64, material: &str, cosine: f64, caliber: f64) -> PlateResponse {
    if material == "teak" {
        return PlateResponse {
            resistance_mm: 0.0,
            ricochet: false,
        };
    }
    let ratio = if caliber > 0.0 {
        thickness / (caliber * 1000.0)
    } else {
        1.0
    };
    let cutoff = 0.02 + 0.18 * clamp((ratio - 0.05) / 0.15, 0.0, 1.0);
    let factor = match material {
        "KC" => 1.1,
        "Ww" => 0.9,
        _ => 1.0,
    };
    let floor = 0.1 - 0.06 * clamp((ratio - 0.1) / 0.1, 0.0, 1.0);
    PlateResponse {
        resistance_mm: factor * thickness / floor.max(cosine.abs()),
        ricochet: cosine.abs() < cutoff,
    }
}
