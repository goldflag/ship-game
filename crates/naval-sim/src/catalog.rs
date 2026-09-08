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
    ships: Vec<ManifestShip>,
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
    pub fleet_entries: BTreeMap<String, FleetEntry>,
    pub identities: Vec<ContentIdentity>,
    pub manifest_hash: String,
    pub terrain: Vec<crate::environment::TerrainField>,
    pub maps: serde_json::Value,
    pub conditions: serde_json::Value,
}

pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
impl Catalog {
    pub fn load(bytes: &[u8]) -> Result<Self, ContentError> {
        let manifest: Manifest = serde_json::from_slice(bytes)?;
        if manifest.version != 1 || manifest.rules_version != crate::rules::Rules::default().version
        {
            return Err(ContentError::Invalid(
                "unsupported manifest or rules version".into(),
            ));
        }
        let mut catalog = Self {
            aircraft: manifest
                .aircraft
                .into_iter()
                .map(|p| (p.id.clone(), p))
                .collect(),
            definitions: BTreeMap::new(),
            fleet_entries: BTreeMap::new(),
            identities: Vec::new(),
            manifest_hash: sha256(bytes),
            terrain: manifest.terrain,
            maps: manifest.maps,
            conditions: manifest.conditions,
        };
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
    for mount in &d.mounts {
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
