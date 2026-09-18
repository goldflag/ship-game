//! Original, normalized construction blocks. Shared by native compilation and
//! the WASM-exported display library; there is no second browser shape recipe.
use crate::{construction_geometry as cg, definition::*, geometry::*};
use std::{collections::BTreeMap, f64::consts::PI, sync::OnceLock};

pub const KINDS: &[&str] = &[
    "box",
    "wedge",
    "corner",
    "inverse-corner",
    "ballast",
    "pyramid",
    "cylinder",
    "half-cylinder",
    "quarter-cylinder",
    "quarter-cylinder-wall",
    "sphere",
    "hemisphere",
    "half-hemisphere",
    "quarter-hemisphere",
    "prism",
    "sphere-octant",
    "hemisphere-shell",
    "half-hemisphere-shell",
    "quarter-hemisphere-shell",
    "parabolic-shell",
    "cone",
    "hollow-cube",
    "concave-corner",
    "bridge",
    "diagonal-bridge",
    "rounded-bridge",
    "bridge-panel",
    "diagonal-bridge-panel",
    "rounded-bridge-panel",
    "breakwater",
];
const SEGMENTS: usize = 16;

fn cell(polygons: Vec<Vec<Vec3>>) -> cg::Cell {
    let points: Vec<_> = polygons.iter().flatten().copied().collect();
    let center = scale(
        points.iter().copied().fold([0.; 3], add),
        1. / points.len() as f64,
    );
    cg::Cell {
        faces: polygons
            .into_iter()
            .filter_map(|mut vertices| {
                cg::clean(&mut vertices);
                if vertices.len() < 3 || cg::area(&vertices) < cg::EPS {
                    return None;
                }
                if dot(cg::normal(&vertices), sub(vertices[0], center)) < 0. {
                    vertices.reverse();
                }
                Some(ConvexVolumeFacesItem { vertices })
            })
            .collect(),
    }
}

fn extrusion(profile: &[[f64; 2]], bottom: f64, top: f64) -> cg::Cell {
    let low: Vec<Vec3> = profile.iter().map(|p| [p[0], bottom, p[1]]).collect();
    let high: Vec<Vec3> = profile.iter().map(|p| [p[0], top, p[1]]).collect();
    let mut faces = vec![low.clone(), high.clone()];
    for i in 0..low.len() {
        let j = (i + 1) % low.len();
        faces.push(vec![low[i], low[j], high[j], high[i]]);
    }
    cell(faces)
}

/// A convex angular patch between two corresponding rings (or two poles).
fn patch(outer: &[Vec3], inner: &[Vec3]) -> cg::Cell {
    let mut faces = vec![outer.to_vec(), inner.to_vec()];
    for i in 0..outer.len() {
        let j = (i + 1) % outer.len();
        faces.push(vec![outer[i], outer[j], inner[j], inner[i]]);
    }
    cell(faces)
}

fn circle(start: f64, end: f64, radius: f64) -> Vec<[f64; 2]> {
    let count = ((end - start) / (2. * PI) * SEGMENTS as f64).round() as usize;
    (0..=count)
        .map(|i| {
            let a = start + (end - start) * i as f64 / count as f64;
            [radius * a.sin(), -radius * a.cos()]
        })
        .collect()
}

fn cylinder(angle: f64) -> cg::Cell {
    let mut profile = circle(0., angle, 0.5);
    if angle < 2. * PI - cg::EPS {
        profile.push([0., 0.]);
    } else {
        profile.pop();
    }
    extrusion(&profile, -0.5, 0.5)
}

fn sphere(hemisphere: bool, parabolic: bool) -> cg::Cell {
    let bands = if hemisphere { 4 } else { 8 };
    let max = if hemisphere { PI / 2. } else { PI };
    let point = |latitude: usize, longitude: usize| {
        let a = max * latitude as f64 / bands as f64;
        let b = 2. * PI * longitude as f64 / SEGMENTS as f64;
        let r = a.sin() * 0.5;
        let y = if parabolic {
            0.5 - a.sin().powi(2)
        } else if hemisphere {
            a.cos() - 0.5
        } else {
            0.5 * a.cos()
        };
        [r * b.sin(), y, -r * b.cos()]
    };
    let mut faces = vec![];
    for y in 0..bands {
        for x in 0..SEGMENTS {
            faces.push(vec![
                point(y, x),
                point(y + 1, x),
                point(y + 1, x + 1),
                point(y, x + 1),
            ]);
        }
    }
    if hemisphere {
        faces.push((0..SEGMENTS).map(|x| point(bands, x)).collect());
    }
    cell(faces)
}

