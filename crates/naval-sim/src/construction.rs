//! Authoritative construction compiler, shared by native tests and local WASM sessions.
use crate::{catalog::sha256, construction_geometry as cg, definition::*, geometry::*};
use std::collections::{BTreeMap, BTreeSet};
pub const COMPILER: &str = "construction-polyhedra-1";
pub const MAX_SOURCE_BYTES: usize = 2_000_000;
pub const MAX_CATALOG_BYTES: usize = 4_000_000;
const STEEL_DENSITY: f64 = 7850.;
const SEA_DENSITY: f64 = 1025.;

fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn finite(v: Vec3) -> bool {
    v.iter().all(|x| x.is_finite() && x.abs() <= 1000.)
}
fn size(v: Vec3) -> bool {
    finite(v) && v.iter().all(|x| *x >= 0.01 && *x <= 500.)
}
fn unique<'a>(ids: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = BTreeSet::new();
    ids.into_iter().all(|s| valid_id(s) && seen.insert(s))
}
fn error(code: &str, message: impl Into<String>, id: Option<&str>) -> ConstructionDiagnostic {
    ConstructionDiagnostic {
        severity: "error".into(),
        code: code.into(),
        message: message.into(),
        source_id: id.map(str::to_owned),
    }
}
fn warn(out: &mut ConstructionResult, code: &str, message: &str) {
    out.diagnostics.push(ConstructionDiagnostic {
        severity: "warning".into(),
        code: code.into(),
        message: message.into(),
        source_id: None,
    });
}

