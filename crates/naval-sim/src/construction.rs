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
    to_json(&compile(&source, &catalog))
}
/// TypeScript optional properties are omitted, rather than encoded as JSON null.
pub fn to_json(value: &impl serde::Serialize) -> Result<String, String> {
    fn omit(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(o) => {
                o.retain(|_, v| !v.is_null());
                for v in o.values_mut() {
                    omit(v);
                }
            }
            serde_json::Value::Array(a) => {
                for v in a {
                    omit(v);
                }
            }
            _ => {}
        }
    }
    let mut value = serde_json::to_value(value).map_err(|e| e.to_string())?;
    omit(&mut value);
    serde_json::to_string(&value).map_err(|e| e.to_string())
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
    // Catalog-declared installation wells cross only the supporting exterior deck.
    // Their enclosures seal the penetration; they do not carve nearby side armor.
    let mut wells = vec![];
    for e in &c.equipment {
        if let Some(p) = catalog
            .equipment
            .iter()
            .find(|p| p.id == e.part_id && p.placement == "deck")
        {
            if !finite(e.position) || !e.bearing_deg.is_finite() {
                return Err(error(
                    "equipment-data",
                    "Invalid installation transform",
                    Some(&e.id),
                ));
            }
            for space in p.occupancy.iter().flatten() {
                if !finite(space.center) || !size(space.size) {
                    return Err(error(
                        "equipment-data",
                        "Invalid installation well",
                        Some(&e.id),
                    ));
                }
                let cell = cg::transform(
                    &cg::box_cell(space.center, space.size),
                    e.position,
                    [1.; 3],
                    -e.bearing_deg.to_radians(),
                );
                wells.push((e.id.clone(), p.kind.clone(), cell));
            }
        }
    }
    let mut penetrations = vec![];
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
            if cg::normal(&f.vertices)[1] > 0.95 {
                for (id, kind, well) in &wells {
                    let mut remaining = vec![];
                    for patch in patches {
                        let mut covered = patch.clone();
                        for plane in &well.faces {
                            let n = cg::normal(&plane.vertices);
                            covered = cg::clip_polygon(&covered, n, dot(n, plane.vertices[0]));
                            if covered.len() < 3 {
                                break;
                            }
                        }
                        if covered.len() >= 3 && cg::area(&covered) > 1e-8 {
                            penetrations.push((id.clone(), kind.clone(), covered));
                        }
                        remaining.extend(cg::exposed(&patch, well, false));
                    }
                    patches = remaining;
                }
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
                    ..Default::default()
                })
            })
            .collect(),
    );
    for (id, kind, polygon) in penetrations {
        let position = scale(
            polygon.iter().copied().fold([0.; 3], add),
            1. / polygon.len() as f64,
        );
        if let Some(room) = nearest_room(&def, sub(position, [0., 0.05, 0.])) {
            let opening = ConstructionOpening {
                id: format!("well-{id}"),
                compartment_id: room.id.clone(),
                position,
                normal: [0., 1., 0.],
                area_m2: cg::area(&polygon),
                sealed_by_mount_id: (kind == "gun").then(|| id.clone()),
                sealed_by_module_id: (kind != "gun").then_some(id),
            };
            def.openings.as_mut().unwrap().push(opening);
        }
    }
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
    for b in &boundaries {
        let a = axis(&b.axis);
        let mut n = [0.; 3];
        n[a] = 1.;
        for (i, cell) in cells.iter().enumerate() {
            if let Some(cut) = cg::clip(cell, n, b.offset) {
                for f in cut
                    .faces
                    .iter()
                    .filter(|f| f.vertices.iter().all(|p| (p[a] - b.offset).abs() < 1e-7))
                {
                    let (center, size) = crate::structure::bounds(f.vertices.iter().copied());
                    def.armor.push(Armor {
                        id: format!("boundary-{}-{i}", b.id),
                        name: b.id.clone(),
                        thickness_mm: b.thickness_mm,
                        center,
                        size,
                        plate: Some(ArmorPlate {
                            vertices: f.vertices.clone(),
                            material: "steel".into(),
                            exterior: Some(false),
                            surface_id: Some(b.id.clone()),
                            ..Default::default()
                        }),
                        exterior: Some(false),
                        ..Default::default()
                    });
                }
            }
        }
    }
    let void_volume: f64 = def.compartments.iter().map(|r| r.capacity_m3).sum();
    def.local_damage = Some(ShipDefinitionLocalDamage {
        version: 1.,
        basis: "Fixed mass-based hull HP distributed by usable room volume; subdivision adds no HP"
            .into(),
        regions: def
            .compartments
            .iter()
            .map(|r| DamageRegion {
                id: r.id.clone(),
                name: r.name.clone(),
                kind: "hull".into(),
                durability_fraction: r.capacity_m3 / void_volume,
                center: r.center,
                size: r.size,
                ..Default::default()
            })
            .collect(),
    });
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
    if !def.mounts.is_empty() {
        let mut bodies: Vec<_> = def
            .hull
            .volume
            .as_ref()
            .unwrap()
            .cells
            .iter()
            .enumerate()
            .map(|(i, c)| MountClearanceProfileBodiesItem {
                id: format!("hull-cell-{i}"),
                mount_id: None,
                surface: surface_mesh(c),
            })
            .collect();
        bodies.extend(
            def.obstructions
                .iter()
                .map(|b| MountClearanceProfileBodiesItem {
                    id: b.id.clone(),
                    mount_id: None,
                    surface: surface_mesh(&cg::box_cell(b.center, b.size)),
                }),
        );
        def.mount_clearance=Some(MountClearanceProfile{version:1.,margin_m:0.01,basis:"Catalog gunhouses/barrels with full recoil envelope against exact hull cells and fixed equipment envelopes".into(),mount_ids:Some(def.mounts.iter().map(|m|m.id.clone()).collect()),bodies:Some(bodies),..Default::default()});
        let clearance = crate::mount_clearance::MountClearance::new(&def)
            .map_err(|e| error("clearance", e, None))?
            .unwrap();
        let poses = vec![crate::mount_clearance::ClearancePose::default(); def.mounts.len()];
        for (i, m) in def.mounts.iter().enumerate() {
            if clearance.minimum_clearance(&def, i, &poses, 1.).0 <= 0. {
                return Err(error(
                    "weapon-clearance",
                    "Gun barrels intersect installed geometry at the initial pose",
                    Some(&m.id),
                ));
            }
        }
    }
    crate::catalog::validate_definition(&def)
        .map_err(|e| error("definition", e.to_string(), None))?;
    out.definition = Some(def);
    Ok(())
}
fn surface_mesh(cell: &cg::Cell) -> AuthoredSurface {
    let mut s = AuthoredSurface::default();
    for f in &cell.faces {
        let base = s.vertices.len();
        s.vertices.extend(&f.vertices);
        s.triangles.extend(
            (1..f.vertices.len() - 1)
                .map(|i| [base as f64, (base + i) as f64, (base + i + 1) as f64]),
        );
    }
    s
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
        .min_by(|a, b| cg::room_distance(a, p).total_cmp(&cg::room_distance(b, p)))
}
fn assign_rooms(def: &mut ShipDefinition) -> Result<(), ConstructionDiagnostic> {
    for i in 0..def.modules.len() {
        if def.modules[i].placement.as_deref() == Some("fixed") {
            continue;
        }
        let p = def.modules[i].center;
        let Some(room) = nearest_room(def, p) else {
            return Err(error(
                "module-room",
                "No floodable interior for equipment",
                Some(&def.modules[i].id),
            ));
        };
        def.modules[i].compartment_id = Some(room.id.clone());
    }
    Ok(())
}
#[allow(clippy::too_many_arguments)]
fn equipment(
    c: &ConstructionData,
    catalog: &ConstructionCatalog,
    hull: &[cg::Cell],
    _material: &[cg::Cell],
    interior: &mut Vec<cg::Cell>,
    masses: &mut Vec<ConstructionMass>,
    def: &mut ShipDefinition,
    out: &mut ConstructionResult,
) -> Result<(), ConstructionDiagnostic> {
    if catalog.equipment.len() > 256
        || !unique(catalog.equipment.iter().map(|p| p.id.as_str()))
        || !unique(catalog.weapons.parts.iter().map(|p| p.id.as_str()))
    {
        return Err(error(
            "catalog",
            "Invalid equipment catalog identities/count",
            None,
        ));
    }
    let mut fitted = vec![];
    let mut all_envelopes: Vec<(String, cg::Cell)> = vec![];
    for e in &c.equipment {
        let Some(p) = catalog.equipment.iter().find(|p| p.id == e.part_id) else {
            return Err(error(
                "missing-part",
                "Exact equipment part is unavailable in this catalog revision",
                Some(&e.id),
            ));
        };
        if !finite(e.position)
            || !e.bearing_deg.is_finite()
            || e.bearing_deg.abs() > 3600.
            || !size(p.size)
            || !finite(p.bounds_center)
            || !finite(p.center_of_gravity)
            || !p.model_url.starts_with("/models/components/")
            || p.content_hash.is_empty()
            || ![
                "gun",
                "torpedo-launcher",
                "engine",
                "magazine",
                "funnel",
                "propeller",
                "rudder",
                "mast",
                "director",
            ]
            .contains(&p.kind.as_str())
            || !["internal", "deck", "underwater"].contains(&p.placement.as_str())
        {
            return Err(error(
                "equipment-data",
                "Equipment transform, model identity or fixed dimensions are invalid",
                Some(&e.id),
            ));
        }
        for n in [
            p.power_kw,
            p.exhaust_kw,
            p.thrust_efficiency,
            p.rudder_area_m2,
            p.service_mass_kg,
            p.ammunition_capacity,
        ]
        .into_iter()
        .flatten()
        {
            if !n.is_finite() || !(0.0..=1e9).contains(&n) {
                return Err(error(
                    "equipment-data",
                    "Invalid equipment capability",
                    Some(&e.id),
                ));
            }
        }
        let pose = Pose {
            x: e.position[0],
            y: e.position[1],
            z: e.position[2],
            heading: e.bearing_deg.to_radians(),
            ..Default::default()
        };
        let transform_cell = |center: Vec3, size: Vec3| {
            cg::transform(
                &cg::box_cell(center, size),
                e.position,
                [1.; 3],
                -e.bearing_deg.to_radians(),
            )
        };
        let envelope = transform_cell(p.bounds_center, p.size);
        for (other, cell) in &all_envelopes {
            if cg::intersection(&envelope, cell).is_some_and(|x| cg::moments(&x).volume > 1e-5) {
                return Err(error(
                    "equipment-overlap",
                    format!("Equipment intersects {other}"),
                    Some(&e.id),
                ));
            }
        }
        all_envelopes.push((e.id.clone(), envelope.clone()));
        let mut occupied = vec![];
        if p.placement == "internal" {
            occupied.push(envelope.clone());
        }
        if let Some(spaces) = &p.occupancy {
            if spaces.len() > 16 {
                return Err(error(
                    "equipment-data",
                    "Too many intrinsic equipment spaces",
                    Some(&e.id),
                ));
            }
            for space in spaces {
                if !finite(space.center) || !size(space.size) {
                    return Err(error(
                        "equipment-data",
                        "Invalid intrinsic equipment space",
                        Some(&e.id),
                    ));
                }
                let volume = transform_cell(space.center, space.size);
                if p.placement == "deck" {
                    occupied.extend(hull.iter().filter_map(|h| cg::intersection(&volume, h)));
                } else {
                    occupied.push(volume);
                }
            }
        }
        let occupied = cg::union(&occupied).map_err(|x| error("equipment-fit", x, Some(&e.id)))?;
        if !occupied.is_empty() {
            let outside = cg::subtract_all(occupied.clone(), interior)
                .map_err(|x| error("equipment-fit", x, Some(&e.id)))?;
            if cg::total(&outside).volume > 1e-5 {
                return Err(error(
                    "equipment-fit",
                    "Package intersects inward plating, internal wall, another load or exterior water",
                    Some(&e.id),
                ));
            }
            *interior = cg::subtract_all(interior.clone(), &occupied)
                .map_err(|x| error("equipment-fit", x, Some(&e.id)))?;
        }
        // Check the explicit original attachment socket (or the package's base datum).
        // Small 5 cm installation tolerance is independent of the 1 m hull grid.
        let local_attachment = p
            .sockets
            .as_ref()
            .and_then(|s| s.iter().find(|s| s.id == "attachment"))
            .map_or(
                if p.placement == "internal" {
                    [
                        p.bounds_center[0],
                        p.bounds_center[1] - p.size[1] / 2.,
                        p.bounds_center[2],
                    ]
                } else {
                    [0.; 3]
                },
                |s| s.position,
            );
        let attachment = local_to_world(local_attachment, pose);
        let supports = if p.placement == "internal" {
            _material
        } else {
            hull
        };
        let attached = supports.iter().any(|h| {
            cg::contains(h, attachment)
                || length(sub(cg::closest_point(h, attachment), attachment)) <= 0.05
        });
        if !attached {
            return Err(error(
                "equipment-attachment",
                "Equipment attachment has no physical hull support within 5 cm",
                Some(&e.id),
            ));
        }
        if p.placement == "deck"
            && hull.iter().any(|h| {
                cg::intersection(&envelope, h)
                    .is_some_and(|x| cg::moments(&x).volume > p.size[0] * p.size[2] * 0.005)
            })
        {
            return Err(error(
                "equipment-fit",
                "Exterior equipment body overlaps the hull; use its original support datum (5 mm fitted-base tolerance)",
                Some(&e.id),
            ));
        }
        let weapon = if p.kind == "gun" {
            Some(
                catalog
                    .weapons
                    .parts
                    .iter()
                    .find(|w| Some(w.id.as_str()) == p.gun_part_id.as_deref())
                    .ok_or_else(|| {
                        error("weapon", "Missing canonical gun definition", Some(&e.id))
                    })?,
            )
        } else {
            None
        };
        let mass_kg = weapon.map_or(p.mass_kg.unwrap_or(0.), |w| w.mass_kg);
        if !mass_kg.is_finite() || mass_kg <= 0. || mass_kg > 1e9 {
            return Err(error(
                "equipment-mass",
                "Equipment requires a positive catalog mass",
                Some(&e.id),
            ));
        }
        let center = local_to_world(p.center_of_gravity, pose);
        let mut load = mass(
            e.id.clone(),
            "equipment",
            &[envelope.clone()],
            mass_kg / cg::moments(&envelope).volume,
        );
        load.center = center;
        load.mass_kg = mass_kg;
        // Box inertia translated from the catalog bounds center to the authored CG.
        load.inertia_kg_m2 =
            cg::moments(&envelope).inertia(mass_kg / cg::moments(&envelope).volume, center);
        masses.push(load);
        if let Some(service) = p.service_mass_kg.filter(|x| *x > 0.) {
            masses.push(ConstructionMass {
                id: format!("{}-service", e.id),
                kind: "service".into(),
                mass_kg: service,
                center,
                inertia_kg_m2: std::array::from_fn(|i| {
                    masses.last().unwrap().inertia_kg_m2[i] * service / mass_kg
                }),
            });
        }
        let (box_center, box_size) = cg::bounds(&envelope);
        let module_kind = match p.kind.as_str() {
            "engine" | "propeller" | "funnel" => Some("engine"),
            "magazine" => Some("magazine"),
            "rudder" => Some("steering"),
            "director" => Some("fire-control"),
            "torpedo-launcher" => Some("launcher"),
            _ => None,
        };
        if let Some(kind) = module_kind {
            def.modules.push(Module {
                id: e.id.clone(),
                name: p.name.clone(),
                kind: kind.into(),
                center: box_center,
                size: box_size,
                hp: (mass_kg.sqrt() * 2.).max(40.),
                placement: (p.placement != "internal").then(|| "fixed".into()),
                immersion_tolerance_m: if p.placement == "internal" {
                    Some((p.size[1] * 0.2).max(0.1))
                } else {
                    None
                },
                role: match p.kind.as_str() {
                    "engine" => Some("combined-drive".into()),
                    "propeller" => Some("shaft".into()),
                    "funnel" => Some("boiler".into()),
                    _ => None,
                },
                serves_mount_ids: if p.kind == "director" {
                    Some(
                        c.equipment
                            .iter()
                            .filter(|x| {
                                catalog
                                    .equipment
                                    .iter()
                                    .any(|p| p.id == x.part_id && p.kind == "gun")
                            })
                            .map(|x| x.id.clone())
                            .collect(),
                    )
                } else {
                    None
                },
                ..Default::default()
            });
        }
        if let Some(w) = weapon {
            if !w.mass_kg.is_finite()
                || !w.muzzle_speed.is_finite()
                || w.muzzle_speed <= 0.
                || !w.projectile_mass_kg.is_finite()
                || w.projectile_mass_kg <= 0.
                || !w.ammo_per_barrel.is_finite()
                || w.ammo_per_barrel < 1.
                || !w.barbette_radius.is_finite()
                || w.barbette_radius <= 0.
            {
                return Err(error(
                    "weapon",
                    "Invalid canonical weapon statistics",
                    Some(&e.id),
                ));
            }
            let magazine = resolve_magazine(c, catalog, e)?;
            def.mounts.push(MountDefinition {
                id: e.id.clone(),
                name: p.name.clone(),
                part_id: w.id.clone(),
                battery: if w.caliber_m >= 0.1 {
                    "main"
                } else {
                    "secondary"
                }
                .into(),
                position: e.position,
                bearing_deg: e.bearing_deg,
                magazine_id: Some(magazine.id.clone()),
                weapon: w.clone(),
                rangefinder: false,
                ..Default::default()
            });
            let stock = w.ammo_per_barrel * w.barrel_count.unwrap_or(2.);
            let kg = stock * w.projectile_mass_kg;
            masses.push(ConstructionMass {
                id: format!("{}-ammunition", e.id),
                kind: "ammunition".into(),
                mass_kg: kg,
                center: magazine_load_center(catalog, magazine),
                inertia_kg_m2: magazine_load_inertia(catalog, magazine, kg),
            });
        }
        if p.kind == "torpedo-launcher" {
            let w = catalog
                .weapons
                .torpedoes
                .iter()
                .flatten()
                .find(|w| Some(w.id.as_str()) == p.torpedo_part_id.as_deref())
                .ok_or_else(|| {
                    error(
                        "weapon",
                        "Missing canonical torpedo definition",
                        Some(&e.id),
                    )
                })?;
            let offsets = p
                .tube_offsets
                .as_ref()
                .filter(|o| !o.is_empty() && o.len() <= 8)
                .ok_or_else(|| {
                    error(
                        "weapon",
                        "Torpedo launcher needs 1–8 original tube offsets",
                        Some(&e.id),
                    )
                })?;
            let magazine = resolve_magazine(c, catalog, e)?;
            def.torpedo_launchers
                .get_or_insert_default()
                .push(TorpedoLauncher {
                    id: e.id.clone(),
                    name: p.name.clone(),
                    position: e.position,
                    traverse_rate_deg: 10.,
                    launch_arcs_deg: vec![[-180., 180.]],
                    ..Default::default()
                });
            for (i, &offset) in offsets.iter().enumerate() {
                if !finite(offset) {
                    return Err(error(
                        "weapon",
                        "Invalid torpedo muzzle offset",
                        Some(&e.id),
                    ));
                }
                def.torpedo_tubes
                    .get_or_insert_default()
                    .push(TubeDefinition {
                        id: format!("{}-tube-{}", e.id, i + 1),
                        name: p.name.clone(),
                        part_id: w.id.clone(),
                        position: local_to_world(offset, pose),
                        bearing_deg: e.bearing_deg,
                        arc_deg: 0.,
                        ammo: 1.,
                        magazine_id: magazine.id.clone(),
                        launcher_id: Some(e.id.clone()),
                        launcher_module_id: Some(e.id.clone()),
                        weapon: w.clone(),
                    });
            }
        }
        if p.kind != "gun" && p.placement != "internal" {
            def.obstructions.push(Volume {
                id: e.id.clone(),
                center: box_center,
                size: box_size,
            });
        }
        fitted.push((e, p));
    }
    // Validate magazine stocks together, so repeated mounts cannot each consume the same capacity.
    for (e, p) in &fitted {
        if p.kind == "magazine" {
            let stock: f64 = def
                .mounts
                .iter()
                .filter(|m| m.magazine_id.as_deref() == Some(e.id.as_str()))
                .map(|m| m.weapon.ammo_per_barrel * m.weapon.barrel_count.unwrap_or(2.))
                .sum();
            if stock > p.ammunition_capacity.unwrap_or(0.) {
                return Err(error(
                    "magazine-capacity",
                    "Magazine cannot hold all initially loaded rounds",
                    Some(&e.id),
                ));
            }
        }
    }
    let mut power = 0.;
    let mut groups = vec![];
    for (engine, part) in fitted.iter().filter(|(_, p)| p.kind == "engine") {
        let funnels: Vec<_> = fitted
            .iter()
            .filter(|(e, p)| {
                p.kind == "funnel"
                    && (e.power_source_id.as_deref() == Some(engine.id.as_str())
                        || (e.power_source_id.is_none()
                            && fitted.iter().filter(|(_, p)| p.kind == "engine").count() == 1))
            })
            .collect();
        let props: Vec<_> = fitted
            .iter()
            .filter(|(e, p)| {
                p.kind == "propeller"
                    && (e.power_source_id.as_deref() == Some(engine.id.as_str())
                        || (e.power_source_id.is_none()
                            && fitted.iter().filter(|(_, p)| p.kind == "engine").count() == 1))
            })
            .collect();
        let exhaust: f64 = funnels
            .iter()
            .map(|(_, p)| p.exhaust_kw.unwrap_or(0.))
            .sum();
        if props.is_empty() || exhaust == 0. {
            continue;
        }
        let efficiency = props
            .iter()
            .map(|(_, p)| p.thrust_efficiency.unwrap_or(0.6).clamp(0.01, 1.))
            .sum::<f64>()
            / props.len() as f64;
        let kw = part.power_kw.unwrap_or(0.).min(exhaust) * efficiency;
        power += kw;
        groups.push(PropulsionGroup {
            id: engine.id.clone(),
            share: kw,
            boiler_ids: funnels.iter().map(|(e, _)| e.id.clone()).collect(),
            drive_ids: vec![engine.id.clone()],
            shaft_ids: props.iter().map(|(e, _)| e.id.clone()).collect(),
        });
    }
    for g in &mut groups {
        g.share /= power.max(1.);
    }
    def.propulsion=Some(ShipDefinitionPropulsion{groups,basis:"Catalog power limited by linked exhaust and propeller efficiency; machinery availability and immersion apply at runtime".into()});
    let m: f64 = masses.iter().map(|m| m.mass_kg).sum();
    let (_, dims) = crate::structure::bounds(
        hull.iter()
            .flat_map(|c| c.faces.iter().flat_map(|f| f.vertices.iter().copied())),
    );
    let wetted: f64 = out
        .surfaces
        .iter()
        .filter(|s| s.normal[1] < 0.5)
        .map(|s| s.area_m2)
        .sum();
    // Bounded gameplay resistance P = (rho/2) Cf S v³, limited by a Froude wave factor.
    let speed = if power > 0. {
        (power * 1000. / (0.5 * SEA_DENSITY * 0.008 * wetted.max(1.)))
            .cbrt()
            .min(0.5 * (9.81 * dims[2]).sqrt())
    } else {
        0.
    };
    let yaw_inertia = m * (dims[0] * dims[0] + dims[2] * dims[2]) / 12.;
    let rudder_moment: f64 = fitted
        .iter()
        .filter(|(_, p)| p.kind == "rudder")
        .map(|(e, p)| p.rudder_area_m2.unwrap_or(0.) * e.position[2].abs())
        .sum();
    def.handling = Handling {
        forward_speed: speed,
        reverse_speed: speed * 0.35,
        acceleration: if speed > 0. {
            (power * 1000. / (m * speed.max(1.))).min(2.)
        } else {
            0.
        },
        braking: 0.12 + speed * 0.015,
        rudder_rate: 0.35,
        max_yaw_rate: if power > 0. {
            (0.5 * SEA_DENSITY * speed * speed * rudder_moment / yaw_inertia.max(1.))
                .sqrt()
                .min(0.25)
        } else {
            0.
        },
    };
    out.loading = Some(ConstructionLoading {
        power_kw: power,
        estimated_speed_mps: speed,
        ..Default::default()
    });
    Ok(())
}
fn magazine_load_center(catalog: &ConstructionCatalog, e: &ConstructionEquipment) -> Vec3 {
    let p = catalog
        .equipment
        .iter()
        .find(|p| p.id == e.part_id)
        .unwrap();
    local_to_world(
        p.bounds_center,
        Pose {
            x: e.position[0],
            y: e.position[1],
            z: e.position[2],
            heading: e.bearing_deg.to_radians(),
            ..Default::default()
        },
    )
}
fn magazine_load_inertia(
    catalog: &ConstructionCatalog,
    e: &ConstructionEquipment,
    kg: f64,
) -> Vec3 {
    let p = catalog
        .equipment
        .iter()
        .find(|p| p.id == e.part_id)
        .unwrap();
    let cell = cg::transform(
        &cg::box_cell(p.bounds_center, p.size),
        e.position,
        [1.; 3],
        -e.bearing_deg.to_radians(),
    );
    cg::moments(&cell).inertia(
        kg / cg::moments(&cell).volume,
        magazine_load_center(catalog, e),
    )
}

