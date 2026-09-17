# Ship runtime representation and loading

The Hipper construction conversion used for the historical measurements below has
been removed. Current commands and regression fixtures use Resolute; their results
are not the recorded Hipper measurements. Reproducing those requires the historical revision.

Measured on 2026-09-16 against `a3c51c0d`, with Admiral Hipper's construction
conversion as the stress case. This is a lossless runtime optimization, not a
new ship authoring format or a claim that large constructed fleets meet 60 Hz.

PR integration also includes master `e02a93d9` (account-backed custom fleets).
The measurements below retain their original `a3c51c0d` baseline; integration
checks revalidate the merged loading paths and regenerated publication. Account
construction artifacts still carry complete source/compiler results and are not
covered by the published historical-preset size reduction.

For the subsequent simplified-combat experiments and exact flood/collision optimizations,
see [compartment runtime](compartment-runtime.md). The measurements below retain
the original first-stage baseline.

## Contract and decisions

`blueprint.json`, retained component catalogs and the native compiler remain the
editable source of truth. The full compiled `public/models/<id>.json` remains a
build/debug artifact used by construction tools and export review. Production
publishes `public/models/runtime/<id>.nsd` instead of downloading that JSON.
Vite removes the full preset JSON from `dist/models`; it retains the exact GLBs.

NSD version 1 encodes the existing definition fields as a postorder DAG. It has
a four-byte `NSD\x01` header, unsigned base-128 node count/root index, and nodes
for null, false, true, little-endian IEEE f64, UTF-8 strings, arrays and objects.
Arrays contain backward node indices; objects refer to a shared key-array schema
and corresponding value indices. Equal numbers, strings, arrays and objects are
interned. Object keys are sorted for deterministic output. No coordinate rounding,
identifier shortening, volume coarsening or weapon-clearance relaxation occurs.
Encoding the complete original Hipper definition without projection is 19.47 MB;
removing the authoring/diagnostic records reduces that to 17.38 MB. Interning
therefore accounts for most of the reduction, without deleting detailed geometry.
The browser shares immutable decoded records; Rust deserializes directly from the
DAG into the generated definition types without an intermediate JSON value tree.
Readers reject unknown versions, nonfinite numbers, forward references, invalid
schemas, excessive nesting, truncation and trailing data.

The runtime projection removes construction primitives, face assignments,
boundaries, loads and non-equipment mass-contribution diagnostics. Gameplay
geometry, topology, aggregate mass/CG/inertia, equipment records and identities
are retained. **Equipment mass contributions are gameplay data:** auxiliary
power ratings consume them. A longer equality run caught their initial omission;
the final projection retains them. Source/result data for editing and local
construction admission remains complete.

`multiplayer:content` derives the runtime assets, their SHA-256 digests, menu
metadata and the authoritative manifest from the single roster in
`src/ships/presets.ts`. `ship:runtime:check` independently regenerates and compares
runtime bytes, metadata and per-design hydrostatic tables. Runtime SHA-256 checks
and definition/model content hashes have different jobs; neither is rewritten to
admit stale assets. The server verifies the runtime digest and model identity
before normal definition validation. Old JSON manifests remain readable.

Menus import metadata. `loadShipPresets` admits selected definitions and their
hydrostatic tables sequentially, once per design, before port switching, custom
battle creation, mission deployment, online snapshot admission or recognition
model loading. Runtime geometry accessed before admission fails explicitly.
The client no longer imports full JSON or every hydrostatic table at startup.
CLI/tests retain synchronous preset consumption after module initialization.

Custom workers fetch only selected historical definitions. An all-local fleet
uses Bismarck as a small trusted bootstrap catalog before native source admission.
The mission planner still requests the complete catalog: its eligibility and
fleet-generation rules need it. The worker retains the common content index,
not a full per-ship JSON manifest after admission. Binary data currently crosses
the manifest boundary as base64; eliminating that last temporary copy is future
work. The authoritative online manifest remains a server-wide catalog.

Rust closed-cell faces use immutable `Arc` storage. Copies into hydrostatics and
collision operations share faces; geometry edits use copy-on-write. Per-vessel
HP, ammunition, water and connection state remain independent. A shared spatial
index selects static weapon-clearance candidates, restores authored body order,
and runs the original narrow phase and swept movement algorithm. Numerical
slack only admits extra candidates. It does not change a collision margin.

