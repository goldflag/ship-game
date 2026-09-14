# Local shipbuilding

Open **Shipbuilder** from the port. The patrol starter includes a gun, ammunition
magazine, diesel machinery, funnel, propeller, rudder and mast. The twin-hull
starter preserves an exterior water channel and deliberately shows an asymmetric
machinery layout. Both are generic sandbox designs, not historical vessels.

Use Hull to select or place pieces, Surfaces for armor/paint/openings, Equipment
for fixed original parts, and Rooms for decks and watertight bulkheads. The hull
grid is 1 m; equipment placement uses 0.25 m. Orbit, top, side and bow views and a
deck slice share source selections. Copy, mirror, brushes, bulk surface changes
and undo/redo operate on stable source identities.

The right-hand instruments show the native compiler's mass contributions, CG,
waterline, roll stability, installed power, speed estimate and diagnostics.
Errors block launch while leaving the draft editable and saveable. Overloading,
instability and missing propulsion are warnings: the sea trial demonstrates the
consequences. Suggestions propose new placements as one undoable edit and do not
rearrange existing installations.

**Sea trial** freezes a compiled revision alongside a stationary target. Normal
helm and gun controls apply. The Sea trial panel provides controlled compartment
flooding, module/hull damage, reset, and return to the shipbuilder. Reset creates
a clean native session from the same source. Battle damage is never saved into a
design. HP/integrity defeat, flooding and capsize retain the existing rules.

Saved, valid designs also appear in **Custom battle**, where they can be the
player, friendly bots or enemies, including repeated copies. Online and campaign
modes continue to accept their historical content only.

## Source and compilation

The shared contract is [blueprint.ts](../src/ships/blueprint.ts).
`ConstructionSource` uses the same schema version, identity and coordinate family
as historical authoring, with a separately versioned `construction.version: 1`.
Historical hulls retain `authored-stations-v1`; constructed definitions use
`constructed-volume-v1` and contain immutable convex cells and attributed exterior
polygons. The Rust generator reads this contract; generated structs are not
maintained by hand.

The source stores primitive parameters and transforms, surface assignments,
equipment instances, boundaries, loads and an exact equipment-catalog revision.
The grid is a placement aid, not the physical discretization. Box, wedge, corner
and inverse-corner pieces use continuous dimensions and quarter-turn hull yaw.
Sizes produce slabs and long/shallow slopes without rounding away partial volume.

Coordinates remain metres, +Y up, -Z bow and +X starboard. Compilation does not
recenter a design or move the hull separately from its contents. Equipment yaw
uses the existing clockwise bearing convention. Published parts retain their
original datum and sockets; bounds centers are not replacement pivots.

[construction.rs](../crates/naval-sim/src/construction.rs) and
[construction_geometry.rs](../crates/naval-sim/src/construction_geometry.rs)
perform the authoritative derivation. WASM exports `compile_construction` and
`suggest_construction`; the native `compile_construction` example accepts the
same source/catalog JSON. TypeScript owns commands, storage and rendering, and
does not provide a second construction-physics implementation.

Compilation unions convex polyhedra, clips shared exterior faces, unions inward
material occupancy and subtracts material/equipment from room volume. Duplicate
envelopes do not add displacement or material twice. A connected rigid hull may
have concave sections, asymmetry or multiple immersed hulls. Final containment,
shell/torpedo contact, grounding and ship-contact checks preserve exterior gaps.

Surface assignments reference primitive IDs and canonical face names. Clipped
patches of a face share that identity; transient triangle numbers are never
source references. Zero assigned armor retains the default structural skin.
An explicit open face omits its skin and supplies a downflooding opening. Internal
boundaries are independent material planes; removing one merges its spaces.

Catalog-declared gun/funnel installation wells may cross their supporting deck.
The compiler reserves their interior intersection and removes crossed support
skin without changing displacement or cutting side armor. The fitted enclosure
seals the opening until its damage owner fails. Other impossible material or
functional overlaps remain errors.

Turret working wells contain a fixed steel trunk and deck collar supporting the
original roller rim. Their material mass, CG and protection are included once;
they do not create displaced volume. They use the design's default structural
thickness, without inferring historical barbette armor. These derived equipment
supports remain visible in inspection and follow their fitting rather than
becoming editable hull-face assignments.

Loading uses steel at 7,850 kg/m³, seawater at 1,025 kg/m³, real material positions,
fixed equipment/service allowances and initial ammunition. No hidden ballast,
CG adjustment or per-design buoyancy multiplier is added. Exact clipped volumes
supply buoyancy and usable room water capacity. Floodwater, machinery immersion
and loss use native simulation state. Resistance, wave effects, package masses
and handling remain documented engineering/game approximations rather than
certified naval performance.