fn dome_shell(angle: f64, parabolic: bool) -> Vec<cg::Cell> {
    let dome = sphere(true, parabolic);
    let count = (angle / (2. * PI) * SEGMENTS as f64).round() as usize;
    dome.faces[..SEGMENTS * 4]
        .iter()
        .enumerate()
        .filter(|(i, _)| i % SEGMENTS < count)
        .map(|(_, face)| {
            let inner: Vec<_> = face
                .vertices
                .iter()
                .map(|p| [p[0] * 0.88, (p[1] + 0.5) * 0.88 - 0.5, p[2] * 0.88])
                .collect();
            patch(&face.vertices, &inner)
        })
        .collect()
}

fn ring(angle: f64, square: bool) -> Vec<cg::Cell> {
    let points = circle(0., angle, 0.5);
    points
        .windows(2)
        .map(|p| {
            let outside = |p: [f64; 2]| {
                if square {
                    let k = 0.5 / p[0].abs().max(p[1].abs());
                    [p[0] * k, p[1] * k]
                } else {
                    p
                }
            };
            let inner = if square { 0.8 } else { 0.88 };
            extrusion(
                &[
                    outside(p[0]),
                    outside(p[1]),
                    [p[1][0] * inner, p[1][1] * inner],
                    [p[0][0] * inner, p[0][1] * inner],
                ],
                -0.5,
                0.5,
            )
        })
        .collect()
}

fn wall(a: [f64; 2], b: [f64; 2], bottom: f64, top: f64, thickness: f64) -> cg::Cell {
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    let length = dx.hypot(dz);
    let n = [
        -dz / length * thickness * 0.5,
        dx / length * thickness * 0.5,
    ];
    extrusion(
        &[
            [a[0] + n[0], a[1] + n[1]],
            [b[0] + n[0], b[1] + n[1]],
            [b[0] - n[0], b[1] - n[1]],
            [a[0] - n[0], a[1] - n[1]],
        ],
        bottom,
        top,
    )
}

fn window_wall(a: [f64; 2], b: [f64; 2], panes: usize, curved: bool, out: &mut Vec<cg::Cell>) {
    let band = |bottom, top, thickness| {
        if curved {
            // Shared radial ends meet exactly across arc segments. Butt-ended
            // rectangular strips leave visible V-notches at each curved joint.
            let radius = a[0].hypot(a[1]);
            let outer = 1. + thickness / (2. * radius);
            let inner = 1. - thickness / (2. * radius);
            extrusion(
                &[
                    [a[0] * outer, a[1] * outer],
                    [b[0] * outer, b[1] * outer],
                    [b[0] * inner, b[1] * inner],
                    [a[0] * inner, a[1] * inner],
                ],
                bottom,
                top,
            )
        } else {
            wall(a, b, bottom, top, thickness)
        }
    };
    out.push(band(-0.5, -0.08, 0.055));
    out.push(band(0.36, 0.5, 0.065));
    // Each pane has physical mullions, supported by the sill and roof rail.
    for i in 0..=panes {
        let t = i as f64 / panes as f64;
        let p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        out.push(cg::box_cell([p[0], 0.14, p[1]], [0.025, 0.44, 0.025]));
    }
}

fn bridge(kind: &str) -> Vec<cg::Cell> {
    let panel = kind.ends_with("panel");
    let rounded = kind.starts_with("rounded");
    let diagonal = kind.starts_with("diagonal");
    let profile = if rounded {
        let mut arc = circle(0., PI / 2., 0.465);
        arc.push([0., 0.]);
        arc
    } else if diagonal {
        vec![[-0.465, -0.465], [0.465, 0.465], [-0.465, 0.465]]
    } else {
        vec![
            [-0.465, -0.465],
            [0.465, -0.465],
            [0.465, 0.465],
            [-0.465, 0.465],
        ]
    };
    let mut out = vec![];
    if !panel {
        out.push(extrusion(&profile, -0.5, -0.44));
        out.push(extrusion(&profile, 0.44, 0.5));
    }
    let edges = if panel {
        if rounded { profile.len() - 2 } else { 1 }
    } else {
        profile.len()
    };
    for i in 0..edges {
        // Each curved segment is one pane. Straight walls retain three panes,
        // without crowding twelve narrow windows into a quarter-round bridge.
        let curved = rounded && i < profile.len() - 2;
        let panes = if curved { 1 } else { 3 };
        window_wall(
            profile[i],
            profile[(i + 1) % profile.len()],
            panes,
            curved,
            &mut out,
        );
    }
    out
}

