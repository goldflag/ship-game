use crate::{
    definition::ShipDefinition,
    rules::{FleetEntry, match_displacement_kg},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

#[derive(Debug, thiserror::Error)]
pub enum ContentError {
    #[error("Invalid content: {0}")]
    Invalid(String),
    #[error("Invalid content JSON: {0}")]
    Json(#[from] serde_json::Error),
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    aircraft: Vec<crate::aviation::GroundPose>,
    version: u32,
    rules_version: u32,
    missions: Vec<crate::mission::MissionRules>,
    air_profiles: Vec<crate::aviation::AirRules>,
    ships: Vec<ManifestShip>,
    hydrostatics: Vec<crate::hydro_table::HydrostaticTable>,
    terrain: Vec<crate::environment::TerrainField>,
    maps: serde_json::Value,
    conditions: serde_json::Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManifestShip {
    id: String,
    content_hash: String,
    sha256: String,
    json: String,
    #[serde(default)]
    encoding: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentIdentity {
    pub id: String,
    pub content_hash: String,
    pub sha256: String,
}
#[derive(Clone)]
pub struct Catalog {
    pub aircraft: BTreeMap<String, crate::aviation::GroundPose>,
    pub definitions: BTreeMap<String, Arc<ShipDefinition>>,
    /// Solved once at content time from the same hulls, so both simulations
    /// float a ship on identical numbers.
    pub hydrostatics: BTreeMap<String, crate::hydro_table::HydrostaticTable>,
    pub fleet_entries: BTreeMap<String, FleetEntry>,
    pub identities: Vec<ContentIdentity>,
    pub manifest_hash: String,
    pub terrain: Vec<crate::environment::TerrainField>,
    pub maps: serde_json::Value,
    pub conditions: serde_json::Value,
    pub missions: BTreeMap<String, crate::mission::MissionRules>,
    pub air_profiles: BTreeMap<String, crate::aviation::AirRules>,
}

pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
impl Catalog {
    pub fn with_construction_catalogs(
        &self,
        sources: &[crate::definition::ConstructionSource],
        parts: &[crate::definition::ConstructionCatalog],
    ) -> Result<Self, ContentError> {
        if sources.len() > 32
            || parts.len() > 32
            || !ids_unique(parts.iter().map(|p| p.revision.as_str()))
        {
            return Err(ContentError::Invalid(
                "Invalid local source/catalog count or duplicate catalog revisions".into(),
            ));
        }
        let mut local = self.clone();
        for source in sources {
            let catalog = parts
                .iter()
                .find(|p| p.revision == source.construction.catalog_revision)
                .ok_or_else(|| {
                    ContentError::Invalid(format!(
                        "Missing retained catalog revision {}",
                        source.construction.catalog_revision
                    ))
                })?;
            local = local.with_constructions(std::slice::from_ref(source), catalog)?;
        }
        Ok(local)
    }
    /// Source-only local admission. Clone leaves trusted manifest identities and hashes untouched.
    /// Immutable local IDs include content revision; no browser-supplied derived geometry is trusted.
    pub fn with_constructions(
        &self,
        sources: &[crate::definition::ConstructionSource],
        parts: &crate::definition::ConstructionCatalog,
    ) -> Result<Self, ContentError> {
        if sources.len() > 32 {
            return Err(ContentError::Invalid(
                "At most 32 distinct local revisions per session".into(),
            ));
        }
        let mut local = self.clone();
        for source in sources {
            let result = crate::construction::compile(source, parts);
            let Some(d) = result.definition else {
                return Err(ContentError::Invalid(
                    result
                        .diagnostics
                        .iter()
                        .map(|e| e.message.as_str())
                        .collect::<Vec<_>>()
                        .join("; "),
                ));
            };
            let id = d.id.clone();
            if self.definitions.contains_key(&id) {
                return Err(ContentError::Invalid(
                    "Local identity collides with existing catalog".into(),
                ));
            }
            let mass = match_displacement_kg(d.hull.mass_kg)
                .ok_or_else(|| ContentError::Invalid("Invalid derived displacement".into()))?;
            local.fleet_entries.insert(
                id.clone(),
                FleetEntry {
                    ship_id: id.clone(),
                    displacement_kg: mass,
                    carrier: false,
                },
            );
            local.definitions.insert(id.clone(), Arc::new(d));
            local.compile(&id).map_err(ContentError::Invalid)?;
        }
        Ok(local)
    }
    /// Compiled geometry for one class, carrying its published hydrostatics.
    pub fn compile(&self, id: &str) -> Result<crate::vessel::CompiledShip, String> {
        let definition = self
            .definitions
            .get(id)
            .ok_or_else(|| format!("Unknown ship class {id}"))?;
        crate::vessel::CompiledShip::new(definition.clone(), self.hydrostatics.get(id))
    }
    pub fn map_ids(&self) -> Result<Vec<String>, String> {
        environment_ids(&self.maps, "maps")
    }
    pub fn weather_ids(&self) -> Result<Vec<String>, String> {
        environment_ids(&self.conditions, "weather")
    }
    pub fn load(bytes: &[u8]) -> Result<Self, ContentError> {
        let manifest: Manifest = serde_json::from_slice(bytes)?;
        if manifest.version != 1 || manifest.rules_version != crate::rules::Rules::default().version
        {
            return Err(ContentError::Invalid(
                "unsupported manifest or rules version".into(),
            ));
        }
        let mut missions = BTreeMap::new();
        for mission in manifest.missions {
            mission.validate_profile().map_err(ContentError::Invalid)?;
            if missions.insert(mission.id.clone(), mission).is_some() {
                return Err(ContentError::Invalid("Duplicate mission profile".into()));
            }
        }
        let mut air_profiles = BTreeMap::new();
        for profile in manifest.air_profiles {
            profile.validate().map_err(ContentError::Invalid)?;
            if air_profiles.insert(profile.id.clone(), profile).is_some() {
                return Err(ContentError::Invalid(
                    "Duplicate air operations profile".into(),
                ));
            }
        }
        if air_profiles.get("legacy-air-v1") != Some(&crate::aviation::AirRules::legacy()) {
            return Err(ContentError::Invalid(
                "Missing or altered legacy air profile".into(),
            ));
        }
        if missions
            .values()
            .any(|m| !air_profiles.contains_key(&m.air_profile_id))
        {
            return Err(ContentError::Invalid("Missing mission air profile".into()));
        }
        let mut catalog = Self {
            aircraft: manifest
                .aircraft
                .into_iter()
                .map(|p| (p.id.clone(), p))
                .collect(),
            definitions: BTreeMap::new(),
            hydrostatics: manifest
                .hydrostatics
                .into_iter()
                .map(|t| (t.id.clone(), t))
                .collect(),
            fleet_entries: BTreeMap::new(),
            identities: Vec::new(),
            manifest_hash: sha256(bytes),
            terrain: manifest.terrain,
            maps: manifest.maps,
            conditions: manifest.conditions,
            missions,
            air_profiles,
        };
        catalog.map_ids().map_err(ContentError::Invalid)?;
        catalog.weather_ids().map_err(ContentError::Invalid)?;
        if catalog
            .terrain
            .iter()
            .any(|f| f.samples.len() != 257 * 257 || f.samples.iter().any(|v| !v.is_finite()))
        {
            return Err(ContentError::Invalid("invalid baked terrain".into()));
        }
        if catalog.aircraft.values().any(|p| {
            !p.pitch.is_finite()
                || !p.clearance.is_finite()
                || p.clearance <= 0.0
                || !p.deck_geometry.valid()
                || p.bomb
                    .as_ref()
                    .is_none_or(|b| !positive(&[b.caliber_m, b.he.damage, b.he.explosive_kg]))
                || p.torpedo
                    .as_ref()
                    .is_none_or(|t| !positive(&[t.speed, t.range_m, t.damage, t.breach_area_m2]))
        }) {
            return Err(ContentError::Invalid("Invalid aircraft ground pose".into()));
        }
        for entry in manifest.ships {
            let definition: ShipDefinition = match entry.encoding.as_deref() {
                None => {
                    if sha256(entry.json.as_bytes()) != entry.sha256 {
                        return Err(ContentError::Invalid(format!(
                            "{} has a mismatched definition digest",
                            entry.id
                        )));
                    }
                    serde_json::from_str(&entry.json)?
                }
                Some("nsd1-base64") => {
                    let bytes = crate::hydro_table::base64(entry.json.as_bytes())
                        .ok_or_else(|| ContentError::Invalid("Invalid runtime base64".into()))?;
                    if sha256(&bytes) != entry.sha256 {
                        return Err(ContentError::Invalid(format!(
                            "{} has a mismatched runtime digest",
                            entry.id
                        )));
                    }
                    crate::runtime_encoding::decode(&bytes).map_err(ContentError::Invalid)?
                }
                Some(_) => {
                    return Err(ContentError::Invalid(
                        "Unsupported definition encoding".into(),
                    ));
                }
            };
            if definition.content_hash.as_deref() != Some(entry.content_hash.as_str()) {
                return Err(ContentError::Invalid(format!(
                    "{} has a mismatched model identifier",
                    entry.id
                )));
            }
            // Published construction definitions are trusted by the same manifest
            // digest/identity checks as legacy presets. Local drafts still enter
            // only through source recompilation in with_constructions.
            if definition.id.starts_with("local-") {
                return Err(ContentError::Invalid(
                    "Local construction is not trusted manifest content".into(),
                ));
            }
            if entry.id != definition.id || catalog.definitions.contains_key(&entry.id) {
                return Err(ContentError::Invalid(format!(
                    "duplicate or mismatched ship {}",
                    entry.id
                )));
            }
            validate_definition(&definition)?;
            if definition.air_wing.as_ref().is_some_and(|w| {
                w.squadrons
                    .iter()
                    .any(|s| !catalog.aircraft.contains_key(&s.model_id))
            }) {
                return Err(ContentError::Invalid("Missing aircraft ground pose".into()));
            }
            let displacement_kg = match_displacement_kg(definition.hull.mass_kg)
                .ok_or_else(|| ContentError::Invalid(format!("{} displacement", entry.id)))?;
            catalog.fleet_entries.insert(
                entry.id.clone(),
                FleetEntry {
                    ship_id: entry.id.clone(),
                    displacement_kg,
                    carrier: definition.air_wing.is_some(),
                },
            );
            catalog
                .definitions
                .insert(entry.id.clone(), Arc::new(definition));
            catalog.identities.push(ContentIdentity {
                id: entry.id,
                content_hash: entry.content_hash,
                sha256: entry.sha256,
            });
        }
        if catalog.definitions.is_empty() {
            return Err(ContentError::Invalid("empty catalog".into()));
        }
        for map in catalog.map_ids().map_err(ContentError::Invalid)? {
            for weather in catalog.weather_ids().map_err(ContentError::Invalid)? {
                catalog.resolve_environment(&map, &weather, 0, 8, 5000.0, None)?;
            }
        }
        Ok(catalog)
    }
}

fn positive(values: &[f64]) -> bool {
    values.iter().all(|n| n.is_finite() && *n > 0.0)
}
fn ids_unique<'a>(ids: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = BTreeSet::new();
    ids.into_iter().all(|id| !id.is_empty() && seen.insert(id))
}
pub fn validate_definition(d: &ShipDefinition) -> Result<(), ContentError> {
    crate::maneuvering::validate(d).map_err(ContentError::Invalid)?;
    let fail = || ContentError::Invalid(format!("invalid compiled definition {}", d.id));
    if let Some(layout) = d.air_wing.as_ref().and_then(|w| w.deck_layout.as_ref()) {
        crate::aviation::validate(d, layout).map_err(ContentError::Invalid)?;
    }
    if d.schema_version != 1.0
        || d.compiler_version != 1.0
        || d.coordinates != "meters-y-up-bow-negative-z"
        || d.id.is_empty()
    {
        return Err(fail());
    }
    if let Some(pool) = d
        .propulsion
        .as_ref()
        .and_then(|p| p.shared_exhaust.as_ref())
    {
        for (ratings, role) in [(&pool.engines, "combined-drive"), (&pool.funnels, "boiler")] {
            if ratings.len() > crate::construction::MAX_EQUIPMENT
                || !ids_unique(ratings.iter().map(|r| r.id.as_str()))
                || ratings.iter().any(|r| {
                    !r.kw.is_finite()
                        || r.kw < 0.
                        || r.kw > 1e9
                        || !d
                            .modules
                            .iter()
                            .any(|m| m.id == r.id && m.role.as_deref() == Some(role))
                })
            {
                return Err(fail());
            }
        }
    }
    let h = &d.hull;
    if let Some(proxy) = &h.buoyancy
        && (proxy.version != 1.
            || d.loading.is_none()
            || h.kind != "constructed-volume-v1"
            || proxy.cells.is_empty()
            || proxy.cells.len() > 10000
            || proxy.cells.iter().any(|c| {
                !positive(&c.size)
                    || !positive(&[c.volume_m3])
                    || c.center.iter().any(|x| !x.is_finite() || x.abs() > 2000.)
            }))
    {
        return Err(fail());
    }
    for room in &d.compartments {
        if let Some(cells) = &room.cells
            && cells
                .iter()
                .any(|c| c.volume_m3.is_some_and(|v| !v.is_finite() || v <= 0.))
        {
            return Err(fail());
        }
    }
    if !positive(&[h.mass_kg, h.length, h.beam, h.draft, h.depth])
        || if h.kind == "constructed-volume-v1" {
            [
                d.handling.forward_speed,
                d.handling.reverse_speed,
                d.handling.acceleration,
                d.handling.braking,
                d.handling.rudder_rate,
                d.handling.max_yaw_rate,
            ]
            .iter()
            .any(|v| !v.is_finite() || *v < 0.)
        } else {
            !positive(&[
                d.handling.forward_speed,
                d.handling.acceleration,
                d.handling.braking,
            ])
        }
    {
        return Err(fail());
    }
    if h.kind == "constructed-volume-v1" {
        let Some(v) = &h.volume else {
            return Err(fail());
        };
        if v.version != 1.
            || v.cells.is_empty()
            || v.cells.len() > crate::construction_geometry::MAX_CELLS
            || v.surfaces.len() > crate::construction::MAX_SURFACES
            || d.stability.as_ref().is_none_or(|s| s.buoyancy_scale != 1.)
        {
            return Err(fail());
        }
        for c in &v.cells {
            if c.faces.len() < 4
                || c.faces.len() > 128
                || c.faces.iter().any(|f| {
                    f.vertices.len() < 3
                        || f.vertices.len() > 128
                        || f.vertices
                            .iter()
                            .flatten()
                            .any(|x| !x.is_finite() || x.abs() > 2000.)
                })
            {
                return Err(fail());
            }
            let m = crate::construction_geometry::moments(c);
            if !m.volume.is_finite() || m.volume <= 0. {
                return Err(fail());
            }
        }
    } else if h.kind != "authored-stations-v1" || h.volume.is_some() {
        return Err(fail());
    }
    if !ids_unique(d.mounts.iter().map(|m| m.id.as_str()))
        || !ids_unique(d.modules.iter().map(|m| m.id.as_str()))
        || !ids_unique(d.compartments.iter().map(|m| m.id.as_str()))
    {
        return Err(fail());
    }
    if !h.waterplane_area_m2.is_finite()
        || if h.kind == "constructed-volume-v1" {
            h.waterplane_area_m2 < 0.
        } else {
            h.waterplane_area_m2 <= 0.
        }
    {
        return Err(fail());
    }
    for pairs in [&h.half_breadths, &h.deck_heights, &h.keel_heights] {
        if pairs.len() < 2
            || pairs.iter().flatten().any(|v| !v.is_finite())
            || pairs.windows(2).any(|p| p[0][0] >= p[1][0])
        {
            return Err(fail());
        }
    }
    for (i, mount) in d.mounts.iter().enumerate() {
        if mount
            .parent_mount_id
            .as_ref()
            .is_some_and(|id| !d.mounts[..i].iter().any(|parent| &parent.id == id))
        {
            return Err(fail());
        }
        if !positive(&[
            mount.weapon.caliber_m,
            mount.weapon.muzzle_speed,
            mount.weapon.reload_seconds,
        ]) || mount
            .magazine_id
            .as_ref()
            .is_some_and(|id| !d.modules.iter().any(|m| &m.id == id))
        {
            return Err(fail());
        }
        if ![1.0, 2.0, 3.0, 4.0, 8.0].contains(&mount.weapon.barrel_count) {
            return Err(fail());
        }
    }
    for connection in &d.connections {
        if !d.compartments.iter().any(|c| c.id == connection.from_id)
            || !d.compartments.iter().any(|c| c.id == connection.to_id)
        {
            return Err(fail());
        }
    }
    Ok(())
}

fn environment_ids(value: &serde_json::Value, key: &str) -> Result<Vec<String>, String> {
    let error = || format!("Invalid {key} catalog");
    if value["version"].as_u64() != Some(1) {
        return Err(error());
    }
    let entries = value[key]
        .as_array()
        .filter(|a| !a.is_empty())
        .ok_or_else(error)?;
    let ids = entries
        .iter()
        .map(|v| {
            v["id"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .ok_or_else(error)
        })
        .collect::<Result<Vec<_>, _>>()?;
    if !ids_unique(ids.iter().map(String::as_str)) {
        return Err(error());
    }
    Ok(ids)
}
#[cfg(test)]
mod environment_tests {
    use super::*;
    #[test]
    fn malformed_environment_catalogs_fail_before_admission() {
        let bytes = std::fs::read("../../.build/naval-content/manifest.json").unwrap();
        for field in ["maps", "conditions"] {
            for bad in [
                serde_json::json!(null),
                serde_json::json!({"version":1,"maps":[],"weather":[]}),
                serde_json::json!({"version":1,"maps":[{"id":4}],"weather":[{"id":4}]}),
            ] {
                let mut manifest: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                manifest[field] = bad;
                assert!(Catalog::load(&serde_json::to_vec(&manifest).unwrap()).is_err());
            }
        }
    }
}
