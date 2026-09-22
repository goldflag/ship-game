use naval_sim::construction::MAX_CATALOG_BYTES;

/// The online compile worker passes the published catalog file to the compiler byte for byte.
/// Revisions published on 2026-09-20 outgrew the old 4 MB bound, and every online compile against
/// them failed before reading the design. Keep every published revision well inside the bound.
#[test]
fn every_published_catalog_fits_the_compiler_input_bound() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../public/models/components/catalogs");
    let mut checked = 0;
    for entry in std::fs::read_dir(&root).expect("published catalogs") {
        let path = entry.unwrap().path().join("catalog.json");
        let Ok(bytes) = std::fs::metadata(&path).map(|m| m.len() as usize) else {
            continue;
        };
        assert!(
            bytes * 2 <= MAX_CATALOG_BYTES,
            "{} is {bytes} bytes, over half the {MAX_CATALOG_BYTES}-byte compiler bound; raise MAX_CATALOG_BYTES",
            path.display()
        );
        checked += 1;
    }
    assert!(
        checked > 0,
        "no published catalogs under {}",
        root.display()
    );
}
