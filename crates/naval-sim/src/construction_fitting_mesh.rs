//! Visual meshes of design-local fittings (`meshes` on a version 2 definition): the bounded
//! `deflate-q16-u16-v1` decoder, the conservative collision boxes and the budgets. A mesh is
//! visual plus mass only; like every custom fitting it never joins the hull union and has no
//! armor, buoyancy, room, flooding, module, obstruction or hit geometry.
//! `src/ships/constructionFittingMesh.ts` mirrors the decoder and the boxes exactly.
use crate::{definition::*, geometry::*};
use base64::Engine;
use std::io::Read;

pub const ENCODING: &str = "deflate-q16-u16-v1";
/// Meshes per definition.
pub const MAX_MESHES: usize = 16;
/// Quantized vertices per mesh: u16 indices.
pub const MAX_MESH_VERTICES: usize = 65_535;
pub const MAX_MESH_TRIANGLES: usize = 20_000;
/// Painted triangle runs per mesh.
pub const MAX_MESH_GROUPS: usize = 64;
/// Mesh triangles summed over a design's definitions, each definition counted once.
pub const MAX_DESIGN_MESH_TRIANGLES: usize = 100_000;
/// Base64 `data` bytes summed over a design's meshes.
pub const MAX_DESIGN_MESH_BYTES: usize = 1 << 20;
/// Instances × definition triangles (meshes, solid faces and tubes) over a design's custom fittings.
pub const MAX_DESIGN_RENDERED_TRIANGLES: usize = 1_000_000;
/// A mesh contributes at most 2^SPLIT_DEPTH collision boxes before the per-part merge.
const SPLIT_DEPTH: usize = 3;
/// Flat meshes (a plate, a screen) still get boxes with some thickness.
pub const MIN_BOX_M: f64 = 0.02;

pub struct Decoded {
    pub points: Vec<Vec3>,
    pub triangles: Vec<[usize; 3]>,
}
impl Decoded {
    /// Summed area and the area-weighted centroid numerator, in triangle order.
    pub fn area_moments(&self) -> (f64, Vec3) {
        let (mut area, mut first) = (0., [0.; 3]);
        for t in &self.triangles {
            let [a, b, c] = t.map(|i| self.points[i]);
            let n = cross(sub(b, a), sub(c, a));
            let piece = dot(n, n).sqrt() / 2.;
            area += piece;
            for k in 0..3 {
                first[k] += piece * (a[k] + b[k] + c[k]) / 3.;
            }
        }
        (area, first)
    }
}

fn count(n: f64, max: usize) -> Option<usize> {
    (n.is_finite() && n.fract() == 0. && n >= 1. && n <= max as f64).then_some(n as usize)
}

