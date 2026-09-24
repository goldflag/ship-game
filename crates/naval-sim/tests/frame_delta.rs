//! The patch stream must reconstruct, tick for tick, exactly the frame the
//! client would have decoded from a complete projection: same fields, same
//! numbers, same absent optionals, through combat, sinkings and detail changes.
use naval_sim::{
    battle::{Battle, BattleSetup},
    catalog::Catalog,
    frame_delta::{BinaryClient, FrameDelta, apply},
    rules::TeamId,
    vessel::CompiledShip,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};

/// What `decodeSnapshot` leaves for the renderer: the projection's text, parsed,
/// with null object fields dropped.
fn decoded(json: &str) -> Value {
    fn strip(value: &mut Value) {
        match value {
            Value::Object(map) => {
                map.retain(|key, value| !value.is_null() || key == "activeFlightLimit");
                for (_, value) in map.iter_mut() {
                    strip(value);
                }
            }
            Value::Array(items) => items.iter_mut().for_each(strip),
            _ => {}
        }
    }
    let mut value: Value = serde_json::from_str(json).expect("projection json");
    strip(&mut value);
    value
}

fn catalog() -> Arc<Catalog> {
    Catalog::installed()
}

/// Every number as the `f64` a JavaScript client holds.
fn as_client(value: &Value) -> Value {
    match value {
        Value::Number(number) => Value::from(number.as_f64().expect("finite")),
        Value::Array(items) => items.iter().map(as_client).collect(),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), as_client(value)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Every frame travels as a patch; the client's copy must match the frame it
/// would have decoded from the complete projection, in the text form and in
/// the binary form the local worker transfers.
struct Stream {
    delta: FrameDelta,
    client: Value,
    binary: FrameDelta,
    binary_client: BinaryClient,
    patch_bytes: usize,
    binary_bytes: usize,
    full_bytes: usize,
}
impl Stream {
    fn new() -> Self {
        Self {
            delta: FrameDelta::default(),
            client: Value::Null,
            binary: FrameDelta::binary(),
            binary_client: BinaryClient::default(),
            patch_bytes: 0,
            binary_bytes: 0,
            full_bytes: 0,
        }
    }
    fn frame<T: serde::Serialize>(&mut self, frame: &T, label: &str) {
        let bytes = self.binary.update_binary(0, frame).expect("binary update");
        self.binary_bytes += bytes.len();
        let (_, base) = self.binary_client.apply(bytes);
        assert_eq!(
            base,
            self.client.get("tick").and_then(Value::as_f64),
            "{label} binary baseline"
        );
        let complete = serde_json::to_string(frame).expect("projection");
        let expected = decoded(&complete);
        let baseline = self.delta.baseline_tick();
        assert_eq!(
            baseline,
            self.client.get("tick").and_then(Value::as_u64),
            "{label} baseline"
        );
        if self.delta.encode(frame).expect("patch") {
            let patch = self.delta.patch();
            self.patch_bytes += patch.len();
            let patch: Value = serde_json::from_str(patch).expect("patch json");
            apply(&mut self.client, &patch);
        }
        self.full_bytes += complete.len();
        assert_eq!(self.client, expected, "{label}");
        assert_eq!(
            self.binary_client.frame,
            as_client(&expected),
            "{label} binary"
        );
    }
}

#[test]
fn full_knowledge_patches_rebuild_the_decoded_frame_through_a_large_battle() {
    let catalog = catalog();
    let roster = [
        "bismarck",
        "yamato",
        "baltimore",
        "fletcher",
        "flower-corvette",
        "enterprise-cv6",
        "shokaku",
    ];
    let mut compiled = BTreeMap::new();
    for id in roster {
        compiled.entry(id.to_string()).or_insert_with(|| {
            Arc::new(
                CompiledShip::new(
                    catalog.definitions[id].clone(),
                    catalog.hydrostatics.get(id),
                )
                .unwrap(),
            )
        });
    }
    let ships: Vec<_> = ["a", "b"]
        .into_iter()
        .flat_map(|team| {
            roster.iter().enumerate().map(move |(i, id)| {
                json!({"id": format!("{team}-{i}"), "presetId": id, "team": team,
                    "controller": if team == "a" && i == 0 { "player" } else { "bot" },
                    "aiLevel": "normal", "spawn": null})
            })
        })
        .collect();
    let setup: BattleSetup = serde_json::from_value(json!({"ships": ships, "seed": 0x6e617661_u32,
        "mapId": "north-atlantic", "weather": "map", "spawnDistance": 4000, "windSpeed": 9}))
    .unwrap();
    let mut battle = Battle::new(catalog, &compiled, setup).unwrap();
    let mut stream = Stream::new();
    // The detail list follows the camera in a real session; changing it moves
    // whole subtrees in and out of the frame mid-stream.
    for tick in 0..600u64 {
        let detail: Vec<String> = match tick / 200 {
            0 => vec!["a-0".into(), "b-0".into()],
            1 => vec!["a-3".into()],
            _ => Vec::new(),
        };
        stream.frame(&battle.full_frame(&detail), &format!("tick {tick}"));
        battle.step(&BTreeMap::new());
    }
    assert!(
        stream.patch_bytes * 4 < stream.full_bytes,
        "patches {} vs complete frames {}",
        stream.patch_bytes,
        stream.full_bytes
    );
    assert!(stream.binary_bytes * 2 < stream.patch_bytes);
}

#[test]
fn team_patches_rebuild_the_decoded_frame_including_contacts_and_events() {
    use naval_sim::pve::{PvePlan, PveRequest};
    let catalog = catalog();
    let request: PveRequest = serde_json::from_value(json!({
        "version": 1, "seed": 17001, "mapId": "pacific-islands", "weather": "clear",
        "difficulty": "normal",
        "ships": [{"id": "own", "presetId": "bismarck", "groupId": "g"},
            {"id": "carrier", "presetId": "enterprise-cv6", "groupId": "g"},
            {"id": "escort", "presetId": "fletcher", "groupId": "g"}],
        "groups": [{"id": "g", "name": "Fleet", "station": "front"}]
    }))
    .unwrap();
    let plan = PvePlan::generate(&catalog, request).unwrap();
    let setup = plan.restart_setup();
    let compiled = setup
        .ships
        .iter()
        .map(|s| {
            (
                s.preset_id.clone(),
                Arc::new(
                    CompiledShip::new(
                        catalog.definitions[&s.preset_id].clone(),
                        catalog.hydrostatics.get(&s.preset_id),
                    )
                    .unwrap(),
                ),
            )
        })
        .collect();
    let mut battle = Battle::new(catalog, &compiled, setup).unwrap();
    let mut stream = Stream::new();
    let detail = ["own".to_string()];
    for tick in 0..600u64 {
        stream.frame(
            &battle.team_frame(TeamId::A, &detail).expect("team frame"),
            &format!("tick {tick}"),
        );
        battle.step(&BTreeMap::new());
    }
    assert!(stream.patch_bytes * 4 < stream.full_bytes);
    assert!(stream.binary_bytes * 2 < stream.patch_bytes);
}
