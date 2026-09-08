use crate::{
    definition::{ShipDefinition, Vec3},
    geometry::*,
    protection::{PlateHit, segment_plate},
};
pub const EXTERIOR_PLATING_REPLACEMENT_M: f64 = 1.5;
#[derive(Clone, Debug)]
pub struct StructuralSurface {
    pub id: String,
    pub name: String,
    pub thickness_mm: f64,
    pub hull: bool,
    pub vertices: Vec<Vec3>,
    pub triangles: Vec<[usize; 3]>,
    center: Vec3,
    size: Vec3,
    chunks: Vec<Chunk>,
}
#[derive(Clone, Debug)]
struct Chunk {
    center: Vec3,
    size: Vec3,
    first: usize,
    end: usize,
}
pub fn bounds(points: impl Iterator<Item = Vec3>) -> (Vec3, Vec3) {
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for p in points {
        for i in 0..3 {
            low[i] = low[i].min(p[i]);
            high[i] = high[i].max(p[i]);
        }
    }
    (
        std::array::from_fn(|i| (low[i] + high[i]) / 2.0),
        std::array::from_fn(|i| (high[i] - low[i]).max(0.00001)),
    )
}
fn cap(points: &[[f64; 2]]) -> Result<Vec<[usize; 3]>, String> {
    let cross = |a: usize, b: usize, c: usize| {
        (points[b][0] - points[a][0]) * (points[c][1] - points[a][1])
            - (points[b][1] - points[a][1]) * (points[c][0] - points[a][0])
    };
    let area: f64 = points
        .iter()
        .enumerate()
        .map(|(i, p)| {
            p[0] * points[(i + 1) % points.len()][1] - p[1] * points[(i + 1) % points.len()][0]
        })
        .sum();
    let mut ids: Vec<_> = (0..points.len()).collect();
    if area < 0.0 {
        ids.reverse();
    }
    let mut result = vec![];
    while ids.len() > 2 {
        let mut found = false;
        for i in 0..ids.len() {
            let (a, b, c) = (
                ids[(i + ids.len() - 1) % ids.len()],
                ids[i],
                ids[(i + 1) % ids.len()],
            );
            if cross(a, b, c).abs() < 1e-9 {
                ids.remove(i);
                found = true;
                break;
            }
            if cross(a, b, c) < 0.0
                || ids.iter().any(|&p| {
                    p != a
                        && p != b
                        && p != c
                        && cross(a, b, p) >= -1e-9
                        && cross(b, c, p) >= -1e-9
                        && cross(c, a, p) >= -1e-9
                })
            {
                continue;
            }
            result.push([a, b, c]);
            ids.remove(i);
            found = true;
            break;
        }
        if !found {
            return Err("structural footprint cannot be triangulated".into());
        }
    }
    Ok(result)
}
impl StructuralSurface {
    fn new(
        id: String,
        name: String,
        vertices: Vec<Vec3>,
        triangles: Vec<[usize; 3]>,
        thickness_mm: f64,
        hull: bool,
    ) -> Self {
        let triangles: Vec<_> = triangles
            .into_iter()
            .filter(|ids| {
                length(cross(
                    sub(vertices[ids[1]], vertices[ids[0]]),
                    sub(vertices[ids[2]], vertices[ids[0]]),
                )) > 1e-9
            })
            .collect();
        let chunks = (0..triangles.len())
            .step_by(96)
            .map(|first| {
                let end = (first + 96).min(triangles.len());
                let (center, size) = bounds(
                    triangles[first..end]
                        .iter()
                        .flat_map(|t| t.map(|i| vertices[i])),
                );
                Chunk {
                    center,
                    size,
                    first,
                    end,
                }
            })
            .collect();
        let (center, size) = bounds(vertices.iter().copied());
        Self {
            id,
            name,
            vertices,
            triangles,
            thickness_mm,
            hull,
            chunks,
            center,
            size,
        }
    }
}
pub fn structural_surfaces(def: &ShipDefinition) -> Result<Vec<StructuralSurface>, String> {
    let Some(plating) = &def.structural_plating else {
        return Ok(vec![]);
    };
    let sections = def
        .hull
        .sections
        .as_ref()
        .ok_or("structural plating requires sections")?;
    let first = sections.first().ok_or("empty hull sections")?;
    let n = first.points.len() * 2 - 1;
    if sections
        .iter()
        .any(|s| s.points.len() != first.points.len())
    {
        return Err("structural sections require matching point counts".into());
    }
    let vertices: Vec<Vec3> = sections
        .iter()
        .flat_map(|s| {
            s.points
                .iter()
                .copied()
                .chain(s.points.iter().skip(1).rev().map(|p| [-p[0], p[1]]))
                .map(|p| [-p[0], p[1], def.hull.length / 2.0 - s.station])
        })
        .collect();
    let mut triangles = vec![];
    for s in 0..sections.len() - 1 {
        for j in 0..n {
            let (a, b, c, d) = (
                s * n + j,
                s * n + (j + 1) % n,
                (s + 1) * n + (j + 1) % n,
                (s + 1) * n + j,
            );
            let halves = if j >= first.points.len() {
                [[a, b, d], [b, c, d]]
            } else {
                [[a, b, c], [a, c, d]]
            };
            for ids in halves {
                if ids.iter().any(|&i| vertices[i][0].abs() > 1e-7) {
                    triangles.push(ids);
                }
            }
        }
    }
    for section in [0, sections.len() - 1] {
        let offset = section * n;
        let points: Vec<_> = vertices[offset..offset + n]
            .iter()
            .map(|v| [v[0], v[1]])
            .collect();
        for [a, b, c] in cap(&points)? {
            triangles.push(if section == 0 {
                [offset + a, offset + b, offset + c]
            } else {
                [offset + c, offset + b, offset + a]
            });
        }
    }
    let mut result = vec![StructuralSurface::new(
        "hull".into(),
        "Hull shell · bow to stern".into(),
        vertices,
        triangles,
        plating.hull_mm,
        true,
    )];
    for s in def.structures.iter().flatten() {
        if let Some(surface) = &s.surface {
            result.push(StructuralSurface::new(
                s.id.clone(),
                s.name.clone(),
                surface.vertices.clone(),
                surface
                    .triangles
                    .iter()
                    .map(|t| t.map(|i| i as usize))
                    .collect(),
                plating.superstructure_mm,
                false,
            ));
            continue;
        }
        let n = s.footprint.len();
        let vertices = [s.base_y, s.base_y + s.height]
            .into_iter()
            .flat_map(|y| s.footprint.iter().map(move |p| [p[0], y, p[1]]))
            .collect();
        let mut triangles = vec![];
        for i in 0..n {
            let j = (i + 1) % n;
            triangles.extend([[i, j, n + j], [i, n + j, n + i]]);
        }
        for [a, b, c] in cap(&s.footprint)? {
            triangles.extend([[a, b, c], [n + a, n + c, n + b]]);
        }
        result.push(StructuralSurface::new(
            s.id.clone(),
            s.name.clone(),
            vertices,
            triangles,
            plating.superstructure_mm,
            false,
        ));
    }
    Ok(result)
}
#[derive(Clone, Debug)]
pub struct StructuralHit<'a> {
    pub hit: PlateHit,
    pub surface: &'a StructuralSurface,
    pub triangle: usize,
}
pub fn structural_hits(
    from: Vec3,
    to: Vec3,
    surfaces: &[StructuralSurface],
) -> Vec<StructuralHit<'_>> {
    let mut hits = vec![];
    for surface in surfaces {
        if segment_box(from, to, surface.center, surface.size).is_none() {
            continue;
        }
        for chunk in &surface.chunks {
            if segment_box(from, to, chunk.center, chunk.size).is_none() {
                continue;
            }
            for i in chunk.first..chunk.end {
                if let Some(hit) =
                    segment_plate(from, to, &surface.triangles[i].map(|j| surface.vertices[j]))
                {
                    hits.push(StructuralHit {
                        hit,
                        surface,
                        triangle: i,
                    });
                }
            }
        }
    }
    hits.sort_by(|a, b| {
        a.hit
            .t
            .total_cmp(&b.hit.t)
            .then_with(|| a.surface.id.cmp(&b.surface.id))
            .then_with(|| a.triangle.cmp(&b.triangle))
    });
    hits
}
