//! Lossless, disposable editor transport. The persisted source/definition schema
//! stays unchanged; only the worker result uses shared records and vertex indices.
use crate::{construction, definition::ConstructionResult};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

// serde_json numbers consider +0 and -0 equal. Sharing must preserve their
// bits too, because decoding promises exactly the original floating point data.
struct ExactValue<'a>(&'a Value);
impl PartialEq for ExactValue<'_> {
    fn eq(&self, other: &Self) -> bool {
        match (self.0, other.0) {
            (Value::Number(a), Value::Number(b)) => {
                a == b && a.as_f64().map(f64::to_bits) == b.as_f64().map(f64::to_bits)
            }
            (Value::Array(a), Value::Array(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| ExactValue(a) == ExactValue(b))
            }
            (Value::Object(a), Value::Object(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .zip(b)
                        .all(|((ak, a), (bk, b))| ak == bk && ExactValue(a) == ExactValue(b))
            }
            (a, b) => a == b,
        }
    }
}
impl Eq for ExactValue<'_> {}
impl std::hash::Hash for ExactValue<'_> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        // A coarser hash is fine: signed-zero collisions are resolved by Eq.
        std::hash::Hash::hash(self.0, state);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Packet {
    format: &'static str,
    version: u8,
    result: Value,
    vertices: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hull_surface_indices: Option<Vec<usize>>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    loading_from_definition: bool,
}

pub(crate) fn encode(result: &ConstructionResult) -> Result<String, String> {
    let mut result = construction::json_value(result)?;
    // Hash borrowed records, not serialized copies. Equality still checks the
    // complete surface, including paint, openings and all authoring metadata.
    let hull_surface_indices = (|| {
        let surfaces = result.get("surfaces")?.as_array()?;
        let hull = result
            .pointer("/definition/hull/volume/surfaces")?
            .as_array()?;
        let lookup: HashMap<ExactValue<'_>, usize> = surfaces
            .iter()
            .enumerate()
            .map(|(i, s)| (ExactValue(s), i))
            .collect();
        hull.iter()
            .map(|s| lookup.get(&ExactValue(s)).copied())
            .collect::<Option<Vec<_>>>()
    })();
    if hull_surface_indices.is_some() {
        result
            .pointer_mut("/definition/hull/volume")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove("surfaces");
    }
    let loading_from_definition = result.get("loading").is_some_and(|loading| {
        result
            .pointer("/definition/loading")
            .is_some_and(|other| ExactValue(loading) == ExactValue(other))
    });
    if loading_from_definition {
        result.as_object_mut().unwrap().remove("loading");
    }
    let mut vertices = Vec::new();
    index_vertices(&mut result, &mut vertices, &mut HashMap::new())?;
    serde_json::to_string(&Packet {
        format: "naval-construction-result",
        version: 1,
        result,
        vertices,
        hull_surface_indices,
        loading_from_definition,
    })
    .map_err(|e| e.to_string())
}