## Reproduce

```sh
bun install --frozen-lockfile
bun run multiplayer:prepare:dev
bun run ship:runtime:check
bun run ship:runtime:bench resolute
cargo build --release --locked -p naval-sim --example runtime_bench
bun scripts/diagnostics/ship-runtime-battles.ts \
  target/release/examples/runtime_bench .build/naval-content/manifest.json current 10
bun scripts/diagnostics/ship-runtime-designs.ts
bun scripts/diagnostics/ship-runtime-browser.ts
bun scripts/diagnostics/ship-runtime-worker.ts
cargo run --release --locked -p naval-sim --example runtime_approximations
```

Validation commands (the full native suite has the baseline failures listed below):

```sh
bun test src/ships/runtimeEncoding.test.ts src/game/session
bun run ship:authoring:check
cargo test --release --locked -p naval-sim --no-fail-fast
bun run ship:check all
bun run ship:review resolute
bun run ship:trial resolute --seconds 15
bun run build
```

The native harness accepts `manifest ships-per-match matches ticks comma-separated-designs [wet]`.
For example, append `resolute wet` after `2 1 120` to flood the
three largest rooms of each ship to 30% capacity before the first tick.
`NAVAL_BENCH_SNAPSHOT=<path>` retains the final full-knowledge snapshot for a diff.
The matrix measures increasing instance counts, distinct designs and multiple
resident matches stepped by one scheduler; it is not a socket-server throughput
or operating-system thread-scaling benchmark.

Capture the baseline executable and manifest **before** changing runtime code or
regenerating assets, in an independent checkout following the integration guide.
Pass that binary/manifest to the same matrix command. `ship-runtime-resident.ts`
compares `.build/runtime-size/baseline-bench` and its saved manifest with the
current release binary, sampling process RSS every 100 ms. All raw measurements,
snapshots, captures and temporary original-source checkouts belong in `.build/`.
Do not commit them as ship reports or reference archives.

## Measurements

Machine: Apple M5 Pro, 51.54 GB physical memory, macOS arm64; Bun 1.3.3 and
headless Chromium. Native release builds include a counting allocator. Battles
use seed 12345, north-atlantic, overcast, hard bots, 5 km separation, 60 Hz fixed
steps. A fresh process is used for each case; OS filesystem caches are warm.
Browser fetches use loopback HTTP and fresh page contexts. These are not cold-disk
or real-network measurements. Other work shares the machine; tails vary.

Sizes use decimal MB. Exact final figures and timings are emitted by the commands
above. The original section sizes were verified: compartments 38.44 MB, hull
15.61 MB, clearance 11.33 MB, armor 6.71 MB, connections 3.75 MB, loading 2.80 MB,
construction records 1.85 MB. Counts remain 141 rooms, 13,731 hull cells, 14,891
surfaces, 13,840 clearance bodies, 16,059 armor patches and 6,924 connections.

| Hipper / two-ship native case | Before | After |
| --- | ---: | ---: |
| Runtime definition, uncompressed | 80.61 MB | 17.38 MB (−78.4%) |
| Runtime definition, gzip | 9.02 MB | 9.60 MB (+6.4%) |
| Visual GLB | 5.40 MB | 5.40 MB |
| Native catalog load / deserialize | 818.66 ms | 361.75 ms |
| Native catalog live allocation (full roster) | 86.96 MB | 82.62 MB |
| Catalog + compiled Hipper live allocation | 143.68 MB | 132.42 MB |
| Native admission peak allocation | 774.13 MB | 173.07 MB |
| Native process sampled steady RSS | 937.20 MB | 168.38 MB |
| Native OS peak RSS, 600-tick run | 940.28 MB | 260.13 MB |
| Browser retained JS heap, Hipper alone | 105.67 MB | 77.28 MB |
| Browser fetch + decode, Hipper alone | 746.50 ms | 216.00 ms |
| Browser parse / decode only | 190.10 ms | 172.20 ms |
| Browser process-tree retained RSS | 474.51 MB | 419.50 MB |
| Browser process-tree peak sampled RSS | 661.85 MB | 532.46 MB |