/// One mesh, validated and dequantized, or the fault naming it. Bounded before any allocation
/// that depends on the payload, even for adversarial compressed data.
pub fn decode(m: &ConstructionFittingMesh, local_m: f64) -> Result<Decoded, String> {
    let id = &m.id;
    if m.encoding != ENCODING {
        return Err(format!(
            "mesh {id} uses the encoding \"{}\"; this build reads \"{ENCODING}\"",
            m.encoding
        ));
    }
    let Some(vertices) = count(m.vertices, MAX_MESH_VERTICES) else {
        return Err(format!(
            "mesh {id} needs 1–{MAX_MESH_VERTICES} vertices; it declares {}",
            m.vertices
        ));
    };
    let Some(triangles) = count(m.triangles, MAX_MESH_TRIANGLES) else {
        return Err(format!(
            "mesh {id} has {} triangles; a mesh holds 1–{MAX_MESH_TRIANGLES}",
            m.triangles
        ));
    };
    if m.data.len() > MAX_DESIGN_MESH_BYTES {
        return Err(format!(
            "mesh {id} carries {} encoded bytes; a design holds at most {MAX_DESIGN_MESH_BYTES}",
            m.data.len()
        ));
    }
    let (lo, hi) = (m.bounds.min, m.bounds.max);
    if (0..3).any(|k| {
        !lo[k].is_finite()
            || !hi[k].is_finite()
            || lo[k].abs() > local_m
            || hi[k].abs() > local_m
            || lo[k] > hi[k]
    }) {
        return Err(format!(
            "mesh {id} needs finite bounds with min ≤ max, within {local_m} m of the datum"
        ));
    }
    let groups = m.groups.as_deref().unwrap_or_default();
    if groups.len() > MAX_MESH_GROUPS {
        return Err(format!(
            "mesh {id} has {} groups; the limit is {MAX_MESH_GROUPS}",
            groups.len()
        ));
    }
    let mut next = 0.;
    for g in groups {
        let text_ok =
            |t: &Option<String>| t.as_ref().is_none_or(|t| !t.is_empty() && t.len() <= 64);
        if !(g.start.fract() == 0. && g.count.fract() == 0.)
            || g.start < next
            || g.count < 1.
            || g.start + g.count > triangles as f64
            || !text_ok(&g.name)
            || !text_ok(&g.paint)
        {
            return Err(format!(
                "mesh {id} needs groups of whole, ascending, non-overlapping triangle runs within its {triangles} triangles, with names and paints of 1–64 bytes"
            ));
        }
        next = g.start + g.count;
    }
    let invalid = || {
        format!(
            "mesh {id} has data that does not decode to {vertices} vertices and {triangles} triangles"
        )
    };
    let compressed = base64::engine::general_purpose::STANDARD
        .decode(&m.data)
        .map_err(|_| invalid())?;
    let expected = 6 * (vertices + triangles);
    let mut bytes = Vec::with_capacity(expected);
    flate2::read::ZlibDecoder::new(compressed.as_slice())
        .take(expected as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid())?;
    if bytes.len() != expected {
        return Err(invalid());
    }
    let word = |i: usize| u16::from_le_bytes([bytes[2 * i], bytes[2 * i + 1]]);
    let points = (0..vertices)
        .map(|v| std::array::from_fn(|k| lo[k] + (hi[k] - lo[k]) * word(3 * v + k) as f64 / 65535.))
        .collect();
    let mut out = Vec::with_capacity(triangles);
    for t in 0..triangles {
        let corner: [usize; 3] = std::array::from_fn(|k| word(3 * vertices + 3 * t + k) as usize);
        if corner.iter().any(|&i| i >= vertices) {
            return Err(format!(
                "mesh {id} triangle {t} names a vertex beyond its {vertices} vertices"
            ));
        }
        out.push(corner);
    }
    Ok(Decoded {
        points,
        triangles: out,
    })
}

fn extent(d: &Decoded, triangles: &[usize]) -> (Vec3, Vec3) {
    let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for &t in triangles {
        for i in d.triangles[t] {
            for k in 0..3 {
                lo[k] = lo[k].min(d.points[i][k]);
                hi[k] = hi[k].max(d.points[i][k]);
            }
        }
    }
    (lo, hi)
}

/// Up to eight conservative boxes: the triangles split three times at the middle of their
/// current extent's longest axis, by centroid. Each box is the full extent of its triangles,
/// at least `MIN_BOX_M` thick, so the boxes together cover the whole mesh.
pub fn boxes(d: &Decoded) -> Vec<ConstructionEquipmentPartFittingItem> {
    let mut groups = vec![(0..d.triangles.len()).collect::<Vec<_>>()];
    for _ in 0..SPLIT_DEPTH {
        let mut next = vec![];
        for group in groups {
            let (lo, hi) = extent(d, &group);
            let axis = (1..3).fold(0, |best, k| {
                if hi[k] - lo[k] > hi[best] - lo[best] {
                    k
                } else {
                    best
                }
            });
            let middle = (lo[axis] + hi[axis]) / 2.;
            let (below, above): (Vec<usize>, Vec<usize>) = group.iter().partition(|&&t| {
                let [a, b, c] = d.triangles[t].map(|i| d.points[i][axis]);
                (a + b + c) / 3. < middle
            });
            if below.is_empty() || above.is_empty() {
                next.push(group);
            } else {
                next.push(below);
                next.push(above);
            }
        }
        groups = next;
    }
    groups
        .iter()
        .map(|group| {
            let (lo, hi) = extent(d, group);
            ConstructionEquipmentPartFittingItem {
                center: std::array::from_fn(|k| (lo[k] + hi[k]) / 2.),
                size: std::array::from_fn(|k| (hi[k] - lo[k]).max(MIN_BOX_M)),
            }
        })
        .collect()
}

