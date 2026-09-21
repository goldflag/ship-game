//! Authoritative construction compiler, shared by native tests and local WASM sessions.
use crate::construction_cache::GeometryCache;
use crate::{catalog::sha256, construction_geometry as cg, definition::*, geometry::*};
use std::collections::{BTreeMap, BTreeSet};
pub const COMPILER: &str = "construction-polyhedra-8";
pub const MAX_SOURCE_BYTES: usize = 16_000_000;
pub const MAX_CATALOG_BYTES: usize = 4_000_000;
/// Source bounds; the editor mirrors them in `src/ships/constructionEditor.ts`.
pub const MAX_PRIMITIVES: usize = 10_000;
pub const MAX_SURFACE_ASSIGNMENTS: usize = 65_536;
/// Catalog equipment rows per design: the editor's detail budget. Design-local
/// fittings are counted separately (`construction_custom_fittings::MAX_INSTANCES`).
pub const MAX_EQUIPMENT: usize = 1_000;
/// Ballast and cargo entries, which are unrelated to the fitting detail budget.
pub const MAX_LOADS: usize = 128;
pub const MAX_BOUNDARIES: usize = 24;
/// Derived exposed skin patches, including installation supports.
pub const MAX_SURFACES: usize = 131_072;
/// Flooding portals between rooms; fragmented interiors reach this long before the cell budget.
pub const MAX_CONNECTIONS: usize = 16_384;
const STEEL_DENSITY: f64 = 7850.;
const SEA_DENSITY: f64 = 1025.;
// Provisional game allowance for unmodeled framing, decks and general outfitting.
// Total weight follows the union envelope; distribute it through its lower half
// to represent low internal loading, with actual volume moments for CG/inertia.
// Fitted equipment, service loads, ammunition and authored steel remain additive.
const INTERNAL_ALLOWANCE_KG_PER_M3: f64 = 150.;

/// Fit tolerances. Lofted plating, touching blocks and near-coplanar cuts leave
/// skin-thick residue around a package that no authoring move can remove, so every
/// fit check ignores an outside volume up to one plating skin over the package's own
/// boundary and reports the rest. Keep them here, nowhere else; the TypeScript side
/// reads them back off diagnostics. `docs/construction-authoring.md` lists the values.
pub mod fit {
    /// Outside volume ignored outright, for small wells whose own skin is tiny.
    pub const OUTSIDE_FLOOR_M3: f64 = 0.005;
    /// Outside volume ignored as a fraction of the well's own occupied volume. The
    /// wedges a sloped or seamed block leaves around a well measure well under 1%;
    /// an authored wall or a well outside the hull is worth many times that.
    pub const OUTSIDE_FRACTION: f64 = 0.005;
    /// Distance from an attachment datum to its hull support that still counts as seated.
    /// Lofted station plating moves by centimetres between frames. Kept under the 10 cm
    /// that `tests/construction_deck_fittings.rs` pins as a real gap.
    pub const ATTACHMENT_M: f64 = 0.08;
    /// Depth an exterior body may sink into the hull under its own base area. Left at
    /// 5 mm: it is already a volume allowance over the whole base, and the sloped-hull
    /// obstruction case in `tests/construction_integral_ammunition.rs` sits just above
    /// it, so a larger figure would stop catching a pillar through a gun body.
    pub const FITTED_BASE_M: f64 = 0.005;
    /// A working well whose top stops this far below a deck still crosses it.
    pub const DECK_CROSSING_M: f64 = 0.01;
    /// Outside volume a fit check ignores for a package of this occupied volume.
    pub fn outside_allowance_m3(occupied_m3: f64) -> f64 {
        OUTSIDE_FLOOR_M3.max(occupied_m3 * OUTSIDE_FRACTION)
    }
}