## Identity, storage and local authority

The compiler digest includes source, compiler version and catalog content.
Constructed IDs include a source identity and digest prefix; the complete digest
and source revision accompany the definition and model. A dedicated bounded
worker compiles each editor revision. Cancellation terminates in-flight native
work; stale messages cannot replace the active preview.

IndexedDB database `fleet-command-construction` stores source revisions and a
transactional current-revision pointer. Compare-and-swap writes reject stale
tabs, and older revisions remain recoverable. Invalid physical drafts may be
saved. Missing catalog versions, corrupt data, newer schemas and quota failures
show recovery guidance without overwriting originals. Catalog versions are loaded
exactly, including retained historical catalogs. Source export is a local backup.

[localShips.ts](../src/ships/localShips.ts) is a port presentation registry.
Each battle freezes its own selected revisions. `LocalRuntime.with_construction`
recompiles these sources against their exact catalogs and installs them in a
cloned native catalog alongside trusted historical content. It does not accept
arbitrary supplied physical definitions or mutate the online manifest.
Unknown local IDs are errors, never a historical fallback. Trial controls are a
guarded local API and are absent from the multiplayer command protocol.

## Production models and bounds

[constructionModel.ts](../src/game/constructionModel.ts) composes native exterior
polygons with immutable component GLBs under `models/components/`. It verifies
component/definition identity, prefixes instance joint/socket IDs and preserves
independent articulation. Armor and compartment inspection renders native
polygons/voids. Named paints use shared naval finish values and metric UVs across
neighboring pieces. Obsolete previews dispose geometry, materials and textures.

See [shared components](shared-components.md) and the
[construction catalog notes](../assets/parts/construction/README.md) for original
builders, publication commands, retained revisions and provisional package data.
Player save/compile/launch needs the production browser assets and WASM only;
Blender and the model-viewer server are authoring/review tools.

The compiler bounds source JSON to 2 MB and an individual catalog to 4 MB. A design
allows 512 primitives, 128 equipment instances, 128 loads and 24 boundaries, with
4,096 disjoint cells and 8,192 skin patches as derivation bounds. Piece dimensions
are 0.01–500 m and finite positions lie within ±1,000 m. Complexity-limit failures
preserve the source and require simplifying the offending geometry. These are
technical bounds, not a promise that every maximal arrangement compiles quickly.

Analytic box/wedge checks use 1e-7 tolerances for small-fixture volume/centroids;
material overlap tests use 1e-6 kg. The implementation plan's execution record
tracks actual native/WASM, browser, asset and performance validation. A standalone
component check does not certify the movement envelope of every installation.

## Measured scenarios and approximations

The September 2026 checks used an Apple M5 Pro with 48 GiB memory and 18 logical
CPUs. The synthetic large source in
[construction-editor-performance.ts](../scripts/tests/construction-editor-performance.ts)
has two hull primitives, seven equipment instances and three internal boundaries.
It is a roughly 106,408 t volume/loading fixture, not a detailed battleship or a
maximum-complexity fixture. Its measured warm worker compile was 6.2 ms, a revised
compile 5.5 ms, mean source/history edit 0.012 ms, and IndexedDB save 0.9 ms.

Actual static production trials loaded the armed patrol starter in 12.65 s, an
armor refit in 12.72 s, and the large fixture in 12.29 s. These timings run from
the Sea trial button to the trial controls becoming available, including model
composition and renderer preparation. They used the initial reviewed compiler
and current 15-part catalog while other development checks were running. They
are individual observations, not latency guarantees.

The patrol trial demonstrated propulsion, steering, ammunition use, compartment
flooding, changed attitude, machinery loss, HP damage and reset. The large trial
spawned with its derived mass and HP, operated its rudder and gun, and accelerated
slowly with the same small machinery package. A separate two-versus-two custom
battle used three copies of one saved revision alongside a historical preset.
Browser background throttling prevented a useful sustained frame-rate sample;
these results do not establish a frame-rate or fleet-size guarantee.

Material and displacement integrals use the actual authored polyhedra. Equipment
inertia uses fixed envelopes and the simulation consumes diagonal inertia,
rather than a fully coupled tensor. Openings operate on whole exposed source
faces; internal decks and bulkheads are full axis-aligned planes. Flow uses
lumped opening area/pressure, terrain contact samples downward-facing vertices,
and collision response retains the existing planar impulse model after testing
actual cell intersection. Suggestions are bounded searches and can explain a
fit failure without finding every feasible arrangement. Initial service and
ammunition loading is fixed; expenditure does not recalculate dry mass.