#[cfg(test)]
#[allow(clippy::needless_range_loop)]
pub(crate) mod tests {
    use super::*;
    use crate::construction::compile;
    use crate::construction_custom_fittings::{part, resolve};
    use std::io::Write;

    /// A deflated, base64 encoded payload: `points` quantized over `bounds`.
    pub fn encode(points: &[Vec3], triangles: &[[u16; 3]], bounds: (Vec3, Vec3)) -> String {
        let (lo, hi) = bounds;
        let mut raw = vec![];
        for p in points {
            for k in 0..3 {
                let span = hi[k] - lo[k];
                let q = if span > 0. {
                    ((p[k] - lo[k]) / span * 65535.).round().clamp(0., 65535.)
                } else {
                    0.
                };
                raw.extend_from_slice(&(q as u16).to_le_bytes());
            }
        }
        for t in triangles {
            for i in t {
                raw.extend_from_slice(&i.to_le_bytes());
            }
        }
        deflate(&raw)
    }
    fn deflate(raw: &[u8]) -> String {
        let mut z = flate2::write::ZlibEncoder::new(vec![], flate2::Compression::best());
        z.write_all(raw).unwrap();
        base64::engine::general_purpose::STANDARD.encode(z.finish().unwrap())
    }
    /// A triangle soup as one mesh record; every triangle keeps its own three vertices.
    pub fn mesh(id: &str, soup: &[[Vec3; 3]]) -> ConstructionFittingMesh {
        let points: Vec<Vec3> = soup.iter().flatten().copied().collect();
        let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for p in &points {
            for k in 0..3 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        let triangles: Vec<[u16; 3]> = (0..soup.len() as u16)
            .map(|t| [3 * t, 3 * t + 1, 3 * t + 2])
            .collect();
        ConstructionFittingMesh {
            id: id.into(),
            encoding: ENCODING.into(),
            data: encode(&points, &triangles, (lo, hi)),
            vertices: points.len() as f64,
            triangles: soup.len() as f64,
            bounds: ConstructionFittingMeshBounds { min: lo, max: hi },
            groups: None,
        }
    }
    fn quad(soup: &mut Vec<[Vec3; 3]>, a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
        soup.push([a, b, c]);
        soup.push([a, c, d]);
    }
    /// An open U-shaped deckhouse shell, 6 m wide, 8 m long and 2.5 m high, with a 2 m wide
    /// notch open to the bow (x −1…1, z −4…1): walls and roof in 1 m panels, no floor.
    pub fn u_deckhouse() -> Vec<[Vec3; 3]> {
        let outline: [[f64; 2]; 8] = [
            [-3., -4.],
            [-1., -4.],
            [-1., 1.],
            [1., 1.],
            [1., -4.],
            [3., -4.],
            [3., 4.],
            [-3., 4.],
        ];
        let mut soup = vec![];
        for i in 0..outline.len() {
            let (a, b) = (outline[i], outline[(i + 1) % outline.len()]);
            let n = ((b[0] - a[0]).abs() + (b[1] - a[1]).abs()).round() as usize;
            for s in 0..n {
                let at = |f: f64| [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
                let (p, q) = (at(s as f64 / n as f64), at((s + 1) as f64 / n as f64));
                quad(
                    &mut soup,
                    [p[0], 0., p[1]],
                    [q[0], 0., q[1]],
                    [q[0], 2.5, q[1]],
                    [p[0], 2.5, p[1]],
                );
            }
        }
        for (x0, x1, z0, z1) in [(-3, -1, -4, 1), (1, 3, -4, 1), (-3, 3, 1, 4)] {
            for x in x0..x1 {
                for z in z0..z1 {
                    let (x, z) = (x as f64, z as f64);
                    quad(
                        &mut soup,
                        [x, 2.5, z],
                        [x, 2.5, z + 1.],
                        [x + 1., 2.5, z + 1.],
                        [x + 1., 2.5, z],
                    );
                }
            }
        }
        soup
    }
    pub fn deckhouse() -> ConstructionFittingDefinition {
        ConstructionFittingDefinition {
            id: "fit-deckhouse".into(),
            name: "U deckhouse".into(),
            version: 2.,
            attach: "deck".into(),
            mass_kg: Some(12_000.),
            meshes: Some(vec![mesh("shell", &u_deckhouse())]),
            ..Default::default()
        }
    }
    fn fixture(
        fittings: Vec<ConstructionFittingDefinition>,
    ) -> (ConstructionSource, ConstructionCatalog) {
        (
            ConstructionSource {
                schema_version: 1.,
                id: "test-hull".into(),
                name: "Test hull".into(),
                coordinates: "meters-y-up-bow-negative-z".into(),
                revision: "one".into(),
                construction: ConstructionData {
                    version: 2.,
                    catalog_revision: "test".into(),
                    default_thickness_mm: 10.,
                    primitives: vec![ConstructionPrimitive {
                        id: "box".into(),
                        kind: "box".into(),
                        size: [10., 4., 30.],
                        ..Default::default()
                    }],
                    fittings: Some(fittings),
                    ..Default::default()
                },
            },
            ConstructionCatalog {
                schema_version: 1.,
                revision: "test".into(),
                weapons: PartCatalog {
                    schema_version: 1.,
                    ..Default::default()
                },
                ..Default::default()
            },
        )
    }
    fn instance(id: &str, part: &str, position: Vec3) -> ConstructionEquipment {
        ConstructionEquipment {
            id: id.into(),
            part_id: format!("design:{part}"),
            position,
            ..Default::default()
        }
    }
    fn inside(b: &ConstructionEquipmentPartFittingItem, p: Vec3) -> bool {
        (0..3).all(|k| (p[k] - b.center[k]).abs() <= b.size[k] / 2.)
    }

    #[test]
    fn a_non_convex_open_mesh_round_trips_and_its_boxes_leave_the_notch_empty() {
        let soup = u_deckhouse();
        let m = mesh("shell", &soup);
        let decoded = decode(&m, 100.).unwrap();
        assert_eq!(decoded.triangles.len(), soup.len());
        // 1 m panels on a 6 × 8 × 2.5 m envelope quantize to within a tenth of a millimetre.
        for (t, tri) in decoded.triangles.iter().zip(&soup) {
            for (i, p) in t.iter().zip(tri) {
                for k in 0..3 {
                    assert!((decoded.points[*i][k] - p[k]).abs() < 1e-4);
                }
            }
        }
        let resolved = part(&deckhouse()).unwrap();
        for (got, want) in resolved.size.iter().zip([6., 2.5, 8.]) {
            assert!((got - want).abs() < 1e-9, "{:?}", resolved.size);
        }
        assert_eq!(resolved.mass_kg, Some(12_000.));
        // The area centroid of walls and roof, symmetric about x = 0.
        let (area, first) = decoded.area_moments();
        assert!((area - (38. * 2.5 + 38.)).abs() < 1e-3, "{area}");
        for k in 0..3 {
            assert!((resolved.center_of_gravity[k] - first[k] / area).abs() < 1e-12);
        }
        assert!(resolved.center_of_gravity[0].abs() < 1e-9);
        let boxes = resolved.fitting.unwrap();
        assert!((2..=8).contains(&boxes.len()), "{}", boxes.len());
        // Conservative: every vertex lies in a box. Non-convex: the notch lies in none.
        for p in &decoded.points {
            assert!(boxes.iter().any(|b| inside(b, *p)), "{p:?}");
        }
        assert!(
            !boxes.iter().any(|b| inside(b, [0., 1.2, -2.5])),
            "{boxes:?}"
        );
        // An explicit centre of gravity wins, within the shape's bounds.
        let mut weighed = deckhouse();
        weighed.center_of_gravity = Some([0., 0.8, 1.]);
        assert_eq!(part(&weighed).unwrap().center_of_gravity, [0., 0.8, 1.]);
        weighed.center_of_gravity = Some([0., 9., 1.]);
        assert!(part(&weighed).unwrap_err().contains("outside"));
    }

    #[test]
    fn a_mesh_instance_adds_loading_only_and_nothing_a_shell_can_hit() {
        let (mut source, catalog) = fixture(vec![deckhouse()]);
        let bare = compile(&source, &catalog);
        assert!(bare.definition.is_some(), "{:?}", bare.diagnostics);
        let mut scaled = instance("house-2", "fit-deckhouse", [0., 2., 8.]);
        scaled.scale = Some([0.5, 1., 0.5]);
        source.construction.equipment =
            vec![instance("house-1", "fit-deckhouse", [0., 2., -6.]), scaled];
        let fitted = compile(&source, &catalog);
        assert!(fitted.definition.is_some(), "{:?}", fitted.diagnostics);
        let (before, after) = (bare.definition.unwrap(), fitted.definition.unwrap());
        // Hull, armor, rooms, modules, obstructions and clearance bodies are unchanged.
        fn value<T: serde::Serialize>(v: &T) -> serde_json::Value {
            serde_json::to_value(v).unwrap()
        }
        assert_eq!(value(&before.hull.volume), value(&after.hull.volume));
        assert_eq!(value(&before.modules), value(&after.modules));
        assert_eq!(value(&before.compartments), value(&after.compartments));
        assert_eq!(value(&before.obstructions), value(&after.obstructions));
        assert_eq!(value(&before.mounts), value(&after.mounts));
        assert_eq!(
            value(&before.mount_clearance),
            value(&after.mount_clearance)
        );
        assert_eq!(value(&bare.surfaces), value(&fitted.surfaces));
        let (light, heavy) = (bare.loading.unwrap(), fitted.loading.unwrap());
        // Full mass plus a quarter for the half-by-half scaled one.
        assert!((heavy.mass_kg - light.mass_kg - 15_000.).abs() < 1e-6);
    }

    #[test]
    fn broken_meshes_are_refused_and_name_the_mesh() {
        let base = deckhouse();
        let check = |edit: &dyn Fn(&mut ConstructionFittingDefinition), text: &str| {
            let mut def = base.clone();
            edit(&mut def);
            let fault = part(&def).unwrap_err();
            assert!(fault.contains(text), "{fault} lacks {text}");
        };
        fn mesh_of(d: &mut ConstructionFittingDefinition) -> &mut ConstructionFittingMesh {
            &mut d.meshes.as_mut().unwrap()[0]
        }
        check(&|d| d.version = 1., "need version 2");
        check(&|d| d.mass_kg = None, "massKg");
        check(
            &|d| mesh_of(d).encoding = "deflate-f32-u32-v1".into(),
            "mesh shell uses the encoding",
        );
        check(&|d| mesh_of(d).triangles -= 1., "does not decode");
        check(&|d| mesh_of(d).data = "!!".into(), "does not decode");
        check(&|d| mesh_of(d).vertices = 70_000., "vertices");
        check(&|d| mesh_of(d).bounds.max[1] = 200., "bounds");
        check(
            &|d| {
                mesh_of(d).groups = Some(vec![
                    ConstructionFittingMeshGroup {
                        start: 0.,
                        count: 10.,
                        ..Default::default()
                    },
                    ConstructionFittingMeshGroup {
                        start: 5.,
                        count: 10.,
                        ..Default::default()
                    },
                ])
            },
            "non-overlapping",
        );
        // A payload that inflates far past its declared size stops at the bound.
        check(
            &|d| mesh_of(d).data = deflate(&vec![0; 10_000_000]),
            "does not decode",
        );
        check(
            &|d| {
                let m = mesh_of(d);
                m.data = encode(
                    &[[0.; 3], [1., 0., 0.], [0., 1., 0.]],
                    &[[0, 1, 3]],
                    ([0.; 3], [1., 1., 0.]),
                );
                (m.vertices, m.triangles) = (3., 1.);
            },
            "names a vertex beyond",
        );
        // Lifted off its datum like any fitting.
        check(
            &|d| {
                mesh_of(d).bounds = ConstructionFittingMeshBounds {
                    min: [-3., 1., -4.],
                    max: [3., 3.5, 4.],
                }
            },
            "above its datum",
        );
        let mut def = base.clone();
        def.meshes = Some(vec![mesh("a", &u_deckhouse()), mesh("a", &u_deckhouse())]);
        assert!(
            part(&def)
                .unwrap_err()
                .contains("repeats the solid, tube or mesh ID a")
        );
    }

    /// `n` quads of a flat 0.1 m grid with shared vertices, or of random corners that barely compress.
    fn sheet(id: &str, n: usize, random: bool) -> ConstructionFittingMesh {
        if random {
            let mut seed = 7u64;
            let mut next = move || {
                seed = seed
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                (seed >> 33) as f64 / (1u64 << 31) as f64
            };
            let mut soup = vec![];
            for _ in 0..2 * n {
                soup.push(std::array::from_fn(|_| {
                    [next() * 9., next() * 3., next() * 9.]
                }));
            }
            return mesh(id, &soup);
        }
        let rows = n.div_ceil(100);
        let points: Vec<Vec3> = (0..=rows)
            .flat_map(|z| (0..=100).map(move |x| [x as f64 * 0.1, 0., z as f64 * 0.1]))
            .collect();
        let at = |x: usize, z: usize| (z * 101 + x) as u16;
        let triangles: Vec<[u16; 3]> = (0..n)
            .flat_map(|i| {
                let (x, z) = (i % 100, i / 100);
                [
                    [at(x, z), at(x + 1, z), at(x + 1, z + 1)],
                    [at(x, z), at(x + 1, z + 1), at(x, z + 1)],
                ]
            })
            .collect();
        let hi = [10., 0., rows as f64 * 0.1];
        ConstructionFittingMesh {
            id: id.into(),
            encoding: ENCODING.into(),
            data: encode(&points, &triangles, ([0.; 3], hi)),
            vertices: points.len() as f64,
            triangles: triangles.len() as f64,
            bounds: ConstructionFittingMeshBounds {
                min: [0.; 3],
                max: hi,
            },
            groups: None,
        }
    }
    fn heavy(id: &str, meshes: Vec<ConstructionFittingMesh>) -> ConstructionFittingDefinition {
        ConstructionFittingDefinition {
            id: id.into(),
            name: id.into(),
            version: 2.,
            attach: "deck".into(),
            mass_kg: Some(1000.),
            meshes: Some(meshes),
            ..Default::default()
        }
    }

    #[test]
    fn design_budgets_name_the_definition_that_crosses_them() {
        // Per mesh.
        let fault = part(&heavy("big", vec![sheet("m", 10_001, false)])).unwrap_err();
        assert!(fault.contains("20000"), "{fault}");
        // Unique triangles: six definitions of 18,000 cross 100,000 at the sixth.
        let many: Vec<_> = (0..6)
            .map(|i| heavy(&format!("fit-{i}"), vec![sheet("m", 9_000, false)]))
            .collect();
        let errors = resolve(&fixture(many.clone()).0.construction, 16).unwrap_err();
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_eq!(errors[0].source_id.as_deref(), Some("fit-5"));
        assert!(
            errors[0].message.contains("108000 visual mesh triangles"),
            "{}",
            errors[0].message
        );
        assert!(resolve(&fixture(many[..5].to_vec()).0.construction, 16).is_ok());
        // Encoded bytes: random vertices barely compress.
        let noisy: Vec<_> = (0..5)
            .map(|i| heavy(&format!("noise-{i}"), vec![sheet("m", 4_000, true)]))
            .collect();
        let bytes: usize = noisy
            .iter()
            .map(|d| d.meshes.as_ref().unwrap()[0].data.len())
            .sum();
        assert!(bytes > MAX_DESIGN_MESH_BYTES, "{bytes}");
        let errors = resolve(&fixture(noisy).0.construction, 16).unwrap_err();
        assert!(
            errors
                .iter()
                .any(|e| e.message.contains("encoded mesh bytes")),
            "{errors:?}"
        );
        // Drawn triangles: instances × the definition's triangles.
        let (mut source, _) = fixture(vec![heavy("fit-sheet", vec![sheet("m", 9_000, false)])]);
        source.construction.equipment = (0..55)
            .map(|i| instance(&format!("s{i}"), "fit-sheet", [0.; 3]))
            .collect();
        assert!(resolve(&source.construction, 16).is_ok());
        source
            .construction
            .equipment
            .push(instance("s55", "fit-sheet", [0.; 3]));
        let errors = resolve(&source.construction, 16).unwrap_err();
        assert_eq!(errors[0].source_id.as_deref(), Some("fit-sheet"));
        assert!(
            errors[0].message.contains("1008000 triangles"),
            "{}",
            errors[0].message
        );
        assert!(
            errors[0].message.contains("56 instances × 18000"),
            "{}",
            errors[0].message
        );
    }
}
