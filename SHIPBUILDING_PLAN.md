# Shipbuilding implementation plan

Status: implementation in progress. Shared source, native compilation, local storage, production equipment and builder integration are implemented; end-to-end acceptance and integration checks are underway.

Planning date: 2026-09-13. Code inspected at commit `5cec0bfc`; implementing agents must recheck current code and follow the integration workflow before making changes.

This document is the implementation brief for a single-player shipbuilding MVP. It consolidates the requirements interview and the user's subsequent corrections. It is self-contained: the untracked `answers` file is background material, not a dependency or the final authority on superseded decisions.

**Important correction: HP stays as the placeholder defeat mechanism.** The user explicitly reversed the questionnaire's proposal to remove HP-based sinking. Preserve the existing combination of HP/integrity loss, flooding and capsize for historical and constructed ships. Do not turn this project into a defeat-rule overhaul.

## 1. Intended experience

A player builds a ship from hull primitives, installs prebuilt equipment, assigns armor, inspects its internal layout, saves locally, and launches into sea trials or a custom battle against AI. Changes to armor and equipment have meaningful effects on space, mass, center of gravity, flotation and handling. Construction remains approachable; machinery routing and detailed naval engineering are largely automated or abstracted.

Historical ships remain non-editable presets. Their original models and blueprints stay on the existing authoring pipeline. Player designs use the same versioned blueprint/definition family and the same Rust combat authority.

The first complete demonstration is a small armed ship that can be built, saved, launched and damaged. The geometry foundation must also work for a connected catamaran and an asymmetric hull; conventional ship shape must not be a hidden prerequisite.

## 2. Accepted scope and priorities

### Required for the MVP

| Area | Requirement |
| --- | --- |
| Modes | Single-player construction, sea trials and custom battles. Saved custom designs can be controlled by the player or AI and fight historical presets or other custom designs. |
| Vessel types | Surface gun and torpedo ships. Equipment spans the early twentieth century through WWII, primarily WWII. National equipment can be mixed. |
| Size | Support small boats through approximately Yamato-sized creations; roughly 100,000 metric tonnes is the upper design target. This is not a newly approved matchmaking rule or an adequate substitute for geometry bounds. |
| Hull freedom | Asymmetric, concave and connected multiple-hull arrangements must work. Do not reject a ship merely because it resembles a catamaran or an unusual platform. |
| Building | A 1 m hull grid; finer equipment placement, initially 0.25 m; 3D placement and brushes with orthographic views and an interior/deck-slice view. |
| Shapes | Cubes, slabs, wedges, inside/outside corners and shallow/long slopes in defined sizes. |
| Equipment | A curated collection of original prebuilt guns, AA, torpedo launchers, machinery, magazines, funnels, masts, directors/rangefinders, propellers and rudders. Fixed weapon variants and catalog equipment dimensions. |
| Placement | Equipment can rotate about the vertical axis on suitable supports. Propellers and rudders are placeable, with automatic placement available. Their locations matter to operation and handling. |
| Hull meaning | Filled hull primitives describe enclosed ship volume. Their union produces an outer skin and usable interior volume; every filled cell is not a solid block of steel or an independently sealed compartment. |
| Internals | Spatial machinery and magazine modules, with an automatically suggested layout that the player can adjust. Editable decks and watertight bulkheads; split/merge compartments. |
| Machinery | Defined package dimensions, mass and output. Simple automatic/logical connections. Funnels provide exhaust capacity for machinery, rather than creating power on their own. |
| Armor | Thickness in millimeters per surface, with area selection, painting, mirroring and presets. Thickness extends inward, occupies space and contributes mass at its real location. Structural steel and armor steel initially. |
| Physics | Derived mass, center of gravity, flotation, stability, flooding, list/capsize, and design-dependent speed and turning. Use bounded engineering approximations for resistance and waves. |
| Flooding | Watertight subdivision matters. Explicit openings admit water when submerged. Flooded or damaged machinery loses capability. |
| Combat damage | Existing HP/integrity-based defeat remains, alongside flooding/capsize. Hull geometry stays intact during combat; breaches are simulation records. No block destruction or detached wreck sections. |
| Damage control | Mostly automatic, using the existing machinery, pumping and crew concepts where applicable. Major destroyed equipment is restored when returning to the undamaged design for a new trial. |
| Trials | Permit overloaded, unstable and underpowered designs to launch with warnings. Invalid data and impossible functional overlaps block launch, not editing or saving a recoverable draft. |
| Appearance | Continuous painted steel across adjacent primitives, without obligatory block outlines. Shared naval finishes, metric texture scale, per-surface paint and a few camouflage presets. |
| Editing essentials | Undo/redo, autosave, selection, copying, mirroring, multi-placement and useful bulk tools. Generic starter hulls and suggested internals should make a first working ship achievable in about 15–30 minutes. |
| Diagnostics | Mass breakdown, center of gravity, predicted waterline, stability warnings, machinery power, estimated speed, armor coverage and firing arcs. Controlled flooding and damage tests in trials. |
| Persistence | Local saves. Preserve source designs and stable IDs across reloads and schema migrations. |
| Platform | Existing desktop browser game on midrange gaming PCs and recent Apple Silicon Macs. Small battles first; no new 8v8 acceptance target or broad fleet optimization campaign. |
| Economy | Free sandbox. No construction currency, unlocks or progression requirements. |