fn recipe(kind: &str) -> Vec<cg::Cell> {
    let b = cg::box_cell([0.; 3], [1.; 3]);
    let mut out = match kind {
        "box" | "ballast" => vec![b],
        "wedge" => vec![cg::clip(&b, normalize([0., 1., 1.]), 0.).unwrap()],
        "corner" => vec![cg::clip(&b, normalize([1., 1., 1.]), -0.5 / 3_f64.sqrt()).unwrap()],
        "inverse-corner" => {
            vec![cg::clip(&b, normalize([1., 1., 1.]), 0.5 / 3_f64.sqrt()).unwrap()]
        }
        "pyramid" => {
            let mut c = b;
            for n in [[2., 1., 0.], [-2., 1., 0.], [0., 1., 2.], [0., 1., -2.]] {
                c = cg::clip(&c, normalize(n), 0.5 / 5_f64.sqrt()).unwrap();
            }
            vec![c]
        }
        "cylinder" => vec![cylinder(2. * PI)],
        "half-cylinder" => vec![cylinder(PI)],
        "quarter-cylinder" => vec![cylinder(PI / 2.)],
        "quarter-cylinder-wall" => ring(PI / 2., false),
        "sphere" => {
            // Leave face-budget headroom for actual placement cuts. A single
            // 128-face sphere gains a 129th face when seated against a wall.
            let c = sphere(false, false);
            vec![
                cg::clip(&c, [0., 1., 0.], 0.).unwrap(),
                cg::clip(&c, [0., -1., 0.], 0.).unwrap(),
            ]
        }
        "prism" => vec![extrusion(&circle(0., 2. * PI, 0.5).into_iter().step_by(2).take(8).collect::<Vec<_>>(), -0.5, 0.5)],
        "hemisphere" => vec![sphere(true, false)],
        "half-hemisphere" => vec![cg::clip(&sphere(true, false), [-1., 0., 0.], 0.).unwrap()],
        "quarter-hemisphere" => {
            let c = cg::clip(&sphere(true, false), [-1., 0., 0.], 0.).unwrap();
            vec![cg::clip(&c, [0., 0., 1.], 0.).unwrap()]
        },
        "sphere-octant" => {
            let c = cg::clip(&sphere(true, false), [-1., 0., 0.], 0.).unwrap();
            vec![cg::clip(&c, [0., 0., 1.], 0.).unwrap()]
        }
        "hemisphere-shell" => dome_shell(2. * PI, false),
        "half-hemisphere-shell" => dome_shell(PI, false),
        "quarter-hemisphere-shell" => dome_shell(PI / 2., false),
        "parabolic-shell" => dome_shell(2. * PI, true),
        "cone" => {
            let ring = circle(0., 2. * PI, 0.5);
            let low: Vec<Vec3> = ring[..SEGMENTS]
                .iter()
                .map(|p| [p[0], -0.5, p[1]])
                .collect();
            let mut faces = vec![low.clone()];
            for i in 0..SEGMENTS {
                faces.push(vec![low[i], low[(i + 1) % SEGMENTS], [0., 0.5, 0.]]);
            }
            vec![cell(faces)]
        }
        "hollow-cube" => ring(2. * PI, true),
        "concave-corner" => ring(PI / 2., true),
        "breakwater" => {
            let mut v = vec![
                wall([-0.49, 0.25], [0., -0.25], -0.5, 0.5, 0.02),
                wall([0., -0.25], [0.49, 0.25], -0.5, 0.5, 0.02),
            ];
            for x in [-0.4_f64, -0.2, 0.2, 0.4] {
                let z = x.abs() * 0.5 / 0.49 - 0.25;
                v.push(extrusion(
                    &[[x - 0.012, z], [x + 0.012, z], [x, 0.48]],
                    -0.5,
                    -0.42,
                ));
                let support = cell(vec![
                    vec![
                        [x - 0.008, -0.5, z],
                        [x - 0.008, 0.45, z],
                        [x - 0.008, -0.5, 0.48],
                    ],
                    vec![
                        [x + 0.008, -0.5, z],
                        [x + 0.008, 0.45, z],
                        [x + 0.008, -0.5, 0.48],
                    ],
                    vec![
                        [x - 0.008, -0.5, z],
                        [x + 0.008, -0.5, z],
                        [x + 0.008, 0.45, z],
                        [x - 0.008, 0.45, z],
                    ],
                    vec![
                        [x - 0.008, 0.45, z],
                        [x + 0.008, 0.45, z],
                        [x + 0.008, -0.5, 0.48],
                        [x - 0.008, -0.5, 0.48],
                    ],
                    vec![
                        [x - 0.008, -0.5, z],
                        [x + 0.008, -0.5, z],
                        [x + 0.008, -0.5, 0.48],
                        [x - 0.008, -0.5, 0.48],
                    ],
                ]);
                v.push(support);
            }
            v
        }
        _ => bridge(kind),
    };
    // Every datum is the center of its actual envelope, including partial curves
    // and thin panels. Size controls and face snapping use that same envelope.
    let (center, size) = crate::structure::bounds(
        out.iter()
            .flat_map(|c| c.faces.iter().flat_map(|f| f.vertices.iter().copied())),
    );
    for c in &mut out {
        for f in std::sync::Arc::make_mut(&mut c.faces) {
            for p in &mut f.vertices {
                *p = std::array::from_fn(|i| (p[i] - center[i]) / size[i]);
            }
        }
    }
    out
}