fn index_vertices(
    value: &mut Value,
    vertices: &mut Vec<Value>,
    lookup: &mut HashMap<[u64; 3], usize>,
) -> Result<(), String> {
    match value {
        Value::Array(items) => {
            for item in items {
                index_vertices(item, vertices, lookup)?;
            }
        }
        Value::Object(fields) => {
            for (key, value) in fields {
                // Every `vertices` field in ConstructionResult is a Vec<Vec3>,
                // including authored geometry retained inside its definition.
                if key == "vertices" {
                    let points = value
                        .as_array_mut()
                        .ok_or("Invalid construction vertices")?;
                    for point in points {
                        let p = point
                            .as_array()
                            .filter(|p| p.len() == 3)
                            .ok_or("Invalid construction vertex")?;
                        let mut bits = [0; 3];
                        for i in 0..3 {
                            bits[i] = p[i]
                                .as_f64()
                                .ok_or("Invalid construction coordinate")?
                                .to_bits();
                        }
                        let index = *lookup.entry(bits).or_insert_with(|| {
                            let index = vertices.len();
                            vertices.push(point.take());
                            index
                        });
                        *point = Value::from(index);
                    }
                } else {
                    index_vertices(value, vertices, lookup)?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::definition::*;
    fn unpack(mut packet: Value) -> Value {
        fn expand(value: &mut Value, points: &[Value]) {
            match value {
                Value::Array(items) => {
                    for item in items {
                        expand(item, points);
                    }
                }
                Value::Object(fields) => {
                    for (key, value) in fields {
                        if key == "vertices" {
                            for i in value.as_array_mut().unwrap() {
                                *i = points[i.as_u64().unwrap() as usize].clone();
                            }
                        } else {
                            expand(value, points);
                        }
                    }
                }
                _ => {}
            }
        }
        let mut result = packet["result"].take();
        expand(&mut result, packet["vertices"].as_array().unwrap());
        if let Some(indices) = packet.get("hullSurfaceIndices") {
            let surfaces: Vec<_> = indices
                .as_array()
                .unwrap()
                .iter()
                .map(|i| result["surfaces"][i.as_u64().unwrap() as usize].clone())
                .collect();
            result["definition"]["hull"]["volume"]["surfaces"] = surfaces.into();
        }
        if packet["loadingFromDefinition"] == true {
            result["loading"] = result["definition"]["loading"].clone();
        }
        result
    }
    #[test]
    fn compact_result_preserves_records_precision_and_failed_designs() {
        let a = [0., 1. / 3., 1e-15];
        let b = [-0., 1. / 3., 1e-15];
        let surface = ConstructionSurface {
            vertices: vec![a, b, [1., 2., 3.], a],
            ..Default::default()
        };
        let mut result = ConstructionResult {
            surfaces: vec![surface.clone()],
            ..Default::default()
        };
        for has_definition in [false, true] {
            if has_definition {
                result.definition = Some(ShipDefinition {
                    hull: Hull {
                        volume: Some(ConstructionGeometry {
                            surfaces: vec![surface.clone()],
                            ..Default::default()
                        }),
                        ..Default::default()
                    },
                    loading: Some(ConstructionLoading::default()),
                    ..Default::default()
                });
                result.loading = Some(ConstructionLoading::default());
            }
            let packet: Value = serde_json::from_str(&encode(&result).unwrap()).unwrap();
            assert_eq!(
                packet["vertices"].as_array().unwrap().len(),
                3,
                "Signed zero must retain a distinct entry"
            );
            let restored = unpack(packet);
            assert_eq!(restored, construction::json_value(&result).unwrap());
            assert_eq!(
                restored["surfaces"][0]["vertices"][1][0]
                    .as_f64()
                    .unwrap()
                    .to_bits(),
                (-0.0f64).to_bits()
            );
        }
        // Same numerical value but different bits must not select another surface.
        let mut other = surface.clone();
        other.normal[0] = -0.;
        result.surfaces.push(other);
        let packet: Value = serde_json::from_str(&encode(&result).unwrap()).unwrap();
        assert_eq!(packet["hullSurfaceIndices"][0], 0);
        assert_eq!(unpack(packet), construction::json_value(&result).unwrap());
        // Only exactly equal records may be shared; partial/error results can differ.
        result.loading.as_mut().unwrap().mass_kg = 1.;
        result
            .definition
            .as_mut()
            .unwrap()
            .hull
            .volume
            .as_mut()
            .unwrap()
            .surfaces[0]
            .paint = "different".into();
        let packet: Value = serde_json::from_str(&encode(&result).unwrap()).unwrap();
        assert!(packet.get("hullSurfaceIndices").is_none());
        assert!(packet.get("loadingFromDefinition").is_none());
        assert_eq!(unpack(packet), construction::json_value(&result).unwrap());
    }
}
