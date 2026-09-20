//! Design-local fittings. A definition in `construction.fittings` becomes one synthesized
//! deck-fitting catalog part (`design:<id>`), so every existing equipment path (support, burial,
//! loading, placement) applies unchanged. Non-structural by construction: the solids never join
//! the hull union, and a deck fitting has no module, obstruction, armor or hit geometry.
//! `src/ships/constructionCustomFittings.ts` mirrors the resolver for the editor and tools.
use crate::{construction_geometry as cg, definition::*, geometry::*};
use std::collections::BTreeSet;

pub const PART_PREFIX: &str = "design:";
pub const MAX_DEFINITIONS: usize = 32;
pub const MAX_SOLIDS: usize = 48;
pub const MAX_TUBES: usize = 16;
pub const MAX_INSTANCES: usize = 512;
/// Convex-cell face triangles plus swept tube triangles, per definition.
pub const MAX_TRIANGLES: usize = 20_000;
pub const MAX_TUBE_LENGTH_M: f64 = 100.;
/// Fitting-local coordinates stay within this distance of the datum.
pub const MAX_LOCAL_M: f64 = 100.;
const TUBE_SIDES: usize = 12;
const EXCLUDED_KINDS: [&str; 3] = ["custom-hull", "balcony", "ballast"];

pub fn is_custom(part_id: &str) -> bool {
    part_id.starts_with(PART_PREFIX)
}
fn density(material: Option<&str>) -> Option<f64> {
    match material.unwrap_or("steel") {
        "steel" => Some(7850.),
        "aluminium" => Some(2700.),
        "brass" => Some(8500.),
        "wood" => Some(700.),
        _ => None,
    }
}
fn fault(message: String, id: &str, related: Option<&str>) -> ConstructionDiagnostic {
    ConstructionDiagnostic {
        severity: "error".into(),
        code: "custom-fitting".into(),
        message,
        source_id: Some(id.into()),
        related_source_ids: related.map(|id| [id.to_owned()].into()),
        ..Default::default()
    }
}
fn local(p: Vec3) -> bool {
    p.iter().all(|x| x.is_finite() && x.abs() <= MAX_LOCAL_M)
}
fn paint_ok(paint: &Option<String>) -> bool {
    paint
        .as_ref()
        .is_none_or(|p| !p.is_empty() && p.len() <= 64)
}
/// The hull-piece record the shape validators and recipes already understand.
fn as_primitive(s: &ConstructionFittingSolid) -> ConstructionPrimitive {
    ConstructionPrimitive {
        id: s.id.clone(),
        kind: s.kind.clone(),
        size: s.size,
        position: s.position,
        rotation_deg: s.rotation_deg,
        tilt: s.tilt.clone(),
        vertices: s.vertices.clone(),
        mesh: s.mesh.clone(),
        shaping: s.shaping.clone(),
        ..Default::default()
    }
}
fn grow(lo: &mut Vec3, hi: &mut Vec3, center: Vec3, size: Vec3) {
    for k in 0..3 {
        lo[k] = lo[k].min(center[k] - size[k] / 2.);
        hi[k] = hi[k].max(center[k] + size[k] / 2.);
    }
}