pub fn cells(kind: &str) -> Option<&'static Vec<cg::Cell>> {
    static LIBRARY: OnceLock<BTreeMap<&str, Vec<cg::Cell>>> = OnceLock::new();
    LIBRARY
        .get_or_init(|| KINDS.iter().map(|kind| (*kind, recipe(kind))).collect())
        .get(kind)
}

pub fn exterior(cells: &[cg::Cell]) -> Vec<cg::Polygon> {
    let mut out = vec![];
    for (i, c) in cells.iter().enumerate() {
        for f in c.faces.iter() {
            let mut patches = vec![f.vertices.clone()];
            for (j, other) in cells.iter().enumerate() {
                if i != j && !cg::separated(c, other) {
                    patches = patches
                        .iter()
                        .flat_map(|p| cg::exposed(p, other, i < j))
                        .collect();
                }
            }
            out.extend(patches);
        }
    }
    out
}

/// Build artifact for ghosts, thumbnails and invalid drafts, from these exact
/// native recipes. Production hulls still render the compiled union surfaces.
pub fn display_library() -> String {
    let shapes: BTreeMap<_, _> = KINDS
        .iter()
        .map(|kind| (*kind, exterior(cells(kind).unwrap())))
        .collect();
    serde_json::json!({"version":1,"shapes":shapes}).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn building_blocks_have_closed_convex_cells_and_exact_envelopes() {
        for kind in KINDS {
            let cells = cells(kind).unwrap();
            cg::check_budget(cells).unwrap();
            let (center, size) = crate::structure::bounds(
                cells
                    .iter()
                    .flat_map(|c| c.faces.iter().flat_map(|f| f.vertices.iter().copied())),
            );
            for axis in 0..3 {
                assert!(center[axis].abs() < 1e-8, "{kind} center");
                assert!((size[axis] - 1.).abs() < 1e-8, "{kind} size");
            }
            for c in cells {
                assert!(cg::total(std::slice::from_ref(c)).volume > 1e-10, "{kind} volume");
                for f in c.faces.iter() {
                    let n = cg::normal(&f.vertices);
                    for p in &f.vertices {
                        assert!(
                            dot(n, sub(*p, f.vertices[0])).abs() < 1e-7,
                            "{kind} nonplanar"
                        );
                    }
                    for p in c.faces.iter().flat_map(|f| &f.vertices) {
                        assert!(dot(n, sub(*p, f.vertices[0])) < 1e-7, "{kind} nonconvex");
                    }
                }
            }
        }
    }

    #[test]
    fn curved_cutouts_windows_and_shells_keep_their_empty_space() {
        let inside = |kind, p| cells(kind).unwrap().iter().any(|c| cg::contains(c, p));
        assert!(!inside("hollow-cube", [0., 0., 0.]));
        assert!(!inside("hemisphere-shell", [0., 0., 0.]));
        assert!(!inside("parabolic-shell", [0., 0., 0.]));
        assert!(!inside("bridge", [0., 0.15, -0.49]));
        assert!(inside("bridge", [0., -0.25, -0.49]));
        assert!(inside("hemisphere", [0., 0., 0.]));
        let pyramid = cg::total(cells("pyramid").unwrap());
        assert!((pyramid.volume - 1. / 3.).abs() < 1e-8);
    }

    #[test]
    fn rounded_bridge_windows_span_each_curved_segment() {
        for kind in ["rounded-bridge", "rounded-bridge-panel"] {
            let cells = bridge(kind);
            let inside = |p| cells.iter().any(|cell| cg::contains(cell, p));
            let arc = circle(0., PI / 2., 0.465);
            for segment in arc.windows(2) {
                for t in [1. / 3., 2. / 3.] {
                    let p = [
                        segment[0][0] * (1. - t) + segment[1][0] * t,
                        0.14,
                        segment[0][1] * (1. - t) + segment[1][1] * t,
                    ];
                    assert!(!inside(p), "{kind}: unnecessary post narrows a curved pane");
                }
            }
            for p in arc {
                assert!(
                    inside([p[0], 0.14, p[1]]),
                    "{kind}: missing supported corner post"
                );
                for (height, thickness) in [(-0.25, 0.055), (0.4, 0.065)] {
                    let outer = 1. + thickness * 0.49 / 0.465;
                    assert!(
                        inside([p[0] * outer, height, p[1] * outer]),
                        "{kind}: open notch in curved band"
                    );
                }
            }
        }
    }
}
