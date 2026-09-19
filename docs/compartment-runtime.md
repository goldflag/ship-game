# Experimental combat runtime profiles

Status (2026-09-19): an offline experiment. Nothing here is enabled, published or selectable in
the game. The exact construction output is the only gameplay representation. The Hipper
construction conversion that the recorded measurements used has been removed; the commands
below use Resolute, so their results are not comparable with the archived numbers.

## What exists in code

- **Optional definition fields.** `Hull.buoyancy` (`HullBuoyancy`, `version` 1, weighted box
  cells) separates displaced volume from the collision volume in `Hull.volume`
  (`crates/naval-sim/src/definition.rs`). `Compartment.cells[].volumeM3` weights a water cell
  independently of its box size. Absent fields keep the exact paths.
- **Validation.** `crates/naval-sim/src/catalog.rs` rejects a buoyancy profile unless it is
  version 1, has loading data, a `constructed-volume-v1` hull, 1–10,000 cells and positive
  finite sizes/volumes; it rejects nonpositive `volumeM3` weights.
- **Consumers.** `hydrostatics.rs` uses the buoyancy cells for displacement when present;
  `stability.rs` updates mass, CG and approximate inertia from water columns for weighted
  profiles; `floodwater.rs` reads the cell weights.
- **Nobody emits them by default.** The construction compiler never writes `Hull.buoyancy`.
  Only the `combat_profile_probe` example does, into an isolated derived definition with its
  own content hash. Derived fixtures are not published, registered or paired with a GLB.
- **Exact optimizations that were kept** (bit-identical results): immersion bisection measures
  cell extents once per attitude (`hydrostatics.rs`, `cell_extents`), and ship collisions use
  spatial candidates with lazily transformed hull pieces before the unchanged convex narrow
  phase (`collisions.rs`, test
  `spatial_candidates_preserve_exhaustive_contacts_and_lazy_transforms`).

## Probe modes

`combat_profile_probe <reference.json> <out.json> <pitch-m> [mode]` (`crates/naval-sim/examples/`):

| Mode | Meaning |
| --- | --- |
| omitted | Unweighted coarse enclosure. Rejected: large displacement and clearance errors. |
| `weighted` | Weighted buoyancy/water cells, exact clearance bodies, approximate exterior armor and aggregate portals. Rejected: armor hits change. |
| `guarded` | Weighted cells with exact armor, hull damage surfaces and individual boundary patches. |
| `hybrid` | Guarded plus source solids as collision pieces. Not small enough to recommend. |

## Standing decisions

- Exact geometry is the reference and the default. Guarded 6 m was the only candidate
  recommended for opt-in playtesting; it changes collision contacts, some breach room
  assignments and righting behaviour, so adopting it needs explicit approval.
- Conservative enclosing surfaces are not valid weapon-clearance geometry. Guarded profiles
  keep exact clearance bodies.
- Filling empty space in a collision enclosure must never create reserve buoyancy.
- Compartment coalescing, 2 m columns and boundary-only extraction were tried and are not in the
  runtime path. The probes remain as `compartment_*_probe.rs` examples.
- The 0.5–2 MB runtime-size goal was not met; it needs a damage-boundary and clearance redesign.

## Reproduce (from the repository root; keep output under `.build/`)

```sh
cargo build -p naval-sim --release --example combat_profile_probe \
  --example combat_profile_fidelity --example combat_profile_trial --example runtime_bench
bun run multiplayer:prepare
mkdir -p .build/combat-profile
cp public/models/resolute.json .build/combat-profile/reference.json
cp .build/naval-content/manifest.json .build/combat-profile/reference.manifest.json
cp public/models/runtime/resolute.nsd .build/combat-profile/reference.nsd
target/release/examples/combat_profile_probe .build/combat-profile/reference.json \
  .build/combat-profile/guarded-6.json 6 guarded > .build/combat-profile/guarded-6.report.json
bun scripts/diagnostics/combat-profile-content.ts .build/combat-profile/guarded-6.json \
  .build/combat-profile/guarded-6 .build/combat-profile/reference.manifest.json
target/release/examples/combat_profile_fidelity .build/combat-profile/reference.json \
  .build/combat-profile/guarded-6.json > .build/combat-profile/guarded-6.fidelity.json
target/release/examples/combat_profile_trial .build/combat-profile/guarded-6.json \
  > .build/combat-profile/guarded-6.trial.json
bun scripts/diagnostics/combat-profile-matrix.ts .build/combat-profile/reference.manifest.json exact
bun scripts/diagnostics/combat-profile-matrix.ts .build/combat-profile/guarded-6.manifest.json guarded-6
```

More in `scripts/diagnostics/`: `combat-profile-load.ts`, `combat-profile-resident.ts`,
`combat-profile-browser.ts`, `ship-runtime-sections.ts` and `ship-runtime-designs.ts`. For
determinism, run the probe twice to different paths and `cmp` the outputs.

History: the [measurement log](archive/compartment-runtime-log.md) holds the acceptance gates, the
September 16, 2026 Hipper tables, the gameplay comparison and the earlier compartment-only
experiments. [Runtime encoding and loading](ship-runtime-performance.md) covers the NSD format.
