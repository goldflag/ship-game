use std::io::Write;
/// Serialize contiguously before compression. Feeding JSON's individual tokens
/// to the compressor repeats its streaming setup for every field and number.
pub fn snapshot_bytes(value: &serde_json::Value) -> Result<Vec<u8>, String> {
    let json = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    encoder.write_all(&json).map_err(|e| e.to_string())?;
    encoder.finish().map_err(|e| e.to_string())
}
/// Every delta is relative to the immutable match baseline. A slow receiver may
/// skip any intermediate frame without needing an acknowledgement or replay.
pub fn delta_bytes(
    baseline: &serde_json::Value,
    current: &serde_json::Value,
) -> Result<Vec<u8>, String> {
    let mut patches = Vec::new();
    diff(baseline, current, &mut Vec::new(), &mut patches);
    snapshot_bytes(&serde_json::json!({"type":"snapshot-delta","patches":patches}))
}
fn diff(
    base: &serde_json::Value,
    value: &serde_json::Value,
    path: &mut Vec<serde_json::Value>,
    patches: &mut Vec<serde_json::Value>,
) {
    use serde_json::{Value, json};
    if base == value {
        return;
    }
    match (base, value) {
        (Value::Object(a), Value::Object(b)) if a.keys().all(|key| b.contains_key(key)) => {
            for (key, value) in b {
                path.push(json!(key));
                if let Some(base) = a.get(key) {
                    diff(base, value, path, patches);
                } else {
                    patches.push(json!([path, value]));
                }
                path.pop();
            }
        }
        (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
            for (index, (base, value)) in a.iter().zip(b).enumerate() {
                path.push(json!(index));
                diff(base, value, path, patches);
                path.pop();
            }
        }
        _ => patches.push(json!([path, value])),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deltas_reconstruct_from_the_same_baseline_after_skipped_frames() {
        use serde_json::{Value, json};
        let baseline =
            json!({"actors":[{"x":0,"hp":100},{"x":4,"hp":100}],"events":[],"optional":null});
        for value in [
            json!({"actors":[{"x":2,"hp":99},{"x":5,"hp":100}],"events":[1],"optional":{"x":3}}),
            json!({"actors":[{"x":9,"hp":90},{"x":8,"hp":0}],"events":[],"optional":null}),
        ] {
            let encoded = delta_bytes(&baseline, &value).unwrap();
            let delta: Value =
                serde_json::from_reader(flate2::read::GzDecoder::new(encoded.as_slice())).unwrap();
            let mut actual = baseline.clone();
            for patch in delta["patches"].as_array().unwrap() {
                let mut target = &mut actual;
                for key in patch[0].as_array().unwrap() {
                    target = if let Some(index) = key.as_u64() {
                        &mut target[index as usize]
                    } else {
                        &mut target[key.as_str().unwrap()]
                    };
                }
                *target = patch[1].clone();
            }
            assert_eq!(actual, value);
        }
    }
}