/// One definition as a catalog deck fitting, or the first fault naming the definition
/// and the offending solid or tube.
pub fn part(def: &ConstructionFittingDefinition) -> Result<ConstructionEquipmentPart, String> {
    if def.version != 1. {
        return Err("has an unsupported version; this build reads version 1".into());
    }
    if def.name.is_empty() || def.name.len() > 80 {
        return Err("needs a name of 1–80 bytes".into());
    }
    if def.attach != "deck" {
        return Err(format!(
            "attaches to \"{}\"; version 1 supports \"deck\" only",
            def.attach
        ));
    }
    if def.solids.len() > MAX_SOLIDS || def.tubes.len() > MAX_TUBES {
        return Err(format!(
            "has {} solids and {} tubes; the limits are {MAX_SOLIDS} solids and {MAX_TUBES} tubes",
            def.solids.len(),
            def.tubes.len()
        ));
    }
    if def.solids.is_empty() && def.tubes.is_empty() {
        return Err("needs at least one solid or tube".into());
    }
    let mut ids = BTreeSet::new();
    for id in def
        .solids
        .iter()
        .map(|s| &s.id)
        .chain(def.tubes.iter().map(|t| &t.id))
    {
        if !crate::construction::valid_id(id) {
            return Err(format!(
                "has a solid or tube ID \"{id}\" that is not 1–64 letters, digits, '-' or '_'"
            ));
        }
        if !ids.insert(id) {
            return Err(format!("repeats the solid or tube ID {id}"));
        }
    }
    let Some(density) = density(def.material.as_deref()) else {
        return Err(format!(
            "has the unknown material \"{}\"; use steel, aluminium, brass or wood",
            def.material.as_deref().unwrap_or_default()
        ));
    };
    let fill = def.fill.unwrap_or(1.);
    if !fill.is_finite() || !(0.01..=1.).contains(&fill) {
        return Err("needs a fill of 0.01–1".into());
    }
    let mut moments = cg::Moments::default();
    let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    let mut solid_boxes = vec![];
    let mut segment_boxes = vec![];
    let mut tube_boxes = vec![];
    let mut triangles = 0;
    for s in &def.solids {
        let p = as_primitive(s);
        if EXCLUDED_KINDS.contains(&s.kind.as_str()) {
            return Err(format!(
                "solid {} is a {}; hull-only shapes cannot be fittings",
                s.id, s.kind
            ));
        }
        if !crate::construction::primitive_valid(&p) || !local(s.position) || !paint_ok(&s.paint) {
            return Err(format!(
                "solid {} has invalid dimensions (0.01–500 m), shape, rotation, paint or a position beyond {MAX_LOCAL_M} m",
                s.id
            ));
        }
        let cells = crate::construction::primitive_cells(&p)
            .map_err(|message| format!("solid {}: {message}", s.id))?;
        cg::check_budget(&cells).map_err(|message| format!("solid {}: {message}", s.id))?;
        let total = cg::total(&cells);
        if total.volume <= 1e-9 {
            return Err(format!("solid {} encloses no volume", s.id));
        }
        moments.add(total);
        triangles += cells
            .iter()
            .flat_map(|c| c.faces.iter())
            .map(|f| f.vertices.len().saturating_sub(2))
            .sum::<usize>();
        let (mut solid_lo, mut solid_hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for cell in &cells {
            let (center, size) = cg::bounds(cell);
            grow(&mut solid_lo, &mut solid_hi, center, size);
        }
        let center = scale(add(solid_lo, solid_hi), 0.5);
        let size = sub(solid_hi, solid_lo);
        grow(&mut lo, &mut hi, center, size);
        solid_boxes.push(ConstructionEquipmentPartFittingItem { center, size });
    }
    for t in &def.tubes {
        if !(2..=64).contains(&t.points.len())
            || t.points.iter().any(|&p| !local(p))
            || !t.diameter_m.is_finite()
            || !(0.01..=2.).contains(&t.diameter_m)
            || !paint_ok(&t.paint)
        {
            return Err(format!(
                "tube {} needs 2–64 finite points within {MAX_LOCAL_M} m, a diameter of 0.01–2 m and a paint name of at most 64 bytes",
                t.id
            ));
        }
        let lengths: Vec<_> = t
            .points
            .windows(2)
            .map(|p| length(sub(p[1], p[0])))
            .collect();
        if lengths.iter().any(|&l| l < 0.01) || lengths.iter().sum::<f64>() > MAX_TUBE_LENGTH_M {
            return Err(format!(
                "tube {} needs segments of at least 1 cm and a total length of at most {MAX_TUBE_LENGTH_M} m",
                t.id
            ));
        }
        let radius = t.diameter_m / 2.;
        let area = std::f64::consts::PI * radius * radius;
        let (mut tube_lo, mut tube_hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for (span, len) in t.points.windows(2).zip(&lengths) {
            let middle = scale(add(span[0], span[1]), 0.5);
            let volume = area * len;
            // Slender-rod second moments about the origin, per axis.
            let axis = scale(sub(span[1], span[0]), 1. / len);
            moments.add(cg::Moments {
                volume,
                first: scale(middle, volume),
                second: std::array::from_fn(|k| {
                    volume
                        * (middle[k] * middle[k]
                            + len * len / 12. * axis[k] * axis[k]
                            + radius * radius / 4. * (1. - axis[k] * axis[k]))
                }),
            });
            let size: Vec3 =
                std::array::from_fn(|k| (span[1][k] - span[0][k]).abs() + t.diameter_m);
            grow(&mut tube_lo, &mut tube_hi, middle, size);
            segment_boxes.push(ConstructionEquipmentPartFittingItem {
                center: middle,
                size,
            });
        }
        triangles += (t.points.len() - 1) * TUBE_SIDES * 2 + 2 * (TUBE_SIDES - 2);
        let center = scale(add(tube_lo, tube_hi), 0.5);
        let size = sub(tube_hi, tube_lo);
        grow(&mut lo, &mut hi, center, size);
        tube_boxes.push(ConstructionEquipmentPartFittingItem { center, size });
    }
    if triangles > MAX_TRIANGLES {
        return Err(format!(
            "needs about {triangles} triangles; the limit is {MAX_TRIANGLES}. Use fewer or simpler solids"
        ));
    }
    let size = sub(hi, lo);
    if size.iter().any(|&n| n > MAX_LOCAL_M) {
        return Err(format!("spans more than {MAX_LOCAL_M} m"));
    }
    if lo[1] > 0.05 {
        return Err(format!(
            "starts {:.3} m above its datum; the lowest solid or tube must reach local y = 0, where the fitting seats on the deck",
            lo[1]
        ));
    }
    let mass_kg = def.mass_kg.unwrap_or(moments.volume * density * fill);
    if !mass_kg.is_finite() || !(0.001..=1_000_000.).contains(&mass_kg) {
        return Err(format!(
            "weighs {mass_kg:.4} kg; the mass must be 0.001–1,000,000 kg"
        ));
    }
    // The compiler accepts at most 64 boxes per part; 48 solids and 16 tubes always fit.
    let fitting = if solid_boxes.len() + segment_boxes.len() <= 64 {
        solid_boxes.into_iter().chain(segment_boxes).collect()
    } else {
        solid_boxes.into_iter().chain(tube_boxes).collect()
    };
    let hash = crate::catalog::sha256(&serde_json::to_vec(def).unwrap_or_default());
    Ok(ConstructionEquipmentPart {
        id: format!("{PART_PREFIX}{}", def.id),
        name: def.name.clone(),
        kind: "deck-fitting".into(),
        size,
        bounds_center: scale(add(lo, hi), 0.5),
        center_of_gravity: moments.center(),
        mass_kg: Some(mass_kg),
        placement: "deck".into(),
        fitting: Some(fitting),
        model_url: format!("/models/components/design-local/{}", def.id),
        content_hash: hash,
        ..Default::default()
    })
}

/// Every definition and reference fault, in source order, or the synthesized parts.
pub fn resolve(
    c: &ConstructionData,
    limit: usize,
) -> Result<Vec<ConstructionEquipmentPart>, Vec<ConstructionDiagnostic>> {
    let definitions = c.fittings.as_deref().unwrap_or_default();
    let mut errors = vec![];
    let mut parts = vec![];
    let mut seen = BTreeSet::new();
    for def in definitions {
        if errors.len() >= limit {
            break;
        }
        if !crate::construction::valid_id(&def.id) {
            errors.push(ConstructionDiagnostic {
                source_id: None,
                ..fault(
                    format!(
                        "The custom fitting named \"{}\" needs an ID of 1–64 letters, digits, '-' or '_'",
                        def.name
                    ),
                    "",
                    None,
                )
            });
        } else if !seen.insert(def.id.as_str()) {
            errors.push(fault(
                format!("More than one custom fitting uses the ID {}", def.id),
                &def.id,
                None,
            ));
        } else {
            match part(def) {
                Ok(part) => parts.push(part),
                Err(message) => errors.push(fault(
                    format!("Custom fitting {} {message}", def.id),
                    &def.id,
                    None,
                )),
            }
        }
    }
    for e in c.equipment.iter().filter(|e| is_custom(&e.part_id)) {
        if errors.len() >= limit {
            break;
        }
        let wanted = &e.part_id[PART_PREFIX.len()..];
        if !definitions.iter().any(|d| d.id == wanted) {
            errors.push(fault(
                format!(
                    "{} is fitted from the custom fitting {wanted}, which this design does not define; define it with a `fitting` command or remove the instance",
                    e.id
                ),
                &e.id,
                Some(wanted),
            ));
        } else if e.gun.is_some()
            || e.launcher.is_some()
            || e.wall.is_some()
            || e.magazine_id.is_some()
            || e.power_source_id.is_some()
        {
            errors.push(fault(
                format!(
                    "{} is a custom fitting; gun, launcher, wall, magazine and power settings do not apply to it",
                    e.id
                ),
                &e.id,
                Some(wanted),
            ));
        }
    }
    if errors.is_empty() {
        Ok(parts)
    } else {
        Err(errors)
    }
}

/// The catalog every part lookup of this design uses: published parts plus this design's
/// definitions. Supplied `design:` entries are never trusted. Invalid definitions are left
/// out here; `resolve` reports them during compilation.
pub fn effective_catalog<'a>(
    c: &ConstructionData,
    catalog: &'a ConstructionCatalog,
) -> std::borrow::Cow<'a, ConstructionCatalog> {
    let definitions = c.fittings.as_deref().unwrap_or_default();
    if definitions.is_empty() && !catalog.equipment.iter().any(|p| is_custom(&p.id)) {
        return std::borrow::Cow::Borrowed(catalog);
    }
    let mut seen = BTreeSet::new();
    let mut extended = catalog.clone();
    extended.equipment.retain(|p| !is_custom(&p.id));
    extended.equipment.extend(
        definitions
            .iter()
            .take(MAX_DEFINITIONS)
            .filter(|d| crate::construction::valid_id(&d.id) && seen.insert(d.id.as_str()))
            .filter_map(|d| part(d).ok()),
    );
    std::borrow::Cow::Owned(extended)
}