fn resolve_magazine<'a>(
    c: &'a ConstructionData,
    catalog: &ConstructionCatalog,
    e: &ConstructionEquipment,
) -> Result<&'a ConstructionEquipment, ConstructionDiagnostic> {
    let magazines: Vec<_> = c
        .equipment
        .iter()
        .filter(|e| {
            catalog
                .equipment
                .iter()
                .any(|p| p.id == e.part_id && p.kind == "magazine")
        })
        .collect();
    e.magazine_id
        .as_ref()
        .and_then(|id| magazines.iter().find(|m| m.id == *id).copied())
        .or_else(|| {
            if e.magazine_id.is_none() && magazines.len() == 1 {
                Some(magazines[0])
            } else {
                None
            }
        })
        .ok_or_else(|| {
            error(
                "magazine-link",
                "Weapon needs a valid magazine assignment",
                Some(&e.id),
            )
        })
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
    fn compiled(s: &ConstructionSource, c: &ConstructionCatalog) -> ShipDefinition {
        let r = compile(s, c);
        r.definition.expect(&format!("{:?}", r.diagnostics))
    }
    fn catamaran() -> (ConstructionSource, ConstructionCatalog) {
        let (mut s, c) = fixture();
        s.id = "catamaran".into();
        s.construction.primitives = vec![
            ConstructionPrimitive {
                id: "port".into(),
                kind: "box".into(),
                position: [-4., 0., 0.],
                size: [3., 4., 20.],
                rotation_deg: 0.,
            },
            ConstructionPrimitive {
                id: "starboard".into(),
                kind: "box".into(),
                position: [4., 0., 0.],
                size: [3., 4., 20.],
                rotation_deg: 0.,
            },
            ConstructionPrimitive {
                id: "bridge".into(),
                kind: "box".into(),
                position: [0., 2.5, 0.],
                size: [11., 1., 4.],
                rotation_deg: 0.,
            },
        ];
        (s, c)
    }
    #[test]
    fn connected_catamaran_keeps_water_channel_in_every_final_query() {
        let (s, c) = catamaran();
        let d = compiled(&s, &c);
        let hydro = crate::hydrostatics::HullHydrostatics::new(&d.hull, None);
        assert!((hydro.sample(0., 0., 0.).volume - 240.).abs() < 1e-6);
        assert!(!crate::hull::hull_contains(&d.hull, [0.; 3]));
        assert!(crate::hull::hull_contains(&d.hull, [0., 2.5, 0.]));
        let from = [0., 0., -30.];
        let to = [0., 0., 30.];
        assert!(
            crate::hull_contact::HullContacts::new(&d.hull)
                .query(from, to)
                .is_empty()
        );
        let geometry = crate::contacts::ContactGeometry::new(&d).unwrap();
        let actor = crate::damage::Combatant::new("cat", &d);
        assert!(
            crate::contacts::ship_contacts(
                &crate::shell::Shell::default(),
                from,
                to,
                &actor,
                &d,
                &geometry
            )
            .is_empty()
        );
        assert!(
            crate::structure::structural_hits(
                from,
                to,
                &crate::torpedoes::torpedo_hull(&d).unwrap()
            )
            .is_empty()
        );
    }
    #[test]
    fn physical_ship_contacts_do_not_fill_catamaran_gap() {
        use crate::{
            rules::TeamId,
            vessel::{CompiledShip, Vessel},
        };
        use std::sync::Arc;
        let (s, c) = catamaran();
        let d = compiled(&s, &c);
        let (mut small, parts) = fixture();
        small.id = "small".into();
        small.construction.primitives[0].size = [1., 1., 2.];
        let tiny = compiled(&small, &parts);
        let a = Vessel::new(
            "cat",
            TeamId::A,
            Arc::new(CompiledShip::new(Arc::new(d), None).unwrap()),
        );
        let mut b = Vessel::new(
            "small",
            TeamId::B,
            Arc::new(CompiledShip::new(Arc::new(tiny), None).unwrap()),
        );
        b.motion.z = 5.;
        let mut actors = vec![a, b];
        crate::collisions::resolve_ship_collisions(&mut actors);
        assert_eq!(actors[0].motion.x, 0.);
        assert_eq!(actors[1].motion.x, 0.);
        assert_eq!(actors[1].motion.z, 5.);
        actors[1].motion.x = 4.;
        crate::collisions::resolve_ship_collisions(&mut actors);
        assert!((actors[1].motion.x - 4.).abs() > 0.1);
    }
    #[test]
    fn actual_load_position_changes_cg_stability_and_attitude() {
        let (mut s, c) = fixture();
        s.construction.loads.push(ConstructionLoad {
            id: "cargo".into(),
            name: "Visible cargo".into(),
            mass_kg: 10000.,
            center: [3., -1., 0.],
            size: [1., 0.5, 1.],
        });
        let low = compiled(&s, &c);
        s.construction.loads[0].center[1] = 1.;
        let high = compiled(&s, &c);
        assert!(
            high.loading.as_ref().unwrap().roll_metacentric_height_m
                < low.loading.as_ref().unwrap().roll_metacentric_height_m
        );
        assert!(low.loading.as_ref().unwrap().center_of_gravity[0] > 0.);
        let hydro = crate::hydrostatics::HullHydrostatics::new(&low.hull, None);
        let mut actor = crate::damage::Combatant::new("test", &low);
        crate::stability::update_stability(&mut actor, &low, &hydro, 1. / 60., 0.5, None);
        assert!(actor.motion.roll < 0.);
        assert_ne!(actor.damage.stability.target_y, 0.);
        // No calibration is introduced for unsafe drafts.
        s.construction.loads[0].mass_kg = 1e7;
        let bad = compile(&s, &c);
        assert!(bad.definition.is_some());
        assert!(bad.diagnostics.iter().any(|d| d.code == "overloaded"));
        assert_eq!(
            bad.definition.unwrap().stability.unwrap().buoyancy_scale,
            1.
        );
    }
    #[test]
    fn armor_uses_submillimeter_space_and_changes_draft() {
        let (mut s, c) = fixture();
        let thin = compiled(&s, &c);
        s.construction.surfaces.push(ConstructionSurfaceAssignment {
            primitive_id: "box".into(),
            face: "starboard".into(),
            thickness_mm: 200.,
            material: "armor-steel".into(),
            paint: "naval-gray".into(),
            open: None,
        });
        let thick = compiled(&s, &c);
        let a = thin.loading.unwrap();
        let b = thick.loading.unwrap();
        assert!(b.mass_kg > a.mass_kg);
        assert!(b.waterline_y > a.waterline_y);
        assert!(b.usable_volume_m3 < a.usable_volume_m3);
        assert!(b.center_of_gravity[0] > a.center_of_gravity[0]);
        s.construction.loads.push(ConstructionLoad {
            id: "edge-load".into(),
            name: "Edge load".into(),
            mass_kg: 100.,
            center: [4.8, 0., 0.],
            size: [0.1, 1., 1.],
        });
        assert!(compile(&s, &c).definition.is_none());
    }
    #[test]
    fn submerged_opening_floods_without_subtracting_buoyancy_twice() {
        let (mut s, c) = fixture();
        s.construction.surfaces.push(ConstructionSurfaceAssignment {
            primitive_id: "box".into(),
            face: "top".into(),
            thickness_mm: 0.,
            material: "steel".into(),
            paint: "naval-gray".into(),
            open: Some(true),
        });
        let d = compiled(&s, &c);
        assert_eq!(d.openings.as_ref().unwrap().len(), 1);
        let mut actor = crate::damage::Combatant::new("open", &d);
        actor.motion.y = -3.;
        let hydro = crate::hydrostatics::HullHydrostatics::new(&d.hull, None);
        let volume = hydro.full_volume();
        crate::flooding::update_flooding(&mut actor, &d, &hydro, 0.1, 0.5, None, None);
        assert!(actor.damage.compartments[0].water_m3 > 0.);
        assert_eq!(hydro.full_volume(), volume);
        let room = &d.compartments[0];
        let water = crate::floodwater::water_body(room, room.capacity_m3 * 0.5, 0., 0.);
        assert!((water.volume - room.capacity_m3 * 0.5).abs() < 1e-8);
        assert!((water.level - 0.005).abs() < 1e-6);
    }
    #[test]
    fn cloned_catalog_admits_only_recompiled_local_sources() {
        let trusted = crate::catalog::Catalog::load(
            &std::fs::read("../../.build/naval-content/manifest.json").unwrap(),
        )
        .unwrap();
        let before = trusted.definitions.len();
        let (s, c) = fixture();
        let d = compiled(&s, &c);
        let local = trusted.with_constructions(&[s], &c).unwrap();
        assert_eq!(trusted.definitions.len(), before);
        assert_eq!(local.definitions.len(), before + 1);
        assert_eq!(local.identities.len(), trusted.identities.len());
        assert_eq!(local.manifest_hash, trusted.manifest_hash);
        assert!(local.compile(&d.id).is_ok());
        assert!(trusted.compile(&d.id).is_err());
    }
}
