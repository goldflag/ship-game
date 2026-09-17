use std::io::Write;
/// Serialize contiguously before compression. Feeding JSON's individual tokens
/// to the compressor repeats its streaming setup for every field and number.
pub fn snapshot_bytes(value: &serde_json::Value) -> Result<Vec<u8>, String> {
    let json = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    frame_bytes(&json)
}
/// One compressed socket frame from already-serialized text.
pub fn frame_bytes(json: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    encoder.write_all(json).map_err(|e| e.to_string())?;
    encoder.finish().map_err(|e| e.to_string())
}
/// A publication: the session frame as a `FrameUpdate` against the immutable
/// match baseline, so every update reconstructs the latest state on its own
/// and a slow receiver may skip any of them without acknowledgement or replay.
pub fn publish_bytes<T: serde::Serialize>(
    baseline: &naval_sim::frame_delta::FrameDelta,
    tick: u64,
    frame: &T,
) -> Result<Vec<u8>, String> {
    let mut delta = baseline.fork();
    let json = delta.update(tick, frame).map_err(|e| e.to_string())?;
    frame_bytes(json.as_bytes())
}
#[cfg(test)]
mod tests {
    use super::*;
    use naval_sim::frame_delta::{FrameDelta, FrameUpdate, apply};
    use serde_json::{Value, json};
    /// Each update patches the baseline, never the previous update, so any
    /// number of them can be dropped.
    #[test]
    fn updates_reconstruct_from_the_same_baseline_after_skipped_frames() {
        let baseline_frame =
            json!({"tick":0,"actors":[{"x":0,"hp":100},{"x":4,"hp":100}],"events":[],"optional":null});
        let mut baseline = FrameDelta::default();
        baseline.encode(&baseline_frame).unwrap();
        let decoded: Value = serde_json::from_str(&FrameDelta::complete(&baseline_frame).unwrap()).unwrap();
        assert_eq!(decoded, json!({"tick":0,"actors":[{"x":0,"hp":100},{"x":4,"hp":100}],"events":[]}));
        for (tick, value) in [
            (3u64, json!({"tick":3,"actors":[{"x":2,"hp":99},{"x":5,"hp":100}],"events":[1],"optional":{"x":3}})),
            (9, json!({"tick":9,"actors":[{"x":9,"hp":90},{"x":8,"hp":0}],"events":[],"optional":null})),
            (12, json!({"tick":12,"actors":[{"x":4},{"x":8,"hp":0}],"events":{},"optional":[1]})),
            (15, json!({"tick":15,"actors":null,"events":[1]})),
        ] {
            let encoded = publish_bytes(&baseline, tick, &value).unwrap();
            let update: FrameUpdate =
                serde_json::from_reader(flate2::read::GzDecoder::new(encoded.as_slice())).unwrap();
            assert_eq!(update.base_tick, Some(0));
            assert_eq!(update.tick, tick);
            let mut actual = decoded.clone();
            apply(&mut actual, &update.delta.expect("moved"));
            let mut expected = value.clone();
            strip(&mut expected);
            assert_eq!(actual, expected);
        }
        fn strip(value: &mut Value) {
            match value {
                Value::Object(map) => {
                    map.retain(|_, v| !v.is_null());
                    map.values_mut().for_each(strip);
                }
                Value::Array(items) => items.iter_mut().for_each(strip),
                _ => {}
            }
        }
    }
}