pub(crate) fn valid_id(s: &str) -> bool {
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
/// Paint for faces, keels and barbettes without a more specific coating.
pub(crate) fn ship_paint(c: &ConstructionData) -> &str {
    c.paint.as_deref().unwrap_or("naval-gray")
}
fn error(code: &str, message: impl Into<String>, id: Option<&str>) -> ConstructionDiagnostic {
    ConstructionDiagnostic {
        severity: "error".into(),
        code: code.into(),
        message: message.into(),
        source_id: id.map(str::to_owned),
        ..Default::default()
    }
}
/// Independent fatal diagnostics collected per compile before collection stops.
pub const MAX_ERRORS: usize = 32;
/// Reports every collected fatal diagnostic; the caller returns the last one.
fn fail_all(
    out: &mut ConstructionResult,
    mut errors: Vec<ConstructionDiagnostic>,
) -> Result<(), ConstructionDiagnostic> {
    let Some(last) = errors.pop() else {
        return Ok(());
    };
    out.diagnostics.append(&mut errors);
    Err(last)
}
/// States which checks a failed phase left unrun, so their silence is not read as a pass.
fn skipped(out: &mut ConstructionResult, message: String) {
    out.diagnostics.push(ConstructionDiagnostic {
        severity: "warning".into(),
        code: "checks-skipped".into(),
        message,
        ..Default::default()
    });
}
/// Names the other party of an overlap; identical parts read as "another …".
pub(crate) fn neighbor_name(own: &str, other: &str) -> String {
    if own == other {
        format!("another {other}")
    } else {
        other.to_owned()
    }
}
fn portal_limit(connections: usize, openings: usize) -> ConstructionDiagnostic {
    error(
        "geometry-limit",
        format!(
            "Subdivision has {connections} flooding portals (limit {MAX_CONNECTIONS}) and {openings} openings (limit 4096)"
        ),
        None,
    )
}
pub(crate) fn warn(out: &mut ConstructionResult, code: &str, message: &str) {
    out.diagnostics.push(ConstructionDiagnostic {
        severity: "warning".into(),
        code: code.into(),
        message: message.into(),
        source_id: None,
        ..Default::default()
    });
}

pub fn compile_json(source: &str, catalog: &str) -> Result<String, String> {
    ConstructionCompiler::default().compile_json(source, catalog)
}

/// One editor's bounded geometry cache. Results remain identical to a fresh compiler;
/// every edit still validates fit, loading and launchability for its exact revision.
#[derive(Default)]
pub struct ConstructionCompiler {
    geometry: GeometryCache,
    scope: Option<(String, String)>,
}
impl ConstructionCompiler {
    pub fn compile_json(&mut self, source: &str, catalog: &str) -> Result<String, String> {
        to_json(&self.compile_input(source, catalog)?)
    }
    /// Compact editor-only result; native/public definition JSON remains unchanged.
    pub fn compile_compact_json(&mut self, source: &str, catalog: &str) -> Result<String, String> {
        crate::construction_transport::encode(&self.compile_input(source, catalog)?)
    }
    fn compile_input(&mut self, source: &str, catalog: &str) -> Result<ConstructionResult, String> {
        if source.len() > MAX_SOURCE_BYTES || catalog.len() > MAX_CATALOG_BYTES {
            return Err("Construction input exceeds bounded JSON size".into());
        }
        let source: ConstructionSource = serde_json::from_str(source).map_err(|e| e.to_string())?;
        let catalog: ConstructionCatalog =
            serde_json::from_str(catalog).map_err(|e| e.to_string())?;
        Ok(self.compile(&source, &catalog))
    }
    pub fn compile(
        &mut self,
        source: &ConstructionSource,
        catalog: &ConstructionCatalog,
    ) -> ConstructionResult {
        let scope = (source.id.clone(), catalog.revision.clone());
        if self.scope.as_ref() != Some(&scope) {
            self.geometry = GeometryCache::default();
            self.scope = Some(scope);
        }
        self.geometry.begin();
        compile_cached(source, catalog, &mut self.geometry)
    }
    pub fn reused_geometry_operations(&self) -> usize {
        self.geometry.hits
    }
}
pub fn suggest_json(source: &str, catalog: &str, part_ids: &str) -> Result<String, String> {
    if source.len() > MAX_SOURCE_BYTES || catalog.len() > MAX_CATALOG_BYTES || part_ids.len() > 4096
    {
        return Err("Suggestion input exceeds size limit".into());
    }
    let source: ConstructionSource = serde_json::from_str(source).map_err(|e| e.to_string())?;
    let catalog: ConstructionCatalog = serde_json::from_str(catalog).map_err(|e| e.to_string())?;
    let ids: Vec<String> = serde_json::from_str(part_ids).map_err(|e| e.to_string())?;
    to_json(&suggest(&source, &catalog, &ids))
}
/// Deterministic bounded proposal. Existing instances never move; every accepted
/// addition passes the same complete compiler as manual edits. Failure is atomic.
pub fn suggest(
    source: &ConstructionSource,
    catalog: &ConstructionCatalog,
    ids: &[String],
) -> ConstructionSuggestion {
    let fail = |code: &str, message: String, id: Option<&str>| ConstructionSuggestion {
        source: source.clone(),
        diagnostics: vec![error(code, message, id)],
    };
    let catalog =
        &*crate::construction_custom_fittings::effective_catalog(&source.construction, catalog);
    if ids.len() > 16 {
        return fail(
            "suggestion-limit",
            "Suggest at most 16 equipment parts at once".into(),
            None,
        );
    }
    let mut result = source.clone();
    let mut requested = vec![];
    for id in ids {
        let Some(p) = catalog.equipment.iter().find(|p| p.id == *id) else {
            return fail("missing-part", format!("Unknown requested part {id}"), None);
        };
        if source.construction.version >= 2. && p.kind == "magazine" {
            return fail(
                "integrated-magazine",
                "Ammunition is already built into each weapon".into(),
                None,
            );
        }
        if p.path.is_some() {
            return fail(
                "equipment-path",
                "Draw connected fittings between chosen attachment points".into(),
                None,
            );
        }
        if !result
            .construction
            .equipment
            .iter()
            .any(|e| e.part_id == *id)
            && !requested
                .iter()
                .any(|p: &&ConstructionEquipmentPart| p.id == *id)
        {
            requested.push(p);
        }
    }
    requested.sort_by_key(|p| match p.kind.as_str() {
        "engine" => 0,
        "magazine" => 1,
        "funnel" => 2,
        "propeller" => 3,
        "rudder" => 4,
        "gun" => 5,
        _ => 6,
    });
    let mut attempts = 0;
    // A draft whose only faults belong to fittings still offers its hull. Those
    // fittings are set aside for support geometry and must stay exactly as faulty.
    let mut set_aside: BTreeSet<String> = BTreeSet::new();
    for part in requested {
        let mut preview = compile(&result, catalog);
        let draft_faults = fault_keys(&preview);
        if preview.definition.is_none() {
            let blocked = preview.diagnostics.clone();
            let mut sound = result.clone();
            // Setting fittings aside can uncover faults of later phases; bounded rounds.
            for _ in 0..4 {
                let Some(faulty) = fitting_faults(&sound, &preview.diagnostics) else {
                    break;
                };
                set_aside.extend(faulty);
                sound
                    .construction
                    .equipment
                    .retain(|e| !set_aside.contains(&e.id));
                preview = compile(&sound, catalog);
                if preview.definition.is_some() {
                    break;
                }
            }
            if preview.definition.is_none() {
                return ConstructionSuggestion {
                    source: source.clone(),
                    diagnostics: blocked,
                };
            }
        }
        let Some(def) = preview.definition.as_ref() else {
            unreachable!()
        };
        let socket = part
            .sockets
            .as_ref()
            .and_then(|s| s.iter().find(|s| s.id == "attachment"));
        let offset = socket.map_or([0.; 3], |s| s.position);
        let direction = socket.map_or([0., -1., 0.], |s| s.direction);
        let mut patches: Vec<(Vec<Vec3>, Vec3, f64)> = preview
            .surfaces
            .iter()
            .filter(|s| {
                !s.open
                    && if part.placement == "internal" {
                        s.normal[1] < -0.95
                    } else {
                        dot(s.normal, direction) < -0.95
                    }
            })
            .map(|s| {
                (
                    s.vertices.clone(),
                    s.normal,
                    if part.placement == "internal" {
                        -s.thickness_mm / 1000.
                    } else {
                        0.
                    },
                )
            })
            .collect();
        if part.placement == "internal" {
            patches.extend(def.armor.iter().filter_map(|a| {
                a.plate
                    .as_ref()
                    .filter(|p| p.exterior == Some(false) && cg::normal(&p.vertices)[1] > 0.95)
                    .map(|p| {
                        (
                            p.vertices.clone(),
                            cg::normal(&p.vertices),
                            a.thickness_mm / 2000.,
                        )
                    })
            }));
        }
        let mut candidates = vec![];
        for (polygon, normal, inset) in patches {
            let (center, size) = crate::structure::bounds(polygon.iter().copied());
            let fixed = (0..3)
                .max_by(|a, b| normal[*a].abs().total_cmp(&normal[*b].abs()))
                .unwrap();
            let axes: Vec<_> = (0..3).filter(|i| *i != fixed).collect();
            let mut values = [vec![], vec![]];
            for (j, &a) in axes.iter().enumerate() {
                let half = part.size[a] * 0.5;
                let lo = center[a] - size[a] * 0.5 + half;
                let hi = center[a] + size[a] * 0.5 - half;
                if lo > hi {
                    values[j].push(center[a]);
                } else {
                    values[j].push(center[a]);
                    let step = (part.size[a] + 0.25).max(0.5);
                    let mut v = lo;
                    while v <= hi + 1e-8 && values[j].len() < 16 {
                        values[j].push((v * 4.).round() / 4.);
                        v += step;
                    }
                }
            }
            for &a in &values[0] {
                for &b in &values[1] {
                    let mut p = center;
                    p[axes[0]] = a;
                    p[axes[1]] = b;
                    p = add(p, scale(normal, inset));
                    candidates.push(sub(p, offset));
                }
            }
        }
        // Favor low internal loads and submerged appendages; then stable source frame order.
        candidates.sort_by(|a, b| {
            a[1].total_cmp(&b[1])
                .then_with(|| a[2].total_cmp(&b[2]))
                .then_with(|| a[0].total_cmp(&b[0]))
        });
        candidates.dedup_by(|a, b| length(sub(*a, *b)) < 1e-7);
        let mut accepted = None;
        let mut last = None;
        for position in candidates {
            if attempts >= 256 {
                break;
            }
            attempts += 1;
            let mut id = format!("auto-{}", part.id.chars().take(48).collect::<String>());
            let mut serial = 1;
            while result.construction.equipment.iter().any(|e| e.id == id) {
                id = format!(
                    "auto-{}-{serial}",
                    part.id.chars().take(48).collect::<String>()
                );
                serial += 1;
            }
            let e = ConstructionEquipment {
                wall: None,
                id,
                part_id: part.id.clone(),
                position,
                bearing_deg: 0.,
                magazine_id: None,
                paint: None,
                gun: None,
                launcher: None,
                path: None,
                power_source_id: None,
            };
            let mut candidate = result.clone();
            candidate.construction.equipment.push(e);
            let compiled = if set_aside.is_empty() {
                compile(&candidate, catalog)
            } else {
                // Valid without the faulty fittings, and no new fault beside them.
                let mut sound = candidate.clone();
                sound
                    .construction
                    .equipment
                    .retain(|e| !set_aside.contains(&e.id));
                let compiled = compile(&sound, catalog);
                if compiled.definition.is_some()
                    && fault_keys(&compile(&candidate, catalog)) != draft_faults
                {
                    continue;
                }
                compiled
            };
            if compiled.definition.is_some() {
                accepted = Some(candidate);
                break;
            }
            last = compiled
                .diagnostics
                .into_iter()
                .find(|d| d.severity == "error");
        }
        let Some(candidate) = accepted else {
            return fail(
                "suggestion-fit",
                format!(
                    "Could not place {} within 256 attempts; {}",
                    part.name,
                    last.map_or(
                        "add a suitably sized flat support or internal floor".into(),
                        |d| d.message
                    )
                ),
                Some(&part.id),
            );
        };
        result = candidate;
    }
    result.revision = format!(
        "suggest-{}",
        &sha256(&serde_json::to_vec(&result).unwrap())[..24]
    );
    ConstructionSuggestion {
        source: result,
        diagnostics: if set_aside.is_empty() {
            vec![]
        } else {
            let ids: Vec<_> = set_aside.into_iter().collect();
            vec![ConstructionDiagnostic {
                severity: "warning".into(),
                code: "suggestion-draft".into(),
                message: format!(
                    "Placed against the draft without its faulty fittings: {}. They are unchanged and still block the compile",
                    ids.join(", ")
                ),
                related_source_ids: Some(ids.into()),
                ..Default::default()
            }]
        },
    }
}
/// Fatal diagnostics by code and source; equal sets mean an edit added no fault.
fn fault_keys(result: &ConstructionResult) -> BTreeSet<(String, Option<String>)> {
    result
        .diagnostics
        .iter()
        .filter(|d| d.severity == "error")
        .map(|d| (d.code.clone(), d.source_id.clone()))
        .collect()
}
/// The fittings to set aside, when every fatal diagnostic names one; otherwise the hull is at fault.
fn fitting_faults(
    source: &ConstructionSource,
    diagnostics: &[ConstructionDiagnostic],
) -> Option<BTreeSet<String>> {
    let faulty: Option<BTreeSet<String>> = diagnostics
        .iter()
        .filter(|d| d.severity == "error")
        .map(|d| {
            d.source_id
                .as_ref()
                .filter(|id| source.construction.equipment.iter().any(|e| e.id == **id))
                .cloned()
        })
        .collect();
    faulty.filter(|ids| !ids.is_empty())
}
/// TypeScript optional properties are omitted, rather than encoded as JSON null.
pub fn to_json(value: &impl serde::Serialize) -> Result<String, String> {
    serde_json::to_string(&json_value(value)?).map_err(|e| e.to_string())
}
pub(crate) fn json_value(value: &impl serde::Serialize) -> Result<serde_json::Value, String> {
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
    Ok(value)
}
pub fn compile(source: &ConstructionSource, catalog: &ConstructionCatalog) -> ConstructionResult {
    ConstructionCompiler::default().compile(source, catalog)
}
fn compile_cached(
    source: &ConstructionSource,
    catalog: &ConstructionCatalog,
    cache: &mut GeometryCache,
) -> ConstructionResult {
    let content_hash = sha256(
        &serde_json::to_vec(&(COMPILER, crate::SIMULATION_BUILD, source, catalog))
            .unwrap_or_default(),
    );
    let mut out = ConstructionResult {
        source_id: source.id.clone(),
        revision: source.revision.clone(),
        content_hash,
        ..Default::default()
    };
    let mut installation_surfaces = vec![];
    if let Err(e) = build(source, catalog, &mut out, &mut installation_surfaces, cache) {
        out.definition = None;
        out.diagnostics.push(e);
        // The note on unrun checks reads last.
        if let Some(i) = out
            .diagnostics
            .iter()
            .position(|d| d.code == "checks-skipped")
        {
            let note = out.diagnostics.remove(i);
            out.diagnostics.push(note);
        }
    }
    // Invalid drafts still show their fixed supports and deck collars. A fit
    // diagnostic blocks admission, not the geometry needed to repair the draft.
    out.surfaces.append(&mut installation_surfaces);
    if out.definition.is_some() {
        let mut faces = vec![];
        for primitive in &source.construction.primitives {
            faces.extend(crate::construction_bilge_keels::surfaces(
                primitive,
                ship_paint(&source.construction),
            ));
            if out.surfaces.len() + faces.len() > MAX_SURFACES {
                out.definition = None;
                out.diagnostics.push(error(
                    "complexity",
                    "Bilge keels exceed the exposed surface limit",
                    Some(&primitive.id),
                ));
                return out;
            }
        }
        if !faces.is_empty() {
            out.bilge_keel_surfaces = Some(faces);
        }
    }
    out
}
/// Every independent source fault, in source order. Header and size faults stop the
/// list: nothing below them can be read reliably.
fn validate(
    source: &ConstructionSource,
    catalog: &ConstructionCatalog,
) -> Vec<ConstructionDiagnostic> {
    let c = &source.construction;
    if source.schema_version != 1.
        || (c.version != 1. && c.version != 2.)
        || source.coordinates != "meters-y-up-bow-negative-z"
        || !valid_id(&source.id)
        || source.name.is_empty()
        || source.name.len() > 160
        || !valid_id(&source.revision)
    {
        return vec![error(
            "source",
            "Unsupported source version, coordinates or identity",
            None,
        )];
    }
    if catalog.schema_version != 1.
        || catalog.weapons.schema_version != 1.
        || c.catalog_revision != catalog.revision
    {
        return vec![error(
            "catalog-revision",
            "The saved equipment catalog revision is unavailable",
            None,
        )];
    }
    let mut errors = vec![];
    // Design-local fittings have their own instance budget.
    let custom_instances = c
        .equipment
        .iter()
        .filter(|e| crate::construction_custom_fittings::is_custom(&e.part_id))
        .count();
    for (count, limit, noun) in [
        (c.primitives.len(), MAX_PRIMITIVES, "hull primitives"),
        (
            c.surfaces.len(),
            MAX_SURFACE_ASSIGNMENTS,
            "face assignments",
        ),
        (
            c.equipment.len() - custom_instances,
            MAX_EQUIPMENT,
            "equipment instances",
        ),
        (
            custom_instances,
            crate::construction_custom_fittings::MAX_INSTANCES,
            "custom fitting instances",
        ),
        (
            c.fittings.as_ref().map_or(0, Vec::len),
            crate::construction_custom_fittings::MAX_DEFINITIONS,
            "custom fitting definitions",
        ),
        (c.boundaries.len(), MAX_BOUNDARIES, "boundaries"),
        (c.loads.len(), MAX_LOADS, "loads"),
    ] {
        if count > limit {
            errors.push(error(
                "complexity",
                format!(
                    "{count} {noun} exceed the limit of {limit}; remove {}",
                    count - limit
                ),
                None,
            ));
        }
    }
    if !c.primitives.iter().any(|p| p.kind != "balcony") {
        errors.push(error("complexity", "Add at least one hull primitive", None));
    }
    if !errors.is_empty() {
        return errors;
    }
    for (noun, ids) in [
        (
            "hull primitive",
            c.primitives
                .iter()
                .map(|p| p.id.as_str())
                .collect::<Vec<_>>(),
        ),
        (
            "equipment",
            c.equipment.iter().map(|p| p.id.as_str()).collect(),
        ),
        (
            "boundary",
            c.boundaries.iter().map(|p| p.id.as_str()).collect(),
        ),
        ("load", c.loads.iter().map(|p| p.id.as_str()).collect()),
    ] {
        let mut seen = BTreeSet::new();
        let mut reported = BTreeSet::new();
        for (i, id) in ids.into_iter().enumerate() {
            if errors.len() >= MAX_ERRORS {
                break;
            }
            if !valid_id(id) {
                errors.push(error(
                    "identity",
                    format!(
                        "The {noun} at index {i} needs an ID of 1–64 letters, digits, '-' or '_'"
                    ),
                    (!id.is_empty() && id.len() <= 64).then_some(id),
                ));
            } else if !seen.insert(id) && reported.insert(id) {
                errors.push(error(
                    "identity",
                    format!(
                        "More than one {noun} uses the ID {id}; instances require unique stable IDs"
                    ),
                    Some(id),
                ));
            }
        }
    }
    // Every later check names an instance by ID.
    if !errors.is_empty() {
        return errors;
    }
    if !c.default_thickness_mm.is_finite() || !(0.1..=1000.).contains(&c.default_thickness_mm) {
        errors.push(error(
            "plating",
            "Structural skin must be 0.1–1000 mm",
            None,
        ));
    }
    if c.finish
        .as_deref()
        .is_some_and(|f| !["matte", "satin", "semi-gloss", "gloss"].contains(&f))
    {
        errors.push(error(
            "surface-finish",
            "Unsupported ship surface finish",
            None,
        ));
    }
    if c.paint
        .as_ref()
        .is_some_and(|paint| paint.is_empty() || paint.len() > 64)
    {
        errors.push(error(
            "ship-paint",
            "Ship paint must be a nonempty name of at most 64 bytes",
            None,
        ));
    }
    for e in &c.equipment {
        if errors.len() >= MAX_ERRORS {
            break;
        }
        let rise = crate::construction_installation::raised(e);
        if e.paint
            .as_ref()
            .is_some_and(|paint| paint.is_empty() || paint.len() > 64)
        {
            errors.push(error(
                "equipment-paint",
                "Fitting paint must be a nonempty name of at most 64 bytes",
                Some(&e.id),
            ));
        } else if !rise.is_finite()
            || !(0. ..=30.).contains(&rise)
            || (c.version < 2. && rise != 0.)
        {
            errors.push(error(
                "barbette-height",
                "Barbette height must be between 0 and 30 m on a version-2 gun installation",
                Some(&e.id),
            ));
        } else if c.version >= 2.
            && let Some(other) = c
                .equipment
                .iter()
                .find(|other| other.id == format!("{}-magazine", e.id))
        {
            let mut d = error(
                "identity",
                format!(
                    "Equipment ID conflicts with the built-in magazine of {}; rename {}",
                    e.id, other.id
                ),
                Some(&e.id),
            );
            d.related_source_ids = Some([other.id.clone()].into());
            errors.push(d);
        }
    }
    for p in &c.primitives {
        if errors.len() >= MAX_ERRORS {
            break;
        }
        if !primitive_valid(p) {
            errors.push(error(
                "primitive",
                "Invalid primitive dimensions, shape or rotation",
                Some(&p.id),
            ));
        }
    }
    let mut assignments = BTreeSet::new();
    for s in &c.surfaces {
        if errors.len() >= MAX_ERRORS {
            break;
        }
        let fault = if !c.primitives.iter().any(|p| p.id == s.primitive_id) {
            Some(format!(
                "names the missing hull primitive {}",
                s.primitive_id
            ))
        } else if ![
            "port",
            "starboard",
            "bottom",
            "top",
            "bow",
            "stern",
            "slope",
        ]
        .contains(&s.face.as_str())
        {
            Some(format!("has the unknown face {}", s.face))
        } else if !assignments.insert((&s.primitive_id, &s.face, &s.panel_id)) {
            Some(format!("repeats the {} face", s.face))
        } else if s.panel_id.as_ref().is_some_and(|panel| {
            panel.is_empty()
                || panel.len() > 512
                || !c.primitives.iter().any(|p| {
                    p.id == s.primitive_id && (p.kind == "custom-hull" || p.solid.is_some())
                })
        }) {
            Some("has a panel ID that only a custom hull or a compound solid can carry".into())
        } else if !s.thickness_mm.is_finite() || !(0.0..=1000.).contains(&s.thickness_mm) {
            Some("needs a thickness of 0–1000 mm".into())
        } else if !["steel", "armor-steel"].contains(&s.material.as_str()) {
            Some(format!("has the unknown material {}", s.material))
        } else if s.paint.is_empty() || s.paint.len() > 64 {
            Some("needs a paint name of 1–64 bytes".into())
        } else {
            None
        };
        if let Some(fault) = fault {
            errors.push(error(
                "surface",
                format!("Invalid or duplicate surface assignment: it {fault}"),
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
            errors.push(error(
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
            errors.push(error(
                "load",
                "Load mass and occupied volume must be positive and bounded",
                Some(&l.id),
            ));
        }
    }
    errors
}
/// Dimensions, placement, rotation and shape records of one source piece; topology is checked
/// when its cells are built.
pub(crate) fn primitive_valid(p: &ConstructionPrimitive) -> bool {
    !((p.kind != "vertex"
        && (p.vertices.is_some() || p.shaping.is_some() || p.mesh.is_some() || p.solid.is_some()))
        || (p.kind != "custom-hull" && p.custom_hull.is_some())
        || (p.kind != "balcony" && p.balcony.is_some())
        || !size(p.size)
        || !finite(p.position)
        || !crate::construction_orientation::valid(p)
        || (p.kind != "vertex"
            && p.kind != "custom-hull"
            && p.kind != "balcony"
            && !crate::construction_shapes::KINDS.contains(&p.kind.as_str())))
}
/// Original solid cells before union splitting. Experimental combat proxies may
/// use their union for collision, provided buoyancy is supplied independently.
pub fn primitive_cells(p: &ConstructionPrimitive) -> Result<Vec<cg::Cell>, String> {
    if p.kind == "balcony" {
        return crate::construction_balcony::build(p).map(|s| s.cells);
    }
    if p.kind == "custom-hull" {
        return crate::construction_custom_hull::build(p).map(|s| s.cells);
    }
    if p.kind == "vertex" {
        return crate::construction_vertex::build(p).map(|s| s.cells);
    }
    if !crate::construction_shapes::KINDS.contains(&p.kind.as_str()) {
        return Err("Unknown construction shape".into());
    }
    Ok(primitive(p))
}
fn primitive(p: &ConstructionPrimitive) -> Vec<cg::Cell> {
    crate::construction_shapes::cells(&p.kind)
        .unwrap()
        .iter()
        .map(|c| crate::construction_orientation::cell(p, c, p.size))
        .collect()
}
pub(crate) fn face_name(p: &[Vec3], primitive: &ConstructionPrimitive) -> String {
    // Undo orientation to keep source face paint and armor attached.
    let n = if primitive.tilt.is_none() {
        normal_local(cg::normal(p), -primitive.rotation_deg.to_radians())
    } else {
        crate::construction_orientation::inverse(primitive, cg::normal(p))
    };
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
    installation_surfaces: &mut Vec<ConstructionSurface>,
    cache: &mut GeometryCache,
) -> Result<(), ConstructionDiagnostic> {
    fail_all(out, validate(source, catalog))?;
    let c = &source.construction;
    // Design-local fittings join the catalog for every lookup below; a design without them
    // keeps the supplied catalog untouched.
    let custom = crate::construction_custom_fittings::resolve(c, MAX_ERRORS);
    let extended;
    let catalog = match custom {
        Ok(parts)
            if parts.is_empty()
                && !catalog
                    .equipment
                    .iter()
                    .any(|p| crate::construction_custom_fittings::is_custom(&p.id)) =>
        {
            catalog
        }
        Ok(parts) => {
            let mut all = catalog.clone();
            all.equipment
                .retain(|p| !crate::construction_custom_fittings::is_custom(&p.id));
            all.equipment.extend(parts);
            extended = all;
            &extended
        }
        Err(errors) => {
            skipped(
                out,
                "Hull, fittings and loading were not checked: fix the custom fitting definitions first".into(),
            );
            return fail_all(out, errors);
        }
    };
    let fail = |s: String| error("geometry", s, None);
    let mut primitives: Vec<_> = c.primitives.iter().collect();
    primitives.sort_by(|a, b| a.id.cmp(&b.id));
    let mut errors = vec![];
    let raw: Vec<_> = primitives
        .iter()
        .map(|p| {
            if p.kind == "balcony" {
                crate::construction_balcony::build(p)
                    .map_err(|message| error("balcony", message, Some(&p.id)))
            } else if p.kind == "custom-hull" {
                crate::construction_custom_hull::build(p)
                    .map_err(|message| error("custom-hull", message, Some(&p.id)))
            } else if p.solid.is_some() {
                crate::construction_solid::build(p)
                    .map_err(|message| error("compound-solid", message, Some(&p.id)))
            } else if p.kind == "vertex" {
                crate::construction_vertex::build(p)
                    .map_err(|message| error("vertex-hull", message, Some(&p.id)))
            } else {
                let cells = primitive(p);
                let faces = cells
                    .iter()
                    .flat_map(|cell| cell.faces.iter())
                    .map(|f| (face_name(&f.vertices, p), f.vertices.clone()))
                    .collect();
                Ok(crate::construction_vertex::VertexSolid { cells, faces })
            }
        })
        .filter_map(|solid| solid.map_err(|e| errors.push(e)).ok())
        .collect();
    if !errors.is_empty() {
        errors.truncate(MAX_ERRORS);
        skipped(
            out,
            "Hull attachment, plating, subdivision, fittings and loading were not checked: fix the hull pieces first".into(),
        );
        return fail_all(out, errors);
    }
    // Index convex cells once, then collect their owning source-piece neighbors.
    // Vertex solids and compound library shapes may hold several cells;
    // single-cell primitives retain the 10k-piece fast path.
    let flat: Vec<_> = raw.iter().flat_map(|p| p.cells.iter().cloned()).collect();
    let owners: Vec<_> = raw
        .iter()
        .enumerate()
        .flat_map(|(i, p)| std::iter::repeat_n(i, p.cells.len()))
        .collect();
    cg::check_budget(&flat).map_err(fail)?;
    let index = cg::Broadphase::sized_for(&flat);
    let cell_neighbors: Vec<Vec<usize>> = (0..flat.len())
        .map(|i| {
            index
                .candidates(&flat[i])
                .into_iter()
                .filter(|&j| j != i && !cg::separated(&flat[i], &flat[j]))
                .collect()
        })
        .collect();
    let mut neighbors = vec![BTreeSet::new(); raw.len()];
    for (i, nearby) in cell_neighbors.iter().enumerate() {
        for &j in nearby {
            if owners[i] != owners[j] {
                neighbors[owners[i]].insert(owners[j]);
            }
        }
    }
    let mut reached = vec![false; raw.len()];
    let mut queue = vec![0];
    reached[0] = true;
    while let Some(a) = queue.pop() {
        for &b in &neighbors[a] {
            if !reached[b]
                && raw[a]
                    .cells
                    .iter()
                    .any(|x| raw[b].cells.iter().any(|y| cg::connected(x, y)))
            {
                reached[b] = true;
                queue.push(b);
            }
        }
    }
    // Every piece outside the first piece's connected group, up to the diagnostic cap.
    // The smaller side of the split is the one reported as detached.
    let mut detached: Vec<_> = (0..raw.len()).filter(|&i| !reached[i]).collect();
    if !detached.is_empty() {
        if detached.len() * 2 > raw.len() {
            detached = (0..raw.len()).filter(|&i| reached[i]).collect();
        }
        let anchor = (0..raw.len()).find(|i| !detached.contains(i)).unwrap_or(0);
        for &i in detached.iter().take(MAX_ERRORS) {
            let mut d = error(
                "attachment",
                format!(
                    "Detached hull pieces need a physical face attachment or connecting beam: {} is not joined to the group of {}",
                    primitives[i].id, primitives[anchor].id
                ),
                Some(&primitives[i].id),
            );
            d.related_source_ids = Some([primitives[anchor].id.clone()].into());
            errors.push(d);
        }
        skipped(
            out,
            format!(
                "{} hull pieces are detached; plating, subdivision, fittings and loading were not checked",
                detached.len()
            ),
        );
        return fail_all(out, errors);
    }
    // Balcony geometry remains available for rendering and authoring attachments,
    // but must never split hull cells or contribute to simulation solids.
    let balconies: BTreeSet<_> = primitives
        .iter()
        .filter(|p| p.kind == "balcony")
        .map(|p| p.id.as_str())
        .collect();
    let structural = |s: &ConstructionSurface| !balconies.contains(s.primitive_id.as_str());
    let mut hull_cells = vec![];
    let mut platform_cells = vec![];
    let remap: Vec<_> = flat
        .iter()
        .enumerate()
        .map(|(i, cell)| {
            if primitives[owners[i]].kind == "balcony" {
                platform_cells.push(cell.clone());
                None
            } else {
                let index = hull_cells.len();
                hull_cells.push(cell.clone());
                Some(index)
            }
        })
        .collect();
    let hull_neighbors: Vec<_> = cell_neighbors
        .iter()
        .enumerate()
        .filter(|(i, _)| remap[*i].is_some())
        .map(|(_, near)| near.iter().filter_map(|&j| remap[j]).collect())
        .collect();
    let cells = cache
        .union_near(&hull_cells, &hull_neighbors)
        .map_err(fail)?;
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
            if crate::construction_installation::deck_mounted(c, catalog, p) {
                continue;
            }
            for space in crate::construction_installation::spaces(c, catalog, p, e) {
                if !finite(space.center) || !size(space.size) {
                    return Err(error(
                        "equipment-data",
                        "Invalid installation well",
                        Some(&e.id),
                    ));
                }
                let cell = crate::construction_installation::crossing_cell(
                    cg::transform(
                        &crate::construction_installation::space_cell(catalog, p, &space),
                        e.position,
                        [1.; 3],
                        -e.bearing_deg.to_radians(),
                    ),
                    &cells,
                    fit::DECK_CROSSING_M,
                );
                wells.push((e.id.clone(), p.kind.clone(), cell));
            }
        }
    }
    let mut penetrations = vec![];
    for (i, p) in primitives.iter().enumerate() {
        for (face, polygon) in raw[i].faces.iter() {
            let panel = face.clone();
            let face = face.split(':').next().unwrap().to_string();
            // A compound solid labels only the polygons that carry a surface group; the rest
            // stay on their canonical side, so an ungrouped face has no panel to override.
            let panel_id = panel
                .split_once(':')
                .map(|(_, id)| id.to_string())
                .or_else(|| (p.kind == "custom-hull").then(|| panel.clone()));
            let a = c
                .surfaces
                .iter()
                .find(|a| a.primitive_id == p.id && a.face == face && a.panel_id == panel_id)
                .or_else(|| {
                    c.surfaces
                        .iter()
                        .find(|a| a.primitive_id == p.id && a.face == face && a.panel_id.is_none())
                });
            let mut patches = vec![polygon.clone()];
            for &j in &neighbors[i] {
                // Decorative platforms cannot cut or fragment structural plating.
                if p.kind != "balcony" && primitives[j].kind == "balcony" {
                    continue;
                }
                for cell in &raw[j].cells {
                    patches = patches
                        .iter()
                        .flat_map(|patch| cg::exposed(patch, cell, i < j))
                        .collect();
                }
            }
            if p.kind != "balcony" && cg::normal(polygon)[1] > 0.95 {
                for (id, kind, well) in &wells {
                    let mut remaining = vec![];
                    for patch in patches {
                        let mut covered = patch.clone();
                        for plane in well.faces.iter() {
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
                let id = format!("{}:{}", p.id, panel);
                out.surfaces.push(ConstructionSurface {
                    panel_id: panel_id.clone(),
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
                    paint: a.map_or(ship_paint(c), |a| a.paint.as_str()).into(),
                    open: a.is_some_and(|a| a.open == Some(true)),
                });
                if out.surfaces.len() > MAX_SURFACES {
                    return Err(error("complexity", "Exposed surface limit exceeded", None));
                }
            }
        }
    }
    // Prepare the complete installation preview before load, boundary or equipment
    // validation can exit. Keep it separate from hull skin until installation
    // mass/protection is added, so it cannot count as plating or an attachment.
    let mut installations = crate::construction_installation::derive(c, catalog)
        .map_err(|e| error("installation-support", e, None))?;
    if out.surfaces.len()
        + installations
            .iter()
            .map(|i| i.surfaces.len())
            .sum::<usize>()
        > MAX_SURFACES
    {
        return Err(error(
            "complexity",
            format!("Installation surfaces exceed the {MAX_SURFACES} surface limit"),
            None,
        ));
    }
    for installation in &mut installations {
        installation_surfaces.append(&mut installation.surfaces);
    }
    let hull_index = cg::Broadphase::sized_for(&cells);
    let mut material: Vec<cg::Cell> = vec![];
    let mut material_budget = cg::CellBudget::default();
    let mut material_index = cg::Broadphase::new(hull_index.pitch());
    let mut contributions = vec![];
    for (i, s) in out
        .surfaces
        .iter()
        .filter(|s| structural(s))
        .enumerate()
        .filter(|(_, s)| !s.open)
    {
        let solid = cg::prism(&s.vertices, s.thickness_mm / 1000.);
        let clipped: Vec<_> = hull_index
            .candidates(&solid)
            .into_iter()
            .filter_map(|k| cg::intersection(&solid, &cells[k]))
            .collect();
        // Inward extrusion of a sloping deck shifts its cut edge sideways.
        // Keep the full plating thickness out of the vertical working well,
        // using the same cutters as the exposed deck; side armor stays intact.
        let clipped = if s.normal[1] > 0.95 {
            cache
                .subtract_all(clipped, wells.iter().map(|(_, _, well)| well))
                .map_err(fail)?
        } else {
            clipped
        };
        let cutters = material_index.candidates(&solid);
        let occupied = cache
            .subtract_all(clipped, cutters.iter().map(|&k| &material[k]))
            .map_err(fail)?;
        if !occupied.is_empty() {
            contributions.push(mass(
                format!("skin-{}-{i}", s.id),
                "skin",
                &occupied,
                STEEL_DENSITY,
            ));
            for cell in &occupied {
                material_index.insert(cell);
            }
            material_budget.add(&occupied).map_err(fail)?;
            material.extend(occupied);
        }
    }
    let (center, dimensions) = crate::structure::bounds(
        cells
            .iter()
            .flat_map(|c| c.faces.iter().flat_map(|f| f.vertices.iter().copied())),
    );
    let lower_hull: Vec<_> = cells
        .iter()
        .filter_map(|cell| cg::clip(cell, [0., 1., 0.], center[1]))
        .collect();
    let lower_volume = cg::total(&lower_hull).volume;
    if lower_volume > cg::EPS {
        contributions.push(mass(
            "hull-internal-allowance".into(),
            "internal-allowance",
            &lower_hull,
            envelope.volume * INTERNAL_ALLOWANCE_KG_PER_M3 / lower_volume,
        ));
    }
    let mut boundaries: Vec<_> = c.boundaries.iter().collect();
    boundaries.sort_by(|a, b| a.id.cmp(&b.id));
    for b in &boundaries {
        let axis = axis(&b.axis);
        let mut size = scale(dimensions, 1.01);
        size[axis] = b.thickness_mm / 1000.;
        let mut position = center;
        position[axis] = b.offset;
        let slab = cg::box_cell(position, size);
        let mut occupied = vec![];
        for piece in cells.iter().filter_map(|c| cg::intersection(&slab, c)) {
            let cutters = material_index.candidates(&piece);
            occupied.extend(
                cache
                    .subtract_all(vec![piece], cutters.iter().map(|&k| &material[k]))
                    .map_err(fail)?,
            );
        }
        if occupied.is_empty() {
            errors.push(error(
                "boundary",
                "Boundary does not cut the hull interior",
                Some(&b.id),
            ));
            continue;
        }
        contributions.push(mass(b.id.clone(), "bulkhead", &occupied, STEEL_DENSITY));
        for cell in &occupied {
            material_index.insert(cell);
        }
        material_budget.add(&occupied).map_err(fail)?;
        material.extend(occupied);
    }
    let mut material_volume = cg::total(&material).volume;
    // Each hull cell loses only the plating near it; cells never interact, so this equals
    // subtracting every material cell from every hull cell, in the same order.
    let mut interior = Vec::with_capacity(cells.len());
    for cell in &cells {
        let cutters = material_index.candidates(cell);
        interior.extend(
            cache
                .subtract_all(vec![cell.clone()], cutters.iter().map(|&k| &material[k]))
                .map_err(fail)?,
        );
    }
    cg::check_budget(&interior).map_err(fail)?;
    // Ballast is a visible construction block with a fixed 100-tonne payload.
    // Its casing/armor is counted above; its fill occupies real interior space
    // and contributes at the authored position, without adjusting buoyancy/CG.
    'ballast: for p in c.primitives.iter().filter(|p| p.kind == "ballast") {
        let envelope = primitive(p);
        let occupied: Vec<_> = interior
            .iter()
            .flat_map(|room| envelope.iter().filter_map(|c| cg::intersection(room, c)))
            .collect();
        if cg::total(&occupied).volume < cg::EPS {
            errors.push(error(
                "ballast-fit",
                "Ballast fill has no space inside its casing, or overlaps another ballast block",
                Some(&p.id),
            ));
            continue;
        }
        // Overlapping ballast cannot hide two fixed weights in one envelope.
        let other_ballast = c
            .primitives
            .iter()
            .filter(|other| other.kind == "ballast" && other.id < p.id);
        for other in other_ballast {
            if primitive(other).iter().any(|a| {
                envelope.iter().any(|b| {
                    cg::intersection(a, b).is_some_and(|c| cg::moments(&c).volume > cg::EPS)
                })
            }) {
                let mut d = error(
                    "ballast-fit",
                    format!(
                        "Ballast blocks must not overlap: {} overlaps {}",
                        p.id, other.id
                    ),
                    Some(&p.id),
                );
                d.related_source_ids = Some([other.id.clone()].into());
                errors.push(d);
                continue 'ballast;
            }
        }
        let mut payload = mass(
            p.id.clone(),
            "load",
            &occupied,
            100_000. / cg::total(&occupied).volume,
        );
        payload.mass_kg = 100_000.;
        contributions.push(payload);
        interior = cache.subtract_all(interior, &envelope).map_err(fail)?;
    }
    // Source loads are visible occupied packages, never invisible ballast.
    for l in &c.loads {
        let load = cg::box_cell(l.center, l.size);
        let remaining = cache
            .subtract_all(vec![load.clone()], &interior)
            .map_err(fail)?;
        if cg::total(&remaining).volume > 1e-6 {
            errors.push(error(
                "load-fit",
                format!(
                    "Load intersects plating, another package, or exterior water: {:.3} m³ of {} lies outside free hull interior",
                    cg::total(&remaining).volume,
                    l.id
                ),
                Some(&l.id),
            ));
            continue;
        }
        let mut point = mass(
            l.id.clone(),
            "load",
            std::slice::from_ref(&load),
            l.mass_kg / cg::moments(&load).volume,
        );
        point.mass_kg = l.mass_kg;
        contributions.push(point);
        interior = cache.subtract_all(interior, &[load]).map_err(fail)?;
    }
    if !errors.is_empty() {
        errors.truncate(MAX_ERRORS);
        skipped(
            out,
            "Fittings, installation support, subdivision and loading were not checked: fix the boundaries, ballast and loads first".into(),
        );
        return fail_all(out, errors);
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
    let mut path_clearance = vec![];
    equipment(
        c,
        catalog,
        &cells,
        &platform_cells,
        &material,
        &mut interior,
        &mut contributions,
        &mut def,
        out,
        &mut path_clearance,
        cache,
        &mut errors,
    )?;
    // Installation support is independent of fitting faults, so both report together.
    // A fitting that already has a fault is not measured again.
    for installation in installations {
        if errors.len() >= MAX_ERRORS
            || errors
                .iter()
                .any(|d| d.source_id.as_deref() == Some(installation.id.as_str()))
        {
            continue;
        }
        let mut backing = cells.clone();
        if let Some(above_deck) = &installation.raised_space {
            backing.push(above_deck.clone());
        }
        let (bore_center, bore_size) = cg::bounds(&installation.bore);
        let mut sloped_deck = false;
        for (_, _, polygon) in penetrations.iter().filter(|(id, _, polygon)| {
            *id == installation.id && cg::normal(polygon)[1] < 1. - cg::EPS
        }) {
            backing.push(crate::construction_installation::deck_backing(
                polygon,
                bore_center[1] + bore_size[1] / 2.,
            ));
            sloped_deck = true;
        }
        let unsupported = cache
            .subtract_all(installation.solids.clone(), &backing)
            .map_err(fail)?;
        if cg::total(&unsupported).volume
            > fit::outside_allowance_m3(cg::total(&installation.solids).volume).max(1e-6)
        {
            let outside = cg::total(&unsupported);
            let near = outside.center();
            errors.push(error(
                "installation-support",
                format!(
                    "Barbette or magazine extends through the hull sides or bottom; widen or deepen the hull, or move this turret. {:.3} m³ of it lies outside the hull near [{:.3}, {:.3}, {:.3}]",
                    outside.volume, near[0], near[1], near[2]
                ),
                Some(&installation.id),
            ));
            continue;
        }
        if !installation.solids.iter().any(|a| {
            material_index
                .candidates(a)
                .into_iter()
                .any(|i| cg::connected(a, &material[i]))
        }) {
            let d = error(
                "installation-support",
                "Barbette collar has no physical connection to hull plating or an internal deck",
                Some(&installation.id),
            );
            // Failure path only: the collar hangs from the gun's attachment datum.
            let seat = c
                .equipment
                .iter()
                .find(|e| e.id == installation.id)
                .and_then(|e| {
                    let p = catalog.equipment.iter().find(|p| p.id == e.part_id)?;
                    let mut datum = e.position;
                    datum[1] += crate::construction_installation::attachment(p)
                        - crate::construction_installation::raised(e);
                    crate::construction_diagnostics::seat_on_surfaces(
                        &out.surfaces,
                        e.position,
                        datum,
                        [0., -1., 0.],
                        true,
                        p.size[0].max(p.size[2]),
                    )
                });
            errors.push(match seat {
                Some(seat) => seat.describe(d, fit::ATTACHMENT_M),
                None => d,
            });
            continue;
        }
        // Fixed trunks participate in native articulation, including neighboring guns.
        if installation.raised_space.is_some() || sloped_deck {
            for (i, cell) in installation.solids.iter().enumerate() {
                path_clearance.push(MountClearanceProfileBodiesItem {
                    id: format!("{}-barbette-{i}", installation.id),
                    mount_id: None,
                    surface: surface_mesh(cell),
                });
            }
        }
        let occupied = cache
            .subtract_all(installation.solids, &material)
            .map_err(fail)?;
        material_volume += cg::total(&occupied).volume;
        contributions.push(mass(
            format!("{}-installation", installation.id),
            "installation",
            &occupied,
            STEEL_DENSITY,
        ));
        for cell in &occupied {
            material_index.insert(cell);
        }
        material_budget.add(&occupied).map_err(fail)?;
        material.extend(occupied);
        // A destroyed installation exposes only the actual bore; its fixed
        // collar and trunk remain ordinary physical material.
        for (id, kind, polygon) in &mut penetrations {
            if *id == installation.id && kind == "gun" {
                for f in installation.bore.faces.iter() {
                    let n = cg::normal(&f.vertices);
                    *polygon = cg::clip_polygon(polygon, n, dot(n, f.vertices[0]));
                    if polygon.len() < 3 {
                        break;
                    }
                }
            }
        }
    }
    if !errors.is_empty() {
        let count = errors.len();
        errors.truncate(MAX_ERRORS);
        skipped(
            out,
            format!(
                "{count} fitting faults{}; gun clearance, subdivision, loading and stability were not checked",
                if count >= MAX_ERRORS {
                    " (the list stops at the limit; more may remain)"
                } else {
                    ""
                }
            ),
        );
        return fail_all(out, errors);
    }
    out.surfaces.append(installation_surfaces);
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
    let groups: Vec<_> = groups
        .into_iter()
        .flat_map(|(id, cells)| {
            let pieces = connected_spaces(cells);
            let count = pieces.len();
            pieces.into_iter().enumerate().map(move |(i, cells)| {
                (
                    if count == 1 {
                        id.clone()
                    } else {
                        format!("{id}-space-{i}")
                    },
                    cells,
                )
            })
        })
        // Clipping can leave microscopic disconnected slivers. Apply the same
        // usable-volume threshold used below before counting simulation rooms.
        .filter(|(_, cells)| cg::total(cells).volume >= 1e-6)
        .collect();
    if groups.len() > 256 {
        return Err(error(
            "geometry-limit",
            "Subdivision exceeds 256 connected rooms",
            None,
        ));
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
            name: format!("Compartment {}", def.compartments.len() + 1),
            center,
            size,
            capacity_m3: m.volume,
            pump_m3_per_second: 0.,
            volumes: Some(volumes),
            ..Default::default()
        });
    }
    let room_lookup = RoomLookup::new(&def.compartments);
    assign_rooms(&mut def, &room_lookup)?;
    if let Some(diagnostic) = crate::construction_services::install(&mut def, catalog) {
        out.diagnostics.push(diagnostic);
    }
    let mut openings = vec![];
    for s in out.surfaces.iter().filter(|s| structural(s) && s.open) {
        for room in &def.compartments {
            for polygon in room_plane_faces(room, s.normal, dot(s.normal, s.vertices[0])) {
                let polygon = intersect_polygons(polygon, &s.vertices);
                if cg::area(&polygon) <= 1e-8 {
                    continue;
                }
                openings.push(ConstructionOpening {
                    id: format!("{}-{}-{}", s.id, room.id, openings.len()),
                    compartment_id: room.id.clone(),
                    position: polygon_center(&polygon),
                    normal: s.normal,
                    area_m2: cg::area(&polygon),
                    ..Default::default()
                });
            }
        }
    }
    def.openings = Some(openings);
    for (id, kind, polygon) in penetrations {
        if polygon.len() < 3 || cg::area(&polygon) < 1e-8 {
            continue;
        }
        let position = scale(
            polygon.iter().copied().fold([0.; 3], add),
            1. / polygon.len() as f64,
        );
        if let Some(room) = room_lookup.nearest(&def.compartments, sub(position, [0., 0.05, 0.])) {
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
        .filter(|s| {
            structural(s)
                && !s.open
                && (!crate::construction_installation::internal(s)
                    || crate::construction_installation::protective(s))
        })
        .enumerate()
        .map(|(i, s)| {
            let (center, size) = crate::structure::bounds(s.vertices.iter().copied());
            Armor {
                id: if crate::construction_installation::internal(s) {
                    s.id.clone()
                } else {
                    format!("skin-{i}")
                },
                name: s.id.clone(),
                center,
                size,
                thickness_mm: s.thickness_mm,
                exterior: Some(!crate::construction_installation::internal(s)),
                plate: Some(ArmorPlate {
                    vertices: s.vertices.clone(),
                    material: if s.material == "armor-steel" {
                        "Wh"
                    } else {
                        "steel"
                    }
                    .into(),
                    exterior: Some(!crate::construction_installation::internal(s)),
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
    // Closed walls use the existing protection-linked damage path. Only true
    // usable faces on both sides receive a transfer portal; a bounding box gap
    // or a package occupying the passage cannot connect rooms.
    for b in &boundaries {
        let mut n = [0.; 3];
        n[axis(&b.axis)] = 1.;
        // These faces depend only on the boundary and the completed rooms. A
        // fragmented hull can have hundreds of plates on this plane; scanning
        // every room again for each plate and each left face is quadratic work.
        let plane_faces = |normal, offset| {
            def.compartments
                .iter()
                .map(|room| {
                    room_plane_faces(room, normal, offset)
                        .into_iter()
                        .map(|mut face| {
                            for p in &mut face {
                                p[axis(&b.axis)] = b.offset;
                            }
                            face
                        })
                        .collect::<Vec<_>>()
                })
                .collect::<Vec<_>>()
        };
        let left_faces = plane_faces(n, b.offset - b.thickness_mm / 2000.);
        let right_faces = plane_faces(scale(n, -1.), -(b.offset + b.thickness_mm / 2000.));
        for armor in def
            .armor
            .iter()
            .filter(|a| a.name == b.id && a.exterior == Some(false))
        {
            let plate = &armor.plate.as_ref().unwrap().vertices;
            for (left, faces) in def.compartments.iter().zip(&left_faces) {
                for a in faces {
                    let a = intersect_polygons(a.clone(), plate);
                    if cg::area(&a) < 1e-8 {
                        continue;
                    }
                    for (right, faces) in def
                        .compartments
                        .iter()
                        .zip(&right_faces)
                        .filter(|(r, _)| r.id != left.id)
                    {
                        for p in faces {
                            let polygon = intersect_polygons(a.clone(), p);
                            let area = cg::area(&polygon);
                            if area < 1e-8 {
                                continue;
                            }
                            let (center, mut size) =
                                crate::structure::bounds(polygon.iter().copied());
                            size[axis(&b.axis)] = b.thickness_mm / 1000. + 0.002;
                            def.connections.push(FloodConnection {
                                id: Some(format!("portal-{}-{}", b.id, def.connections.len())),
                                from_id: left.id.clone(),
                                to_id: right.id.clone(),
                                state: Some("closed".into()),
                                area_m2: area,
                                position: Some(polygon_center(&polygon)),
                                armor_id: Some(armor.id.clone()),
                                bounds: Some(FloodConnectionBounds { center, size }),
                                ..Default::default()
                            });
                            if def.connections.len() > MAX_CONNECTIONS {
                                return Err(portal_limit(
                                    def.connections.len(),
                                    def.openings.as_ref().unwrap().len(),
                                ));
                            }
                        }
                    }
                }
            }
        }
    }
    if def.connections.len() > MAX_CONNECTIONS || def.openings.as_ref().unwrap().len() > 4096 {
        return Err(portal_limit(
            def.connections.len(),
            def.openings.as_ref().unwrap().len(),
        ));
    }
    let armor_ids = crate::construction_compact::compact_armor(&mut def.armor);
    for c in &mut def.connections {
        if let Some(id) = &mut c.armor_id
            && let Some(merged) = armor_ids.get(id)
        {
            *id = merged.clone();
        }
    }
    crate::construction_compact::compact_connections(&mut def.connections);
    let void_volume: f64 = def.compartments.iter().map(|r| r.capacity_m3).sum();
    def.local_damage = ShipDefinitionLocalDamage {
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
    };
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
            surfaces: out
                .surfaces
                .iter()
                .filter(|s| structural(s))
                .cloned()
                .collect(),
        }),
        ..Default::default()
    };
    def.stability = Some(ShipDefinitionStability {
        version: 1.,
        dry_center_of_gravity: cg,
        buoyancy_scale: 1.,
        shell_thickness_mm: c.default_thickness_mm,
        basis:
            "Exact polyhedral buoyancy; authored loading plus low distributed internal allowance; no buoyancy calibration"
                .into(),
    });
    let hydro = crate::hydrostatics::HullHydrostatics::new(&def.hull, None);
    let float = hydro.flotation(total_mass / SEA_DENSITY, 0., 0.);
    if def.modules.iter().any(|m| {
        (m.role.as_deref() == Some("shaft") || m.kind == "steering")
            && m.center[1] + m.size[1] * 0.5 > -float.y
    }) {
        warn(
            out,
            "propulsor-exposure",
            "Propeller or rudder is partly above the estimated waterline; exposure reduces its runtime capability",
        );
    }
    def.hull.waterplane_area_m2 = if float.afloat {
        ((hydro.sample(float.y - 0.0001, 0., 0.).volume
            - hydro.sample(float.y + 0.0001, 0., 0.).volume)
            / 0.0002)
            .max(0.)
    } else {
        0.
    };
    let eps = 0.001;
    let f2 = hydro.flotation(total_mass / SEA_DENSITY, eps, 0.);
    let arm0 = crate::hydrostatics::righting_arms(float.center, cg, 0., 0.).0;
    let arm1 = crate::hydrostatics::righting_arms(f2.center, cg, eps, 0.).0;
    let gm = -(arm1 - arm0) / eps;
    let power = out.loading.as_ref().map_or(0., |l| l.power_kw);
    let loading=ConstructionLoading{mass_kg:total_mass,center_of_gravity:cg,inertia_kg_m2:inertia,contributions,envelope_volume_m3:envelope.volume,material_volume_m3:material_volume,usable_volume_m3:def.compartments.iter().map(|r|r.capacity_m3).sum(),waterline_y:if float.afloat {-float.y}else{high},buoyancy_center:float.center,roll_metacentric_height_m:gm,power_kw:power,estimated_speed_mps:0.,basis:"Steel 7850 kg/m³; seawater 1025 kg/m³; internal allowance 150 kg/m³ of union envelope distributed through its lower half by height; exact convex clipping; fixed catalog service load and initial projectile stock".into()};
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
    def.loading = Some(loading.clone());
    let mut maneuvering = ManeuveringProfile {
        version: 1.,
        ..Default::default()
    };
    for e in &c.equipment {
        let Some(p) = catalog.equipment.iter().find(|p| p.id == e.part_id) else {
            continue;
        };
        if p.kind == "propeller" {
            maneuvering
                .propellers
                .push(ManeuveringProfilePropellersItem {
                    module_id: e.id.clone(),
                    bearing_deg: e.bearing_deg.rem_euclid(360.),
                    diameter_m: p.size[0].max(p.size[1]),
                });
        } else if p.kind == "rudder" && p.rudder_area_m2.unwrap_or(0.) > 0. {
            maneuvering.rudders.push(ManeuveringProfileRuddersItem {
                module_id: e.id.clone(),
                bearing_deg: e.bearing_deg.rem_euclid(360.),
                area_m2: p.rudder_area_m2.unwrap(),
            });
        }
    }
    def.maneuvering = Some(maneuvering);
    let movement = crate::maneuvering::Maneuvering::new(&def);
    def.handling = movement.estimated_handling(&def);
    def.loading.as_mut().unwrap().estimated_speed_mps = movement.estimated_speed;
    out.loading = def.loading.clone();
    def.accuracy = ShipDefinitionAccuracy {
        exterior: "Player-authored polyhedral hull".into(),
        internals: "Bounded exact volume clipping; gameplay machinery".into(),
        weapons: "Original component catalog".into(),
    };
    if !def.mounts.is_empty() {
        let mut bodies = crate::construction_compact::exterior_clearance(
            &def.hull.volume.as_ref().unwrap().cells,
        );
        bodies.extend(
            def.obstructions
                .iter()
                .map(|b| MountClearanceProfileBodiesItem {
                    id: b.id.clone(),
                    mount_id: None,
                    surface: surface_mesh(&cg::box_cell(b.center, b.size)),
                }),
        );
        bodies.extend(path_clearance);
        def.mount_clearance=Some(MountClearanceProfile{version:1.,hull_interior_guard:Some(true),margin_m:0.01,basis:"Catalog gunhouses/barrels with full recoil envelope against the exact hull exterior and fixed equipment envelopes".into(),mount_ids:Some(def.mounts.iter().map(|m|m.id.clone()).collect()),bodies:Some(bodies),..Default::default()});
        // Funnel and mast volumes stay in the shipped profile, so runtime gun arcs
        // and hit geometry are unchanged; barrels simply may not be rejected for
        // entering one. Lift them out for this check and put them back in place.
        let mut lifted = vec![];
        if let Some(bodies) = def.mount_clearance.as_mut().and_then(|p| p.bodies.as_mut()) {
            for i in (0..bodies.len()).rev() {
                if c.equipment.iter().any(|e| {
                    e.id == bodies[i].id
                        && catalog
                            .equipment
                            .iter()
                            .any(|p| p.id == e.part_id && uncontested(p))
                }) {
                    lifted.push((i, bodies.remove(i)));
                }
            }
        }
        let clearance = crate::mount_clearance::MountClearance::new(&def)
            .map_err(|e| error("clearance", e, None))?
            .unwrap();
        let poses: Vec<_> = def
            .mounts
            .iter()
            .map(|m| crate::mount_clearance::ClearancePose {
                elevation: m.initial_elevation_deg.unwrap_or(0.).to_radians(),
                ..Default::default()
            })
            .collect();
        let mut errors = vec![];
        for (i, m) in def.mounts.iter().enumerate() {
            let (gap, body) = clearance.minimum_clearance(&def, i, &poses, 1.);
            if gap <= 0. && errors.len() < MAX_ERRORS {
                let mut d = error(
                    "weapon-clearance",
                    format!(
                        "Gun barrels intersect installed geometry at the initial pose{}",
                        body.as_deref()
                            .map_or(String::new(), |body| format!(": {body}"))
                    ),
                    Some(&m.id),
                );
                // Clearance bodies also include hull cells and derived supports.
                d.related_source_ids = body
                    .filter(|body| c.equipment.iter().any(|e| e.id == *body))
                    .map(|body| [body].into());
                errors.push(d);
            }
        }
        if let Some(bodies) = def.mount_clearance.as_mut().and_then(|p| p.bodies.as_mut()) {
            for (i, body) in lifted.into_iter().rev() {
                bodies.insert(i, body);
            }
        }
        fail_all(out, errors)?;
    }
    // Keep room identity, capacity, bounds, and all opening/portal attribution
    // from the original partition. Runtime flooding needs only its exact union.
    for room in &mut def.compartments {
        if let Some(volumes) = room.volumes.take() {
            room.volumes = Some(crate::compartment_geometry::coalesce(volumes).0);
        }
    }
    crate::catalog::validate_definition(&def)
        .map_err(|e| error("definition", e.to_string(), None))?;
    out.definition = Some(def);
    Ok(())
}
fn surface_mesh(cell: &cg::Cell) -> AuthoredSurface {
    let mut s = AuthoredSurface::default();
    for f in cell.faces.iter() {
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
fn polygon_center(polygon: &[Vec3]) -> Vec3 {
    scale(
        polygon.iter().copied().fold([0.; 3], add),
        1. / polygon.len() as f64,
    )
}
fn intersect_polygons(mut polygon: Vec<Vec3>, clip: &[Vec3]) -> Vec<Vec3> {
    let normal = cg::normal(clip);
    for i in 0..clip.len() {
        let side = normalize(cross(sub(clip[(i + 1) % clip.len()], clip[i]), normal));
        polygon = cg::clip_polygon(&polygon, side, dot(side, clip[i]));
        if polygon.len() < 3 {
            return vec![];
        }
    }
    polygon
}
fn room_plane_faces(room: &Compartment, normal: Vec3, offset: f64) -> Vec<Vec<Vec3>> {
    #[cfg(test)]
    tests::ROOM_PLANE_SCANS.with(|count| count.set(count.get() + 1));
    room.volumes
        .iter()
        .flatten()
        .flat_map(|c| c.faces.iter())
        .filter(|f| {
            f.vertices
                .iter()
                .all(|v| (dot(normal, *v) - offset).abs() < 1e-7)
                && dot(cg::normal(&f.vertices), normal) > 1. - 1e-7
        })
        .map(|f| f.vertices.clone())
        .collect()
}
fn connected_spaces(mut cells: Vec<cg::Cell>) -> Vec<Vec<cg::Cell>> {
    cells.sort_by(|a, b| {
        let (a, b) = (cg::bounds(a).0, cg::bounds(b).0);
        a[0].total_cmp(&b[0])
            .then(a[1].total_cmp(&b[1]))
            .then(a[2].total_cmp(&b[2]))
    });
    let index = cg::Broadphase::sized_for(&cells);
    let mut remaining: Vec<_> = cells.into_iter().map(Some).collect();
    let mut groups = vec![];
    let mut first = 0;
    while let Some(start) = remaining[first..].iter().position(Option::is_some) {
        first += start;
        let mut group = vec![remaining[first].take().unwrap()];
        let mut i = 0;
        while i < group.len() {
            for k in index.candidates(&group[i]) {
                if remaining[k]
                    .as_ref()
                    .is_some_and(|cell| cg::connected(&group[i], cell))
                {
                    group.push(remaining[k].take().unwrap());
                }
            }
            i += 1;
        }
        groups.push(group);
    }
    groups
}
struct RoomLookup(Vec<Vec<(Vec3, Vec3)>>);
impl RoomLookup {
    fn new(rooms: &[Compartment]) -> Self {
        Self(
            rooms
                .iter()
                .map(|room| room.volumes.iter().flatten().map(cg::bounds).collect())
                .collect(),
        )
    }
    fn nearest<'a>(&self, rooms: &'a [Compartment], p: Vec3) -> Option<&'a Compartment> {
        // AABB distance is a lower bound on distance to the exact cell. Keep
        // source order and exact closest-point distances for all possible winners.
        let lower = |(center, size): (Vec3, Vec3)| {
            length(std::array::from_fn(|i| {
                ((p[i] - center[i]).abs() - size[i] * 0.5 - 1e-7).max(0.)
            }))
        };
        let mut best = None;
        let mut distance = f64::INFINITY;
        for (room, bounds) in rooms.iter().zip(&self.0) {
            if lower((room.center, room.size)) > distance {
                continue;
            }
            if let Some(cells) = &room.volumes {
                for (cell, &bounds) in cells.iter().zip(bounds) {
                    if lower(bounds) > distance {
                        continue;
                    }
                    let d = length(sub(p, cg::closest_point(cell, p)));
                    if best.is_none() || d < distance {
                        distance = d;
                        best = Some(room);
                    }
                    if distance == 0. {
                        return best;
                    }
                }
            } else {
                let d = cg::room_distance(room, p);
                if best.is_none() || d < distance {
                    distance = d;
                    best = Some(room);
                }
            }
        }
        best
    }
}
fn assign_rooms(
    def: &mut ShipDefinition,
    lookup: &RoomLookup,
) -> Result<(), ConstructionDiagnostic> {
    for i in 0..def.modules.len() {
        if def.modules[i].placement.as_deref() == Some("fixed") {
            continue;
        }
        let p = def.modules[i].center;
        let Some(room) = lookup.nearest(&def.compartments, p) else {
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
/// A funnel or mast is one conservative catalog box drawn around uptakes,
/// platforms, galleries, yards and rigging that real hull structure and real
/// fittings pass through. Neither is ever a collision body: no overlap,
/// intersection or clearance fault may be raised against one, or against
/// anything that enters one. Seating, mass, exhaust, flooding openings and the
/// runtime obstruction volumes are unaffected.
pub(crate) fn uncontested(p: &ConstructionEquipmentPart) -> bool {
    matches!(p.kind.as_str(), "funnel" | "mast")
}
#[allow(clippy::too_many_arguments)]
fn equipment(
    c: &ConstructionData,
    catalog: &ConstructionCatalog,
    hull: &[cg::Cell],
    platforms: &[cg::Cell],
    _material: &[cg::Cell],
    interior: &mut Vec<cg::Cell>,
    masses: &mut Vec<ConstructionMass>,
    def: &mut ShipDefinition,
    out: &mut ConstructionResult,
    path_clearance: &mut Vec<MountClearanceProfileBodiesItem>,
    cache: &mut GeometryCache,
    faults: &mut Vec<ConstructionDiagnostic>,
) -> Result<(), ConstructionDiagnostic> {
    let published = || {
        catalog
            .equipment
            .iter()
            .filter(|p| !crate::construction_custom_fittings::is_custom(&p.id))
    };
    if published().count() > 256
        || !unique(published().map(|p| p.id.as_str()))
        || !unique(catalog.weapons.parts.iter().map(|p| p.id.as_str()))
    {
        return Err(error(
            "catalog",
            "Invalid equipment catalog identities/count",
            None,
        ));
    }
    // A fitting's first fault ends only that fitting; the others are still checked
    // against everything placed so far, the faulty fitting's envelope included.
    let mut errors: Vec<ConstructionDiagnostic> = vec![];
    let mut unseated = BTreeSet::new();
    let installed_parts: Vec<_> = c
        .equipment
        .iter()
        .filter_map(|e| {
            catalog
                .equipment
                .iter()
                .find(|p| p.id == e.part_id)
                .map(|p| (e, p))
        })
        .filter_map(|(e, p)| {
            crate::construction_wall_fittings::installed(e, p, c, &out.surfaces)
                .map(|p| (e.id.clone(), p))
                .map_err(|d| {
                    unseated.insert(e.id.as_str());
                    if errors.len() < MAX_ERRORS {
                        errors.push(d);
                    }
                })
                .ok()
        })
        .collect();
    // Decorative fittings never collide with other equipment. Keep machinery and
    // weapon clearance independent of source order, including propeller supports.
    // Funnels and masts collide with nothing at all; see `uncontested`.
    let colliding_ids: std::collections::BTreeSet<_> = installed_parts
        .iter()
        .filter(|(_, p)| {
            p.path.is_none()
                && !matches!(p.kind.as_str(), "deck-fitting" | "director")
                && !uncontested(p)
        })
        .map(|(id, _)| id.as_str())
        .collect();
    let uncontested_ids: std::collections::BTreeSet<_> = installed_parts
        .iter()
        .filter(|(_, p)| uncontested(p))
        .map(|(id, _)| id.as_str())
        .collect();
    // Fixed exterior fittings may still seat partly into the hull.
    let relaxed_fit = |p: &ConstructionEquipmentPart| {
        p.placement == "deck"
            && p.path.is_none()
            && matches!(
                p.kind.as_str(),
                "deck-fitting" | "mast" | "director" | "funnel"
            )
    };
    let relaxed_ids: std::collections::BTreeSet<_> = installed_parts
        .iter()
        .filter(|(_, p)| relaxed_fit(p))
        .map(|(id, _)| id.as_str())
        .collect();
    // Diagnostics name the catalog part; source ids are opaque to the designer.
    let part_name = |id: &str| {
        installed_parts
            .iter()
            .find(|(other, _)| other == id)
            .map_or_else(|| id.to_owned(), |(_, p)| p.name.clone())
    };
    let weapon_ids: std::collections::BTreeSet<_> = installed_parts
        .iter()
        .filter(|(_, p)| matches!(p.kind.as_str(), "gun" | "torpedo-launcher"))
        .map(|(id, _)| id.as_str())
        .collect();
    let mut fitted = vec![];
    // Interior a funnel or mast reserved: removed from `interior` as before, but
    // restored when any other package is measured against it.
    let mut uncontested_space: Vec<cg::Cell> = vec![];
    let mut all_envelopes: Vec<(String, cg::Cell)> = vec![];
    let mut fitting_index = cg::Broadphase::new(8.);
    let hull_index = cg::Broadphase::sized_for(hull);
    let platform_index = cg::Broadphase::sized_for(platforms);
    let material_support_index = cg::Broadphase::sized_for(_material);
    let surface_support = crate::construction_paths::SurfaceSupport::new(&out.surfaces);
    let mut support_sockets = vec![];
    let mut fitting_surfaces = vec![];
    let has_lines = c.equipment.iter().any(|e| {
        catalog.equipment.iter().any(|p| {
            p.id == e.part_id
                && p.path
                    .as_ref()
                    .is_some_and(|path| matches!(path.kind.as_str(), "rope" | "chain"))
        })
    });
    let mut path_members = 0;
    // A route can attach to an explicit eye only after its owning fixed fitting
    // has independently passed hull support/fit. Source order cannot form cycles.
    let is_path = |e: &&ConstructionEquipment| {
        catalog
            .equipment
            .iter()
            .find(|p| p.id == e.part_id)
            .is_some_and(|p| p.path.is_some())
    };
    'fittings: for e in c
        .equipment
        .iter()
        .filter(|e| !is_path(e))
        .chain(c.equipment.iter().filter(is_path))
    {
        macro_rules! reject {
            ($diagnostic:expr) => {{
                errors.push($diagnostic);
                if errors.len() >= MAX_ERRORS {
                    break 'fittings;
                }
                continue 'fittings;
            }};
        }
        macro_rules! attempt {
            ($result:expr) => {
                match $result {
                    Ok(value) => value,
                    Err(diagnostic) => reject!(diagnostic),
                }
            };
        }
        if unseated.contains(e.id.as_str()) {
            continue;
        }
        let Some((_, p)) = installed_parts.iter().find(|(id, _)| id == &e.id) else {
            reject!(error(
                "missing-part",
                "Exact equipment part is unavailable in this catalog revision",
                Some(&e.id),
            ));
        };
        // Legacy funnel links are accepted but no longer constrain shared exhaust.
        if p.kind != "funnel"
            && e.power_source_id.as_ref().is_some_and(|id| {
                p.kind != "propeller"
                    || !c.equipment.iter().any(|e| {
                        &e.id == id
                            && catalog
                                .equipment
                                .iter()
                                .any(|p| p.id == e.part_id && p.kind == "engine")
                    })
            })
        {
            let mut d = error(
                "power-link",
                format!(
                    "Power connection must reference a fitted engine; {} is not one",
                    e.power_source_id.as_deref().unwrap_or_default()
                ),
                Some(&e.id),
            );
            d.related_source_ids = e.power_source_id.clone().map(|id| [id].into());
            reject!(d);
        }
        let raise = crate::construction_installation::raised(e);
        if !raise.is_finite()
            || !(0. ..=30.).contains(&raise)
            || (raise > 0. && (p.kind != "gun" || c.version < 2.))
        {
            reject!(error(
                "barbette-height",
                "Barbette height must be between 0 and 30 m on a gun installation",
                Some(&e.id),
            ));
        }
        if c.version >= 2. && (p.kind == "magazine" || e.magazine_id.is_some()) {
            reject!(error(
                "integrated-magazine",
                "Ammunition is built into each weapon; remove separate magazines and magazine links",
                Some(&e.id),
            ));
        }
        if !finite(e.position)
            || !e.bearing_deg.is_finite()
            || e.bearing_deg.abs() > 3600.
            || !(size(p.size)
                || p.wall_mount.is_some()
                    && finite(p.size)
                    && p.size[0] >= 0.01
                    && p.size[1] >= 0.01
                    && p.size[0] <= 500.
                    && p.size[1] <= 500.
                    && (0.001..=0.01).contains(&p.size[2]))
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
                "deck-fitting",
            ]
            .contains(&p.kind.as_str())
            || !["internal", "deck", "underwater"].contains(&p.placement.as_str())
        {
            reject!(error(
                "equipment-data",
                "Equipment transform, model identity or fixed dimensions are invalid",
                Some(&e.id),
            ));
        }
        if e.path.is_some() && p.path.is_none() {
            reject!(error(
                "equipment-path",
                "This fixed fitting cannot contain path points",
                Some(&e.id),
            ));
        }
        if p.sockets
            .iter()
            .flatten()
            .any(|s| !finite(s.position) || !finite(s.direction) || length(s.direction) < 1e-6)
        {
            reject!(error(
                "equipment-data",
                "Invalid equipment socket position or direction",
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
                reject!(error(
                    "equipment-data",
                    "Invalid equipment capability",
                    Some(&e.id),
                ));
            }
        }
        if p.kind == "deck-fitting"
            && [
                p.power_kw,
                p.exhaust_kw,
                p.thrust_efficiency,
                p.rudder_area_m2,
                p.service_mass_kg,
                p.ammunition_capacity,
            ]
            .iter()
            .flatten()
            .any(|x| *x != 0.)
        {
            reject!(error(
                "equipment-data",
                "Deck fittings contribute mass without machinery or weapon capabilities",
                Some(&e.id),
            ));
        }
        if p.path.is_some() {
            let path = attempt!(crate::construction_paths::compile(
                e,
                p,
                &out.surfaces,
                &surface_support,
                hull,
                &hull_index,
                &support_sockets,
                &fitting_surfaces,
            ));
            path_members += path.cells.len();
            if path_members > 16_384 {
                reject!(error(
                    "equipment-path",
                    "Connected fittings exceed 16384 physical members; simplify the routes",
                    Some(&e.id),
                ));
            }
            masses.push(path.mass);
            // Routes contribute loading and support checks, never fitting obstacles.
            fitted.push((e, p));
            continue;
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
        let weapon = if p.kind == "gun" {
            Some(attempt!(
                catalog
                    .weapons
                    .parts
                    .iter()
                    .find(|w| Some(w.id.as_str()) == p.gun_part_id.as_deref())
                    .ok_or_else(|| error(
                        "weapon",
                        "Missing canonical gun definition",
                        Some(&e.id)
                    ))
            ))
        } else {
            None
        };
        let mut fitting_cells = if let Some(weapon) = weapon {
            crate::mount_clearance::installation_bounds(
                weapon,
                e.gun
                    .as_ref()
                    .and_then(|g| g.initial_elevation_deg)
                    .unwrap_or(0.)
                    .to_radians(),
            )
            .into_iter()
            .map(|(center, size)| transform_cell(center, size))
            .collect::<Vec<_>>()
        } else if let Some(boxes) = &p.fitting {
            if p.kind != "deck-fitting"
                || boxes.is_empty()
                || boxes.len() > 64
                || boxes.iter().any(|b| {
                    !finite(b.center)
                        || !size(b.size)
                        || (0..3).any(|i| {
                            (b.center[i] - p.bounds_center[i]).abs() + b.size[i] / 2.
                                > p.size[i] / 2. + 0.025
                        })
                })
            {
                reject!(error(
                    "equipment-data",
                    "Invalid original fitting boxes",
                    Some(&e.id),
                ));
            }
            boxes
                .iter()
                .map(|b| transform_cell(b.center, b.size))
                .collect()
        } else {
            vec![envelope.clone()]
        };
        let body_cell_count = fitting_cells.len();
        if p.kind == "gun" && crate::construction_installation::raised(e) > 0. {
            let top = crate::construction_installation::attachment(p);
            for space in crate::construction_installation::spaces(c, catalog, p, e) {
                fitting_cells.push(transform_cell(
                    [
                        space.center[0],
                        top - crate::construction_installation::raised(e) / 2.,
                        space.center[2],
                    ],
                    [
                        space.size[0],
                        crate::construction_installation::raised(e),
                        space.size[2],
                    ],
                ));
            }
        }
        // Only registered cells whose bounds meet this fitting's can intersect it, so the
        // broadphase replaces the scan over every earlier envelope. Candidate indices are
        // `all_envelopes` positions in ascending order, so the neighbour reported first is
        // the one the full scan reported.
        let clash = if colliding_ids.contains(e.id.as_str()) {
            let mut candidates: Vec<usize> = fitting_cells
                .iter()
                .flat_map(|f| fitting_index.candidates(f))
                .collect();
            candidates.sort_unstable();
            candidates.dedup();
            candidates.into_iter().find_map(|i| {
                let (other, cell) = &all_envelopes[i];
                if !colliding_ids.contains(other.as_str()) {
                    return None;
                }
                // Fixed machinery retains its partial-overlap rule; weapons need clearance.
                let weapon = |kind: &str| matches!(kind, "gun" | "torpedo-launcher");
                if (relaxed_fit(p) && !weapon_ids.contains(other.as_str()))
                    || (relaxed_ids.contains(other.as_str()) && !weapon(&p.kind))
                {
                    return None;
                }
                fitting_cells
                    .iter()
                    .find_map(|f| {
                        cg::intersection(f, cell).filter(|x| cg::moments(x).volume > 1e-5)
                    })
                    .map(|shared| (other.clone(), shared))
            })
        } else {
            None
        };
        // A clashing fitting still registers, so later fittings are tested against it.
        for fitted_cell in &fitting_cells {
            fitting_index.insert(fitted_cell);
            all_envelopes.push((e.id.clone(), fitted_cell.clone()));
        }
        if let Some((other, shared)) = clash {
            reject!(crate::construction_diagnostics::overlap(
                error(
                    "equipment-overlap",
                    format!(
                        "{} intersects {}",
                        p.name,
                        neighbor_name(&p.name, &part_name(&other))
                    ),
                    Some(&e.id),
                ),
                &other,
                Some(&shared),
            ));
        }
        let mut occupied = vec![];
        if p.placement == "internal" {
            occupied.push(envelope.clone());
        }
        {
            let spaces = crate::construction_installation::spaces(c, catalog, p, e);
            if spaces.len() > 16 {
                reject!(error(
                    "equipment-data",
                    "Too many intrinsic equipment spaces",
                    Some(&e.id),
                ));
            }
            for space in spaces {
                if !finite(space.center) || !size(space.size) {
                    reject!(error(
                        "equipment-data",
                        "Invalid intrinsic equipment space",
                        Some(&e.id),
                    ));
                }
                let volume = crate::construction_installation::crossing_cell(
                    cg::transform(
                        &crate::construction_installation::space_cell(catalog, p, &space),
                        e.position,
                        [1.; 3],
                        -e.bearing_deg.to_radians(),
                    ),
                    hull,
                    fit::DECK_CROSSING_M,
                );
                if p.placement == "deck" {
                    occupied.extend(hull.iter().filter_map(|h| cg::intersection(&volume, h)));
                } else {
                    occupied.push(volume);
                }
            }
        }
        let occupied =
            attempt!(cg::union(&occupied).map_err(|x| error("equipment-fit", x, Some(&e.id))));
        if !occupied.is_empty() {
            // A funnel's uptake shares its space: plating, bulkheads and loads may
            // cross it. It still reserves the volume it occupies, below.
            let outside = if uncontested(p) {
                vec![]
            } else {
                let outside = attempt!(
                    cache
                        .subtract_all(occupied.clone(), interior.iter())
                        .map_err(|x| error("equipment-fit", x, Some(&e.id)))
                );
                // Neither is the space a funnel or mast reserved an obstacle to
                // anything else, whichever of the two the source lists first.
                if uncontested_space.is_empty() {
                    outside
                } else {
                    attempt!(
                        cache
                            .subtract_all(outside, uncontested_space.iter())
                            .map_err(|x| error("equipment-fit", x, Some(&e.id)))
                    )
                }
            };
            // Only derived working wells earn the skin allowance: they are clipped
            // against plating and block seams the author cannot reach. An internal
            // package is an authored box that must genuinely fit in free interior.
            let allowance = if p.placement == "deck" {
                fit::outside_allowance_m3(cg::total(&occupied).volume)
            } else {
                1e-5
            };
            if cg::total(&outside).volume > allowance {
                let blocked = cg::total(&outside);
                let near = blocked.center();
                reject!(error(
                    "equipment-fit",
                    format!(
                        "{}. {:.3} m³ of it lies outside free hull interior near [{:.3}, {:.3}, {:.3}]",
                        if p.kind == "gun" {
                            "Barbette or magazine intersects hull plating, an internal wall or another load; move the turret or provide more hull space"
                        } else {
                            "Package intersects inward plating, internal wall, another load or exterior water"
                        },
                        blocked.volume,
                        near[0],
                        near[1],
                        near[2]
                    ),
                    Some(&e.id),
                ));
            }
            if uncontested(p) {
                uncontested_space.extend(occupied.iter().cloned());
            }
            *interior = attempt!(
                cache
                    .subtract_all(interior.clone(), &occupied)
                    .map_err(|x| error("equipment-fit", x, Some(&e.id)))
            );
        }
        // Check the explicit original attachment socket (or the package's base datum).
        // The `fit::ATTACHMENT_M` installation tolerance is independent of the 1 m hull grid.
        let mut local_attachment = p
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
        local_attachment[1] -= crate::construction_installation::raised(e);
        let attachment = local_to_world(local_attachment, pose);
        let attachment_direction = p
            .sockets
            .as_ref()
            .and_then(|s| s.iter().find(|s| s.id == "attachment"))
            .map_or([0., -1., 0.], |s| normalize(s.direction));
        let world_direction = sub(local_to_world(attachment_direction, pose), e.position);
        // Failure diagnostics search this far off the socket line for a support.
        let footprint = (0..3)
            .map(|i| p.bounds_center[i].abs() + p.size[i] / 2.)
            .fold(0., f64::max);
        let supports = if p.placement == "internal" {
            _material
        } else {
            hull
        };
        // Internal powerplants are supported by their installation. The occupied-volume
        // check above already requires the entire package to fit in free hull interior.
        let low = sub(attachment, [fit::ATTACHMENT_M; 3]);
        let high = add(attachment, [fit::ATTACHMENT_M; 3]);
        let support_index = if p.placement == "internal" {
            &material_support_index
        } else {
            &hull_index
        };
        let attached = (p.kind == "engine" && p.placement == "internal")
            || support_index
                .candidates_box(low, high)
                .into_iter()
                .map(|i| &supports[i])
                .chain(
                    platform_index
                        .candidates_box(low, high)
                        .into_iter()
                        .filter(|_| p.placement == "deck")
                        .map(|i| &platforms[i]),
                )
                .any(|h| {
                    cg::contains(h, attachment)
                        || length(sub(cg::closest_point(h, attachment), attachment))
                            <= fit::ATTACHMENT_M
                });
        let attached = attached
            && ((p.kind != "deck-fitting"
                && !crate::construction_installation::deck_mounted(c, catalog, p))
                || (relaxed_fit(p)
                    && hull.iter().any(|h| {
                        h.faces.iter().all(|f| {
                            let n = cg::normal(&f.vertices);
                            dot(n, sub(attachment, f.vertices[0])) < -1e-6
                        })
                    }))
                || surface_support.supported(
                    attachment,
                    Some(world_direction),
                    false,
                    fit::ATTACHMENT_M,
                ));
        let attached = attached
            && (p.placement != "underwater"
                || surface_support.supported(attachment, None, false, fit::ATTACHMENT_M));
        let support = if attached {
            None
        } else {
            crate::construction_propellers::derive(e, p, &out.surfaces)
        };
        if !attached && support.is_none() && e.wall.is_none() {
            let d = error(
                "equipment-attachment",
                if p.kind == "propeller" {
                    "No hull connection for this propeller; move it closer to the stern or beneath the hull"
                } else {
                    "Equipment attachment has no physical hull support within 10 cm"
                },
                Some(&e.id),
            );
            // Failure path only: measure to the support this datum is tested against.
            let seat = if p.placement == "internal" {
                crate::construction_diagnostics::seat_on_cells(supports, e.position, attachment)
            } else {
                crate::construction_diagnostics::seat_on_surfaces(
                    &out.surfaces,
                    e.position,
                    attachment,
                    normalize(world_direction),
                    p.placement == "deck",
                    footprint,
                )
            };
            reject!(match seat {
                Some(seat) => seat.describe(d, fit::ATTACHMENT_M),
                None => d,
            });
        }
        if let Some(support) = support {
            if hull.iter().any(|h| {
                cg::intersection(&envelope, h).is_some_and(|x| cg::moments(&x).volume > 1e-5)
            }) {
                reject!(error(
                    "equipment-fit",
                    "Propeller blades need clearance from the hull; move the propeller farther out",
                    Some(&e.id),
                ));
            }
            let members: Vec<_> = support
                .members
                .iter()
                .flat_map(|m| {
                    crate::construction_propellers::cells(m)
                        .into_iter()
                        .map(move |cell| (m, cell))
                })
                .collect();
            for (i, (member, cell)) in members.iter().enumerate() {
                if let Some((id, other)) = all_envelopes.iter().find(|(id, other)| {
                    id != &e.id
                        && colliding_ids.contains(id.as_str())
                        && cg::intersection(cell, other)
                            .is_some_and(|x| cg::moments(&x).volume > 1e-5)
                }) {
                    reject!(crate::construction_diagnostics::overlap(
                        error(
                            "equipment-overlap",
                            format!(
                                "Propeller shaft or support intersects {}",
                                neighbor_name(&p.name, &part_name(id))
                            ),
                            Some(&e.id),
                        ),
                        id,
                        cg::intersection(cell, other).as_ref(),
                    ));
                }
                if crate::construction_propellers::crosses_hull(member, cell, hull) {
                    reject!(error(
                        "equipment-fit",
                        format!(
                            "Propeller {} crosses the hull; move the propeller to clear the plating",
                            member.kind
                        ),
                        Some(&e.id),
                    ));
                }
                fitting_index.insert(cell);
                all_envelopes.push((e.id.clone(), cell.clone()));
                path_clearance.push(MountClearanceProfileBodiesItem {
                    id: format!("{}-support-{i}", e.id),
                    mount_id: None,
                    surface: surface_mesh(cell),
                });
            }
            // Union joined lofts before integrating weight; never add them to hull cells.
            let cells: Vec<_> = members.into_iter().map(|(_, cell)| cell).collect();
            let solids =
                attempt!(cg::union(&cells).map_err(|x| error("equipment-fit", x, Some(&e.id))));
            masses.push(mass(
                format!("{}-support", e.id),
                "equipment",
                &solids,
                STEEL_DENSITY,
            ));
            out.propeller_supports
                .get_or_insert_with(Vec::new)
                .push(support);
        }
        let intrusion = if p.placement == "deck" && e.wall.is_none() && !relaxed_fit(p) {
            // The fixed support crosses the deck by design. Its well and hull
            // backing are validated separately; only the gun body must clear it.
            hull.iter().find_map(|h| {
                fitting_cells[..body_cell_count].iter().find_map(|f| {
                    cg::intersection(f, h).and_then(|x| {
                        let base_area = if p.kind == "deck-fitting" {
                            (0..3)
                                .map(|i| {
                                    attachment_direction[i].abs()
                                        * p.size[(i + 1) % 3]
                                        * p.size[(i + 2) % 3]
                                })
                                .sum()
                        } else {
                            p.size[0] * p.size[2]
                        };
                        let volume = cg::moments(&x);
                        (volume.volume > base_area * fit::FITTED_BASE_M)
                            .then(|| (volume.center(), x))
                    })
                })
            })
        } else {
            None
        };
        if let Some((point, shared)) = intrusion {
            let mut d = error(
                "equipment-fit",
                format!(
                    "Exterior equipment body overlaps the hull near [{:.3}, {:.3}, {:.3}]; use its original support datum (5 mm fitted-base tolerance)",
                    point[0], point[1], point[2]
                ),
                Some(&e.id),
            );
            // Depth of the shared volume along the seating axis.
            let (_, extent) = cg::bounds(&shared);
            let axis = (0..3)
                .max_by(|a, b| {
                    attachment_direction[*a]
                        .abs()
                        .total_cmp(&attachment_direction[*b].abs())
                })
                .unwrap();
            d.fit.get_or_insert_default().penetration_m =
                Some(crate::construction_diagnostics::rounded(extent[axis]));
            reject!(match crate::construction_diagnostics::seat_on_surfaces(
                &out.surfaces,
                e.position,
                attachment,
                normalize(world_direction),
                true,
                footprint,
            ) {
                Some(seat) => seat.describe(d, fit::FITTED_BASE_M),
                None => d,
            });
        }
        if p.placement == "deck" {
            if has_lines
                && let Some(surface) =
                    attempt!(crate::construction_paths::FittingSurface::new(e, p))
            {
                fitting_surfaces.push(surface);
            }
            support_sockets.extend(
                p.sockets
                    .iter()
                    .flatten()
                    .filter(|s| {
                        s.id != "attachment" && matches!(s.kind.as_str(), "support" | "rigging")
                    })
                    .map(|s| crate::construction_paths::SupportSocket {
                        position: local_to_world(s.position, pose),
                    }),
            );
        }
        let mass_kg = weapon.map_or(p.mass_kg.unwrap_or(0.), |w| w.mass_kg);
        if !mass_kg.is_finite() || mass_kg <= 0. || mass_kg > 1e9 {
            reject!(error(
                "equipment-mass",
                "Equipment requires a positive catalog mass",
                Some(&e.id),
            ));
        }
        let center = local_to_world(p.center_of_gravity, pose);
        let mut load = mass(
            e.id.clone(),
            "equipment",
            std::slice::from_ref(&envelope),
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
                // Trainable launchers retain their original zero-bearing frame;
                // absolute runtime train owns the one and only yaw transform.
                center: if p.kind == "torpedo-launcher" {
                    add(e.position, p.bounds_center)
                } else {
                    box_center
                },
                size: if p.kind == "torpedo-launcher" {
                    p.size
                } else {
                    box_size
                },
                hp: (mass_kg.sqrt() * 2.).max(40.),
                placement: (p.placement != "internal").then(|| "fixed".into()),
                immersion_tolerance_m: if p.placement == "internal" {
                    Some((p.size[1] * 0.2).max(0.1))
                } else {
                    None
                },
                role: match p.kind.as_str() {
                    "engine" if p.power_kw.unwrap_or(0.) > 0. => Some("combined-drive".into()),
                    "propeller" => Some("shaft".into()),
                    "funnel" => Some("boiler".into()),
                    _ => None,
                },
                torpedo_launcher_id: (p.kind == "torpedo-launcher").then(|| e.id.clone()),
                serves_mount_ids: (p.kind == "director").then(|| {
                    c.equipment
                        .iter()
                        .filter(|x| {
                            catalog
                                .equipment
                                .iter()
                                .any(|p| p.id == x.part_id && p.kind == "gun")
                        })
                        .map(|x| x.id.clone())
                        .collect()
                }),
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
                reject!(error(
                    "weapon",
                    "Invalid canonical weapon statistics",
                    Some(&e.id),
                ));
            }
            let (magazine_id, ammo_center, ammo_size) = if c.version >= 2. {
                let (center, size) = attempt!(
                    crate::construction_installation::magazine(c, catalog, p, e).ok_or_else(|| {
                        error(
                            "magazine-fit",
                            "Gun needs an integral ammunition package",
                            Some(&e.id),
                        )
                    })
                );
                let id = integral_magazine(
                    def,
                    e,
                    center,
                    size,
                    false,
                    crate::construction_installation::deck_mounted(c, catalog, p),
                );
                (id, center, size)
            } else {
                let magazine = attempt!(resolve_magazine(c, catalog, e));
                (
                    magazine.id.clone(),
                    magazine_load_center(catalog, magazine),
                    [0.; 3],
                )
            };
            let installation = e.gun.clone().unwrap_or_default();
            let train = installation.traverse_deg.unwrap_or(w.traverse_deg);
            let low = installation
                .elevation_min_deg
                .unwrap_or(w.elevation_min_deg);
            let high = installation
                .elevation_max_deg
                .unwrap_or(w.elevation_max_deg);
            let initial = installation.initial_elevation_deg.unwrap_or(0.);
            if ![train, low, high, initial].iter().all(|v| v.is_finite())
                || train <= 0.
                || train > w.traverse_deg
                || low < w.elevation_min_deg
                || low > 0.
                || high > w.elevation_max_deg
                || high < 0.
                || initial < low
                || initial > high
                || installation
                    .battery
                    .as_deref()
                    .is_some_and(|b| !matches!(b, "main" | "secondary"))
                || installation.traverse_limits_deg.is_some_and(|[a, b]| {
                    !a.is_finite()
                        || !b.is_finite()
                        || a > 0.
                        || b < 0.
                        || a >= b
                        || a < -train
                        || b > train
                })
            {
                reject!(error(
                    "weapon-installation",
                    "Gun installation exceeds its canonical capability",
                    Some(&e.id),
                ));
            }
            let mut installed = w.clone();
            installed.traverse_deg = train;
            if installation.elevation_min_deg.is_some() {
                installed.catalog_elevation_min_deg = Some(w.elevation_min_deg);
            }
            if installation.elevation_max_deg.is_some() {
                installed.catalog_elevation_max_deg = Some(w.elevation_max_deg);
            }
            installed.elevation_min_deg = low;
            installed.elevation_max_deg = high;
            def.mounts.push(MountDefinition {
                id: e.id.clone(),
                name: p.name.clone(),
                part_id: w.id.clone(),
                battery: installation.battery.unwrap_or_else(|| {
                    if w.caliber_m >= 0.1 {
                        "main"
                    } else {
                        "secondary"
                    }
                    .into()
                }),
                position: e.position,
                bearing_deg: e.bearing_deg,
                magazine_id: Some(magazine_id),
                weapon: installed,
                initial_elevation_deg: installation.initial_elevation_deg,
                traverse_limits_deg: installation.traverse_limits_deg,
                rangefinder: false,
                ..Default::default()
            });
            let stock = w.ammo_per_barrel * w.barrel_count;
            let kg = stock * w.projectile_mass_kg;
            masses.push(ConstructionMass {
                id: format!("{}-ammunition", e.id),
                kind: "ammunition".into(),
                mass_kg: kg,
                center: ammo_center,
                inertia_kg_m2: if c.version >= 2. {
                    box_inertia(ammo_size, kg)
                } else {
                    magazine_load_inertia(catalog, attempt!(resolve_magazine(c, catalog, e)), kg)
                },
            });
        }
        if p.kind == "torpedo-launcher" {
            let w = attempt!(
                catalog
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
                    })
            );
            let offsets = attempt!(
                p.tube_offsets
                    .as_ref()
                    .filter(|o| !o.is_empty() && o.len() <= 8)
                    .ok_or_else(|| {
                        error(
                            "weapon",
                            "Torpedo launcher needs 1–8 original tube offsets",
                            Some(&e.id),
                        )
                    })
            );
            let magazine_id = if c.version >= 2. {
                integral_magazine(def, e, add(e.position, p.bounds_center), p.size, true, true)
            } else {
                attempt!(resolve_magazine(c, catalog, e)).id.clone()
            };
            if let Some(installation) = &e.launcher {
                let [lo, hi] = installation.traverse_limits_deg;
                if !lo.is_finite()
                    || !hi.is_finite()
                    || lo < -180.
                    || hi > 180.
                    || lo >= hi
                    || e.bearing_deg < lo
                    || e.bearing_deg > hi
                    || installation.launch_arcs_deg.is_empty()
                    || installation.launch_arcs_deg.len() > 8
                    || installation.launch_arcs_deg.iter().any(|[a, b]| {
                        !a.is_finite() || !b.is_finite() || a >= b || *a < lo || *b > hi
                    })
                {
                    reject!(error(
                        "weapon-installation",
                        "Launcher arcs must lie within traverse limits and include the installed resting bearing",
                        Some(&e.id),
                    ));
                }
            }
            def.torpedo_launchers
                .get_or_insert_default()
                .push(TorpedoLauncher {
                    id: e.id.clone(),
                    name: p.name.clone(),
                    position: e.position,
                    traverse_rate_deg: 10.,
                    launch_arcs_deg: e
                        .launcher
                        .as_ref()
                        .map_or_else(|| vec![[-180., 180.]], |l| l.launch_arcs_deg.clone()),
                    traverse_limits_deg: e.launcher.as_ref().map(|l| l.traverse_limits_deg),
                });
            for (i, &offset) in offsets.iter().enumerate() {
                if !finite(offset) {
                    reject!(error(
                        "weapon",
                        "Invalid torpedo muzzle offset",
                        Some(&e.id),
                    ));
                }
                def.torpedo_tubes
                    .get_or_insert_default()
                    .push(TubeDefinition {
                        id: format!("{}.tube-{}", e.id, i + 1),
                        name: p.name.clone(),
                        part_id: w.id.clone(),
                        position: add(e.position, offset),
                        bearing_deg: 0.,
                        // Match the existing trainable-bank alignment window;
                        // projectile direction is still the physical absolute train.
                        arc_deg: 2.,
                        ammo: 1.,
                        magazine_id: magazine_id.clone(),
                        launcher_id: Some(e.id.clone()),
                        launcher_module_id: Some(e.id.clone()),
                        weapon: w.clone(),
                    });
            }
        }
        if p.kind != "gun" && p.placement != "internal" {
            if p.kind == "torpedo-launcher" {
                // Reserve the full train sweep for neighboring gun barrels.
                // Damage/contact boxes still use the actual moving module pose.
                let radius = (p.bounds_center[0].abs() + p.size[0] * 0.5)
                    .hypot(p.bounds_center[2].abs() + p.size[2] * 0.5);
                def.obstructions.push(Volume {
                    id: format!("{}-sweep", e.id),
                    center: add(e.position, [0., p.bounds_center[1], 0.]),
                    size: [radius * 2., p.size[1], radius * 2.],
                });
            } else if p.kind != "deck-fitting" {
                // Deck fittings are cosmetic: guns train and fire through them.
                def.obstructions.push(Volume {
                    id: e.id.clone(),
                    center: box_center,
                    size: box_size,
                });
            }
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
                .map(|m| m.weapon.ammo_per_barrel * m.weapon.barrel_count)
                .sum();
            if stock > p.ammunition_capacity.unwrap_or(0.) {
                let mut d = error(
                    "magazine-capacity",
                    format!(
                        "Magazine cannot hold all initially loaded rounds: {stock:.0} assigned, capacity {:.0}",
                        p.ammunition_capacity.unwrap_or(0.)
                    ),
                    Some(&e.id),
                );
                d.related_source_ids = Some(
                    def.mounts
                        .iter()
                        .filter(|m| m.magazine_id.as_deref() == Some(e.id.as_str()))
                        .map(|m| m.id.clone())
                        .collect(),
                );
                errors.push(d);
            }
        }
    }
    // Hull burial applies to every fixed fitting. Only collision-bearing fittings
    // can bury one another; decorative overlaps never consume their exposed volume.
    'burial: for id in &relaxed_ids {
        // One fault per fitting; a rejected fitting is not measured again.
        // A funnel or mast may be buried to any depth by hull pieces or fittings.
        if errors.len() >= MAX_ERRORS
            || uncontested_ids.contains(id)
            || errors.iter().any(|d| d.source_id.as_deref() == Some(*id))
        {
            continue;
        }
        let cells: Vec<_> = all_envelopes
            .iter()
            .filter(|(owner, _)| owner == id)
            .map(|(_, cell)| cell.clone())
            .collect();
        let mut exposed = match cg::union(&cells) {
            Ok(exposed) => exposed,
            Err(message) => {
                errors.push(error("equipment-overlap", message, Some(id)));
                continue;
            }
        };
        let volume = cg::total(&exposed).volume;
        let hull_candidates: std::collections::BTreeSet<_> = cells
            .iter()
            .flat_map(|cell| hull_index.candidates(cell))
            .collect();
        let fitting_candidates: std::collections::BTreeSet<_> = cells
            .iter()
            .flat_map(|cell| fitting_index.candidates(cell))
            .collect();
        let cutters = hull_candidates.iter().map(|&i| &hull[i]).chain(
            fitting_candidates
                .iter()
                .filter(|&&i| {
                    all_envelopes[i].0 != *id
                        && colliding_ids.contains(id)
                        && colliding_ids.contains(all_envelopes[i].0.as_str())
                })
                .map(|&i| &all_envelopes[i].1),
        );
        for cutter in cutters {
            exposed = exposed
                .iter()
                .flat_map(|cell| cg::subtract(cell, cutter))
                .collect();
            if cg::total(&exposed).volume + 1e-7 < volume * crate::construction_overlap::MIN_EXPOSED
            {
                errors.push(error(
                    "equipment-overlap",
                    format!(
                        "Keep at least 10% of each fixed fitting outside the hull; machinery must also remain exposed to other machinery and weapons. {} has under {:.0}% exposed",
                        part_name(id),
                        crate::construction_overlap::MIN_EXPOSED * 100.
                    ),
                    Some(id),
                ));
                continue 'burial;
            }
        }
    }
    // Propulsion and services describe a fitted ship; the caller reports the faults.
    if !errors.is_empty() {
        faults.append(&mut errors);
        return Ok(());
    }
    let power = crate::construction_propulsion::install(&fitted, def, out);
    // Final hull/loading and fitted datums are needed before deriving force-based estimates.
    def.handling = Handling {
        rudder_rate: 0.35,
        ..Default::default()
    };
    out.loading = Some(ConstructionLoading {
        power_kw: power,
        ..Default::default()
    });
    Ok(())
}
fn box_inertia(size: Vec3, kg: f64) -> Vec3 {
    std::array::from_fn(|i| kg * (size[(i + 1) % 3].powi(2) + size[(i + 2) % 3].powi(2)) / 12.)
}
fn integral_magazine(
    def: &mut ShipDefinition,
    e: &ConstructionEquipment,
    center: Vec3,
    size: Vec3,
    launcher: bool,
    exposed: bool,
) -> String {
    let id = format!("{}-magazine", e.id);
    def.modules.push(Module {
        id: id.clone(),
        name: format!("{} ammunition", e.id),
        kind: "magazine".into(),
        center,
        size,
        hp: 100.,
        placement: exposed.then(|| "fixed".into()),
        immersion_tolerance_m: (!exposed).then_some((size[1] * 0.2).max(0.1)),
        torpedo_launcher_id: launcher.then(|| e.id.clone()),
        ..Default::default()
    });
    id
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
    thread_local! {
        pub(super) static ROOM_PLANE_SCANS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    }

    #[test]
    fn fragmented_bulkheads_scan_each_room_once_per_side() {
        let (mut source, catalog) = fixture();
        source.construction.primitives = (0..12)
            .map(|i| ConstructionPrimitive {
                id: format!("segment-{i:02}"),
                kind: "box".into(),
                position: [0., 0., (i as f64 - 5.5) * 4.],
                size: [10., 4., 4.],
                ..Default::default()
            })
            .collect();
        source.construction.boundaries = vec![
            ConstructionBoundary {
                id: "deck".into(),
                axis: "y".into(),
                offset: 0.,
                thickness_mm: 20.,
            },
            ConstructionBoundary {
                id: "bulkhead".into(),
                axis: "z".into(),
                offset: 0.,
                thickness_mm: 20.,
            },
        ];
        ROOM_PLANE_SCANS.with(|count| count.set(0));
        let result = compile(&source, &catalog);
        let scans = ROOM_PLANE_SCANS.with(|count| count.get());
        let def = result.definition.expect("Segmented hull must compile");
        assert_eq!(def.compartments.len(), 4);
        assert!(!def.connections.is_empty());
        // Bound work independently of the number of hull/armor fragments. Count
        // scans, not elapsed time, so this catches the regression on any machine.
        assert!(
            scans <= 2 * source.construction.boundaries.len() * def.compartments.len(),
            "Repeated compartment scans: {scans}"
        );
        for connection in &def.connections {
            assert_eq!(connection.state.as_deref(), Some("closed"));
            assert_ne!(connection.from_id, connection.to_id);
            assert!(
                def.armor
                    .iter()
                    .any(|armor| Some(&armor.id) == connection.armor_id.as_ref())
            );
        }
        let area: f64 = def
            .connections
            .iter()
            .map(|connection| connection.area_m2)
            .sum();
        // The deck spans both halves and the transverse wall both decks, minus
        // the exterior plating and their shared steel intersection.
        let expected = (10. - 0.02) * (48. - 0.02 - 0.02) + (10. - 0.02) * (4. - 0.02 - 0.02);
        assert!((area - expected).abs() < 1e-6, "{area} != {expected}");
    }

    #[test]
    fn ship_surface_finish_preserves_physics_and_validates_saved_source() {
        let (mut source, catalog) = fixture();
        let original = compile(&source, &catalog);
        assert!(!to_json(&source).unwrap().contains("\"finish\""));
        let mut compiler = ConstructionCompiler::default();
        compiler.compile(&source, &catalog);
        for finish in ["matte", "satin", "semi-gloss", "gloss"] {
            source.construction.finish = Some(finish.into());
            let saved: ConstructionSource =
                serde_json::from_str(&to_json(&source).unwrap()).unwrap();
            assert_eq!(saved.construction.finish.as_deref(), Some(finish));
            let result = compiler.compile(&saved, &catalog);
            assert!(result.definition.is_some(), "{:?}", result.diagnostics);
            assert_ne!(result.content_hash, original.content_hash);
            assert_eq!(
                to_json(&result.surfaces).unwrap(),
                to_json(&original.surfaces).unwrap()
            );
            assert_eq!(
                to_json(&result.loading).unwrap(),
                to_json(&original.loading).unwrap()
            );
            assert_eq!(
                to_json(&result).unwrap(),
                to_json(&compile(&saved, &catalog)).unwrap()
            );
        }
        source.construction.finish = Some("chrome".into());
        assert!(
            compile(&source, &catalog)
                .diagnostics
                .iter()
                .any(|d| d.code == "surface-finish")
        );
        source.construction.finish = None;
        assert_eq!(
            compile(&source, &catalog).content_hash,
            original.content_hash
        );
    }
    #[test]
    fn ship_paint_coats_unassigned_faces_without_changing_physics() {
        let (mut source, catalog) = fixture();
        let original = compile(&source, &catalog);
        assert!(!to_json(&source).unwrap().contains("\"paint\":\"sea-blue\""));
        source.construction.paint = Some("sea-blue".into());
        let saved: ConstructionSource = serde_json::from_str(&to_json(&source).unwrap()).unwrap();
        assert_eq!(saved.construction.paint.as_deref(), Some("sea-blue"));
        let result = compile(&saved, &catalog);
        assert!(result.definition.is_some(), "{:?}", result.diagnostics);
        assert_eq!(
            to_json(&result.loading).unwrap(),
            to_json(&original.loading).unwrap()
        );
        let assigned = |s: &ConstructionSurface| {
            source
                .construction
                .surfaces
                .iter()
                .any(|a| a.primitive_id == s.primitive_id && a.face == s.face)
        };
        let mut repainted = 0;
        for (before, after) in original.surfaces.iter().zip(&result.surfaces) {
            if assigned(before) {
                assert_eq!(before.paint, after.paint);
            } else {
                assert_eq!(after.paint, "sea-blue");
                repainted += 1;
            }
        }
        assert!(repainted > 0);
        source.construction.paint = Some(String::new());
        assert!(
            compile(&source, &catalog)
                .diagnostics
                .iter()
                .any(|d| d.code == "ship-paint")
        );
    }
    #[test]
    fn incremental_revisions_match_fresh_compilation_including_invalid_edits() {
        let (base, mut catalog) = fixture();
        let mut compiler = ConstructionCompiler::default();
        let mut source = base.clone();
        compiler.compile(&source, &catalog);
        for edit in 0..9 {
            source.revision = format!("edit-{edit}");
            match edit {
                0 => { let mut block = source.construction.primitives[0].clone(); block.id = "deck-block".into(); block.size = [2.; 3]; block.position = [0., 3., 0.]; source.construction.primitives.push(block); }
                1 => source.construction.primitives[1].size[0] = 3.,
                2 => source.construction.primitives[1].position[0] = 100., // Detached invalid draft.
                3 => { source.construction.primitives.pop(); }
                4 => source.construction.default_thickness_mm = 40.,
                5 => source.construction.surfaces.push(serde_json::from_value(serde_json::json!({"primitiveId":"box","face":"top","open":true,"paint":"sea-blue","material":"steel","thicknessMm":40})).unwrap()),
                6 => source.construction.boundaries.push(ConstructionBoundary { id: "deck".into(), axis: "y".into(), offset: 0., thickness_mm: 20. }),
                7 => { catalog.revision = "changed".into(); source.construction.catalog_revision = catalog.revision.clone(); }
                _ => { source = base.clone(); source.id = "other-design".into(); }
            }
            let actual = compiler.compile(&source, &catalog);
            let fresh = compile(&source, &catalog);
            assert_eq!(
                to_json(&actual).unwrap(),
                to_json(&fresh).unwrap(),
                "edit {edit}"
            );
            if edit == 1 {
                assert!(compiler.reused_geometry_operations() > 0);
            }
        }
    }
    #[test]
    fn room_lookup_matches_full_exact_distance_with_ties_and_concavities() {
        let rooms: Vec<_> = (0..4)
            .map(|i| {
                let cells = vec![
                    cg::box_cell([i as f64 * 6., 0., -2.], [2., 4., 8.]),
                    cg::box_cell([i as f64 * 6. + 1., 0., 3.], [4., 4., 2.]),
                ];
                let (center, size) = crate::structure::bounds(
                    cells
                        .iter()
                        .flat_map(|c| c.faces.iter().flat_map(|f| f.vertices.iter().copied())),
                );
                Compartment {
                    id: format!("room-{i}"),
                    center,
                    size,
                    volumes: Some(cells),
                    ..Default::default()
                }
            })
            .collect();
        let lookup = RoomLookup::new(&rooms);
        for x in -4..26 {
            for z in -8..9 {
                let p = [x as f64, 0., z as f64];
                let expected = rooms
                    .iter()
                    .min_by(|a, b| cg::room_distance(a, p).total_cmp(&cg::room_distance(b, p)))
                    .unwrap();
                assert_eq!(lookup.nearest(&rooms, p).unwrap().id, expected.id, "{p:?}");
            }
        }
    }
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
                        tilt: None,
                        mesh: None,
                        solid: None,
                        balcony: None,
                        shaping: None,
                        custom_hull: None,
                        vertices: None,
                        smooth_group: None,
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
    fn microscopic_sealed_voids_do_not_consume_the_room_budget() {
        let (mut source, catalog) = fixture();
        source.construction.default_thickness_mm = 0.1;
        source.construction.primitives[0].size = [30., 1., 2.];
        source.construction.primitives[0].position = [0.; 3];
        for i in 0..257 {
            source.construction.primitives.push(ConstructionPrimitive {
                tilt: None,
                mesh: None,
                solid: None,
                balcony: None,
                shaping: None,
                custom_hull: None,
                id: format!("tiny-{i}"),
                kind: "box".into(),
                size: [0.01; 3],
                position: [-14. + i as f64 * 0.1, 0.505, 0.],
                ..Default::default()
            });
        }
        source.construction.boundaries.push(ConstructionBoundary {
            id: "tiny-void-floor".into(),
            axis: "y".into(),
            offset: 0.501,
            thickness_mm: 0.1,
        });
        let result = compile(&source, &catalog);
        assert!(result.definition.is_some(), "{:?}", result.diagnostics);
        assert!(result.definition.unwrap().compartments.len() < 256);
    }
    #[test]
    fn ballast_adds_exact_fixed_payload_and_displaces_real_interior() {
        let (mut source, catalog) = fixture();
        source.construction.primitives.push(ConstructionPrimitive {
            tilt: None,
            mesh: None,
            solid: None,
            balcony: None,
            shaping: None,
            custom_hull: None,
            id: "weight".into(),
            kind: "box".into(),
            size: [3., 2., 3.],
            position: [2., 3., 0.],
            rotation_deg: 0.,
            vertices: None,
            smooth_group: None,
        });
        let empty = compile(&source, &catalog).loading.unwrap();
        source.construction.primitives[1].kind = "ballast".into();
        let result = compile(&source, &catalog);
        assert!(result.definition.is_some(), "{:?}", result.diagnostics);
        let loaded = result.loading.unwrap();
        assert!((loaded.mass_kg - empty.mass_kg - 100_000.).abs() < 1e-6);
        assert!((loaded.envelope_volume_m3 - empty.envelope_volume_m3).abs() < 1e-7);
        assert!(loaded.usable_volume_m3 < empty.usable_volume_m3);
        let weight = loaded
            .contributions
            .iter()
            .find(|c| c.id == "weight")
            .unwrap();
        assert_eq!(weight.mass_kg, 100_000.);
        assert!((weight.center[0] - 2.).abs() < 1e-7);
        assert!(loaded.center_of_gravity[0] > empty.center_of_gravity[0]);
        source.construction.primitives[1].size = [4., 2., 4.];
        assert_eq!(
            compile(&source, &catalog)
                .loading
                .unwrap()
                .contributions
                .iter()
                .find(|c| c.id == "weight")
                .unwrap()
                .mass_kg,
            100_000.
        );
        let mut duplicate = source.construction.primitives[1].clone();
        duplicate.id = "weight2".into();
        source.construction.primitives.push(duplicate);
        assert!(
            compile(&source, &catalog)
                .diagnostics
                .iter()
                .any(|d| d.code == "ballast-fit")
        );
    }
    #[test]
    fn every_library_shape_compiles_with_real_material_and_voids() {
        for kind in crate::construction_shapes::KINDS {
            let (mut source, catalog) = fixture();
            source.construction.primitives[0].kind = (*kind).into();
            source.construction.primitives[0].size = [8., 6., 10.];
            let started = std::time::Instant::now();
            let result = compile(&source, &catalog);
            eprintln!(
                "{kind}: {:?} {} surfaces",
                started.elapsed(),
                result.surfaces.len()
            );
            assert!(
                result.definition.is_some(),
                "{kind}: {:?}",
                result.diagnostics
            );
            let definition = result.definition.unwrap();
            crate::catalog::validate_definition(&definition).unwrap();
            let loading = definition.loading.unwrap();
            assert!(
                loading.mass_kg > 0. && loading.envelope_volume_m3 > 0.,
                "{kind}"
            );
            assert!(
                loading.material_volume_m3 <= loading.envelope_volume_m3 + 1e-6,
                "{kind}"
            );
        }
    }
    #[test]
    fn vertex_hulls_compile_real_volume_and_retain_face_assignments() {
        let (mut s, c) = fixture();
        let original = compile(&s, &c).loading.unwrap().envelope_volume_m3;
        s.construction.primitives[0].kind = "vertex".into();
        let cube = compile(&s, &c);
        assert!(cube.definition.is_some(), "{:?}", cube.diagnostics);
        assert!((cube.loading.unwrap().envelope_volume_m3 - original).abs() < 1e-6);
        s.construction.primitives[0].vertices = Some(vec![
            [-0.5, -0.5, -0.5],
            [0.5, -0.5, -0.5],
            [0.3, 0.5, -0.5],
            [-0.5, 0.5, -0.5],
            [-0.5, -0.5, 0.5],
            [0.5, -0.5, 0.5],
            [0.5, 0.5, 0.5],
            [-0.5, 0.5, 0.5],
        ]);
        s.construction.surfaces.push(ConstructionSurfaceAssignment {
            panel_id: None,
            primitive_id: "box".into(),
            face: "starboard".into(),
            thickness_mm: 25.,
            material: "armor-steel".into(),
            paint: "red-oxide".into(),
            open: None,
        });
        let warped = compile(&s, &c);
        assert!(warped.definition.is_some(), "{:?}", warped.diagnostics);
        assert!(warped.loading.unwrap().envelope_volume_m3 < original);
        assert!(
            warped
                .surfaces
                .iter()
                .filter(|s| s.face == "starboard")
                .all(|s| s.paint == "red-oxide" && s.thickness_mm == 25.)
        );
        assert!(warped.surfaces.iter().all(|s| s.face != "slope"));
        let mut split = s.clone();
        let parent = s.construction.primitives[0].clone();
        split.construction.surfaces.clear();
        split.construction.primitives = (0..4)
            .map(|i| {
                let mut p = parent.clone();
                p.id = format!("child-{i}");
                p.size[2] /= 4.;
                p.position[2] = -10. + 2.5 + i as f64 * 5.;
                let v = p.vertices.as_mut().unwrap();
                v[2][0] = 0.5 - 0.2 * (1. - i as f64 / 4.);
                v[6][0] = 0.5 - 0.2 * (1. - (i + 1) as f64 / 4.);
                p
            })
            .collect();
        let children = compile(&split, &c);
        assert!(children.definition.is_some(), "{:?}", children.diagnostics);
        s.construction.primitives[0].vertices.as_mut().unwrap()[2] = [-2., -2., 2.];
        let folded = compile(&s, &c);
        assert!(folded.definition.is_none());
        assert!(
            folded
                .diagnostics
                .iter()
                .any(|d| d.code == "vertex-hull" && d.source_id.as_deref() == Some("box"))
        );
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
            .unwrap_or_else(|| panic!("{:?}", result.diagnostics));
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
        r.definition
            .unwrap_or_else(|| panic!("{:?}", r.diagnostics))
    }
    fn catamaran() -> (ConstructionSource, ConstructionCatalog) {
        let (mut s, c) = fixture();
        s.id = "catamaran".into();
        s.construction.primitives = vec![
            ConstructionPrimitive {
                tilt: None,
                mesh: None,
                solid: None,
                balcony: None,
                shaping: None,
                custom_hull: None,
                vertices: None,
                smooth_group: None,
                id: "port".into(),
                kind: "box".into(),
                position: [-4., 0., 0.],
                size: [3., 4., 20.],
                rotation_deg: 0.,
            },
            ConstructionPrimitive {
                tilt: None,
                mesh: None,
                solid: None,
                balcony: None,
                shaping: None,
                custom_hull: None,
                vertices: None,
                smooth_group: None,
                id: "starboard".into(),
                kind: "box".into(),
                position: [4., 0., 0.],
                size: [3., 4., 20.],
                rotation_deg: 0.,
            },
            ConstructionPrimitive {
                tilt: None,
                mesh: None,
                solid: None,
                balcony: None,
                shaping: None,
                custom_hull: None,
                vertices: None,
                smooth_group: None,
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
            panel_id: None,
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
            panel_id: None,
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
    fn closed_bulkhead_isolates_water_and_damage_transfer_conserves_it() {
        let (mut s, c) = fixture();
        s.construction.boundaries.push(ConstructionBoundary {
            id: "wall".into(),
            axis: "z".into(),
            offset: 0.,
            thickness_mm: 10.,
        });
        let d = compiled(&s, &c);
        assert_eq!(d.compartments.len(), 2);
        assert!(!d.connections.is_empty());
        assert!(
            d.connections
                .iter()
                .all(|c| c.state.as_deref() == Some("closed")
                    && d.armor.iter().any(|a| Some(&a.id) == c.armor_id.as_ref()))
        );
        let hydro = crate::hydrostatics::HullHydrostatics::new(&d.hull, None);
        let mut actor = crate::damage::Combatant::new("rooms", &d);
        let source = actor.damage.connections[0].from_index;
        let target = actor.damage.connections[0].to_index;
        let water = d.compartments[source].capacity_m3 * 0.8;
        actor.damage.compartments[source].water_m3 = water;
        crate::flooding::update_flooding(&mut actor, &d, &hydro, 0.01, 0.5, None, None);
        assert_eq!(actor.damage.compartments[target].water_m3, 0.);
        actor.damage.connections[0].state = "damaged".into();
        actor.damage.connections[0].damage_area_m2 = 0.1;
        crate::flooding::update_flooding(&mut actor, &d, &hydro, 0.01, 0.5, None, None);
        assert!(actor.damage.compartments[target].water_m3 > 0.);
        assert!(
            (actor
                .damage
                .compartments
                .iter()
                .map(|c| c.water_m3)
                .sum::<f64>()
                - water)
                .abs()
                < 1e-8
        );
        assert!(
            actor
                .damage
                .compartments
                .iter()
                .all(|c| c.water_level_y.is_some())
        );
        s.construction.surfaces.push(ConstructionSurfaceAssignment {
            panel_id: None,
            primitive_id: "box".into(),
            face: "top".into(),
            open: Some(true),
            thickness_mm: 0.,
            material: "steel".into(),
            paint: "naval-gray".into(),
        });
        let open = compiled(&s, &c);
        for room in &open.compartments {
            assert!(
                open.openings
                    .as_ref()
                    .unwrap()
                    .iter()
                    .any(|o| o.compartment_id == room.id)
            );
        }
        s.construction.boundaries.clear();
        assert_eq!(compiled(&s, &c).compartments.len(), 1);
    }
    #[test]
    fn occupied_interior_barrier_cannot_join_disconnected_air_spaces() {
        let (mut s, c) = fixture();
        s.construction.loads.push(ConstructionLoad {
            id: "package".into(),
            name: "Sealed package".into(),
            mass_kg: 100.,
            center: [0.; 3],
            size: [9.98, 3.98, 0.1],
        });
        let d = compiled(&s, &c);
        assert_eq!(d.compartments.len(), 2);
        assert!(d.connections.is_empty());
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
    fn equipped_fixture() -> (ConstructionSource, ConstructionCatalog) {
        let (mut s, mut c) = fixture();
        let weapons: PartCatalog =
            serde_json::from_str(include_str!("../../../assets/parts/guns.json")).unwrap();
        let gun = weapons
            .parts
            .iter()
            .find(|p| p.id == "us-5in38-mk30-mod0-single")
            .unwrap()
            .clone();
        c.weapons.parts.push(gun.clone());
        for (id, kind, placement, size, center, mass_kg) in [
            (
                "engine-part",
                "engine",
                "internal",
                [2., 2., 3.],
                [0., 1., 0.],
                10000.,
            ),
            (
                "magazine-part",
                "magazine",
                "internal",
                [2., 2., 3.],
                [0., 1., 0.],
                1000.,
            ),
            (
                "funnel-part",
                "funnel",
                "deck",
                [1., 3., 1.],
                [0., 1.5, 0.],
                1000.,
            ),
            (
                "screw-part",
                "propeller",
                "underwater",
                [0.5, 0.5, 0.5],
                [0.; 3],
                100.,
            ),
            (
                "rudder-part",
                "rudder",
                "underwater",
                [0.2, 0.8, 1.],
                [0., -0.4, 0.],
                100.,
            ),
            ("gun-part", "gun", "deck", [3., 2., 3.], [0., 1., 0.], 0.),
        ] {
            c.equipment.push(ConstructionEquipmentPart {
                id: id.into(),
                name: id.into(),
                kind: kind.into(),
                placement: placement.into(),
                size,
                bounds_center: center,
                center_of_gravity: center,
                mass_kg: (mass_kg > 0.).then_some(mass_kg),
                model_url: format!("/models/components/{id}/test.glb"),
                content_hash: "test".into(),
                gun_part_id: (kind == "gun").then(|| gun.id.clone()),
                power_kw: (kind == "engine").then_some(1000.),
                exhaust_kw: (kind == "funnel").then_some(1000.),
                thrust_efficiency: (kind == "propeller").then_some(0.6),
                rudder_area_m2: (kind == "rudder").then_some(0.8),
                ammunition_capacity: (kind == "magazine").then_some(1000.),
                occupancy: if kind == "gun" {
                    Some(vec![ConstructionEquipmentPartOccupancyItem {
                        center: [0., -0.5, 0.],
                        size: [2.6, 1., 2.6],
                    }])
                } else if kind == "funnel" {
                    Some(vec![ConstructionEquipmentPartOccupancyItem {
                        center: [0., -0.25, 0.],
                        size: [1., 0.5, 1.],
                    }])
                } else {
                    None
                },
                sockets: Some(vec![ConstructionEquipmentPartSocketsItem {
                    id: "attachment".into(),
                    kind: "support".into(),
                    position: if kind == "propeller" {
                        [0., 0., -0.25]
                    } else {
                        [0.; 3]
                    },
                    direction: if kind == "propeller" {
                        [0., 0., -1.]
                    } else if kind == "rudder" {
                        [0., 1., 0.]
                    } else {
                        [0., -1., 0.]
                    },
                }]),
                ..Default::default()
            });
        }
        for (id, part, position) in [
            ("engine", "engine-part", [-3., -1.99, 2.]),
            ("magazine", "magazine-part", [3., -1.99, -4.]),
            ("gun", "gun-part", [0., 2., -5.]),
            ("funnel", "funnel-part", [0., 2., 5.]),
            ("screw", "screw-part", [0., -1.5, 10.25]),
            ("rudder", "rudder-part", [2., -2., 7.]),
        ] {
            s.construction.equipment.push(ConstructionEquipment {
                id: id.into(),
                part_id: part.into(),
                position,
                bearing_deg: 0.,
                ..Default::default()
            });
        }
        (s, c)
    }
    #[test]
    fn every_faulty_fitting_is_reported_with_its_measured_gap_and_seat() {
        let (mut source, catalog) = equipped_fixture();
        let mut sunk = source.construction.equipment[2].clone();
        assert_eq!(sunk.id, "gun");
        sunk.id = "sunk".into();
        sunk.position = [0., 1.5, 1.];
        sunk.bearing_deg = 90.;
        source.construction.equipment.push(sunk);
        source.construction.equipment[2].position[1] = 2.8;
        let result = compile(&source, &catalog);
        assert!(result.definition.is_none());
        let errors: Vec<_> = result
            .diagnostics
            .iter()
            .filter(|d| d.severity == "error")
            .collect();
        assert_eq!(errors.len(), 2, "{:?}", result.diagnostics);
        let floating = errors
            .iter()
            .find(|d| d.source_id.as_deref() == Some("gun"))
            .unwrap();
        assert_eq!(floating.code, "equipment-attachment");
        assert_eq!(floating.fit.as_ref().unwrap().gap_m, Some(0.8));
        assert_eq!(
            floating.fit.as_ref().unwrap().tolerance_m,
            Some(fit::ATTACHMENT_M)
        );
        assert_eq!(
            floating.fit.as_ref().unwrap().nearest_support_id.as_deref(),
            Some("box")
        );
        assert_eq!(
            floating.fit.as_ref().unwrap().seat_position,
            Some([0., 2., -5.])
        );
        assert!(floating.message.contains("0.800 m clear of hull piece box"));
        let buried = errors
            .iter()
            .find(|d| d.source_id.as_deref() == Some("sunk"))
            .unwrap();
        assert_eq!(buried.code, "equipment-fit", "{buried:?}");
        assert_eq!(buried.fit.as_ref().unwrap().gap_m, Some(-0.5));
        // The catalog body starts just above its datum.
        assert!(
            buried
                .fit
                .as_ref()
                .unwrap()
                .penetration_m
                .is_some_and(|depth| depth > 0.4 && depth <= 0.5)
        );
        assert_eq!(
            buried.fit.as_ref().unwrap().seat_position,
            Some([0., 2., 1.])
        );
        let note = result.diagnostics.last().unwrap();
        assert_eq!(
            (note.severity.as_str(), note.code.as_str()),
            ("warning", "checks-skipped")
        );
        // Both corrections together compile.
        for e in &mut source.construction.equipment {
            if let Some(d) = errors
                .iter()
                .find(|d| d.source_id.as_deref() == Some(e.id.as_str()))
            {
                e.position = d.fit.as_ref().unwrap().seat_position.unwrap();
            }
        }
        let repaired = compile(&source, &catalog);
        assert!(repaired.definition.is_some(), "{:?}", repaired.diagnostics);
    }
    #[test]
    fn suggestions_set_faulty_fittings_aside_but_not_a_faulty_hull() {
        let (mut source, catalog) = equipped_fixture();
        source.construction.equipment.retain(|e| e.id != "funnel");
        source.construction.equipment[2].position[1] = 2.8;
        let before = source.construction.equipment.clone();
        let proposal = suggest(&source, &catalog, &["funnel-part".into()]);
        assert!(
            proposal.diagnostics.iter().all(|d| d.severity == "warning"),
            "{:?}",
            proposal.diagnostics
        );
        assert_eq!(proposal.diagnostics[0].code, "suggestion-draft");
        assert_eq!(
            proposal.diagnostics[0].related_source_ids.as_deref(),
            Some(&["gun".to_owned()][..])
        );
        let added = proposal.source.construction.equipment.last().unwrap();
        assert_eq!(added.part_id, "funnel-part");
        assert_eq!(
            serde_json::to_string(&proposal.source.construction.equipment[..before.len()]).unwrap(),
            serde_json::to_string(&before).unwrap()
        );
        // Seating the faulty gun then yields a valid ship with the proposed funnel.
        let mut repaired = proposal.source.clone();
        repaired.construction.equipment[2].position[1] = 2.;
        let result = compile(&repaired, &catalog);
        assert!(result.definition.is_some(), "{:?}", result.diagnostics);
        source.construction.boundaries.push(ConstructionBoundary {
            id: "outside".into(),
            axis: "y".into(),
            offset: 50.,
            thickness_mm: 10.,
        });
        let refused = suggest(&source, &catalog, &["funnel-part".into()]);
        assert!(refused.diagnostics.iter().any(|d| d.code == "boundary"));
        assert_eq!(refused.source.construction.equipment.len(), before.len());
    }
    #[test]
    fn independent_source_faults_are_reported_together() {
        let (mut source, catalog) = equipped_fixture();
        let mut surface = ConstructionSurfaceAssignment {
            primitive_id: "absent".into(),
            face: "top".into(),
            thickness_mm: 10.,
            material: "steel".into(),
            paint: "naval-gray".into(),
            ..Default::default()
        };
        source.construction.surfaces.push(surface.clone());
        surface.primitive_id = "box".into();
        surface.material = "tin".into();
        source.construction.surfaces.push(surface);
        source.construction.equipment[0].paint = Some(String::new());
        let result = compile(&source, &catalog);
        let found: Vec<_> = result
            .diagnostics
            .iter()
            .filter(|d| d.severity == "error")
            .map(|d| (d.code.as_str(), d.source_id.as_deref()))
            .collect();
        assert_eq!(
            found,
            [
                ("equipment-paint", Some("engine")),
                ("surface", Some("absent")),
                ("surface", Some("box"))
            ],
            "{:?}",
            result.diagnostics
        );
        // Optional measurement fields never appear on diagnostics without them.
        let json = to_json(&result).unwrap();
        assert!(!json.contains("gapM") && !json.contains("relatedSourceIds"));
        assert!(
            !serde_json::to_string(&result.diagnostics)
                .unwrap()
                .contains("gapM")
        );
    }
    #[test]
    fn propulsion_warnings_identify_missing_parts_and_keep_trials_available() {
        for (removed, needed) in [
            ("funnel", "funnel"),
            ("screw", "propeller"),
            ("engine", "engine"),
        ] {
            let (mut source, catalog) = equipped_fixture();
            source.construction.equipment.retain(|e| e.id != removed);
            let result = compile(&source, &catalog);
            assert!(result.definition.is_some(), "{:?}", result.diagnostics);
            assert_eq!(result.loading.as_ref().unwrap().power_kw, 0.);
            let warning = result
                .diagnostics
                .iter()
                .find(|d| d.code == "unpowered")
                .unwrap();
            assert_eq!(warning.severity, "warning");
            assert!(warning.message.contains(needed), "{}", warning.message);
            assert!(warning.message.contains("Add"), "{}", warning.message);
            assert!(warning.message.contains("trial"), "{}", warning.message);
            if removed != "engine" {
                assert_eq!(warning.source_id.as_deref(), Some("engine"));
            }
        }
        let (mut source, catalog) = equipped_fixture();
        source
            .construction
            .equipment
            .retain(|e| e.id != "funnel" && e.id != "screw");
        let result = compile(&source, &catalog);
        let warning = result
            .diagnostics
            .iter()
            .find(|d| d.code == "unpowered")
            .unwrap();
        assert!(warning.message.contains("funnel") && warning.message.contains("propeller"));
    }

    #[test]
    fn shared_propeller_combines_power_but_keeps_engine_damage_independent() {
        use crate::{damage::Combatant, machinery::system_health};
        let (mut source, mut catalog) = equipped_fixture();
        catalog
            .equipment
            .iter_mut()
            .find(|p| p.kind == "funnel")
            .unwrap()
            .exhaust_kw = Some(2000.);
        let baseline = compile(&source, &catalog).loading.unwrap().power_kw;
        let mut second = source
            .construction
            .equipment
            .iter()
            .find(|e| e.id == "engine")
            .unwrap()
            .clone();
        second.id = "second-engine".into();
        second.position[0] = 3.;
        source.construction.equipment.push(second);
        let result = compile(&source, &catalog);
        assert!(result.definition.is_some(), "{:?}", result.diagnostics);
        assert!(!result.diagnostics.iter().any(|d| d.code == "unpowered"));
        assert_eq!(result.propeller_assignments.as_ref().unwrap().len(), 2);
        assert!((result.loading.as_ref().unwrap().power_kw - 2. * baseline).abs() < 1e-9);
        let def = result.definition.as_ref().unwrap();
        let groups = &def.propulsion.as_ref().unwrap().groups;
        assert_eq!(groups.len(), 2);
        assert!(
            groups
                .iter()
                .all(|g| g.shaft_ids == ["screw"] && g.drive_ids.len() == 1)
        );
        let fresh = Combatant::new("shared", def);
        assert!((system_health(&fresh, def, "engine", None) - 1.).abs() < 1e-9);
        let mut actor = fresh.clone();
        actor
            .damage
            .modules
            .iter_mut()
            .find(|m| m.id == "engine")
            .unwrap()
            .hp = 0.;
        assert!((system_health(&actor, def, "engine", None) - 0.5).abs() < 1e-9);
        actor = fresh.clone();
        let shaft = actor
            .damage
            .modules
            .iter_mut()
            .find(|m| m.id == "screw")
            .unwrap();
        shaft.hp *= 0.5;
        assert!((system_health(&actor, def, "engine", None) - 0.5).abs() < 1e-9);
        actor
            .damage
            .modules
            .iter_mut()
            .find(|m| m.id == "screw")
            .unwrap()
            .hp = 0.;
        assert_eq!(system_health(&actor, def, "engine", None), 0.);
        assert!((system_health(&fresh, def, "engine", None) - 1.).abs() < 1e-9);
    }

    #[test]
    fn automatic_propellers_recompile_layout_and_freeze_connections_for_damage() {
        use crate::{damage::Combatant, machinery::system_health};
        let (mut source, mut catalog) = equipped_fixture();
        catalog
            .equipment
            .iter_mut()
            .find(|p| p.kind == "funnel")
            .unwrap()
            .exhaust_kw = Some(2000.);
        source
            .construction
            .equipment
            .iter_mut()
            .find(|e| e.id == "screw")
            .unwrap()
            .position[0] = -3.;
        for (original, id) in [("engine", "starboard-engine"), ("screw", "starboard-screw")] {
            let mut copy = source
                .construction
                .equipment
                .iter()
                .find(|e| e.id == original)
                .unwrap()
                .clone();
            copy.id = id.into();
            copy.position[0] = 3.;
            source.construction.equipment.push(copy);
        }
        let result = compile(&source, &catalog);
        assert!(result.definition.is_some(), "{:?}", result.diagnostics);
        assert!(!result.diagnostics.iter().any(|d| d.code == "unpowered"));
        let assignment = |r: &ConstructionResult, prop: &str| {
            r.propeller_assignments
                .as_ref()
                .unwrap()
                .iter()
                .find(|a| a.propeller_id == prop)
                .map(|a| a.engine_id.clone())
        };
        assert_eq!(assignment(&result, "screw").as_deref(), Some("engine"));
        assert_eq!(
            assignment(&result, "starboard-screw").as_deref(),
            Some("starboard-engine")
        );
        let def = result.definition.as_ref().unwrap();
        let mut actor = Combatant::new("frozen", def);
        for id in ["engine", "starboard-screw"] {
            actor
                .damage
                .modules
                .iter_mut()
                .find(|m| m.id == id)
                .unwrap()
                .hp = 0.;
        }
        assert_eq!(system_health(&actor, def, "engine", None), 0.); // No damage-time reassignment.
        assert_eq!(assignment(&result, "screw").as_deref(), Some("engine"));
        for e in source
            .construction
            .equipment
            .iter_mut()
            .filter(|e| e.id == "engine" || e.id == "starboard-engine")
        {
            e.position[0] *= -1.;
        }
        let moved = compile(&source, &catalog);
        assert!(moved.definition.is_some(), "{:?}", moved.diagnostics);
        assert_eq!(
            assignment(&moved, "screw").as_deref(),
            Some("starboard-engine")
        );
        assert_eq!(
            assignment(&moved, "starboard-screw").as_deref(),
            Some("engine")
        );
        source
            .construction
            .equipment
            .iter_mut()
            .find(|e| e.id == "screw")
            .unwrap()
            .power_source_id = Some("engine".into());
        let manual = compile(&source, &catalog);
        assert_eq!(assignment(&manual, "screw").as_deref(), Some("engine"));
        assert_eq!(
            assignment(&manual, "starboard-screw").as_deref(),
            Some("starboard-engine")
        );
        source
            .construction
            .equipment
            .retain(|e| e.id != "starboard-screw");
        let short = compile(&source, &catalog);
        let warning = short
            .diagnostics
            .iter()
            .find(|d| d.code == "unpowered")
            .unwrap();
        assert_eq!(warning.source_id.as_deref(), Some("starboard-engine"));
        assert!(warning.message.contains("Set a propeller to Automatic"));
        // Routing still appears while a missing funnel prevents thrust.
        source.construction.equipment.retain(|e| e.id != "funnel");
        let missing = compile(&source, &catalog);
        assert_eq!(assignment(&missing, "screw").as_deref(), Some("engine"));
        assert_eq!(missing.loading.unwrap().power_kw, 0.);
    }

    #[test]
    fn propulsion_warnings_explain_zero_power_and_exhaust_capacity() {
        for (rated, exhaust, expected) in [
            (0., 1000., "rated power"),
            (1000., 0., "exhaust capacity"),
            (1000., 10., "auxiliary"),
        ] {
            let (source, mut catalog) = equipped_fixture();
            catalog
                .equipment
                .iter_mut()
                .find(|p| p.kind == "engine")
                .unwrap()
                .power_kw = Some(rated);
            catalog
                .equipment
                .iter_mut()
                .find(|p| p.kind == "funnel")
                .unwrap()
                .exhaust_kw = Some(exhaust);
            let result = compile(&source, &catalog);
            assert!(result.definition.is_some(), "{:?}", result.diagnostics);
            assert_eq!(result.loading.as_ref().unwrap().power_kw, 0.);
            let warning = result
                .diagnostics
                .iter()
                .find(|d| d.code == "unpowered")
                .unwrap();
            assert!(warning.message.contains(expected), "{}", warning.message);
        }
        let (source, catalog) = equipped_fixture();
        assert!(
            !compile(&source, &catalog)
                .diagnostics
                .iter()
                .any(|d| d.code == "unpowered")
        );
    }

    fn shared_exhaust_fixture() -> (ConstructionSource, ConstructionCatalog) {
        let (mut source, mut catalog) = equipped_fixture();
        let mut engine_part = catalog
            .equipment
            .iter()
            .find(|p| p.kind == "engine")
            .unwrap()
            .clone();
        engine_part.id = "large-engine-part".into();
        engine_part.power_kw = Some(3000.);
        catalog.equipment.push(engine_part);
        for (original, id, part, position) in [
            (
                "engine",
                "second-engine",
                "large-engine-part",
                [-3., -1.99, 6.],
            ),
            ("screw", "second-screw", "screw-part", [2., -1.5, 10.25]),
        ] {
            let mut copy = source
                .construction
                .equipment
                .iter()
                .find(|e| e.id == original)
                .unwrap()
                .clone();
            copy.id = id.into();
            copy.part_id = part.into();
            copy.position = position;
            if original == "screw" {
                copy.power_source_id = Some("second-engine".into());
            }
            source.construction.equipment.push(copy);
        }
        source
            .construction
            .equipment
            .iter_mut()
            .find(|e| e.id == "screw")
            .unwrap()
            .power_source_id = Some("engine".into());
        (source, catalog)
    }

    #[test]
    fn shared_exhaust_limits_all_engines_and_accepts_obsolete_funnel_links() {
        let (mut source, mut catalog) = shared_exhaust_fixture();
        for (capacity, expected) in [
            (0., 0.),
            (40., 0.),
            (2000., 1152.),
            (4000., 2352.),
            (8000., 2352.),
        ] {
            catalog
                .equipment
                .iter_mut()
                .find(|p| p.kind == "funnel")
                .unwrap()
                .exhaust_kw = Some(capacity);
            let result = compile(&source, &catalog);
            assert!(result.definition.is_some(), "{:?}", result.diagnostics);
            assert!((result.loading.as_ref().unwrap().power_kw - expected).abs() < 1e-9);
            assert_eq!(
                result
                    .diagnostics
                    .iter()
                    .any(|d| d.code == "exhaust-capacity"),
                capacity > 0. && capacity < 4000.
            );
            if expected > 0. {
                let groups = &result
                    .definition
                    .as_ref()
                    .unwrap()
                    .propulsion
                    .as_ref()
                    .unwrap()
                    .groups;
                assert_eq!(groups.len(), 2);
                assert!((groups[0].share - 0.25).abs() < 1e-9);
                assert!((groups[1].share - 0.75).abs() < 1e-9);
            }
        }
        // An old link to an engine that has since been deleted is harmless.
        source
            .construction
            .equipment
            .iter_mut()
            .find(|e| e.id == "funnel")
            .unwrap()
            .power_source_id = Some("deleted-engine".into());
        assert!((compiled(&source, &catalog).loading.unwrap().power_kw - 2352.).abs() < 1e-9);
        source
            .construction
            .equipment
            .iter_mut()
            .find(|e| e.id == "screw")
            .unwrap()
            .power_source_id = Some("deleted-engine".into());
        assert!(
            compile(&source, &catalog)
                .diagnostics
                .iter()
                .any(|d| d.code == "power-link")
        );
    }

    #[test]
    fn shared_exhaust_damage_uses_capacity_and_reallocates_after_engine_loss() {
        use crate::{
            damage::Combatant,
            machinery::{electrical_power, system_health},
        };
        let (mut source, mut catalog) = shared_exhaust_fixture();
        let mut large = catalog
            .equipment
            .iter()
            .find(|p| p.kind == "funnel")
            .unwrap()
            .clone();
        large.id = "large-funnel-part".into();
        large.exhaust_kw = Some(5000.);
        catalog.equipment.push(large);
        let mut funnel = source
            .construction
            .equipment
            .iter()
            .find(|e| e.id == "funnel")
            .unwrap()
            .clone();
        funnel.id = "large-funnel".into();
        funnel.part_id = "large-funnel-part".into();
        funnel.position[0] = 3.;
        source.construction.equipment.push(funnel);
        let definition = compiled(&source, &catalog);
        // Ratings must survive the native/JSON definition boundary.
        let def: ShipDefinition =
            serde_json::from_str(&serde_json::to_string(&definition).unwrap()).unwrap();
        let mut actor = Combatant::new("pool", &def);
        let health = |a: &Combatant| system_health(a, &def, "engine", None);
        let set = |a: &mut Combatant, id: &str, fraction: f64| {
            let max = def.modules.iter().find(|m| m.id == id).unwrap().hp;
            a.damage.modules.iter_mut().find(|m| m.id == id).unwrap().hp = max * fraction;
        };
        assert_eq!(health(&actor), 1.);
        let mut submerged = def.clone();
        submerged
            .modules
            .iter_mut()
            .find(|m| m.id == "large-funnel")
            .unwrap()
            .center[1] = -100.;
        let immersed_actor = Combatant::new("immersed", &submerged);
        assert!(
            (system_health(&immersed_actor, &submerged, "engine", None) - (1000. - 80.) / 3920.)
                .abs()
                < 1e-9
        );
        assert!(crate::catalog::validate_definition(&def).is_ok());
        let mut invalid = def.clone();
        invalid
            .propulsion
            .as_mut()
            .unwrap()
            .shared_exhaust
            .as_mut()
            .unwrap()
            .funnels[0]
            .kw = -1.;
        assert!(crate::catalog::validate_definition(&invalid).is_err());
        set(&mut actor, "funnel", 0.);
        assert_eq!(health(&actor), 1.); // 5000 kW still covers 4000 kW.
        set(&mut actor, "large-funnel", 0.5);
        assert!((health(&actor) - (2500. - 80.) / 3920.).abs() < 1e-9);
        assert_eq!(electrical_power(&actor, &def, None), 1.); // Auxiliary reserve first.
        set(&mut actor, "second-engine", 0.);
        assert!((health(&actor) - 0.25).abs() < 1e-9); // Remaining engine has full exhaust.
        set(&mut actor, "large-funnel", 0.);
        assert_eq!(health(&actor), 0.);
        assert_eq!(electrical_power(&actor, &def, None), 0.);
        set(&mut actor, "funnel", 0.01); // 10 kW for a 20 kW auxiliary reserve.
        assert_eq!(health(&actor), 0.);
        let mut no_exhaust_limit = actor.clone();
        set(&mut no_exhaust_limit, "funnel", 1.);
        assert!(
            (electrical_power(&actor, &def, None)
                / electrical_power(&no_exhaust_limit, &def, None)
                - 0.5)
                .abs()
                < 1e-9
        );
        set(&mut no_exhaust_limit, "screw", 0.);
        assert_eq!(health(&no_exhaust_limit), 0.);
        assert!(electrical_power(&no_exhaust_limit, &def, None) > 0.);
    }

    #[test]
    fn integral_magazine_stays_at_barbette_foot_when_turret_is_raised() {
        let (mut s, c) = equipped_fixture();
        s.construction.version = 2.;
        s.construction.equipment.retain(|e| e.id != "magazine");
        let normal = compiled(&s, &c);
        let magazine = normal
            .modules
            .iter()
            .find(|m| m.id == "gun-magazine")
            .unwrap();
        assert_eq!(
            normal.mounts[0].magazine_id.as_deref(),
            Some("gun-magazine")
        );
        let gun = s
            .construction
            .equipment
            .iter_mut()
            .find(|e| e.id == "gun")
            .unwrap();
        gun.position[1] += 3.;
        gun.gun = Some(ConstructionEquipmentGun {
            barbette_height_m: Some(3.),
            ..Default::default()
        });
        let raised = compiled(&s, &c);
        assert!(
            length(sub(
                magazine.center,
                raised
                    .modules
                    .iter()
                    .find(|m| m.id == "gun-magazine")
                    .unwrap()
                    .center
            )) < 1e-9
        );
        assert!((raised.mounts[0].position[1] - normal.mounts[0].position[1] - 3.).abs() < 1e-9);
        assert!(
            raised.loading.as_ref().unwrap().mass_kg > normal.loading.as_ref().unwrap().mass_kg
        );
        let ammo = |d: &ShipDefinition| {
            d.loading
                .as_ref()
                .unwrap()
                .contributions
                .iter()
                .find(|m| m.kind == "ammunition")
                .unwrap()
                .clone()
        };
        assert_eq!(ammo(&normal).center, ammo(&raised).center);
        assert_eq!(ammo(&normal).mass_kg, ammo(&raised).mass_kg);
    }
    #[test]
    fn integral_barbettes_block_thin_hulls_and_separate_magazines() {
        let (mut s, c) = equipped_fixture();
        s.construction.version = 2.;
        assert!(
            compile(&s, &c)
                .diagnostics
                .iter()
                .any(|d| d.code == "integrated-magazine")
        );
        s.construction.equipment.retain(|e| e.id == "gun");
        compiled(&s, &c);
        s.construction.primitives[0].size[0] = 2.;
        let narrow = compile(&s, &c);
        assert!(narrow.definition.is_none());
        assert!(
            narrow
                .diagnostics
                .iter()
                .any(|d| d.source_id.as_deref() == Some("gun"))
        );
        s.construction.primitives[0].size = [10., 0.5, 20.];
        s.construction.equipment[0].position[1] = 0.25;
        assert!(compile(&s, &c).definition.is_none());
    }
    #[test]
    fn separate_gun_geometry_allows_overlapping_empty_catalog_bounds() {
        let (mut source, mut catalog) = equipped_fixture();
        let part = catalog
            .equipment
            .iter_mut()
            .find(|p| p.id == "gun-part")
            .unwrap();
        part.size = [10., 3., 10.];
        part.occupancy = None;
        part.bounds_center = [0., 1.5, 0.];
        let mut second = source
            .construction
            .equipment
            .iter()
            .find(|e| e.id == "gun")
            .unwrap()
            .clone();
        second.id = "neighbor".into();
        second.position[0] = 4.;
        source.construction.equipment.push(second);
        let result = compile(&source, &catalog);
        assert!(result.definition.is_some(), "{:?}", result.diagnostics);
        source.construction.equipment.last_mut().unwrap().position[0] = 0.;
        let name = catalog
            .equipment
            .iter()
            .find(|p| p.id == "gun-part")
            .unwrap()
            .name
            .clone();
        let result = compile(&source, &catalog);
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.code == "equipment-overlap"
                    && d.message
                        .starts_with(&format!("{name} intersects another {name}. "))
                    && d.related_source_ids.as_deref() == Some(&["gun".to_owned()][..])
                    && d.fit
                        .as_ref()
                        .is_some_and(|fit| fit.penetration_m > Some(0.))),
            "{:?}",
            result.diagnostics
        );
    }
    #[test]
    fn fixed_fittings_can_overlap_weapons_in_either_source_order() {
        let (mut source, mut catalog) = equipped_fixture();
        let mut part = catalog
            .equipment
            .iter()
            .find(|p| p.kind == "funnel")
            .unwrap()
            .clone();
        part.id = "fixed-part".into();
        part.kind = "deck-fitting".into();
        part.exhaust_kw = None;
        part.occupancy = None;
        catalog.equipment.push(part);
        source.construction.equipment.push(ConstructionEquipment {
            id: "fixed".into(),
            part_id: "fixed-part".into(),
            position: [1.4, 2., -5.],
            ..Default::default()
        });
        for _ in 0..2 {
            let result = compile(&source, &catalog);
            assert!(result.definition.is_some(), "{:?}", result.diagnostics);
            source.construction.equipment.reverse();
        }
    }
    /// A funnel and a mast standing on the test hull, plus a deck fitting and a
    /// second funnel available to overlap them.
    fn uncontested_fixture() -> (ConstructionSource, ConstructionCatalog) {
        let (mut source, mut catalog) = equipped_fixture();
        let funnel = catalog
            .equipment
            .iter()
            .find(|p| p.kind == "funnel")
            .unwrap()
            .clone();
        for (id, kind) in [
            ("mast-part", "mast"),
            ("fixed-part", "deck-fitting"),
            ("director-part", "director"),
        ] {
            let mut part = funnel.clone();
            part.id = id.into();
            part.kind = kind.into();
            part.exhaust_kw = None;
            part.occupancy = None;
            catalog.equipment.push(part);
        }
        source.construction.equipment.push(ConstructionEquipment {
            id: "mast".into(),
            part_id: "mast-part".into(),
            position: [0., 2., 3.],
            ..Default::default()
        });
        (source, catalog)
    }
    fn launchable_in_either_order(source: &ConstructionSource, catalog: &ConstructionCatalog) {
        let mut source = source.clone();
        for _ in 0..2 {
            let result = compile(&source, catalog);
            assert!(result.definition.is_some(), "{:?}", result.diagnostics);
            source.construction.equipment.reverse();
        }
    }
    #[test]
    fn hull_pieces_may_bury_a_funnel_or_a_mast() {
        let (source, catalog) = uncontested_fixture();
        // A deckhouse abaft the gun swallows the mast and the funnel whole.
        for size in [[4., 3., 6.5], [4., 3.2, 6.5]] {
            let mut source = source.clone();
            source.construction.primitives.push(ConstructionPrimitive {
                id: "house".into(),
                kind: "box".into(),
                position: [0., 2. + size[1] / 2., 4.75],
                size,
                ..Default::default()
            });
            launchable_in_either_order(&source, &catalog);
        }
    }
    #[test]
    fn equipment_may_overlap_a_funnel_or_a_mast_in_either_source_order() {
        let (source, catalog) = uncontested_fixture();
        // Weapons, decorative fittings and another funnel, each sharing the
        // envelope of the funnel at z = 5 or the mast at the origin.
        for (id, part_id, position) in [
            ("neighbor-gun", "gun-part", [0., 2., 5.]),
            ("neighbor-fixed", "fixed-part", [0., 2., 3.]),
            ("neighbor-funnel", "funnel-part", [0., 2., 3.2]),
            ("neighbor-mast", "mast-part", [0., 2., 5.]),
            ("neighbor-director", "director-part", [0., 2., 3.]),
        ] {
            let mut source = source.clone();
            source.construction.equipment.push(ConstructionEquipment {
                id: id.into(),
                part_id: part_id.into(),
                position,
                ..Default::default()
            });
            launchable_in_either_order(&source, &catalog);
        }
    }
    #[test]
    fn a_funnel_uptake_may_cross_plating_a_bulkhead_or_a_load() {
        let (source, catalog) = uncontested_fixture();
        let mut bulkhead = source.clone();
        bulkhead.construction.boundaries.push(ConstructionBoundary {
            id: "frame".into(),
            axis: "z".into(),
            offset: 5.,
            thickness_mm: 20.,
        });
        let mut load = source.clone();
        load.construction.loads.push(ConstructionLoad {
            id: "stores".into(),
            name: "Stores".into(),
            mass_kg: 1000.,
            center: [0., 1.4, 5.],
            size: [2., 1., 2.],
        });
        for source in [bulkhead, load] {
            launchable_in_either_order(&source, &catalog);
        }
    }
    #[test]
    fn a_funnel_keeps_its_module_opening_and_runtime_obstruction_when_buried() {
        let (mut source, catalog) = uncontested_fixture();
        source.construction.primitives.push(ConstructionPrimitive {
            id: "house".into(),
            kind: "box".into(),
            position: [0., 3.5, 4.75],
            size: [4., 3., 6.5],
            ..Default::default()
        });
        // The uptake still cuts its sealed flooding opening through the deck it
        // stands on; what changed is only that the hull around it is admissible.
        let open = uncontested_fixture().0;
        assert!(
            compiled(&open, &catalog)
                .openings
                .iter()
                .flatten()
                .any(|o| o.sealed_by_module_id.as_deref() == Some("funnel")),
            "the uptake keeps its sealed flooding opening"
        );
        let definition = compiled(&source, &catalog);
        // Combat is unchanged: both remain gun-arc obstructions and clearance bodies.
        for id in ["funnel", "mast"] {
            assert!(definition.obstructions.iter().any(|o| o.id == id));
            assert!(
                definition
                    .mount_clearance
                    .as_ref()
                    .unwrap()
                    .bodies
                    .iter()
                    .flatten()
                    .any(|b| b.id == id)
            );
        }
    }
    #[test]
    fn gun_barrels_may_enter_a_mast_but_not_other_installed_geometry() {
        let (mut source, catalog) = uncontested_fixture();
        // The mast stands in the gun's barrel envelope at its initial pose.
        source
            .construction
            .equipment
            .iter_mut()
            .find(|e| e.id == "mast")
            .unwrap()
            .position = [0., 2., -7.];
        launchable_in_either_order(&source, &catalog);
        // Another fitting in the same place is still a clearance fault.
        source.construction.equipment.push(ConstructionEquipment {
            id: "rangefinder".into(),
            part_id: "director-part".into(),
            position: [0., 2., -7.],
            ..Default::default()
        });
        let result = compile(&source, &catalog);
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.code == "weapon-clearance"
                    && d.related_source_ids.as_deref() == Some(&["rangefinder".to_owned()][..])),
            "{:?}",
            result.diagnostics
        );
    }

    #[test]
    fn construction_retains_bounded_gun_installation_settings() {
        let (mut source, catalog) = equipped_fixture();
        let gun = source
            .construction
            .equipment
            .iter_mut()
            .find(|e| e.id == "gun")
            .unwrap();
        gun.gun = Some(ConstructionEquipmentGun {
            battery: Some("secondary".into()),
            initial_elevation_deg: Some(10.),
            traverse_deg: Some(60.),
            traverse_limits_deg: Some([-45., 60.]),
            ..Default::default()
        });
        let definition = compiled(&source, &catalog);
        assert_eq!(definition.mounts[0].battery, "secondary");
        assert_eq!(definition.mounts[0].initial_elevation_deg, Some(10.));
        assert_eq!(definition.mounts[0].weapon.traverse_deg, 60.);
        assert_eq!(definition.mounts[0].traverse_limits_deg, Some([-45., 60.]));
        source
            .construction
            .equipment
            .iter_mut()
            .find(|e| e.id == "gun")
            .unwrap()
            .gun
            .as_mut()
            .unwrap()
            .traverse_deg = Some(361.);
        assert!(
            compile(&source, &catalog)
                .diagnostics
                .iter()
                .any(|d| d.code == "weapon-installation")
        );
    }
    #[test]
    fn equipped_loading_penetrations_and_real_machinery_damage() {
        let (s, c) = equipped_fixture();
        let d = compiled(&s, &c);
        assert_eq!(d.mounts[0].weapon.mass_kg, c.weapons.parts[0].mass_kg);
        assert!(d.loading.as_ref().unwrap().power_kw > 0.);
        assert!(d.handling.forward_speed > 0.);
        assert!(d.mount_clearance.is_some());
        let mut bare = s.clone();
        bare.construction.equipment.clear();
        let bare = compiled(&bare, &c);
        assert!(
            (bare.loading.unwrap().material_volume_m3
                - d.loading.as_ref().unwrap().material_volume_m3
                + d.loading
                    .as_ref()
                    .unwrap()
                    .contributions
                    .iter()
                    .filter(|m| m.kind == "installation")
                    .map(|m| m.mass_kg / STEEL_DENSITY)
                    .sum::<f64>()
                - 32.
                    * (0.5_f64.powi(2) + c.weapons.parts[0].barbette_radius.powi(2))
                    * (std::f64::consts::TAU / 64.).sin()
                    * 0.01)
                .abs()
                < 1e-6
        );
        let hydro = crate::hydrostatics::HullHydrostatics::new(&d.hull, None);
        let mut actor = crate::damage::Combatant::new("armed", &d);
        let screw = d
            .modules
            .iter()
            .find(|m| m.role.as_deref() == Some("shaft"))
            .unwrap();
        actor.motion.y = -screw.center[1];
        let half = crate::machinery::equipment_condition(&actor, &d, screw, None);
        assert!((half.availability - 0.5).abs() < 1e-7);
        actor.motion.y += screw.size[1];
        assert_eq!(
            crate::machinery::equipment_condition(&actor, &d, screw, None).availability,
            0.
        );
        actor.motion.y = -3.;
        crate::flooding::update_flooding(&mut actor, &d, &hydro, 0.01, 0.5, None, None);
        assert_eq!(
            actor
                .damage
                .compartments
                .iter()
                .map(|c| c.water_m3)
                .sum::<f64>(),
            0.
        );
        actor.mounts[0].hp = 0.;
        crate::flooding::update_flooding(&mut actor, &d, &hydro, 0.01, 0.5, None, None);
        assert!(
            actor
                .damage
                .compartments
                .iter()
                .map(|c| c.water_m3)
                .sum::<f64>()
                > 0.
        );
        let engine = d.modules.iter().find(|m| m.id == "engine").unwrap();
        let room = d
            .compartments
            .iter()
            .position(|r| Some(r.id.as_str()) == engine.compartment_id.as_deref())
            .unwrap();
        actor.damage.compartments[room].water_m3 = d.compartments[room].capacity_m3;
        actor.damage.stability.water.clear();
        assert_eq!(
            crate::machinery::equipment_condition(&actor, &d, engine, None).availability,
            0.
        );
        crate::damage::damage_hull(&mut actor, 1e9, None);
        crate::flooding::update_flooding(&mut actor, &d, &hydro, 0.01, 0.5, None, None);
        assert!(actor.damage.sunk);
        assert_eq!(actor.damage.defeat_cause.as_deref(), Some("hull-failure"));
        let fresh = crate::damage::Combatant::new("reset", &d);
        assert!(fresh.mounts[0].hp > 0.);
        assert_eq!(fresh.damage.compartments[0].water_m3, 0.);
    }
    #[test]
    fn fit_tolerances_pass_skin_deep_faults_and_still_reject_real_ones() {
        let (base, c) = equipped_fixture();
        let mut fitted = base.clone();
        fitted
            .construction
            .equipment
            .retain(|e| matches!(e.id.as_str(), "gun" | "magazine"));
        let at = |y: f64, x: f64| {
            let mut s = fitted.clone();
            let gun = s
                .construction
                .equipment
                .iter_mut()
                .find(|e| e.id == "gun")
                .unwrap();
            gun.position = [x, y, 0.];
            compile(&s, &c)
        };
        // The hull box top is y = 2. Seating arithmetic lands a hair below a deck
        // plane; such a well still crosses the deck and the gun still fits.
        assert!(at(2., 0.).definition.is_some());
        let well_openings = |result: &ConstructionResult| {
            result
                .definition
                .as_ref()
                .and_then(|d| d.openings.as_ref())
                .map_or(0, |o| o.iter().filter(|o| o.id == "well-gun").count())
        };
        assert!(well_openings(&at(2., 0.)) > 0);
        for y in [2. - 1e-6, 2. - 1e-4, 2. - fit::DECK_CROSSING_M / 2.] {
            let result = at(y, 0.);
            assert!(result.definition.is_some(), "{y}: {:?}", result.diagnostics);
            // Without the crossing tolerance the deck keeps a skin-thin lid over the
            // well: no penetration, and every later cut of that lid is degenerate.
            assert!(well_openings(&result) > 0, "{y} did not open its deck");
        }
        // A well that stops clear of the deck does not cut it.
        assert_eq!(well_openings(&at(2. - fit::DECK_CROSSING_M * 4., 0.)), 0);
        // Genuinely wrong placements still fail: buried, floating, half outside.
        for (y, x) in [(1.5, 0.), (2.3, 0.), (2., 4.5)] {
            let result = at(y, x);
            assert!(result.definition.is_none(), "{y} {x} was accepted");
            assert!(
                result
                    .diagnostics
                    .iter()
                    .any(|d| d.code.starts_with("equipment-") || d.code == "installation-support"),
                "{y} {x}: {:?}",
                result.diagnostics
            );
        }
        assert!(fit::outside_allowance_m3(0.) == fit::OUTSIDE_FLOOR_M3);
        assert!(fit::outside_allowance_m3(100.) == 100. * fit::OUTSIDE_FRACTION);
    }
    #[test]
    fn intrinsic_well_never_carves_side_armor() {
        let (mut s, c) = equipped_fixture();
        s.construction
            .equipment
            .retain(|e| matches!(e.id.as_str(), "gun" | "magazine"));
        s.construction
            .equipment
            .iter_mut()
            .find(|e| e.id == "gun")
            .unwrap()
            .position = [4.5, 2., 4.];
        let result = compile(&s, &c);
        assert!(result.definition.is_none());
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.code == "equipment-fit" || d.code == "installation-support"),
            "{:?}",
            result.diagnostics
        );
    }
    #[test]
    fn proposals_preserve_existing_instances_and_fail_atomically() {
        let (mut s, c) = equipped_fixture();
        s.construction.equipment.retain(|e| e.id == "engine");
        let old = serde_json::to_value(&s.construction.equipment).unwrap();
        let proposed = suggest(&s, &c, &["magazine-part".into()]);
        assert!(
            proposed.diagnostics.is_empty(),
            "{:?}",
            proposed.diagnostics
        );
        assert_eq!(
            serde_json::to_value(&proposed.source.construction.equipment[..1]).unwrap(),
            old
        );
        assert!(compile(&proposed.source, &c).definition.is_some());
        let failed = suggest(&s, &c, &["absent".into()]);
        assert_eq!(
            serde_json::to_value(failed.source).unwrap(),
            serde_json::to_value(s).unwrap()
        );
        assert_eq!(failed.diagnostics[0].code, "missing-part");
    }
    #[test]
    fn mixed_retained_catalogs_match_every_revision_exactly() {
        let trusted = crate::catalog::Catalog::load(
            &std::fs::read("../../.build/naval-content/manifest.json").unwrap(),
        )
        .unwrap();
        let (s, c) = fixture();
        let mut newer = s.clone();
        newer.revision = "two".into();
        newer.construction.catalog_revision = "test-two".into();
        let mut next = c.clone();
        next.revision = "test-two".into();
        assert!(
            trusted
                .with_construction_catalogs(&[s.clone(), newer.clone()], &[c.clone(), next])
                .is_ok()
        );
        assert!(
            trusted
                .with_construction_catalogs(&[s, newer], &[c])
                .is_err()
        );
    }
}
