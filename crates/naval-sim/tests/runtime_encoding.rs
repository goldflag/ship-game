use naval_sim::{definition::ShipDefinition,runtime_encoding::decode};
#[test]
fn published_encoding_preserves_every_typed_field(){
 let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
 for entry in std::fs::read_dir(root.join("public/models/runtime")).unwrap() {
  let path=entry.unwrap().path(); if path.extension().and_then(|s|s.to_str())!=Some("nsd"){continue;}
  let id=path.file_stem().unwrap().to_str().unwrap();
  let bytes=std::fs::read(&path).unwrap();
  let mut original:ShipDefinition=serde_json::from_slice(&std::fs::read(root.join(format!("public/models/{id}.json"))).unwrap()).unwrap();
  if let Some(c)=&mut original.construction {c.primitives.clear();c.surfaces.clear();c.boundaries.clear();c.loads.clear();}
  if let Some(l)=&mut original.loading {l.contributions.retain(|c|c.kind=="equipment");}
  let decoded:ShipDefinition=decode(&bytes).unwrap();
  assert_eq!(naval_sim::catalog::sha256(&serde_json::to_vec(&decoded).unwrap()), naval_sim::catalog::sha256(&serde_json::to_vec(&original).unwrap()), "{id}");
 }

}
#[test]
fn malformed_graphs_fail_closed(){
 for bytes in [vec![],b"NSD\x02\x01\x00\x00".to_vec(),b"NSD\x01\x01\x00\x05\x01\x00".to_vec(),b"NSD\x01\x01\x00\x03".to_vec()] {assert!(decode::<ShipDefinition>(&bytes).is_err());}
}