### Optional after the core loop works

- Ammunition expenditure updating mass and center of gravity, if it follows cheaply from the loading model. Finite ammunition and initial ammunition weight still matter.
- Convenient tools for internal citadels, spaced armor and torpedo-defense voids, where ordinary armor/compartment machinery supports them. Basic armored decks and bulkheads remain in scope; a specialized protection designer is not a completion gate.
- Local blueprint file export/import as a useful backup convenience after local persistence works. Cloud infrastructure is not implied.

### Explicitly deferred

- Custom carriers/submarines, modern weapons and player-designed guns.
- Multiplayer custom ships, co-op building, campaign integration, public galleries, cloud saves, custom-model importing and scripted mods.
- Runtime hull cutting, block disappearance, fracture, detached sections and structural bending.
- Detailed pipes, electrical wiring, ammunition conveyors, exhaust routing or shaft-building puzzles.
- Fuel depletion, endurance, refueling or fuel-management gameplay. Use a documented fixed service/fuel loading allowance with real mass and space.
- Dedicated ballast placement tools and deliberate counter-flooding controls. Do not silently add ballast or adjust CG to make a bad design float.
- Wave slamming, spray accumulation, detailed deck overtopping, trapped-air compression and a full fluid simulation.
- Specialized torpedo-defense bonuses and replacing HP defeat with physical-loss-only rules.
- Arbitrary equipment scaling and full reproduction of every existing historical fitting.
- The adjustable custom hull tool itself. Its compatibility requirements are mandatory now; its editing UI is a later phase.

## 3. Repository instructions and implementation boundaries