pub fn compile_json(source: &str, catalog: &str) -> Result<String, String> {
    if source.len() > MAX_SOURCE_BYTES || catalog.len() > MAX_CATALOG_BYTES {
        return Err("Construction input exceeds bounded JSON size".into());
    }
    let source: ConstructionSource = serde_json::from_str(source).map_err(|e| e.to_string())?;
    let catalog: ConstructionCatalog = serde_json::from_str(catalog).map_err(|e| e.to_string())?;
    serde_json::to_string(&compile(&source, &catalog)).map_err(|e| e.to_string())
}
pub fn compile(source: &ConstructionSource, catalog: &ConstructionCatalog) -> ConstructionResult {
    let content_hash =
        sha256(&serde_json::to_vec(&(COMPILER, source, catalog)).unwrap_or_default());
    let mut out = ConstructionResult {
        source_id: source.id.clone(),
        revision: source.revision.clone(),
        content_hash,
        ..Default::default()
    };
    if let Err(e) = build(source, catalog, &mut out) {
        out.definition = None;
        out.diagnostics.push(e);
    }
    out
}
fn validate(
    source: &ConstructionSource,
    catalog: &ConstructionCatalog,
) -> Result<(), ConstructionDiagnostic> {
    let c = &source.construction;
    if source.schema_version != 1.
        || c.version != 1.
        || source.coordinates != "meters-y-up-bow-negative-z"
        || !valid_id(&source.id)
        || source.name.is_empty()
        || source.name.len() > 160
        || !valid_id(&source.revision)
    {
        return Err(error(
            "source",
            "Unsupported source version, coordinates or identity",
            None,
        ));
    }
    if catalog.schema_version != 1.
        || catalog.weapons.schema_version != 1.
        || c.catalog_revision != catalog.revision
    {
        return Err(error(
            "catalog-revision",
            "The saved equipment catalog revision is unavailable",
            None,
        ));
    }
    if !c.default_thickness_mm.is_finite() || !(0.1..=1000.).contains(&c.default_thickness_mm) {
        return Err(error(
            "plating",
            "Structural skin must be 0.1–1000 mm",
            None,
        ));
    }
    if c.primitives.is_empty()
        || c.primitives.len() > 512
        || c.surfaces.len() > 4096
        || c.equipment.len() > 128
        || c.boundaries.len() > 24
        || c.loads.len() > 128
    {
        return Err(error(
            "complexity",
            "Use 1–512 hull primitives, at most 128 equipment/loads and 24 boundaries",
            None,
        ));
    }
    if !unique(c.primitives.iter().map(|p| p.id.as_str()))
        || !unique(c.equipment.iter().map(|p| p.id.as_str()))
        || !unique(c.boundaries.iter().map(|p| p.id.as_str()))
        || !unique(c.loads.iter().map(|p| p.id.as_str()))
    {
        return Err(error(
            "identity",
            "Instances require unique stable IDs",
            None,
        ));
    }
    for p in &c.primitives {
        if !size(p.size)
            || !finite(p.position)
            || !p.rotation_deg.is_finite()
            || (p.rotation_deg / 90. - (p.rotation_deg / 90.).round()).abs() > 1e-8
            || p.rotation_deg.abs() > 3600.
            || !["box", "wedge", "corner", "inverse-corner"].contains(&p.kind.as_str())
        {
            return Err(error(
                "primitive",
                "Invalid primitive dimensions, shape or quarter-turn rotation",
                Some(&p.id),
            ));
        }
    }
    let mut assignments = BTreeSet::new();
    for s in &c.surfaces {
        if !c.primitives.iter().any(|p| p.id == s.primitive_id)
            || ![
                "port",
                "starboard",
                "bottom",
                "top",
                "bow",
                "stern",
                "slope",
            ]
            .contains(&s.face.as_str())
            || !assignments.insert((&s.primitive_id, &s.face))
            || !s.thickness_mm.is_finite()
            || !(0.0..=1000.).contains(&s.thickness_mm)
            || !["steel", "armor-steel"].contains(&s.material.as_str())
            || s.paint.is_empty()
            || s.paint.len() > 64
        {
            return Err(error(
                "surface",
                "Invalid or duplicate surface assignment",
                Some(&s.primitive_id),
            ));
        }
    }
    for b in &c.boundaries {
        if !["x", "y", "z"].contains(&b.axis.as_str())
            || !b.offset.is_finite()
            || b.offset.abs() > 1000.
            || !b.thickness_mm.is_finite()
            || !(0.1..=1000.).contains(&b.thickness_mm)
        {
            return Err(error(
                "boundary",
                "Invalid deck/bulkhead plane or thickness",
                Some(&b.id),
            ));
        }
    }
    for l in &c.loads {
        if !finite(l.center)
            || !size(l.size)
            || !l.mass_kg.is_finite()
            || l.mass_kg <= 0.
            || l.mass_kg > 1e9
        {
            return Err(error(
                "load",
                "Load mass and occupied volume must be positive and bounded",
                Some(&l.id),
            ));
        }
    }
    Ok(())
}
fn primitive(p: &ConstructionPrimitive) -> cg::Cell {
    let b = cg::box_cell([0.; 3], [1.; 3]);
    let c = match p.kind.as_str() {
        "wedge" => cg::clip(&b, normalize([0., 1., 1.]), 0.).unwrap(),
        "corner" => cg::clip(&b, normalize([1., 1., 1.]), -0.5 / 3_f64.sqrt()).unwrap(),
        "inverse-corner" => cg::clip(&b, normalize([1., 1., 1.]), 0.5 / 3_f64.sqrt()).unwrap(),
        _ => b,
    };
    cg::transform(&c, p.position, p.size, p.rotation_deg.to_radians())
}
fn face_name(p: &[Vec3], primitive: &ConstructionPrimitive) -> String {
    // Undo yaw to resolve the source face, independent of triangulation/position.
    let n = normal_local(cg::normal(p), -primitive.rotation_deg.to_radians());
    for (name, axis, sign) in [
        ("port", 0, -1.),
        ("starboard", 0, 1.),
        ("bottom", 1, -1.),
        ("top", 1, 1.),
        ("bow", 2, -1.),
        ("stern", 2, 1.),
    ] {
        if n[axis] * sign > 1. - 1e-7 {
            return name.into();
        }
    }
    "slope".into()
}
fn normal_local(p: Vec3, yaw: f64) -> Vec3 {
    let (s, c) = yaw.sin_cos();
    [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]]
}
fn mass(id: String, kind: &str, cells: &[cg::Cell], density: f64) -> ConstructionMass {
    let m = cg::total(cells);
    let center = m.center();
    ConstructionMass {
        id,
        kind: kind.into(),
        mass_kg: m.volume * density,
        center,
        inertia_kg_m2: m.inertia(density, center),
    }
}
fn build(
    source: &ConstructionSource,
    catalog: &ConstructionCatalog,
    out: &mut ConstructionResult,
) -> Result<(), ConstructionDiagnostic> {
    validate(source, catalog)?;
    let c = &source.construction;
    let fail = |s: String| error("geometry", s, None);
    let mut primitives: Vec<_> = c.primitives.iter().collect();
    primitives.sort_by(|a, b| a.id.cmp(&b.id));
    let raw: Vec<_> = primitives.iter().map(|p| primitive(p)).collect();
    let mut reached = BTreeSet::from([0]);
    loop {
        let old = reached.len();
        for a in 0..raw.len() {
            if reached.contains(&a) {
                for b in 0..raw.len() {
                    if !reached.contains(&b) && cg::connected(&raw[a], &raw[b]) {
                        reached.insert(b);
                    }
                }
            }
        }
        if reached.len() == old {
            break;
        }
    }
    if reached.len() != raw.len() {
        return Err(error(
            "attachment",
            "Detached hull pieces need a physical face attachment or connecting beam",
            None,
        ));
    }
    let cells = cg::union(&raw).map_err(fail)?;
    let envelope = cg::total(&cells);
    for (i, p) in primitives.iter().enumerate() {
        for f in &raw[i].faces {
            let face = face_name(&f.vertices, p);
            let a = c
                .surfaces
                .iter()
                .find(|a| a.primitive_id == p.id && a.face == face);
            let mut patches = vec![f.vertices.clone()];
            for (j, other) in raw.iter().enumerate() {
                if i == j || cg::separated(&raw[i], other) {
                    continue;
                }
                patches = patches
                    .iter()
                    .flat_map(|patch| cg::exposed(patch, other, i < j))
                    .collect();
            }
            for patch in patches {
                if patch.len() < 3 || cg::area(&patch) < cg::EPS {
                    continue;
                }
                let id = format!("{}:{}", p.id, face);
                out.surfaces.push(ConstructionSurface {
                    id,
                    primitive_id: p.id.clone(),
                    face: face.clone(),
                    normal: cg::normal(&patch),
                    area_m2: cg::area(&patch),
                    vertices: patch,
                    thickness_mm: a.map_or(c.default_thickness_mm, |a| {
                        a.thickness_mm.max(c.default_thickness_mm)
                    }),
                    material: a.map_or("steel", |a| a.material.as_str()).into(),
                    paint: a.map_or("naval-gray", |a| a.paint.as_str()).into(),
                    open: a.is_some_and(|a| a.open == Some(true)),
                });
                if out.surfaces.len() > 8192 {
                    return Err(error("complexity", "Exposed surface limit exceeded", None));
                }
            }
        }
    }
    let mut material = vec![];
    let mut contributions = vec![];
    for (i, s) in out.surfaces.iter().enumerate().filter(|(_, s)| !s.open) {
        let solid = cg::prism(&s.vertices, s.thickness_mm / 1000.);
        let clipped: Vec<_> = cells
            .iter()
            .filter_map(|c| cg::intersection(&solid, c))
            .collect();
        let occupied = cg::subtract_all(clipped, &material).map_err(fail)?;
        if !occupied.is_empty() {
            contributions.push(mass(
                format!("skin-{}-{i}", s.id),
                "skin",
                &occupied,
                STEEL_DENSITY,
            ));
            material.extend(occupied);
        }
    }
    let (center, dimensions) = crate::structure::bounds(
        cells
            .iter()
            .flat_map(|c| c.faces.iter().flat_map(|f| f.vertices.iter().copied())),
    );
    let mut boundaries: Vec<_> = c.boundaries.iter().collect();
    boundaries.sort_by(|a, b| a.id.cmp(&b.id));
    for b in &boundaries {
        let axis = axis(&b.axis);
        let mut size = scale(dimensions, 1.01);
        size[axis] = b.thickness_mm / 1000.;
        let mut position = center;
        position[axis] = b.offset;
        let slab = cg::box_cell(position, size);
        let occupied: Vec<_> = cells
            .iter()
            .filter_map(|c| cg::intersection(&slab, c))
            .collect();
        let occupied = cg::subtract_all(occupied, &material).map_err(fail)?;
        if occupied.is_empty() {
            return Err(error(
                "boundary",
                "Boundary does not cut the hull interior",
                Some(&b.id),
            ));
        }
        contributions.push(mass(b.id.clone(), "bulkhead", &occupied, STEEL_DENSITY));
        material.extend(occupied);
    }
    let material_volume = cg::total(&material).volume;
    let mut interior = cg::subtract_all(cells.clone(), &material).map_err(fail)?;
    // Source loads are visible occupied packages, never invisible ballast.
    for l in &c.loads {
        let load = cg::box_cell(l.center, l.size);
        let remaining = cg::subtract_all(vec![load.clone()], &interior).map_err(fail)?;
        if cg::total(&remaining).volume > 1e-6 {
            return Err(error(
                "load-fit",
                "Load intersects plating, another package, or exterior water",
                Some(&l.id),
            ));
        }
        let mut point = mass(
            l.id.clone(),
            "load",
            &[load.clone()],
            l.mass_kg / cg::moments(&load).volume,
        );
        point.mass_kg = l.mass_kg;
        contributions.push(point);
        interior = cg::subtract_all(interior, &[load]).map_err(fail)?;
    }
    let mut def = ShipDefinition {
        schema_version: 1.,
        compiler_version: 1.,
        id: format!(
            "local-{}-{}",
            source.id.chars().take(32).collect::<String>(),
            &out.content_hash[..16]
        ),
        name: source.name.clone(),
        configuration: "Player construction".into(),
        coordinates: source.coordinates.clone(),
        model_url: String::new(),
        content_hash: Some(out.content_hash.clone()),
        construction_revision: Some(source.revision.clone()),
        construction: Some(c.clone()),
        ..Default::default()
    };
    equipment(
        c,
        catalog,
        &cells,
        &material,
        &mut interior,
        &mut contributions,
        &mut def,
        out,
    )?;
    // Boundaries have already removed physical material. Split by source plane to keep
    // stable room names even when partial pieces/triangulation change.
    let mut groups = BTreeMap::<String, Vec<cg::Cell>>::new();
    for cell in interior {
        let key = boundaries
            .iter()
            .map(|b| {
                format!(
                    "-{}{}",
                    b.id,
                    if cg::moments(&cell).center()[axis(&b.axis)] < b.offset {
                        "a"
                    } else {
                        "b"
                    }
                )
            })
            .collect::<String>();
        groups.entry(format!("room{key}")).or_default().push(cell);
    }
    for (id, volumes) in groups {
        let m = cg::total(&volumes);
        if m.volume < 1e-6 {
            continue;
        }
        let (center, size) = crate::structure::bounds(
            volumes
                .iter()
                .flat_map(|c| c.faces.iter().flat_map(|f| f.vertices.iter().copied())),
        );
        def.compartments.push(Compartment {
            id,
            name: "Interior".into(),
            center,
            size,
            capacity_m3: m.volume,
            pump_m3_per_second: 0.,
            volumes: Some(volumes),
            ..Default::default()
        });
    }
    assign_rooms(&mut def)?;
    def.openings = Some(
        out.surfaces
            .iter()
            .filter(|s| s.open)
            .filter_map(|s| {
                let position = scale(
                    s.vertices.iter().copied().fold([0.; 3], add),
                    1. / s.vertices.len() as f64,
                );
                let inside = sub(position, scale(s.normal, 0.001));
                nearest_room(&def, inside).map(|room| ConstructionOpening {
                    id: s.id.clone(),
                    compartment_id: room.id.clone(),
                    position,
                    normal: s.normal,
                    area_m2: s.area_m2,
                })
            })
            .collect(),
    );
    def.armor = out
        .surfaces
        .iter()
        .filter(|s| !s.open)
        .enumerate()
        .map(|(i, s)| {
            let (center, size) = crate::structure::bounds(s.vertices.iter().copied());
            Armor {
                id: format!("skin-{i}"),
                name: s.id.clone(),
                center,
                size,
                thickness_mm: s.thickness_mm,
                exterior: Some(true),
                plate: Some(ArmorPlate {
                    vertices: s.vertices.clone(),
                    material: if s.material == "armor-steel" {
                        "Wh"
                    } else {
                        "steel"
                    }
                    .into(),
                    exterior: Some(true),
                    surface_id: Some(s.id.clone()),
                    ..Default::default()
                }),
                ..Default::default()
            }
        })
        .collect();
    let total_mass: f64 = contributions.iter().map(|m| m.mass_kg).sum();
    if total_mass <= 0. {
        return Err(error("loading", "No physical material mass", None));
    }
    let cg = scale(
        contributions
            .iter()
            .map(|m| scale(m.center, m.mass_kg))
            .fold([0.; 3], add),
        1. / total_mass,
    );
    let inertia: Vec3 = std::array::from_fn(|i| {
        contributions
            .iter()
            .map(|m| {
                let r = sub(m.center, cg);
                m.inertia_kg_m2[i] + m.mass_kg * (dot(r, r) - r[i] * r[i])
            })
            .sum()
    });
    let length = (center[2].abs() + dimensions[2] * 0.5) * 2.;
    let beam = (center[0].abs() + dimensions[0] * 0.5) * 2.;
    let low = center[1] - dimensions[1] * 0.5;
    let high = center[1] + dimensions[1] * 0.5;
    def.hull = Hull {
        kind: "constructed-volume-v1".into(),
        length,
        beam,
        draft: (-low).max(0.01),
        depth: high.max(0.01),
        mass_kg: total_mass,
        waterplane_area_m2: dimensions[0] * dimensions[2],
        reserve_buoyancy_m3: (envelope.volume - total_mass / SEA_DENSITY).max(0.),
        half_breadths: vec![[0., beam * 0.5], [length, beam * 0.5]],
        deck_heights: vec![[0., high], [length, high]],
        keel_heights: vec![[0., low], [length, low]],
        volume: Some(ConstructionGeometry {
            version: 1.,
            cells,
            surfaces: out.surfaces.clone(),
        }),
        ..Default::default()
    };
    def.stability = Some(ShipDefinitionStability {
        version: 1.,
        dry_center_of_gravity: cg,
        buoyancy_scale: 1.,
        shell_thickness_mm: c.default_thickness_mm,
        basis:
            "Exact polyhedral envelope and distributed material/loading; no calibration or ballast"
                .into(),
    });
    let hydro = crate::hydrostatics::HullHydrostatics::new(&def.hull, None);
    let float = hydro.flotation(total_mass / SEA_DENSITY, 0., 0.);
    let eps = 0.001;
    let f2 = hydro.flotation(total_mass / SEA_DENSITY, eps, 0.);
    let arm0 = crate::hydrostatics::righting_arms(float.center, cg, 0., 0.).0;
    let arm1 = crate::hydrostatics::righting_arms(f2.center, cg, eps, 0.).0;
    let gm = -(arm1 - arm0) / eps;
    let power = out.loading.as_ref().map_or(0., |l| l.power_kw);
    let speed = out.loading.as_ref().map_or(0., |l| l.estimated_speed_mps);
    let loading=ConstructionLoading{mass_kg:total_mass,center_of_gravity:cg,inertia_kg_m2:inertia,contributions,envelope_volume_m3:envelope.volume,material_volume_m3:material_volume,usable_volume_m3:def.compartments.iter().map(|r|r.capacity_m3).sum(),waterline_y:if float.afloat {-float.y}else{high},buoyancy_center:float.center,roll_metacentric_height_m:gm,power_kw:power,estimated_speed_mps:speed,basis:"Steel 7850 kg/m³; seawater 1025 kg/m³; exact convex clipping; fixed catalog service load and initial projectile stock; no hidden ballast".into()};
    if !float.afloat {
        warn(
            out,
            "overloaded",
            "Total loading exceeds enclosed displacement; trial will sink",
        );
    }
    if gm <= 0. {
        warn(
            out,
            "unstable",
            "Upright equilibrium has negative initial stability",
        );
    }
    if arm0.abs() > 0.01 {
        warn(
            out,
            "asymmetric-load",
            "Off-center loading will cause list at equilibrium",
        );
    }
    if power == 0. {
        warn(
            out,
            "unpowered",
            "No functioning propulsion chain; the ship can still enter a trial",
        );
    }
    def.loading = Some(loading.clone());
    out.loading = Some(loading);
    def.accuracy = ShipDefinitionAccuracy {
        exterior: "Player-authored polyhedral hull".into(),
        internals: "Bounded exact volume clipping; gameplay machinery".into(),
        weapons: "Original component catalog".into(),
    };
    crate::catalog::validate_definition(&def)
        .map_err(|e| error("definition", e.to_string(), None))?;
    out.definition = Some(def);
    Ok(())
}
fn axis(a: &str) -> usize {
    match a {
        "x" => 0,
        "y" => 1,
        _ => 2,
    }
}
fn nearest_room(def: &ShipDefinition, p: Vec3) -> Option<&Compartment> {
    def.compartments
        .iter()
        .min_by(|a, b| length(sub(a.center, p)).total_cmp(&length(sub(b.center, p))))
}
fn assign_rooms(_def: &mut ShipDefinition) -> Result<(), ConstructionDiagnostic> {
    Ok(())
}
#[allow(clippy::too_many_arguments)]
fn equipment(
    c: &ConstructionData,
    _catalog: &ConstructionCatalog,
    _hull: &[cg::Cell],
    _material: &[cg::Cell],
    _interior: &mut Vec<cg::Cell>,
    _mass: &mut Vec<ConstructionMass>,
    def: &mut ShipDefinition,
    _out: &mut ConstructionResult,
) -> Result<(), ConstructionDiagnostic> {
    if !c.equipment.is_empty() {
        return Err(error(
            "equipment",
            "Equipment compilation is not yet available",
            None,
        ));
    }
    def.handling = Handling {
        forward_speed: 0.,
        reverse_speed: 0.,
        acceleration: 0.,
        braking: 0.1,
        rudder_rate: 0.3,
        max_yaw_rate: 0.,
    };
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    pub fn fixture() -> (ConstructionSource, ConstructionCatalog) {
        (
            ConstructionSource {
                schema_version: 1.,
                id: "test-hull".into(),
                name: "Test hull".into(),
                coordinates: "meters-y-up-bow-negative-z".into(),
                revision: "one".into(),
                construction: ConstructionData {
                    version: 1.,
                    catalog_revision: "test".into(),
                    default_thickness_mm: 10.,
                    primitives: vec![ConstructionPrimitive {
                        id: "box".into(),
                        kind: "box".into(),
                        position: [0.; 3],
                        size: [10., 4., 20.],
                        rotation_deg: 0.,
                    }],
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
    fn generated_source_to_valid_definition_round_trip() {
        let (s, c) = fixture();
        let encoded = compile_json(
            &serde_json::to_string(&s).unwrap(),
            &serde_json::to_string(&c).unwrap(),
        )
        .unwrap();
        let result: ConstructionResult = serde_json::from_str(&encoded).unwrap();
        let d = result
            .definition
            .expect(&format!("{:?}", result.diagnostics));
        crate::catalog::validate_definition(&d).unwrap();
        assert!(d.id.starts_with("local-"));
        assert_eq!(d.hull.kind, "constructed-volume-v1");
        assert!((d.loading.unwrap().envelope_volume_m3 - 800.).abs() < 1e-7);
    }
    #[test]
    fn duplicate_primitive_does_not_duplicate_skin_or_loading() {
        let (mut s, c) = fixture();
        let first = compile(&s, &c);
        let mut p = s.construction.primitives[0].clone();
        p.id = "duplicate".into();
        s.construction.primitives.push(p);
        let second = compile(&s, &c);
        assert!(second.definition.is_some(), "{:?}", second.diagnostics);
        assert!((first.loading.unwrap().mass_kg - second.loading.unwrap().mass_kg).abs() < 1e-6);
        assert_eq!(first.surfaces.len(), second.surfaces.len());
    }
    #[test]
    fn historical_published_definitions_still_validate() {
        let mut count = 0;
        for entry in std::fs::read_dir("../../public/models").unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let data = std::fs::read(&path).unwrap();
            let value: serde_json::Value = serde_json::from_slice(&data).unwrap();
            if value.get("hull").is_none() {
                continue;
            }
            let d: ShipDefinition = serde_json::from_value(value).unwrap();
            crate::catalog::validate_definition(&d).unwrap();
            count += 1;
        }
        assert!(count > 0);
    }
}