Browser RSS includes the fresh browser, renderer and utility/GPU processes, with
about 264 MB empty-page overhead in each case. It is sampled every 50 ms and may
double-count shared pages or miss short peaks. Instrumentation affects timings.
The browser comparison loads one definition, not the entire application.
Default Bismarck preset startup takes 88.8 ms and retains 9.39 MB JS heap plus
2.99 MB backing storage; network assertions confirm no Hipper definition fetch.

An additional Hipper instance adds 0.802 MB live allocation (slope from two to
eight ships), unchanged before/after. Loading three additional distinct designs
(Bismarck, Fletcher, Enterprise) adds 2.723 MB catalog data, and compiling them
adds another 5.608 MB, or 8.331 MB together. The existing catalog/compiled sharing
already prevents multiplying these costs for each instance. The standalone
Hipper catalog drops from 72.91 to 68.57 MB live allocation; its admission peak
drops from 719.98 to 152.13 MB.

Real local worker admission for two Bismarcks takes 348 ms and reserves 18.48 MB
WASM memory; two Hippers take 1,228 ms and reserve 142.80 MB. These are current
values, not a before/after comparison. The worker request check confirms unused
Hipper data is absent from a Bismarck battle.

Tick times in milliseconds over 600 steps (10 simulated seconds), measured in
separate native processes without simultaneous builds in this checkout:

| Battle | Before p50 / p95 / p99 | After p50 / p95 / p99 | Before / after max |
| --- | ---: | ---: | ---: |
| 2 Hippers | 8.80 / 11.55 / 41.55 | 5.64 / 7.52 / 37.53 | 44.89 / 43.01 |
| 8 Hippers | 34.28 / 46.05 / 160.87 | 22.60 / 36.03 / 154.04 | 169.14 / 204.45 |
| 16 Hippers | 68.76 / 107.71 / 316.11 | 47.33 / 77.05 / 344.64 | 498.83 / 483.23 |
| 4 resident matches × 8 Hippers, total scheduler tick | 143.94 / 629.78 / 1039.25 | 90.30 / 569.60 / 704.64 | 4352.81 / 3548.16 |
| 8 ships across 4 designs | 9.48 / 12.33 / 42.05 | 5.82 / 8.10 / 35.93 | 47.42 / 61.24 |

All five saved full-knowledge end-state SHA-256 values agree exactly. For the
concurrent case the harness records the first match; all matches have identical
setup and seed. Tail improvements are not uniform: the 16-ship p99 increases
from 316 to 345 ms, and mixed-fleet maximum from 47 to 61 ms. These are individual
runs on shared hardware, not confidence intervals.

For the deliberately wet two-Hipper case (120 ticks), p50 / p95 / p99 are
3.53 / 4.29 / 98.98 ms before and 3.64 / 4.44 / 77.29 ms after. The worst tick
falls from 3,803 to 2,620 ms, with exactly equal final state.

Original serialized section sizes (section gzip streams are independent and do
not sum to whole-file gzip):

| Section | JSON MB | Gzip MB |
| --- | ---: | ---: |
| compartments | 38.439 | 4.908 |
| hull | 15.611 | 1.230 |
| mountClearance | 11.333 | 0.798 |
| armor | 6.705 | 0.762 |
| connections | 3.745 | 0.386 |
| loading | 2.800 | 0.787 |
| construction | 1.852 | 0.128 |

The 1 MB runtime aim, and even the 2–5 MB exception threshold, are **not met** for
this stress case. Exact clipped room geometry and its floating-point coordinates
still dominate. The new representation is substantially smaller, but its gzip
transfer is slightly larger than the old JSON's highly repetitive text. There is
no claim that the codec improves all compression ratios or every JS parse time.
The benefit combines reduced representation size, lower memory peaks, geometry
sharing, demand loading and less clearance work.

The wet case deliberately exposes a remaining latency spike: the initial exact
floodwater solve is expensive. It is not evidence that arbitrary damaged fleets
fit inside a 16.67 ms tick budget. Likewise, 16 Hippers and four concurrent matches
still exceed real-time budgets. These short deterministic windows do not certify
long-running, projectile-heavy or aircraft-heavy server capacity.