/// `{ "parts": [...] }` or `{ "diagnostics": [...] }` for one source; the published catalog is not needed.
pub fn parts_json(source: &str) -> Result<String, String> {
    if source.len() > crate::construction::MAX_SOURCE_BYTES {
        return Err("Construction input exceeds bounded JSON size".into());
    }
    let source: ConstructionSource = serde_json::from_str(source).map_err(|e| e.to_string())?;
    let mut definitions_only = source.construction;
    definitions_only.equipment.clear();
    if definitions_only.fittings.as_ref().map_or(0, Vec::len) > MAX_DEFINITIONS {
        return Err(format!(
            "A design holds at most {MAX_DEFINITIONS} custom fitting definitions"
        ));
    }
    crate::construction::to_json(
        &match resolve(&definitions_only, crate::construction::MAX_ERRORS) {
            Ok(parts) => serde_json::json!({ "parts": parts }),
            Err(diagnostics) => serde_json::json!({ "diagnostics": diagnostics }),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::construction::compile;

    fn solid(id: &str, kind: &str, size: Vec3, position: Vec3) -> ConstructionFittingSolid {
        ConstructionFittingSolid {
            id: id.into(),
            kind: kind.into(),
            size,
            position,
            ..Default::default()
        }
    }
    fn bollard() -> ConstructionFittingDefinition {
        ConstructionFittingDefinition {
            id: "fit-bollard".into(),
            name: "Twin bollard".into(),
            version: 1.,
            attach: "deck".into(),
            solids: vec![
                solid("base", "box", [1.2, 0.1, 0.4], [0., 0.05, 0.]),
                solid("post-a", "cylinder", [0.3, 0.6, 0.3], [-0.35, 0.4, 0.]),
                solid("post-b", "cylinder", [0.3, 0.6, 0.3], [0.35, 0.4, 0.]),
            ],
            tubes: vec![ConstructionFittingTube {
                id: "bar".into(),
                points: vec![[-0.35, 0.55, 0.], [0.35, 0.55, 0.]],
                diameter_m: 0.06,
                paint: None,
            }],
            material: None,
            fill: Some(0.5),
            mass_kg: None,
        }
    }
    fn instance(id: &str, position: Vec3) -> ConstructionEquipment {
        ConstructionEquipment {
            id: id.into(),
            part_id: "design:fit-bollard".into(),
            position,
            ..Default::default()
        }
    }
    fn fixture() -> (ConstructionSource, ConstructionCatalog) {
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
                        size: [10., 4., 20.],
                        ..Default::default()
                    }],
                    fittings: Some(vec![bollard()]),
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

    #[test]
    fn a_definition_resolves_to_a_deck_fitting_with_exact_bounds_mass_and_cg() {
        let part = part(&bollard()).unwrap();
        assert_eq!(part.id, "design:fit-bollard");
        assert_eq!(
            (part.kind.as_str(), part.placement.as_str()),
            ("deck-fitting", "deck")
        );
        for (got, want) in part.size.iter().zip([1.2, 0.7, 0.4]) {
            assert!((got - want).abs() < 1e-9, "{:?}", part.size);
        }
        for (got, want) in part.bounds_center.iter().zip([0., 0.35, 0.]) {
            assert!((got - want).abs() < 1e-9, "{:?}", part.bounds_center);
        }
        // A 16-gon prism of circumradius 0.15 m, 0.6 m tall.
        let post = 0.5 * 16. * 0.15 * 0.15 * (std::f64::consts::TAU / 16.).sin() * 0.6;
        let bar = std::f64::consts::PI * 0.03 * 0.03 * 0.7;
        let volume = 1.2 * 0.1 * 0.4 + 2. * post + bar;
        assert!((part.mass_kg.unwrap() - volume * 7850. * 0.5).abs() < 1e-6);
        assert!(part.center_of_gravity[0].abs() < 1e-9);
        assert!(part.center_of_gravity[1] > 0.05 && part.center_of_gravity[1] < 0.4);
        assert_eq!(part.fitting.as_ref().unwrap().len(), 4);
        let mut weighed = bollard();
        weighed.mass_kg = Some(250.);
        assert_eq!(super::part(&weighed).unwrap().mass_kg, Some(250.));
    }

    #[test]
    fn a_seated_instance_adds_loading_only_and_nothing_a_shell_can_hit() {
        let (mut source, catalog) = fixture();
        let bare = compile(&source, &catalog);
        assert!(bare.definition.is_some(), "{:?}", bare.diagnostics);
        source.construction.equipment = vec![
            instance("bollard-1", [2., 2., -5.]),
            instance("bollard-2", [-2., 2., -5.]),
        ];
        let fitted = compile(&source, &catalog);
        assert!(fitted.definition.is_some(), "{:?}", fitted.diagnostics);
        let (before, after) = (bare.definition.unwrap(), fitted.definition.unwrap());
        // Hull, armor, rooms, modules, obstructions and clearance bodies are unchanged.
        let json = |v: &dyn Fn(&ShipDefinition) -> String| (v(&before), v(&after));
        let same = |(a, b): (String, String)| assert_eq!(a, b);
        same(json(&|d| {
            crate::construction::to_json(&d.hull.volume).unwrap()
        }));
        same(json(&|d| crate::construction::to_json(&d.modules).unwrap()));
        same(json(&|d| {
            crate::construction::to_json(&d.compartments).unwrap()
        }));
        same(json(&|d| {
            crate::construction::to_json(&d.obstructions).unwrap()
        }));
        same(json(&|d| crate::construction::to_json(&d.mounts).unwrap()));
        same(json(&|d| {
            crate::construction::to_json(&d.mount_clearance).unwrap()
        }));
        assert_eq!(
            crate::construction::to_json(&bare.surfaces).unwrap(),
            crate::construction::to_json(&fitted.surfaces).unwrap()
        );
        // Beyond the echoed source, the loading contribution is the only trace of the instance.
        let mut unloaded = after.clone();
        unloaded.loading = None;
        unloaded.construction = None;
        let text = crate::construction::to_json(&unloaded).unwrap();
        let at = text
            .find("bollard-1")
            .map(|i| &text[i.saturating_sub(300)..(i + 80).min(text.len())]);
        assert!(at.is_none(), "{at:?}");
        let (light, heavy) = (bare.loading.unwrap(), fitted.loading.unwrap());
        let unit = part(&bollard()).unwrap();
        assert!((heavy.mass_kg - light.mass_kg - 2. * unit.mass_kg.unwrap()).abs() < 1e-6);
        let load = heavy
            .contributions
            .iter()
            .find(|m| m.id == "bollard-1")
            .unwrap();
        assert!((load.center[0] - 2.).abs() < 1e-9 && load.center[1] > 2.);
        assert!(load.inertia_kg_m2.iter().all(|n| *n > 0.));
    }

    #[test]
    fn a_floating_instance_reports_the_gap_and_the_seat() {
        let (mut source, catalog) = fixture();
        source.construction.equipment = vec![instance("bollard-1", [2., 2.4, -5.])];
        let result = compile(&source, &catalog);
        assert!(result.definition.is_none());
        let d = result
            .diagnostics
            .iter()
            .find(|d| d.code == "equipment-attachment")
            .unwrap();
        assert_eq!(d.source_id.as_deref(), Some("bollard-1"));
        let fit = d.fit.as_ref().unwrap();
        assert!((fit.gap_m.unwrap() - 0.4).abs() < 1e-6, "{fit:?}");
        assert!((fit.seat_position.unwrap()[1] - 2.).abs() < 1e-6);
    }

    #[test]
    fn faults_name_the_definition_and_the_solid_or_instance() {
        let (mut source, catalog) = fixture();
        let fittings = source.construction.fittings.as_mut().unwrap();
        fittings[0].solids[1].size = [0.3, 0.001, 0.3];
        let mut floating = bollard();
        floating.id = "fit-floating".into();
        for s in &mut floating.solids {
            s.position[1] += 1.;
        }
        floating.tubes.clear();
        fittings.push(floating);
        source.construction.equipment = vec![ConstructionEquipment {
            part_id: "design:fit-missing".into(),
            ..instance("orphan", [0., 2., 0.])
        }];
        let result = compile(&source, &catalog);
        assert!(result.definition.is_none());
        let faults: Vec<_> = result
            .diagnostics
            .iter()
            .filter(|d| d.code == "custom-fitting")
            .collect();
        assert_eq!(faults.len(), 3, "{:?}", result.diagnostics);
        assert_eq!(faults[0].source_id.as_deref(), Some("fit-bollard"));
        assert!(faults[0].message.contains("solid post-a"));
        assert_eq!(faults[1].source_id.as_deref(), Some("fit-floating"));
        assert!(faults[1].message.contains("above its datum"));
        assert_eq!(faults[2].source_id.as_deref(), Some("orphan"));
        assert_eq!(
            faults[2].related_source_ids.as_deref(),
            Some(&["fit-missing".to_owned()][..])
        );
        for (kind, reason) in [("ballast", "hull-only"), ("custom-hull", "hull-only")] {
            let mut def = bollard();
            def.solids[0].kind = kind.into();
            assert!(part(&def).unwrap_err().contains(reason));
        }
        let mut def = bollard();
        def.attach = "wall".into();
        assert!(part(&def).unwrap_err().contains("\"deck\" only"));
        def = bollard();
        def.tubes[0].points.truncate(1);
        assert!(part(&def).unwrap_err().contains("tube bar"));
        def = bollard();
        def.solids[0].shaping = Some(ConstructionFreeformShape {
            version: 1.,
            edges: vec![0.],
            radius: 0.01,
            style: "chamfer".into(),
        });
        assert!(part(&def).unwrap_err().contains("solid base"));
    }

    #[test]
    fn custom_instances_are_counted_apart_from_catalog_equipment() {
        let (mut source, catalog) = fixture();
        source.construction.primitives[0].size = [20., 4., 120.];
        source.construction.equipment = (0..200)
            .map(|i| {
                instance(
                    &format!("bollard-{i}"),
                    [-8. + (i % 10) as f64 * 1.7, 2., -55. + (i / 10) as f64 * 5.],
                )
            })
            .collect();
        let result = compile(&source, &catalog);
        assert!(result.definition.is_some(), "{:?}", result.diagnostics);
        source.construction.equipment = (0..MAX_INSTANCES + 1)
            .map(|i| instance(&format!("bollard-{i}"), [0., 2., 0.]))
            .collect();
        let result = compile(&source, &catalog);
        let d = &result.diagnostics[0];
        assert_eq!(d.code, "complexity");
        assert!(
            d.message.contains("513 custom fitting instances"),
            "{}",
            d.message
        );
    }

    #[test]
    fn sources_without_fittings_serialize_and_hash_as_before() {
        let (mut source, catalog) = fixture();
        source.construction.fittings = None;
        let text = crate::construction::to_json(&source).unwrap();
        assert!(!text.contains("fittings"));
        let reread: ConstructionSource = serde_json::from_str(&text).unwrap();
        assert_eq!(
            compile(&reread, &catalog).content_hash,
            compile(&source, &catalog).content_hash
        );
        // A supplied `design:` catalog entry is never trusted.
        let (source, mut catalog) = fixture();
        catalog.equipment.push(ConstructionEquipmentPart {
            id: "design:fit-bollard".into(),
            mass_kg: Some(1e9),
            ..Default::default()
        });
        let effective = effective_catalog(&source.construction, &catalog);
        assert_eq!(effective.equipment.len(), 1);
        assert!(effective.equipment[0].mass_kg.unwrap() < 1e4);
    }
}
