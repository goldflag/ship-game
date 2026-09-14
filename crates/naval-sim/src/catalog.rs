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
    aircraft: Vec<crate::aircraft_deck::GroundPose>,
    version: u32,
    rules_version: u32,
    missions: Vec<crate::mission::MissionRules>,
    air_profiles: Vec<crate::air_rules::AirRules>,
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
    pub aircraft: BTreeMap<String, crate::aircraft_deck::GroundPose>,
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
    pub air_profiles: BTreeMap<String, crate::air_rules::AirRules>,
}

pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
impl Catalog {
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
        if air_profiles.get("legacy-air-v1") != Some(&crate::air_rules::AirRules::legacy()) {
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
                || p.deck_geometry.as_ref().is_some_and(|g| !g.valid())
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
            if sha256(entry.json.as_bytes()) != entry.sha256 {
                return Err(ContentError::Invalid(format!(
                    "{} has a mismatched definition digest",
                    entry.id
                )));
            }
            let value: serde_json::Value = serde_json::from_str(&entry.json)?;
            if value.get("contentHash").and_then(|v| v.as_str())
                != Some(entry.content_hash.as_str())
            {
                return Err(ContentError::Invalid(format!(
                    "{} has a mismatched model identifier",
                    entry.id
                )));
            }
            let definition: ShipDefinition = serde_json::from_value(value)?;
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
    let fail = || ContentError::Invalid(format!("invalid compiled definition {}", d.id));
    if let Some(layout) = d.air_wing.as_ref().and_then(|w| w.deck_layout.as_ref()) {
        crate::flight_deck::validate(d, layout).map_err(ContentError::Invalid)?;
    }
    if d.schema_version != 1.0
        || d.compiler_version != 1.0
        || d.coordinates != "meters-y-up-bow-negative-z"
        || d.id.is_empty()
    {
        return Err(fail());
    }
    let h = &d.hull;
    if !positive(&[
        h.mass_kg,
        h.length,
        h.beam,
        h.draft,
        h.depth,
        h.waterplane_area_m2,
    ]) || !positive(&[
        d.handling.forward_speed,
        d.handling.acceleration,
        d.handling.braking,
    ]) {
        return Err(fail());
    }
    if !ids_unique(d.mounts.iter().map(|m| m.id.as_str()))
        || !ids_unique(d.modules.iter().map(|m| m.id.as_str()))
        || !ids_unique(d.compartments.iter().map(|m| m.id.as_str()))
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
        if let Some(c) = &mount.travel_clearance {
            if d.mount_clearance.as_ref().is_some_and(|p| {
                p.mount_ids
                    .as_ref()
                    .is_some_and(|ids| ids.contains(&mount.id))
                    || p.mounts
                        .as_ref()
                        .is_some_and(|entries| entries.iter().any(|e| e.mount_id == mount.id))
            }) {
                return Err(ContentError::Invalid(format!(
                    "{}: use either travelClearance or mountClearance, not both",
                    mount.id
                )));
            }
            let vertices = &c.surface.vertices;
            if c.version != 1
                || !(3..=2048).contains(&vertices.len())
                || !(1..=4096).contains(&c.surface.triangles.len())
                || !(1..=16).contains(&c.barrels.len())
                || vertices.iter().flatten().any(|v| !v.is_finite())
                || c.barrels.iter().any(|p| {
                    ![p.from_m, p.to_m, p.height_m, p.radius_m]
                        .iter()
                        .all(|v| v.is_finite())
                        || p.from_m < -50.0
                        || p.to_m > 50.0
                        || p.to_m <= p.from_m
                        || p.height_m.abs() > 10.0
                        || !(0.001..=5.0).contains(&p.radius_m)
                })
            {
                return Err(fail());
            }
            for ids in &c.surface.triangles {
                if ids.iter().any(|i| {
                    !i.is_finite() || i.fract() != 0.0 || *i < 0.0 || *i >= vertices.len() as f64
                }) {
                    return Err(fail());
                }
                let [a, b, c] = ids.map(|i| vertices[i as usize]);
                if crate::geometry::length(crate::geometry::cross(
                    crate::geometry::sub(b, a),
                    crate::geometry::sub(c, a),
                )) < 1e-8
                {
                    return Err(fail());
                }
            }
        }
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
        if ![1.0, 2.0, 3.0, 4.0, 8.0].contains(&mount.weapon.barrel_count.unwrap_or(2.0)) {
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
