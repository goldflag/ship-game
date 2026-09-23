//! Section-authored closed hulls. Source remains one primitive; only Rust derives solids.
use crate::{
    construction_geometry as cg, construction_vertex::VertexSolid, definition::*, geometry::*,
};

fn contour(points: &[ConstructionHullPoint], index: usize) -> f64 {
    points[index]
        .contour
        .unwrap_or(index as f64 * 8. / (points.len() - 1) as f64)
}
fn edge_id(start: f64, end: f64) -> String {
    if start.fract() == 0. && end == start + 1. {
        start.to_string()
    } else {
        format!("{start}~{end}")
    }
}
pub(super) fn transform(
    p: &ConstructionPrimitive,
    t: f64,
    point: &ConstructionHullPoint,
    position: f64,
) -> Vec3 {
    let h = p.custom_hull.as_ref().unwrap();
    let sign = if point.x > 0. {
        1.
    } else if point.x < 0. {
        -1.
    } else {
        0.
    };
    let x = point.x
        + (1. - (position - 2.).abs())
            .max(0.)
            .max((1. - (position - 6.).abs()).max(0.))
            * sign
            * h.bulb
            * 0.38
            * (-((t - 0.055) / 0.075).powi(2)).exp();
    let rake = h.rake * p.size[1] * 0.6 * (0.6 - point.y).max(0.) * (-t * 30.).exp();
    let bulb =
        h.bulb * p.size[1] * 0.7 * (-((point.y + 0.24) / 0.17).powi(2)).exp() * (-t * 35.).exp();
    let [x, y, z] = [
        x * p.size[0] / 2.,
        point.y * p.size[1],
        (t - 0.5) * p.size[2] + rake - bulb,
    ];
    crate::construction_orientation::point(p, [x, y, z])
}
fn mean(points: &[Vec3]) -> Vec3 {
    scale(
        points.iter().fold([0.; 3], |a, b| add(a, *b)),
        1. / points.len() as f64,
    )
}