## Simplification probes, not defaults

`runtime_approximations` measures prototypes without publishing them:

- Rounding to a 1 micrometre grid changes total hull volume by only about
  0.000013 m³, but creates **169 degenerate faces** in clipping slivers. Aggregate
  buoyancy agreement alone does not establish safe geometry or contact behavior.
- Summed hull-cell AABBs represent 168,360 m³ versus 41,736 m³ of exact hull volume.
  Summed compartment envelopes represent 91,572 m³ versus 37,633 m³ of usable
  room volume, with overlap. They cannot replace disjoint flotation/flood geometry.
- Conservative clearance AABBs change 555 of 816 sampled gaps and add 174 blocked
  cases; no sampled unsafe clear occurred. Extra blocking materially affects firing
  and movement. This sample is not proof of all poses.
- Dropping per-part mass diagnostics preserves the already compiled total mass,
  CG and inertia exactly; equipment power ratings are explicitly retained.

No coarse hull, merged room/connection topology, larger armor zone or box-only
clearance approximation is enabled. Room/armor merging would also change damage,
head-dependent flow, breach ownership and independent boundary failure state.
The next major size reduction needs a separately validated simulation geometry
resolution, with per-room capacity/moments, submerged volume, contact, clearance
and battle tolerances agreed before any gameplay-changing default is adopted.

## Validation and limits

- Every published preset's decoded native typed fields match its intended runtime
  projection exactly. JS tests cover Hipper's full exact encoding, deterministic
  output, IEEE values, shared immutable geometry and malformed streams.
  Runtime field and sampled battle-state tolerances are zero; the existing
  published CPU/render muzzle check permits 0.025 m, with this model measured
  below 1e-6 m.
- Indexed and linear Hipper clearance agree on 480 gap queries and 160 swept
  requests, including obstruction identity, independent neighbor poses and recoil.
- The saved representative before/after battle end states are byte-identical, including the
  wet case. This is evidence for those deterministic windows, not all possible play.
- Native construction acceptance covers buoyancy, capsize/sinking, machinery and
  auxiliaries, independent per-instance damage/water, armor contacts, gun clearance
  and trainable torpedo transforms. The 15-second worker/WASM sea trial travels
  36.20 m, changes heading by 0.0465 rad, fires eight main-gun rounds, and restores
  tick 0, ammunition and integrity on reset.
- The exact rebuilt GLB's binary chunk, geometry, materials, nodes and transforms
  match the previous publication. Only its two definition-hash metadata fields
  change. All five exported fixed views were inspected. The existing detailed
  equipment and ship acceptance limitations remain those of the Hipper brief.
  The sampled articulation review reports 150 samples, 1,317 blocked requests,
  and maximum CPU/render muzzle disagreement 4.18e-7 m. Blocks are not clearance
  passes and are not removed by this optimization.
- `bun run build`, fleet/aircraft/equipment checks, runtime freshness checks,
  TypeScript checks, authoring tests and targeted session/encoding tests pass.
  The full native suite reports 309 passes and three failures. All three reproduce
  on an isolated copy of original commit `a3c51c0d` and its original manifest:
  `carrier_loss::a_homeless_strike_releases_its_bombs_then_withdraws_without_fabricated_kills`,
  `damage_migration::complete_battles_match_reference`, and
  `flooding_fast_paths::a_dry_body_reports_the_same_levels_as_a_flooded_one`.
  Their expectations have not been weakened or their goldens rewritten.
- Authoring compilation remains expensive. The full Hipper source trial still
  needs about 106 seconds to load on this shared machine, 31 seconds to simulate
  15 seconds, and 0.12 seconds to reset. Published runtime admission is much
  cheaper; these changes do not optimize the editor's CSG compilation.
- Browser heap samples report retained JS heap and a post-decode sample. Browser
  RSS sums the process tree; its sampled peak is not an exact renderer peak.
  Worker measurements report allocated WASM
  linear-memory pages, not the allocator's live bytes. Native allocation peaks,
  sampled RSS and OS-reported peak RSS are reported separately.
