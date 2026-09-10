use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
fn sources(path: &Path, files: &mut Vec<PathBuf>) {
    for e in fs::read_dir(path).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            sources(&p, files)
        } else if p.extension().is_some_and(|e| e == "rs") {
            files.push(p)
        }
    }
}
fn main() {
    let root = Path::new("../..");
    let mut files = vec![];
    for path in ["crates/naval-sim/src", "crates/naval-protocol/src"] {
        sources(&root.join(path), &mut files)
    }
    for file in [
        "Cargo.toml",
        "Cargo.lock",
        "rust-toolchain.toml",
        "crates/naval-sim/Cargo.toml",
        "crates/naval-protocol/Cargo.toml",
        "assets/gameplay/battle-rules.v1.json",
        "assets/gameplay/pve-mission.v1.json",
        "assets/gameplay/legacy-air.v1.json",
        "assets/gameplay/visual-sensors.v2.json",
    ] {
        files.push(root.join(file))
    }
    files.sort();
    let mut digest = Sha256::new();
    for p in files {
        println!("cargo:rerun-if-changed={}", p.display());
        digest.update(p.strip_prefix(root).unwrap().to_string_lossy().as_bytes());
        digest.update([0]);
        digest.update(fs::read(p).unwrap());
    }
    println!(
        "cargo:rustc-env=NAVAL_SIMULATION_BUILD={:x}",
        digest.finalize()
    );
}