fn validate_paint_bands(paint: &ConstructionHullPaintBands) -> Result<(), String> {
    if paint.version != 1. || paint.bands.len() > 8 {
        return Err("Use version 1 with at most 8 hull paint bands".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    let mut previous = f64::NEG_INFINITY;
    for band in &paint.bands {
        if band.id.is_empty() || band.id.len() > 64 || !ids.insert(&band.id) {
            return Err("Each hull paint band needs a unique ID".into());
        }
        if !band.upper_y.is_finite() || band.upper_y.abs() > 500. || band.upper_y <= previous {
            return Err("Keep paint heights in ascending order, between -500 and 500 m".into());
        }
        if band.paint.trim().is_empty() || band.paint.len() > 64 {
            return Err("Choose a paint for each hull band".into());
        }
        previous = band.upper_y;
    }
    Ok(())
}

type Boundary = (String, Vec<Vec3>, bool, String);
type Cut = (Vec<cg::Cell>, Vec<(String, Vec<Vec3>)>);

/// Tetrahedra from `center` to every boundary triangle, with the exterior triangles, or the label of the first
/// triangle that faces away from the centre: the span is not star-shaped about it.
fn star_cut<'a>(
    boundary: impl IntoIterator<Item = &'a Boundary>,
    center: Vec3,
) -> Result<Cut, String> {
    let mut pieces = vec![];
    let mut exterior_faces = vec![];
    for (name, f, exterior, label) in boundary {
        if cg::area(f) < 1e-10 {
            continue;
        }
        let det = dot(
            sub(f[0], center),
            cross(sub(f[1], center), sub(f[2], center)),
        );
        if det < -1e-7 {
            return Err(label.clone());
        }
        if *exterior {
            exterior_faces.push((name.clone(), f.clone()));
        }
        if det.abs() < 1e-10 {
            continue;
        }
        let [a, b, c] = [f[0], f[1], f[2]];
        pieces.push(cg::Cell {
            faces: vec![
                f.clone(),
                vec![center, b, a],
                vec![center, c, b],
                vec![center, a, c],
            ]
            .into_iter()
            .map(|vertices| ConvexVolumeFacesItem { vertices })
            .collect(),
        });
    }
    Ok((pieces, exterior_faces))
}

/// The fallback for a span that is not star-shaped about any one centre, such as a wine-glass bow section whose
/// flare, narrow waist and wider forefoot no single point sees. Mirrored outline points share a height, so the
/// horizontal chords between them cut every section into symmetric trapezoids. The span is split into slabs of
/// consecutive bands, each star-shaped about its own centre: one band per slab where that holds, more where a band is a
/// thin twisted sliver (a flat keel beside a shallow V) that only its neighbour can carry. Exterior side triangles are the star cut's own; only the end caps
/// are split by band. A side whose height reverses has no such cut, and `None` keeps the original rejection.
fn band_cut(
    a: &[Vec3],
    b: &[Vec3],
    outlines: [&[ConstructionHullPoint]; 2],
    boundary: &[Boundary],
    [bow, stern]: [bool; 2],
) -> Option<Cut> {
    let n = a.len();
    let keel = (n - 1) / 2;
    if outlines
        .iter()
        .any(|s| (0..keel).any(|j| s[j].y < s[j + 1].y))
    {
        return None;
    }
    let interior = |f: Vec<Vec3>| (String::new(), f, false, String::new());
    // The slab between mirrored pairs `top` and `bottom`, and its centre.
    let slab = |top: usize, bottom: usize| {
        let (top_m, low_m) = (n - 1 - top, n - 1 - bottom);
        // Port edges `top..bottom`, their starboard twins and, for the top slab, the deck: four boundary rows per edge.
        let mut members: Vec<Boundary> = (top..bottom)
            .chain(low_m..top_m)
            .chain((top == 0).then_some(n - 1))
            .flat_map(|edge| boundary[4 * edge..4 * edge + 2].iter().cloned())
            .collect();
        if top > 0 {
            members.push(interior(vec![a[top_m], a[top], b[top_m]]));
            members.push(interior(vec![a[top], b[top], b[top_m]]));
        }
        if bottom != keel {
            members.push(interior(vec![b[low_m], a[bottom], a[low_m]]));
            members.push(interior(vec![b[low_m], b[bottom], a[bottom]]));
        }
        for band in top..bottom {
            let (low, band_low_m, band_top_m) = (band + 1, n - 2 - band, n - 1 - band);
            let cap = [
                ("bow", vec![a[low], a[band], a[band_top_m]], bow),
                ("bow", vec![a[band_low_m], a[low], a[band_top_m]], bow),
                ("stern", vec![b[band], b[low], b[band_top_m]], stern),
                ("stern", vec![b[low], b[band_low_m], b[band_top_m]], stern),
            ];
            for (name, f, exterior) in cap {
                members.push((name.into(), f, exterior, String::new()));
            }
        }
        let corners: Vec<usize> = (top..=bottom)
            .chain(low_m.max(bottom + 1)..=top_m)
            .collect();
        let center = scale(
            add(
                mean(&corners.iter().map(|&i| a[i]).collect::<Vec<_>>()),
                mean(&corners.iter().map(|&i| b[i]).collect::<Vec<_>>()),
            ),
            0.5,
        );
        star_cut(&members, center)
    };
    // `last[j]`: the slab ending at pair `j` in a cut of everything above it, taking the shortest such slab.
    let mut last: Vec<Option<(usize, Cut)>> = (0..=keel).map(|_| None).collect();
    for bottom in 1..=keel {
        last[bottom] = (0..bottom)
            .rev()
            .filter(|&top| top == 0 || last[top].is_some())
            .find_map(|top| slab(top, bottom).ok().map(|cut| (top, cut)));
    }
    let mut slabs = vec![];
    let mut bottom = keel;
    while bottom > 0 {
        let (top, cut) = last[bottom].take()?;
        slabs.push(cut);
        bottom = top;
    }
    let mut pieces = vec![];
    let mut caps = vec![];
    for (slab_pieces, exterior) in slabs.into_iter().rev() {
        pieces.extend(slab_pieces);
        caps.extend(
            exterior
                .into_iter()
                .filter(|(name, _)| name == "bow" || name == "stern"),
        );
    }
    // Exterior sides keep the star cut's order; the banded caps follow.
    let sides = boundary
        .iter()
        .enumerate()
        .filter(|(i, (_, f, _, _))| i % 4 < 2 && cg::area(f) >= 1e-10)
        .map(|(_, (name, f, _, _))| (name.clone(), f.clone()));
    Some((pieces, sides.chain(caps).collect()))
}

/// Crease lines only split the side lighting, but each must name a port outline point between the deck edge and the
/// keel, in order, so every renderer and the editor agree on where the hull turns sharply.
fn validate_creases(creases: &[f64], outline: &[ConstructionHullPoint]) -> Result<(), String> {
    let keel = (outline.len() - 1) / 2;
    let mut previous = 0.;
    for &c in creases {
        if !c.is_finite()
            || c <= previous
            || c >= 4.
            || !(1..keel).any(|j| contour(outline, j) == c)
        {
            return Err("Put each hull crease on a port outline point between the deck edge and the keel, in order".into());
        }
        previous = c;
    }
    Ok(())
}

pub fn build(p: &ConstructionPrimitive) -> Result<VertexSolid, String> {
    let h = p
        .custom_hull
        .as_ref()
        .ok_or("Custom hull sections are missing")?;
    if h.version != 1.
        || !(4..=48).contains(&h.stations.len())
        || !h.rake.is_finite()
        || !(0.0..=1.5).contains(&h.rake)
        || !h.bulb.is_finite()
        || !(0.0..=1.0).contains(&h.bulb)
    {
        return Err("Custom hulls need version 1, 4–48 sections and valid bow settings".into());
    }
    if h.red_paint_y
        .is_some_and(|y| !y.is_finite() || y.abs() > 500.)
    {
        return Err("Red paint Y must be between -500 and 500 m".into());
    }
    if let Some(paint) = &h.paint_bands {
        validate_paint_bands(paint)?;
    }
    if let Some(k) = &h.bilge_keels {
        crate::construction_bilge_keels::validate(k)?;
    }
    let n = h.stations[0].points.len();
    if !(5..=33).contains(&n) || n % 2 != 1 || h.stations.iter().any(|s| s.points.len() != n) {
        return Err("Use the same odd number of outline points (5–33) in every section".into());
    }
    let keel = (n - 1) / 2;
    let mut ids = std::collections::BTreeSet::new();
    for (i, s) in h.stations.iter().enumerate() {
        if s.id.is_empty()
            || s.id.len() > 128
            || !ids.insert(&s.id)
            || !s.t.is_finite()
            || !(0.0..=1.0).contains(&s.t)
            || s.points
                .iter()
                .any(|p| !p.x.is_finite() || !p.y.is_finite())
        {
            return Err("Each hull section needs a unique ID, finite outline points and a position from bow to stern".into());
        }
        if (i == 0 && s.t != 0.)
            || (i == h.stations.len() - 1 && s.t != 1.)
            || (i > 0 && s.t - h.stations[i - 1].t < 0.005)
        {
            return Err("Hull end sections must stay at bow and stern; keep other sections ordered and at least 0.5% apart".into());
        }
        for j in 0..n {
            let t = contour(&s.points, j);
            if !t.is_finite()
                || !(0.0..=8.0).contains(&t)
                || (j == 0 && t != 0.)
                || (j == n - 1 && t != 8.)
                || (j > 0 && t - contour(&s.points, j - 1) < 1e-6)
                || (t + contour(&s.points, n - 1 - j) - 8.).abs() > 1e-10
                || t != contour(&h.stations[0].points, j)
            {
                return Err("Keep matching, ordered outline positions mirrored around the keel in every section".into());
            }
        }
        if s.points[keel].x.abs() > 1e-10
            || (0..keel).any(|j| {
                s.points[j].x > 1e-10
                    || (s.points[j].x + s.points[n - 1 - j].x).abs() > 1e-10
                    || (s.points[j].y - s.points[n - 1 - j].y).abs() > 1e-10
            })
            || s.points[0].y - s.points[keel].y < 0.06
        {
            return Err("Keep hull sections symmetric, on their own side of the centerline, with the deck above the keel".into());
        }
        let area: f64 = s
            .points
            .iter()
            .enumerate()
            .map(|(j, p)| p.x * s.points[(j + 1) % n].y - s.points[(j + 1) % n].x * p.y)
            .sum();
        if area < -1e-10 || (area < 1e-10 && i > 0 && i < h.stations.len() - 1) {
            return Err("Only a bow or stern section may taper to zero area".into());
        }
    }
    if let Some(creases) = &h.creases {
        validate_creases(creases, &h.stations[0].points)?;
    }
    let rings: Vec<Vec<Vec3>> = h
        .stations
        .iter()
        .map(|s| {
            s.points
                .iter()
                .enumerate()
                .map(|(i, v)| transform(p, s.t, v, contour(&s.points, i)))
                .collect()
        })
        .collect();
    if rings
        .iter()
        .flatten()
        .flatten()
        .any(|v| !v.is_finite() || v.abs() > 1000.)
    {
        return Err("Hull points must stay within 1000 m of the design origin".into());
    }
    let mut cells = vec![];
    let mut faces = vec![];
    for span in 0..rings.len() - 1 {
        let a = &rings[span];
        let b = &rings[span + 1];
        let ca = mean(a);
        let cb = mean(b);
        let center = scale(add(ca, cb), 0.5);
        // The fourth field names the piece the way an author sees it, so a rejection can say where it failed.
        let mut boundary: Vec<Boundary> = vec![];
        let span_label = format!(
            "\"{}\" and \"{}\"",
            h.stations[span].id,
            h.stations[span + 1].id
        );
        for edge in 0..n {
            let k = (edge + 1) % n;
            let start = contour(&h.stations[span].points, edge);
            let end = if edge == n - 1 {
                9.
            } else {
                contour(&h.stations[span].points, edge + 1)
            };
            let middle = (start + end) / 2.;
            let name = if start == 8. {
                "top"
            } else if middle < 3. {
                "port"
            } else if middle <= 5. {
                "bottom"
            } else {
                "starboard"
            };
            let edge_key = edge_id(start, end);
            let tag = format!(
                "{name}:{edge_key}@{}",
                serde_json::to_string(&[&h.stations[span].id, &h.stations[span + 1].id]).unwrap()
            );
            let label = format!("{name} edge {edge_key}");
            if (keel..n - 1).contains(&edge) {
                boundary.push((tag.clone(), vec![a[edge], a[k], b[k]], true, label.clone()));
                boundary.push((tag, vec![a[edge], b[k], b[edge]], true, label));
            } else {
                boundary.push((
                    tag.clone(),
                    vec![a[edge], a[k], b[edge]],
                    true,
                    label.clone(),
                ));
                boundary.push((tag, vec![a[k], b[k], b[edge]], true, label));
            }
            boundary.push((
                "bow".into(),
                vec![a[k], a[edge], ca],
                span == 0,
                format!("bow cap at point {edge}"),
            ));
            boundary.push((
                "stern".into(),
                vec![b[edge], b[k], cb],
                span == rings.len() - 2,
                format!("stern cap at point {edge}"),
            ));
        }
        let pieces = match star_cut(&boundary, center) {
            Ok((pieces, exterior)) => {
                faces.extend(exterior);
                pieces
            }
            Err(label) => {
                let Some((pieces, exterior)) = band_cut(
                    a,
                    b,
                    [&h.stations[span].points, &h.stations[span + 1].points],
                    &boundary,
                    [span == 0, span == rings.len() - 2],
                ) else {
                    return Err(format!(
                        "Hull folds through itself between sections {span_label} at the {label}. Reduce the twist there, move that outline point, or add a section near this transition.",
                    ));
                };
                faces.extend(exterior);
                pieces
            }
        };
        if cg::total(&pieces).volume < 1e-8 {
            return Err(format!(
                "The hull span between sections {span_label} has no enclosed volume. Only an end section may taper to zero width",
            ));
        }
        cells.extend(cg::coalesce_cells(pieces));
    }
    let index = cg::Broadphase::sized_for(&cells);
    for (i, cell) in cells.iter().enumerate() {
        for j in index.candidates(cell).into_iter().filter(|j| *j < i) {
            if cg::intersection(cell, &cells[j]).is_some_and(|c| cg::moments(&c).volume > 1e-7) {
                return Err(
                    "Hull sections overlap. Move the crossed sections or points apart".into(),
                );
            }
        }
    }
    Ok(VertexSolid { cells, faces })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hull(pointed: bool) -> ConstructionPrimitive {
        let mut p:ConstructionPrimitive=serde_json::from_value(serde_json::json!({"id":"hull","kind":"custom-hull","size":[10,4,20],"position":[0,0,0],"rotationDeg":0,"customHull":{"version":1,"rake":0,"bulb":0,"stations":[]}})).unwrap();
        for i in 0..4 {
            let t = i as f64 / 3.;
            let w = if pointed { t } else { 1. };
            p.custom_hull
                .as_mut()
                .unwrap()
                .stations
                .push(ConstructionHullStation {
                    id: format!("s{i}"),
                    t,
                    points: vec![
                        [-w, 0.5],
                        [-w, 0.25],
                        [-w, -0.25],
                        [-w, -0.5],
                        [0., -0.5],
                        [w, -0.5],
                        [w, -0.25],
                        [w, 0.25],
                        [w, 0.5],
                    ]
                    .into_iter()
                    .map(|v| ConstructionHullPoint {
                        x: v[0],
                        y: v[1],
                        contour: None,
                    })
                    .collect(),
                });
        }
        p
    }
    #[test]
    fn box_and_sharp_bow_displace_real_volume() {
        for (pointed, volume) in [(false, 800.), (true, 400.)] {
            let s = build(&hull(pointed)).unwrap();
            assert!((cg::total(&s.cells).volume - volume).abs() < 1e-7);
            assert!(s.faces.iter().all(|(_, p)| cg::area(p) > 0.));
        }
    }
    #[test]
    fn malformed_sections_are_rejected() {
        let mut p = hull(false);
        p.custom_hull.as_mut().unwrap().stations[1].t = 0.;
        assert!(build(&p).is_err());
        let mut p = hull(false);
        p.custom_hull.as_mut().unwrap().stations[1].points[0].x = 0.3;
        assert!(build(&p).is_err());
        let mut p = hull(false);
        p.custom_hull.as_mut().unwrap().stations[2].points[2].y = f64::NAN;
        assert!(build(&p).is_err());
    }
    #[test]
    fn variable_outlines_preserve_closed_volume_and_mirrored_panels() {
        for n in [5, 7, 11, 33] {
            let mut p = hull(false);
            for s in &mut p.custom_hull.as_mut().unwrap().stations {
                let half = (n - 1) / 2;
                s.points = (0..n)
                    .map(|i| {
                        if i == half {
                            return ConstructionHullPoint {
                                x: 0.,
                                y: -0.5,
                                contour: Some(4.),
                            };
                        }
                        let j = if i < half { i } else { n - 1 - i };
                        let t = j as f64 / (half - 1) as f64;
                        ConstructionHullPoint {
                            x: if i < half { -1. } else { 1. },
                            y: 0.5 - t,
                            contour: Some(if i < half { t * 3. } else { 8. - t * 3. }),
                        }
                    })
                    .collect();
            }
            let solid = build(&p).unwrap();
            let volume = cg::total(&solid.cells).volume;
            assert!(volume > 0. && volume <= 800. + 1e-7);
            assert!((volume - 800.).abs() < 1e-7);
            assert!(
                solid
                    .faces
                    .iter()
                    .any(|(name, _)| name.starts_with("top:8@"))
            );
            assert!(solid.faces.iter().all(|(_, face)| cg::area(face) > 0.));
            p.custom_hull.as_mut().unwrap().stations[1].points.pop();
            assert!(build(&p).is_err());
        }
    }
    /// A rejection has to say which span failed: "sections 2 and 3" sent an agent counting rows by hand.
    #[test]
    fn a_folded_span_names_its_sections_and_edge() {
        let mut p = hull(false);
        let stations = &mut p.custom_hull.as_mut().unwrap().stations;
        // A pinched waist alone now takes the band cut; a side that also climbs back up has no band cut.
        for (j, x) in [(1, -0.02), (7, 0.02)] {
            stations[2].points[j].x = x;
            stations[2].points[j].y = 0.6;
        }
        let message = build(&p).err().expect("the span should be rejected");
        assert!(message.contains("\"s1\" and \"s2\""), "{message}");
        assert!(message.contains("edge"), "{message}");
    }
    /// Wine-glass sections (flare over a narrow waist over a wider forefoot) are not star-shaped about any one
    /// centre. The band cut takes those spans and keeps the exact volume; star-shaped spans keep the star cut.
    #[test]
    fn wine_glass_spans_take_the_band_cut_with_exact_volume() {
        let half = [[-1., 0.5], [-0.1, 0.25], [-0.8, -0.25], [-0.8, -0.5]];
        let mut p = hull(false);
        for s in &mut p.custom_hull.as_mut().unwrap().stations {
            for (j, [x, y]) in half.into_iter().enumerate() {
                s.points[j].x = x;
                s.points[j].y = y;
                s.points[8 - j].x = -x;
                s.points[8 - j].y = y;
            }
        }
        let ring: Vec<Vec3> = p.custom_hull.as_ref().unwrap().stations[0]
            .points
            .iter()
            .map(|v| [v.x * 5., v.y * 4., 0.])
            .collect();
        let area: f64 = (0..9)
            .map(|j| ring[j][0] * ring[(j + 1) % 9][1] - ring[(j + 1) % 9][0] * ring[j][1])
            .sum::<f64>()
            .abs()
            / 2.;
        let solid = build(&p).unwrap();
        assert!((cg::total(&solid.cells).volume - area * 20.).abs() < 1e-7);
        assert!(solid.faces.iter().all(|(_, face)| cg::area(face) > 0.));
        // Two cap triangles per band and none for the flat keel band: the banded caps, not the nine-triangle fan.
        assert_eq!(
            solid.faces.iter().filter(|(name, _)| name == "bow").count(),
            6
        );
        // Banded end caps still close the hull: their area is the section area at each end.
        for end in ["bow", "stern"] {
            let cap: f64 = solid
                .faces
                .iter()
                .filter(|(name, _)| name == end)
                .map(|(_, f)| cg::area(f))
                .sum();
            assert!((cap - area).abs() < 1e-9, "{end} {cap} {area}");
        }
        // The same hull with the waist filled out is star-shaped, so it keeps one centre per span.
        let star = build(&hull(false)).unwrap();
        assert_eq!(
            star.faces.iter().filter(|(name, _)| name == "bow").count(),
            9
        );
    }
    /// A flat keel plate beside a shallow V makes the keel band a thin twisted sliver that is not star-shaped about its
    /// own centre; it is carried by one slab together with the band above it.
    #[test]
    fn a_sliver_keel_band_joins_the_band_above() {
        let flat = [
            [-2.7, 7.],
            [-1.6, 4.8],
            [-0.7, 2.4],
            [-0.35, 0.],
            [-0.3, -2.5],
            [-0.4, -5.],
            [-0.9, -7.5],
            [-0.5, -9.93],
        ];
        let vee = [
            [-3.2, 6.7],
            [-1.9, 4.6],
            [-0.9, 2.3],
            [-0.5, -0.2],
            [-0.46, -2.7],
            [-0.7, -5.2],
            [-1.35, -7.6],
            [-0.8, -9.91],
        ];
        let station = |i: usize, t: f64, half: &[[f64; 2]; 8]| {
            let mut outline = half.to_vec();
            outline.push([0., -9.93]);
            outline.extend(half.iter().rev().map(|[x, y]| [-x, *y]));
            let points: Vec<_> = outline
                .iter()
                .map(|[x, y]| serde_json::json!({ "x": x, "y": y / 20. }))
                .collect();
            serde_json::json!({ "id": format!("s{i}"), "t": t, "points": points })
        };
        let p: ConstructionPrimitive = serde_json::from_value(serde_json::json!({
            "id": "hull", "kind": "custom-hull", "size": [2, 20, 8], "position": [0, 0, 0], "rotationDeg": 0,
            "customHull": { "version": 1, "rake": 0, "bulb": 0, "stations": [
                station(0, 0., &flat), station(1, 0.25, &flat), station(2, 0.5, &vee), station(3, 1., &vee)
            ] }
        }))
        .unwrap();
        let solid = build(&p).unwrap();
        // The divergence theorem over the exterior faces gives the enclosed volume independently of the cut.
        let enclosed: f64 = solid
            .faces
            .iter()
            .map(|(_, f)| dot(f[0], cross(f[1], f[2])) / 6.)
            .sum();
        assert!((cg::total(&solid.cells).volume - enclosed).abs() < 1e-9);
        assert!(solid.cells.iter().all(|c| cg::moments(c).volume > 0.));
    }
    #[test]
    fn creases_sit_on_port_outline_points_and_leave_the_solid_alone() {
        let plain = build(&hull(false)).unwrap();
        let mut p = hull(false);
        p.custom_hull.as_mut().unwrap().creases = Some(vec![1., 3.]);
        let creased = build(&p).unwrap();
        assert_eq!(plain.faces, creased.faces);
        for bad in [vec![0.], vec![4.], vec![1.5], vec![3., 1.], vec![f64::NAN]] {
            p.custom_hull.as_mut().unwrap().creases = Some(bad);
            assert!(build(&p).is_err());
        }
    }
    #[test]
    fn a_hull_takes_up_to_48_sections() {
        for (count, ok) in [(48, true), (49, false)] {
            let mut p = hull(false);
            let h = p.custom_hull.as_mut().unwrap();
            let template = h.stations[0].clone();
            h.stations = (0..count)
                .map(|i| ConstructionHullStation {
                    id: format!("s{i}"),
                    t: i as f64 / (count - 1) as f64,
                    ..template.clone()
                })
                .collect();
            assert_eq!(build(&p).is_ok(), ok);
        }
    }
    #[test]
    fn outline_positions_must_match_and_remain_symmetric() {
        let mut p = hull(false);
        p.custom_hull.as_mut().unwrap().stations[1].points[1].contour = Some(1.25);
        assert!(build(&p).is_err());
        p.custom_hull.as_mut().unwrap().stations[1].points[1].contour = Some(f64::NAN);
        assert!(build(&p).is_err());
    }
}
