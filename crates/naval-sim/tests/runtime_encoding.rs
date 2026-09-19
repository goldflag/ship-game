use naval_sim::{definition::ShipDefinition, runtime_encoding::decode};
#[test]
fn published_encoding_preserves_every_typed_field() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for entry in std::fs::read_dir(root.join("public/models/runtime")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|s| s.to_str()) != Some("nsd") {
            continue;
        }
        let id = path.file_stem().unwrap().to_str().unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let mut original: ShipDefinition = serde_json::from_slice(
            &std::fs::read(root.join(format!("public/models/{id}.json"))).unwrap(),
        )
        .unwrap();
        if let Some(c) = &mut original.construction {
            c.primitives.clear();
            c.surfaces.clear();
            c.boundaries.clear();
            c.loads.clear();
        }
        if let Some(l) = &mut original.loading {
            l.contributions.retain(|c| c.kind == "equipment");
        }
        let decoded: ShipDefinition = decode(&bytes).unwrap();
        assert_eq!(
            naval_sim::catalog::sha256(&serde_json::to_vec(&decoded).unwrap()),
            naval_sim::catalog::sha256(&serde_json::to_vec(&original).unwrap()),
            "{id}"
        );
    }
}
#[test]
fn malformed_graphs_fail_closed() {
    for bytes in [
        vec![],
        b"NSD\x02\x01\x00\x00".to_vec(),
        b"NSD\x01\x01\x00\x05\x01\x00".to_vec(),
        b"NSD\x01\x01\x00\x03".to_vec(),
    ] {
        assert!(decode::<ShipDefinition>(&bytes).is_err());
    }
}

#[test]
fn integer_fields_decode_exact_runtime_numbers_without_truncation() {
    fn number(value: f64) -> Vec<u8> {
        let mut bytes = b"NSD\x01\x01\x00\x03".to_vec();
        bytes.extend(value.to_le_bytes());
        bytes
    }
    // ConstructionEquipmentWall.version uses u32; NSD stores every number as f64.
    for value in [0, 1, u32::MAX] {
        assert_eq!(decode::<u32>(&number(value as f64)).unwrap(), value);
    }
    for value in [-1., 1.5, u32::MAX as f64 + 1., f64::INFINITY, f64::NAN] {
        assert!(decode::<u32>(&number(value)).is_err(), "{value}");
    }
    assert_eq!(
        decode::<f64>(&number(-0.)).unwrap().to_bits(),
        (-0.0f64).to_bits()
    );
    assert_eq!(decode::<f64>(&number(1.5)).unwrap(), 1.5);
}