Read [AGENTS.md](AGENTS.md), [README architecture](README.md#architecture), [documentation index](docs/README.md), [ship pipeline](docs/ship-pipeline.md), [runtime contract](docs/ship-runtime-contract.md), [shared components](docs/shared-components.md), and [integration workflow](docs/integration-workflow.md). Read the applicable appearance, ocean, model-review and session guides when touching those systems.

- Continue using one versioned blueprint/definition family. Different geometry sources inside that family are allowed; a separate incompatible player-ship format and combat simulator are not.
- The Rust simulation owns combat, flooding and physical poses. Active custom battles already run in WASM. The legacy TypeScript simulation is a migration reference and presentation dependency, not the place to add a second active physics implementation.
- Keep GPU ocean sampling visual-only. Builder trials must exercise the same CPU water/pose rules as battles.
- Preserve stable part, assembly, joint, muzzle and socket identities. Preserve the documented coordinate conversion and the Bismarck baseline.
- Historical asset changes follow the existing compile/build/check/review pipeline. Player construction and launching must work in a production browser without Blender, a developer server, Python or writing to the source repository.
- Reuse original component recipes/assets. An installed preview extracted from a ship's GLB is not a reusable authoring source. Extend the catalog honestly for non-gun families rather than disguising them as guns.
- Use Blender MCP and the required visual review loop when authoring or extracting durable equipment geometry. Persist changes in original inputs, then rebuild. Follow the documented inspected-local-render fallback if MCP is unavailable.
- Keep logs, exploratory exports, screenshots and diagnostic artifacts in ignored `.build/`. Do not create ship `reports/` or `references/` directories.
- Historical presets remain registered in `src/ships/presets.ts`, one entry per line. A local saved-design store is not a second hard-coded historical roster. Do not add each user's ship to that source file.
- Treat the product decisions above as already authorized. Resolve routine implementation details without reopening the interview. Ask only if a material requirement cannot be met or a proposed change would expand scope.

## 4. Current code and gaps to address

Paths are starting points, not exclusive ownership boundaries. Recheck them against the implementation branch.

| Concern | Existing entry points | Consequence for this work |
| --- | --- | --- |
| Authoring/compiled schema | [blueprint.ts](src/ships/blueprint.ts), [blueprint tests](src/ships/blueprint.test.ts) | Hull geometry is currently authored station data; mass, handling and internals are largely supplied. Constructed ships need derived data and source geometry. |
| Rust definitions | [generator](scripts/multiplayer/generate-rust-definitions.ts), [generated types](crates/naval-sim/src/definition.rs) | Rust types derive from the TypeScript contract. The generator currently rejects heterogeneous object unions: account for this before adding shape unions. Do not hand-maintain a divergent Rust schema. |
| Hull geometry | [hull.rs](crates/naval-sim/src/hull.rs), [hydrostatics.rs](crates/naval-sim/src/hydrostatics.rs), [hydro_table.rs](crates/naval-sim/src/hydro_table.rs) | Cross-sections are mirrored. New geometry must support asymmetry, disjoint sections and gaps without inventing displaced volume. |
| Physical state | [stability.rs](crates/naval-sim/src/stability.rs), [floodwater.rs](crates/naval-sim/src/floodwater.rs), [flooding.rs](crates/naval-sim/src/flooding.rs), [motion.rs](crates/naval-sim/src/motion.rs), [machinery.rs](crates/naval-sim/src/machinery.rs) | Reuse floodwater, machinery and loss concepts. Current loading/handling assumptions and inertia approximations must be evaluated for constructed designs. |
| Compiled collision/contact caches | [vessel.rs](crates/naval-sim/src/vessel.rs), [contacts.rs](crates/naval-sim/src/contacts.rs), [hull_contact.rs](crates/naval-sim/src/hull_contact.rs), [collisions.rs](crates/naval-sim/src/collisions.rs), [torpedoes.rs](crates/naval-sim/src/torpedoes.rs) | Changing buoyancy alone is insufficient. Hull containment, shell/torpedo hits, armor, obstacles and ship contact geometry need the constructed geometry too. |
| Local runtime content | [catalog.rs](crates/naval-sim/src/catalog.rs), [WASM exports](crates/naval-wasm/src/lib.rs), [worker](src/game/session/local.worker.ts), [LocalBattleSession](src/game/session/LocalBattleSession.ts), [session guide](src/game/session/README.md) | The worker loads a build-time manifest and resolves preset IDs. Add a validated, local runtime path for constructed definitions and derived caches. |
| Preset assumptions in UI | [presets.ts](src/ships/presets.ts), [shipModel.ts](src/game/shipModel.ts), [battle UI](src/ui/battle/BattleDialog.tsx), [fleet transfers](src/ui/battle/fleetTransfer.ts), [mode rules](src/ui/battle/battleModes.ts) | Avoid the existing unknown-ID fallback to Bismarck for custom designs. Inspect catalog, deployment, card metadata and formation paths for preset-only assumptions. |
| Rendering | [Game.ts](src/game/Game.ts), [loadShipModel.ts](src/game/loadShipModel.ts), [ShipView.ts](src/game/ShipView.ts), [ShipInspection.ts](src/game/ShipInspection.ts), [inspection data](src/ships/inspection.ts) | Loading currently expects a ship GLB with a matching definition hash. Add construction-model composition while keeping definition/geometry identity checks. |
| Equipment assets | [guns catalog](assets/parts/guns.json), [library metadata](assets/parts/library.json), [library code](assets/parts/library.py), [part tools](scripts/parts/pipeline.ts) | Standalone builds currently live in `.build/parts` and the development viewer serves them. Production needs a durable publication path for the curated component assets. |
| Integration checks | [package.json](package.json), [test guide](docs/test-performance.md), [Rust/WASM guide](docs/rust-multiplayer-implementation.md) | Shared schema/compiler changes can invalidate published historical outputs. Run freshness checks and rebuild only the outputs they identify. |

## 5. Architecture and geometry contract

### 5.1 One source design, one compiled result

Extend the shared authoring contract with construction source data: stable primitive instances, shape parameters, surface assignments, equipment instances, internal boundaries and layout choices. Keep editor camera/tool state separate from simulation inputs. Preserve the distinction between editable source and derived definition/caches.

Historical station hulls and constructed volume hulls are geometry variants of the same contract. Existing historical definitions must continue to load. Choose a versioning/migration strategy deliberately; do not keep incompatible structures under the same version accidentally.

Prefer implementing authoritative geometry/loading derivation in reusable Rust code callable through WASM and native tests. TypeScript can own editor commands, authoring validation and display state. Use one implementation of the physical derivations, with reference checks where needed; do not independently implement competing browser and battle formulas.

Before broad edits, prove the schema-generator path for the chosen representation. Either support the required discriminated types in generation or use an explicit, validated representation that the generator can serialize correctly. Record the choice in this plan's implementation notes.

Compile a design revision into:

1. Simulation definition, equipment/system bindings and immutable collision/contact geometry.
2. Hull displacement representation and reusable hydrostatic data or bounded queries.
3. Compartments, material occupancy, openings and flooding connectivity.
4. Loading data: mass contributions, centers, inertia, service/ammunition allowances and derived handling inputs.
5. Renderable hull surfaces, material/armor attribution and component placements using the same revision identity.
6. Diagnostics that distinguish invalid geometry from a physically poor but valid design.

The same revision must supply the editor preview, trial and saved-design launch. A cancelled or stale asynchronous compile must never replace a newer result. Cache keys include the relevant source, compiler and component revisions.

### 5.2 Grid placement must not dictate physical shape

Store shape definitions/parameters and transforms, not only a boolean occupancy grid. The grid is a snapping aid. Wedges already need partial-cell geometry; future tapered/curved pieces need the same independence from the placement grid.

Use a volume/geometry interface capable of unions, disconnected cross-sections, interior gaps and partial cells. A bounded polyhedral/cut-cell representation is a reasonable initial candidate. Prove it with the fixtures below before committing every editor feature to it. Do not use a single convex hull or mirrored width table as the final physical representation of an arbitrary design.

- Adjacent envelope primitives merge into continuous hull volume. Shared interior faces do not become armor or bulkheads automatically.
- Exposed skin, internal decks/bulkheads and equipment are material/functional layers within that volume.
- Remove duplicate/overlapping contributions deterministically. Overlap cannot create extra buoyancy, armor layers or mass by accident.
- Preserve the exterior water channel between catamaran hulls, concave notches and other open gaps in the actual physical queries.
- A broad-phase bound may span empty space; final collision, projectile and displacement queries must respect the gaps.
- Require physical attachment between parts of a single rigid ship. Multiple hulls joined by a deck or beams are valid. Detached islands cannot be welded together invisibly by the simulation. This is a connectivity rule, not a structural-strength simulation.
- Keep surface paint/armor identity stable through triangulation, chunking, selection moves and save/load. Do not use transient render triangle indices as authoring IDs.

### 5.3 Armor, openings and interior space

Armor belongs to physical surfaces. Its millimeter thickness extends inward from the designed exterior and contributes material volume, mass and center of mass. Walls and decks also consume space. Treat corner joins consistently so shared material is not counted twice. Conservative room-clearance checks are acceptable when their error is small and documented; a full one-meter-cell penalty for a thin plate is not.

For overlapping armor occupancy and machinery, retain a visible editable draft and report the actual conflict. Do not silently shrink modules, move them, remove armor or grant collision-free space.

Provide an explicit opening operation or surface state distinct from changing the hull envelope. Changing the silhouette normally rebuilds its skin; opening a hatch/deck surface exposes the compartment behind it. Zero protective armor must not ambiguously mean both an ordinary thin structural skin and a completely open hole.

Compartment generation must:

- Respect the actual hull interior, armor, decks, bulkheads and module occupancy.
- Distinguish exterior water gaps from enclosed/floodable interior spaces.
- Produce stable room identities where boundaries are unchanged and deterministic connections between rooms and the sea.
- Represent open-topped spaces and downflooding through explicit openings without introducing invisible armor across those openings.
- Account for machinery/material volume when deriving floodable capacity.
- Preserve user-edited layouts; regeneration is an explicit undoable operation, not an automatic reshuffle after every hull edit.

Use one consistent flooding accounting method. The existing simulation adds floodwater mass to envelope buoyancy. Do not also subtract the same flooded volume from buoyancy and thereby count flooding twice. Do not preserve free flotation in a fully flooded open compartment by treating its air as permanently sealed.

### 5.4 Loading and handling

Mass is derived from shell/armor, decks, bulkheads, equipment, initial ammunition, service load and the documented structural allowance. Show the breakdown. Component masses must not include the same armor, magazine or machinery volume twice.

Calculate dry CG from mass positions and appropriate inertia from the distributed loading. Use actual hull volumes for displacement and righting behavior. Do not apply per-design buoyancy scaling, arbitrary low CG or hidden ballast to make player ships pass trials. Historical loading calibrations can remain for historical presets.

Keep the design coordinate frame stable as armor or load changes. The runtime contract remains meters, +Y up, -Z bow, +X starboard, with the documented waterline datum. If a compile-time normalization is needed, retain one explicit transform and apply it to hulls, materials, modules, CG, components and sockets together; never shift the hull independently of its contents.

Derive propulsion and handling from the selected machinery, hull geometry, loading, propellers and rudders. Named, shared engineering approximations are acceptable; arbitrary authored top speed for every custom ship is not. Propellers must be suitably immersed and linked to a working power source. Damaged or flooded machinery and steering must affect the same controls used in battles.

Connections should begin as simple typed assignments with automatic suggestions and basic fit/availability checks. Reserve the physical space intrinsic to modules and turret/barbette/magazine assemblies. Do not add a pipe network or path-routing puzzle to the MVP.

### 5.5 Local runtime integration

Add a validated constructed-content input at the local runtime boundary. Freeze selected design revisions at launch and install their definitions/caches in a session-local registry alongside historical content. Multiple instances share immutable geometry while retaining independent damage, ammunition and motion state.

Do not mutate the generated production manifest in place, change the compiled preset roster for local saves, or relax online trusted-content checks. Multiplayer and PvE campaign selectors continue to admit their existing content only. Mode switching must not leak local-only designs into an unsupported mode or silently substitute another vessel.

Extend resolution and metadata paths to handle historical and local design references explicitly. Unknown/missing design IDs are visible errors. Editing a design in port must not alter a battle already using an earlier revision.

The worker remains authoritative at the existing fixed step. Reuse addressed commands, snapshots, stable presentation identities, telemetry and reset/lifecycle code. Trial-only flood/damage commands must be confined to the local trial API and not exposed as new unvalidated online commands.

Reuse the current mass-based `max_hull_integrity` calculation in [damage.rs](crates/naval-sim/src/damage.rs) and the existing module/damage-control conventions. Supply the constructed ship's derived mass and meaningful damage regions. Do not invent an HP bonus per voxel, per mesh or per funnel: subdividing unchanged geometry must not change durability. Broad combat rebalance is outside this plan.

### 5.6 Model composition and asset publication

Add a ship-model creation seam that can load an existing published GLB or compose a constructed hull and published equipment into the hierarchy expected by ShipView. Use the common definition/content identity rather than pretending every local design has a URL in `public/models`.

- Compose hull surfaces in sensible chunks/batches; do not create a Three.js object or physical body for every filled voxel.
- Generate render surfaces from the same source geometry used by physical derivation. Physical approximations require explicit tolerance checks against the visible shape.
- Prefix published component joint/socket IDs with the placed instance's stable identity, preserving correct local pivots and muzzle transforms.
- Preserve the existing articulated firing, inspection and effects bindings. Verify multiple copies of one component do not share mutable pose or damage state.
- Publish curated component GLBs/textures through a reproducible source-backed asset pipeline. Asset metadata can reference catalog IDs and hashes; do not create a second weapon-stat catalog.
- Production runtime must fetch published assets through the existing base-path handling. It must not depend on `.build/parts`, viewer API routes or Blender.
- Extend shared named paints and metric finishes. Preserve sharp intentional chines while removing artificial per-block seams. Keep hull, armor and internals inspection usable against the sea.
- Dispose obsolete editor meshes, component instances and compile buffers when changing designs or entering/leaving trials.

### 5.7 Local persistence

Use IndexedDB as the default browser store for potentially large source designs. Separate persistent design IDs from revision IDs and generated-cache identities. Save the versioned source, selected catalog revisions and user-authored layout/appearance; compiled geometry is a disposable cache that can be rebuilt.

Keep autosave transactional and retain the last recoverable revision. A draft with physical fit errors can be saved without becoming launchable. Missing component revisions, unsupported schema versions, quota failures and migration errors must produce actionable messages while preserving the original source. Loading a design must not silently substitute a different weapon variant or change its dimensions to match a newer catalog entry.

Prove close/reopen and migration behavior with representative design sizes. Optional file backup/export can be added after this path works; no cloud service is required.

## 6. Ordered implementation work

Work in these slices. Keep the smallest construction-to-trial path functioning as features accumulate. Do not finish a large editor before proving the geometry and runtime boundaries.

### S0 — Contract and compatibility proof

Dependencies: none.

Deliverables:

- Pin the shared schema extension, source/derived boundary, geometry representation, coordinate handling, revision identity and local runtime content API.
- Demonstrate a minimal constructed definition passing the real type-generation and Rust deserialization/validation path.
- Inventory all hull-specific consumers and preset-only resolution paths, using the entry points above. Include collision profiles, torpedo hulls, shell contacts, containment, inspection, firing clearance and hydrostatic caches.
- Inventory candidate reusable equipment with `bun run part:list`. Select a small starter catalog from original registered sources; identify extraction/publication work separately from already reusable components.
- Establish small analytic/native fixtures for the geometry proof and a browser route or diagnostic entry that can inspect the same results.

Acceptance:

- Existing historical definitions still load through normal validation.
- The chosen schema can be generated into Rust without manual edits to generated definitions.
- A local custom identity does not fall back to Bismarck, enter the online content registry, or require a source-roster edit.
- Implementation notes identify the chosen representation and the checks that justified it. An unresolved geometry choice is not hidden behind a finished editor.

### S1 — General hull volume, loading and flotation

Dependencies: S0.

Deliverables:

- Primitive composition, skin attribution and partial-cell/volume queries for the initial shape set.
- Material mass/CG/inertia, hull displacement and bounded flotation/righting queries callable by native simulation and the editor worker.
- Explicit exterior gaps and openings, with simple initial rooms sufficient to demonstrate downflooding.
- Inspection of primitive geometry, skin, material occupancy, mass points, waterline and buoyancy center.
- Bounded asynchronous compilation with cancellation/revision checks. Reuse immutable geometry; do not recalculate a full hydrostatic table on every pointer movement or tick.

Acceptance:

- Rectangular hull and wedge volume/centroid checks agree with analytic results within declared numeric tolerances.
- A connected catamaran displaces the two immersed hulls, not the water between them. Ray/contact tests through an unobstructed part of the gap miss.
- Moving an off-center test load changes CG and equilibrium attitude in the correct direction; moving it upward reduces stability for the same fixture.
- Additional armor changes mass/draft and reduces available internal space.
- An open-topped fixture floods when its opening submerges. Water-volume accounting is conserved within a declared tolerance.
- There is no automatic buoyancy/CG correction that conceals an unstable design.
- Historical hydrostatics and contact regression fixtures continue to pass, or any intentional shared numerical change is documented and validated before adoption.

### S2 — Editable hulls, armor and local source saves

Dependencies: S1.

Deliverables:

- Port entry to a builder with a generic starter hull and a blank design.
- Place/remove/rotate primitives; brush and bulk operations; multi-select, copy, mirror, undo/redo, orthographic views and deck slices.
- Surface armor/material/paint editing with millimeter thickness, area selection and visible inward occupancy.
- Local design storage, autosave and recovery. Persist authoring state rather than only generated meshes or compiled physics.
- Incremental preview updates and actionable error/warning overlays while allowing incomplete drafts to remain editable and saved.

Acceptance:

- A block/wedge hull survives save, application reload and recompilation without losing dimensions, stable IDs, armor or paint assignments.
- Undo/redo restores both shape and surface/module references; history is not corrupted by asynchronous preview results.
- Thickness is assigned to selected faces rather than all faces of a block; an engine-sized test volume becomes invalid when inward armor reaches it.
- Adjacent surfaces look like continuous painted steel. Mirroring and mesh chunk boundaries do not create gaps or change physical mass.
- Unknown/corrupt local data produces a recoverable error and does not overwrite the last valid save. Storage failure/quota errors are visible.

### S3 — One complete armed-ship trial

Dependencies: S2 plus the minimal source-backed equipment publication path from S0.

Deliverables:

- One usable machinery package, one magazine, one gun mount, a funnel, propeller and rudder with simple valid connections.
- Manual placement plus basic suggested placement sufficient to make the starter ship work. Reserve physical module and gun-installation space.
- Source-backed runtime component publication/composition, unique articulation IDs, derived performance and functioning firing/muzzle bindings.
- A local trial launch through LocalBattleSession/WASM using the newly compiled definition. Include a stationary target, reset and return-to-builder flow.
- Existing HP, ammunition, damage, machinery loss, flooding and capsize behavior applied to the custom definition.

Acceptance — first playable milestone:

- Build and save a small armed ship, launch it without Blender or a per-ship repository build, move, steer and fire at a target.
- Return to the builder, change armor or machinery position, relaunch and observe the resulting loading/flotation change.
- Damage or flood a real compartment and observe loss of the machinery it contains, water accumulation and changed attitude.
- HP/integrity depletion still invokes the existing loss behavior. Flooding/capsize remain supported. No runtime geometry cutting is introduced.
- Reset/return restores a clean trial from the saved source; battle damage does not modify that source.
- The same path works from a production build using published component assets, without viewer-only endpoints or local source tools.

Do not defer this milestone until every shape, component or editor convenience is polished.

### S4 — Suggested internal layouts and useful design diagnostics

Dependencies: S3.

Deliverables:

- Deterministic suggested room/module placement for the supported hull geometry, with understandable failure messages when equipment cannot fit.
- Add/move decks and watertight bulkheads; split/merge compartments; explicit openings; physical armor/room/module overlap checks.
- Major machinery, magazines, service/fuel allowance, electrical/pump and steering functions represented at the agreed level of abstraction.
- Mostly automatic damage control with simple existing priorities where useful.
- Mass breakdown, CG/waterline and stability display, estimated power/speed, armor inspection, firing arcs and controlled flooding/damage actions.
- A clear separation between an invalid design and a valid but unsafe design. Auto-layout suggestions are undoable and do not rearrange user-authored internals unexpectedly.

Acceptance:

- A novice can obtain a working starter design using suggested internals, then move its major modules manually.
- A blocked/oversized magazine or machinery package produces a specific fit error instead of invisible equipment or an automatic size reduction.
- A closed bulkhead isolates rooms until the applicable opening/damage rules permit transfer; connected-room water transfer conserves water.
- Module volume is not simultaneously counted as empty floodable space.
- An unstable or overloaded design can be launched into trials with warnings and fails according to its physical configuration.
- Unusual connected hulls either receive a valid suggested layout or a clear, locally fixable placement explanation; they are not rejected as an unsupported hull class.

### S5 — Curated catalog and custom-battle integration

Dependencies: S4. Source extraction for additional curated components can proceed separately after S0's contracts are stable.

Deliverables:

- A reviewed collection covering destroyer/cruiser/battleship armament, AA, torpedo launchers, machinery and the required fittings. Prefer existing original reusable variants; do not require the full historical catalog.
- Correct mass, space, protection, attachment, articulation and functional metadata for every curated part. Directors/rangefinders and funnels have the agreed roles.
- Custom designs visible in local custom-battle selection and deployment, with correct names, class metadata, dimensions and thumbnails/previews.
- Player and AI use of custom designs; multiple instances of one saved revision; mixed historical/custom fleets.
- Mode-aware selection/resolution that keeps local-only designs out of online/campaign flows without altering those modes' existing content rules.

Acceptance:

- A saved design can be the player's vessel, an ally or an enemy, including duplicate instances with independent state.
- An actual torpedo launch, AA engagement and director-linked gun engagement work with curated parts.
- Turrets, barrels and fittings have physical supports and legal movement/firing envelopes throughout intermediate poses. Reuse a reviewed part without assuming every new installation is automatically clear.
- Local custom battles end and reset under the existing rules with correct ship identities and displacement data.
- Switching to an unsupported mode gives a clear selection state; no unknown custom ID silently resolves to a historical ship.
- Historical custom battles, online sessions and campaign flows continue to pass their relevant regressions.

### S6 — MVP completion and documentation

Dependencies: S5.

Deliverables:

- Finish build-tool ergonomics, local-save recovery, painting/camouflage, trial controls, beginner guidance and invalid-design explanations.
- Measure editing, compilation, launch and small-battle behavior for a small ship and an approximately 100,000-tonne design on an identified target machine.
- Fix demonstrated stalls or excessive memory use; add honest technical bounds where required. Do not add an unrelated maximum-fleet benchmark campaign.
- Update current documentation for the shared schema, constructed hull physics, component publication, local content boundary, saving and the builder workflow. Mark historical planning text as historical rather than treating it as current scope.
- Consider the optional ammunition-loading or layered-protection conveniences only after the required acceptance criteria pass.

Acceptance:

- All required scope in section 2 is demonstrable in the actual application and survives a production build/reload.
- The first-ship workflow is tested with generic starter content and understandable guidance.
- Measurements identify hardware, ship complexity and the actual scenario; no unsupported frame-rate or hull-count guarantee is made.
- No hidden dependency on Blender, the model-viewer server, untracked developer files or mutable build outputs exists in player save/launch flows.

## 7. Validation strategy

Choose meaningful tests around public behavior and boundaries. Do not fill the project with tests that merely repeat an implementation's formulas. Analytic fixtures, conservation checks, invariants and native/WASM comparisons are preferred.

| Fixture or operation | Required assertion |
| --- | --- |
| Box and wedge envelope | Volume, material mass and centroids agree with independent analytic expectations. |
| Adjacent/overlapping shapes | Shared skin is removed correctly; subdivisions or duplicate placement do not inflate mass/displacement. |
| Catamaran and concave hull | Real water gaps stay empty in buoyancy and final contact queries. |
| Translated/mirrored design | Expected transformed geometry and CG; invariant total mass/volume; no double coordinate conversion. |
| Thin and thick armor | Correct inward space use, mass growth and collision/penetration thickness; thin plating is not rounded to a whole grid cell. |
| Elevated/asymmetric load | Physically consistent stability/trim/list response with no per-design calibration hiding failure. |
| Open-topped/flooded spaces | Inflow on submergence, correct exterior connectivity, conserved transfer and a consistent buoyancy/water-mass method. |
| Machinery and guns | Fit, immersion, assignment, damage and ammunition availability affect operation; repeated component instances keep independent joints/state. |
| Save/recompile/migrate | Source and stable references survive; unknown components or versions produce a recoverable diagnostic. |
| Worker revision race | An older compile cannot replace the current design or mutate the ship already in a battle. |
| Local custom content | Valid custom content loads; malformed/oversized geometry and unknown IDs are rejected; online manifest trust is unchanged. |
| Reset/return/reload | Damage is not saved into the source design; resources and session state are released or restored correctly. |
| Historical regressions | Preset loading, gun poses, hydrostatics, snapshots, damage, modes and asset freshness still satisfy their applicable checks. |

For each physical representation, document numeric tolerances and test boundary cases. Demonstrate that refinement improves approximate geometry rather than assuming a coarse grid is accurate. Native and WASM results need agreed numerical tolerances; do not promise unverified bitwise cross-platform lockstep.

Run checks according to the changed boundary:

- Pure editor/authoring code: relevant Bun tests and the production build.
- Schema changes: `bun run multiplayer:definitions`, relevant authoring/generator and Rust tests, then the normal preparation/check pipeline. Do not manually edit generated Rust definitions or wire types.
- Rust/runtime changes: relevant native tests and WASM/session tests; `bun run multiplayer:check` when shared simulation, schema or protocol boundaries change. Follow the current setup guide for required toolchains/content.
- Equipment/model changes: `part:list`, `model:viewer`, applicable `part:inputs`, `part:build`, `part:check`, ship compilation/build/freshness checks and required visual reviews. Extend these tools for new component families/publication rather than pretending the existing gun-preview pipeline already publishes runtime assets.
- Before integration: `bun run ship:check all`, rebuild only the stale outputs it identifies, relevant simulation tests and `bun run build`. Run the complete `bun run test` suite at the completed milestone/integration boundary; use focused tests during iteration.
- Validate the actual builder, armor/internals views, launch, articulation, flooding and return flow in the browser. A successful compile or Python/Blender command alone is not visual review.

Preserve logs and temporary visual evidence under `.build/shipbuilding/`. Keep concise implementation notes and actual validation results here or in the relevant current guide, not a new tracked reports archive. Never rewrite hashes, relax bounds blindly or refresh fixtures merely to make a broken implementation pass.

## 8. Agent execution and integration

- Start with S0, then follow the dependencies. A slice is complete only when its acceptance criteria are demonstrated; an editor mockup alone does not complete a physical-building slice.
- Follow the integration guide: independent implementation tasks start from current remote master in separate worktrees; one integrator mutates the main checkout. Check for already integrated/equivalent commits before replaying work.
- Default to sequential implementation. If multiple agents are explicitly assigned, divide work only after shared interfaces are concrete. Geometry/schema/runtime ownership is tightly coupled; do not have separate agents invent competing contracts.
- Useful independent work after S0 includes source-backed component extraction and publication, and editor/persistence work against the agreed compile API. Integrate shared type/catalog changes through one owner.
- For every completed slice, record the commit, actual tests/visual checks, remaining limitations and any changed technical choice in the execution record below. Update completion boxes only when the acceptance conditions pass.
- Do not introduce a new service, purchase assets, publish a site, deploy infrastructure or build deferred game systems as incidental work on this plan.
- This root plan is the product-scope reference. Keep ongoing implementation notes concise; move stable technical contracts into the current guides and link them here when implemented.

## 9. Future custom hull tool

The future tool edits individual hull pieces' end profiles, taper and curvature, potentially adding vertex controls. It must coexist with grid blocks in the same saved design and feed the same physical derivation. Snapping can remain enabled while a piece's shape uses continuous coordinates.

Required foundations now:

- Versioned shape parameters and stable instance/surface identities.
- Geometry-independent physical queries supporting partial volumes and exterior gaps.
- A source-to-derived pipeline with reliable invalidation, local saves and migrations.
- Armor and interior layout references that can survive geometric edits or report clear invalidation.
- A separation between placement grid resolution and physical/visual accuracy.

Do not build the custom-hull UI during the MVP or promise automatic conversion of every block assembly. Preserve old designs and let old/new piece types mix. Any future conversion should be optional and previewable.

NavalArt is a workflow reference, not a source of geometry/assets or evidence about its internal implementation. Its [developer notes for version 1.1](https://store.steampowered.com/news/posts/?appids=842780&enddate=1743410045&feed=steam_community_announcements) describe vertex hull editing, snapping, mirroring and splitting. Study the actual editing workflow when that later phase begins.

## 10. Planning ranges and execution record

Initial estimates assume one experienced developer working full time and a modest curated equipment collection. They are planning ranges, not measured delivery commitments or an agent runtime budget.

| Milestone | Approximate cumulative effort |
| --- | --- |
| Geometry/loading/flotation proof | 2–4 weeks |
| First complete build/save/launch/combat loop | 6–10 weeks |
| Usable MVP | 4–8 months |
| Later polished custom hull editor | Additional 2–4 months, depending on editing freedom |

Revisit the ranges after S1 proves the geometry and after S3 proves the runtime/component path. Preserve the required hull freedom and physical meaning; trim optional features before weakening those foundations.

### Completion tracking

- [x] S0 — Contract and compatibility proof
- [ ] S1 — General hull volume, loading and flotation
- [ ] S2 — Editable hulls, armor and local source saves
- [ ] S3 — One complete armed-ship trial
- [ ] S4 — Suggested internal layouts and diagnostics
- [ ] S5 — Curated catalog and custom battles
- [ ] S6 — MVP completion and documentation

### Implementation notes

The current technical contract is documented in [Local shipbuilding](docs/shipbuilding.md). S0 uses bounded unions of convex polyhedra and attributed exterior polygons, with continuous primitive dimensions and a stable source coordinate frame. The generator consumes explicit shared interfaces rather than heterogeneous object unions. Native analytic box/wedge/overlap fixtures, historical JSON validation, real WASM compilation and local identity/mode-boundary tests justify this choice.

Integrated foundations: `8089d151` (contract/geometry proof), `6027ef3f` (equipped native compiler and physical consumers), `5d68abf0` (suggestion contract), `4130d6e5`/`847a72c8` (transactional storage), `cd3fde4a`/`2c16d3fe` (14 original published equipment assets), `35f3ab2b`/`5ed063ab` (editor/recovery), and `e386de17` (local sessions, model composition and App integration). The initial real IndexedDB workflow passed nine assertions, and the editor's actual browser workflow passed fourteen editing/save/reload/disposal assertions. Root compile-race/local-identity tests and existing session/mode regressions pass; trial damage-unit verification is pending the native hardening integration.

All historical outputs became stale through the shared schema fingerprint. Clean fleet rebuilds are in progress; no hashes were rewritten to bypass freshness. S1–S6 completion boxes remain open until their full physical, browser, combat and production acceptance is demonstrated. HP/integrity defeat remains part of the required implementation.
