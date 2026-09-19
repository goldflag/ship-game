# Fleet Command — Fleet Battles

Naval fleet battles using **Rust, Bun, TypeScript, React, Three.js WebGPU, Water Pro 3.5.1, and Sky Pro 2.2.0**. Custom battles run the shared Rust simulation in a WebAssembly worker; 1v1 multiplayer uses the same simulation on an authoritative Rust server. Historical ships use a reproducible Blender asset pipeline and versioned blueprints. Reusable equipment is discovered with `bun run part:list` and built from original shared recipes; `bun run model:viewer` browses ships, standalone components and reference comparisons. See [shared components](docs/shared-components.md).

For agent work, start with [repository instructions](AGENTS.md) and the [task-based documentation map](docs/README.md). Ship authoring follows the [ship pipeline](docs/ship-pipeline.md) and its required [model review checks](docs/ship-model-review.md).

```sh
# Requires the pinned Rust toolchain and wasm-bindgen-cli 0.2.128; see multiplayer setup below.
bun install
bun run git:setup # Once per clone: safer catalog merges and remembered resolutions
bun run dev
```

In a fresh worktree run `bun run bootstrap` first. The main checkout reserves `http://127.0.0.1:5173/`.
Each linked worktree gets its own stable port in 5200-5899, derived from its path, and cannot select 5173
even with `--port`. Every dev server prints its URL and records it in `.build/dev-server.json`.

### 1v1 multiplayer

An account is required for the game and shipbuilder. Saved designs synchronize across devices and can join online fleets alongside historical presets. See [accounts and custom multiplayer](docs/accounts.md).

Run the account, compiler and multiplayer services described in [accounts](docs/accounts.md) alongside the development server, then choose **Battle** in port and the **1v1 online** tab. Drag ships into the eight berths (the first berth is your initial command ship) before finding an opponent or creating/joining an invite from the **Match** panel. Each side may bring **200,000 metric tonnes**, **8 vessels** and **2 carriers**. The server draws a map, weather and time of day; night has a 10% weight. Destroy the opposing fleet or have more original tonnage afloat at 30 minutes. Equal tonnage and mutual destruction draw.

Press **M** (or hold Ctrl and choose **Fleet chart** under the battle tally; a carrier keeps M for Air operations) to order your other ships from the fleet chart: select ships, then Move, Hold, Escort, Focus fire or Auto from the wheel, or right-click water or an enemy. Your own ship keeps its last engine and rudder orders while the chart is open, and **Return to helm** or M brings you back to it; Take helm moves you to another surviving owned ship. Carrier orders remain available through Air operations. Menus and tab blur do not pause online matches. Reconnection reserves your side for 90 seconds; explicitly returning to port forfeits an active match. After a reload, choose **Reconnect to previous battle** in the 1v1 online Match panel.

See [Rust multiplayer setup, architecture and validation](docs/rust-multiplayer-implementation.md) for toolchain installation, server settings and content identity. The public frontend and multiplayer backend run at **https://ships.tomato.gg** on Hermes in a separate Docker Compose project; see [deployment and operations](docs/deployment.md).

### Cloning without the asset archive

For code work, clone sparsely and skip original asset sources; the game runs from `public/`:

```sh
git clone --filter=blob:none --sparse git@github.com:goldflag/ship-game.git
cd ship-game
git sparse-checkout set --no-cone '/*' '!/assets'
```

Aircraft and other non-ship reference/review archives still use Git LFS (see `.gitattributes`). `GIT_LFS_SKIP_SMUDGE=1` skips their downloads; fetch originals when needed for those pipelines. Ship report/reference archives and comparison pages have been removed. Ship research and diagnostics stay in ignored `.build/`.

### Deploying under a sub-path

The complete Hermes deployment uses `bun run deploy:hermes` at the domain root,
with separate web/server containers and persistent match storage. See the
[deployment guide](docs/deployment.md). The following describes the older static-only deployment.

Set `BASE_PATH` to the mount point when building. Every asset URL resolves through `src/assetUrl.ts` against Vite's base, so the same build works at the site root or under a prefix:

```sh
BASE_PATH=/naval/ bun run build   # serve dist/ at https://example.com/naval/
```

`bun run build` runs every `ship:check` and `aircraft:check` first; they need neither Blender nor the LFS archive.

`bun run deploy:naval` builds for https://game.tomato.gg/naval/ and rsyncs `dist/` to the tanks-na host, where the tank game's Caddy serves it from `/root/tank-game/naval` (see the `@naval` block in Tomato-gg/tank-game's Caddyfile). Override the destination with `NAVAL_DEPLOY_TARGET=user@host:/path/`.

Open http://localhost:5173. Current Chrome or Edge with hardware acceleration is recommended. WebGPU is selected by Three.js when available; its WebGL2 backend is the compatibility fallback. Initial startup compiles the ocean and cloud shaders, which can take a moment.

How the game plays (port, battle modes, controls, fleet command, carrier operations and the naval
mechanics behind them) is in the [player guide](docs/player-guide.md).

## Architecture

The port's **Shipbuilder** creates local surface ships from editable hull pieces,
armor, equipment and internal boundaries. Save drafts in the local library,
launch a sea trial, or bring compiled designs into Custom battle as player or AI
ships. Historical presets remain non-editable; online and campaign content stays
separate. See the [shipbuilding guide](docs/shipbuilding.md) for controls, source
identity, physical approximations and recovery.

Preset menus use lightweight metadata; ship definitions and hydrostatic tables load on demand before simulation. Indexed runtime definitions retain exact gameplay geometry while sharing repeated records; native collision and hydrostatic consumers share immutable cell faces. See [runtime sizes, benchmarks and limits](docs/ship-runtime-performance.md).

Production builds publish losslessly compressed ship transfers alongside the original GLBs. `src/game/loadShipModel.ts` decompresses them before the normal GLTF parse and definition-hash check; development uses the original models. The build also extracts the supplied ocean/sky libraries' embedded textures into separate hashed files, allowing the game code to start before every texture downloads. Both steps preserve the original asset bytes.

Fleet loading prepares one ship type at a time to limit overlapping parse and geometry buffers. PvE preloads the public recognition catalog without revealing the enemy roster, but generates runtime detail levels only for the friendly ship types: observed exteriors use the original geometry and do not consume those buffers. Hit-surface caches retain triangle-range bounds and use one temporary query mesh, keeping dense models from allocating thousands of persistent mesh objects.

Sound uses an [original ElevenLabs-generated naval set](assets/audio/naval/README.md): mechanical UI clicks, engine telegraph and reload cues, a departure horn, caliber-based gunfire, armor hits, ricochets, splashes and magazine explosions. Click or press a key to enable browser audio. **Esc → Settings → Sound** adjusts master, effects and interface levels or mutes everything; changes apply immediately and persist without restarting the battle. Pause stops combat tails; background tabs are silent. `bun run audio:build` rebuilds the processed assets locally from the retained originals and prompts.

- `src/ships/blueprint.ts`: validated, versioned JSON blueprints and compiled ship definitions.
- `assets/`: original Blender sources, reusable gun recipes, references, source registers and generated review images.
- `scripts/ships/`: portable build, export, independent GLB validation, starter and review commands.
- `src/game/session/battleSetup.ts`: bounded custom-battle setup, deployment and spawn validation, checked again by the Rust battle on admission.
- `crates/naval-sim/`: authoritative renderer-free movement, weapons, collisions, aircraft, damage and flooding at 60 Hz. `naval-protocol` validates addressed commands; `naval-server` owns online matches and results; `naval-wasm` hosts custom battles.
- `src/game/session/`: stable presentation objects, custom worker scheduling, WebSocket/reconnect transport and player intent.
- `src/game/session/elements.ts`, `telemetry.ts`, `airTelemetry.ts`: the frame's element shapes as generated from Rust, and the read-only instrument readouts over them. `src/game/mountGeometry.ts`, `mountFrames.ts`, `ballistics.ts`, `machinery.ts`, `floodwater.ts`, `airWing.ts`: presentation helpers that read the frame (muzzles, carried-mount frames, aim arcs, readiness, water surfaces, deck spots); the two arithmetic copies (`ballistics`, `mountFrames`) are gated against the Rust originals by `src/game/wasmReference.test.ts`.
- `src/simulation/`: the retired TypeScript engine, kept only as the fixture its remaining renderer tests build on; nothing in the game imports it.
- `src/game/ShipView.ts`: binds simulation state to exported joints. `ShipInspection.ts` renders shared armor/module/compartment inspection geometry; `src/ships/inspection.ts` supplies both its geometry and the port list. `CombatEffects.ts` expands projectile instances as needed and uses bounded pools for cosmetic particles.
- `src/game/Game.ts`: scene, licensed Water/Sky integration and lifecycle. Combat ship poses come from CPU simulation; GPU waves animate the sea and buoys.
- `src/game/VisualEnvironment.ts`: applies the resolved map, time-of-day and weather conditions to the water and sky, and owns their live overrides: the port's daylight and standing wind, the developer console's per-scene weather overrides, the air map's far fog, underwater attenuation and the celestial light shared with scene lights and smoke.
- `src/game/HarborBackdrop.ts`, `ShipWake.ts`, `FleetWakeFoam.ts` and `WakeFoam.ts`: illustrative port and hull-scaled sailing wakes for every ship. See [ocean configuration](docs/ocean-configuration.md).
- `src/game/ShipFunnelSmoke.ts`: drifting exhaust from the authored funnel rims on every surface ship. Light smoke rises in port; underway exhaust thickens and trails in the wind. It pauses with the game, hides during inspection and own-ship binocular views, stops emitting when propulsion fails or the outlet submerges, and clears on ship/battle resets. This is a visual approximation of exhaust, with one bounded particle batch for the fleet.
- `src/ui/components/`: [shared naval controls](src/ui/components/README.md), including buttons, inputs and custom keyboard-accessible dropdowns used throughout the game.
- `src/ui/`: the selected [Fleet action HUD](docs/hud-mockups/README.md), port, helm instruments, live battery readiness, targeting and damage feedback. Telemetry updates at 10 Hz; the **Battle** screen in `src/ui/battle/` configures custom, fleet command and 1v1 fleets in port.
- `vendor/`: supplied proprietary Pro runtime bundles and licenses. Their original terms remain in force.

Combat uses velocity-aware AP penetration and delayed fuzes, protected AP/HE bursts, finite ammunition, local fires, machinery failures, timed damage-control teams and compartment flooding. Flotation and righting moments come from the authored hull and a declared provisional loading calibration. Floodwater moves under heel and trim; seawater can enter or leave openings. Ships can be immobile, disarmed, disabled afloat, sinking or capsized. Gameplay hull durability and local equipment condition are tracked separately; hull exhaustion, flooding and capsize can each sink a ship. The internal layouts, fuel, crew performance, loading and protection values remain game approximations. Player construction derives loading and convex-volume geometry in Rust; historical presets retain their declared loading calibrations. Individual crew, detailed spall and hull fracture remain future work. Submarine dive planes, propellers and rudders animate from CPU motion through the blueprint’s retained joints; other non-gun fittings remain visual.

Bismarck, Yamato, Baltimore and Enterprise have full hull-end and major-structure coverage. Their fidelity geometry and retained room IDs are integrated with the damage model; legacy armor volumes remain supported for other definitions. See the [integration record](docs/archive/fleet-fidelity-integration.md) for the independently identified validation snapshots.

The shared simulation runs in the browser for local battles and in the authoritative Rust server for multiplayer, with validated player commands and WebSocket snapshots. Battle weather drives deterministic CPU heave, roll, pitch, wind leeway and added resistance. GPU wave detail remains visual; combat hulls and their hitboxes use the same CPU pose.

## Model pipeline

New ship construction uses the custom editor and Rust compiler. Blender remains
the permanent tool for reusable components; existing Blender-backed ships stay
supported. See [agent construction authoring](docs/construction-authoring.md) for
file-backed editing, batch commands, fixed views, sea trials and publication.

```sh
bun run ship:new my-ship --template fletcher-hull
bun run ship:edit my-ship
bun run ship:build my-ship
```

Historical ships use one versioned blueprint, the original component catalog and original Blender recipes. These produce a simulation definition, articulated GLB and port thumbnail. The [preset registry](src/ships/presets.ts) owns the playable roster. Generated models use meters, bow -Z, up +Y and waterline Y=0.

```sh
bun run ship:new my-ship
bun run ship:compile my-ship
bun run ship:build my-ship
bun run ship:review my-ship
bun run ship:check my-ship
```

Start “create X ship” with the [collaborative brief and reference approval](docs/ship-pipeline.md#start-a-new-ship-collaboratively): resolve the vessel, year/refit, paint and reference policy, then show clear source previews for user approval before modeling. GameModels3D-only is a supported experimental choice; agents must not add historical photos or plans unless approved. Match the accepted primary model/configuration and independently author all geometry and textures. Keep the short approved brief, source links and limitations in the ship README. Research downloads, logs and diagnostic results belong in ignored `.build/`; do not create ship `reports/` or `references/` folders.

Use [Blender MCP for interactive authoring and visual correction](docs/ship-build-reference.md#blender-mcp-authoring-loop), then preserve accepted changes in original recipes/components and rebuild through `ship:build`. Reinspect the rebuilt scene and exported model before accepting the result.

Follow the [ship pipeline](docs/ship-pipeline.md), [file layout and build details](docs/ship-build-reference.md), [model review](docs/ship-model-review.md) and [runtime contract](docs/ship-runtime-contract.md). The original Bismarck baseline remains protected. Passing export checks validates authored targets, not historical accuracy. The old port reference pages and archive comparison commands are retired.

### Local model overlay

Run `bun run model:viewer` and open http://127.0.0.1:5180/ to compare our models with GameModels3D WoWS geometry or a local GLB. Choose overlay or synchronized side-by-side views, including front, rear, both sides, top and bottom. Adjust opacity, configuration and alignment. Reference geometry stays in ignored local storage and never enters ship builds. See the [overlay app guide](tools/ship-overlay/README.md).

## Aircraft model collection

Thirteen original Japanese and American WWII carrier aircraft are available as standalone Blender sources and GLBs: Zero (A6M2/A6M5), Val, Kate, Judy, Jill, Wildcat, Dauntless, Devastator, Hellcat, Helldiver, Avenger and Corsair. Open **`/aircraft-review.html`** to select, orbit and articulate them. Enterprise uses the Wildcat, Dauntless and Devastator in combat. Shōkaku uses the A6M2 Zero, D3A1 Val and B5N2 Kate; the full asset collection remains available in the inspector.

The models were rebuilt through Blender MCP from individually measured three-view schematics, with transparent cockpits, original textured finishes, separate moving parts and three mesh/texture detail levels. Retained drawing overlays and variant caveats accompany the editable sources. Run `bun run aircraft:check all` to validate them, or `bun run aircraft:build all` for the reproducible local Blender build. See the [aircraft source index](assets/aircraft/README.md) and [pipeline](docs/aircraft-pipeline.md).

## Validation

```sh
bun run test
bun run test:serial              # Single-process run for shared-state diagnosis
bun run build
bun run preview
```

`bun run test` discovers every test file under `src/` and `scripts/` and runs each in a separate Bun process, with at most eight workers (bounded by available CPU parallelism). Measured expensive files start first to avoid leaving one slow file at the end. Output stays grouped by file, and any failed file fails the command. Assertions and simulation durations are preserved. `bun run build` checks asset hashes and freshness. See [runtime measurements](docs/test-performance.md). `bun test` still uses Bun's single-process runner. Passing options to `bun run test`, such as `--coverage`, `--watch` or `--test-name-pattern`, delegates to the native single-process runner so those options retain their usual behavior.

See the [test runtime measurements](docs/test-performance.md) for the before/after comparison.

Tests cover mixed-fleet deployment and loading, bot fire/reloads/damage/retargeting, friendly firing lanes, battle results and resets, fleet determinism, blueprint validation, reusable component compilation, movement, ship contacts (ramming, reversing, sliding, mass, turning, pile-ups, sinking and close passes), ballistic solutions, swept hits, armor before modules, conserved flood transfer, reload/ammunition, propulsion damage, magazine detonation, sinking, reset behavior, and identical combat outcomes at different frame rates. A renderer adapter test loads the actual exported joint hierarchy and checks rear-turret rotation, elevation and recoil against authoritative muzzle positions. The build checks that the GLB matches its compiled definition and measures actual exported hull/pivot/muzzle geometry. Browser validation is also needed for rendering and controls.

The [implementation validation record](docs/archive/ship-validation.md) lists the tested build, browser observations and remaining accuracy/visual checks.

To measure a deterministic mixed 30-versus-30 battle, run `bun scripts/diagnostics/mixed-fleet-performance.ts 30 7200` for the CPU replay, or open `/scripts/diagnostics/fleet-performance.html?team=30&mixed` in development and run `await review.measureFrames()` in the browser console. Reload before repeating the frame replay. Runtime surface batching and camera-based detail reduction retain the original GLB geometry and articulated joints for inspection and damage marks.

Three.js renderer reference: https://threejs.org/manual/en/webgpurenderer

Click the compact **AP / HE** cycle control beside the weapon slots, or press **E**, to queue shells for the selected gun battery’s next load. Double-press **E** within 300 ms to switch immediately with a full reload. Hold Ctrl to click the controls. Hover or focus the cycle control to inspect both finite stocks and the reload cost. Each battery remembers its selection. AP penetrates armor before a delayed burst; HE bursts on contact against light protection and exposed equipment. A queued choice preserves loaded rounds and existing reload progress; pressing once again cancels or changes that choice. An immediate switch takes a full reload, including switching back during loading; it never creates or spends rounds. Weapon and mount counters show rounds available for their current load. Cycling is unavailable when the other type is empty or unsupported, but the control remains focusable for stock inspection; guns without HE keep AP. Returning to port restores both stocks and AP selection. The shortcut is rebindable in Settings → Keybindings. HE fill, fragment budget and stock split remain provisional game calibration.

Damage-control crews automatically balance fires, flooding and repairs. Local fire profiles distinguish machinery, ammunition, cargo and empty spaces. Fire consumes finite fuel and cannot restart indefinitely in a burned-out area. Internal fires produce smoke at their outlets; gunhouse fires show flames and smoke. Crews take time to set up, shore small accessible holes, close intact open boundaries and use portable pumps. Repairs consume finite supplies, stop at 60% condition and cannot revive destroyed equipment.

The sailing HUD names burning locations on the **Damage control** line above your ship's name and marks them on the ship instrument. Open that line to see intensity, remaining combustible load, threatened equipment and crew deployment or cooling progress. Set a crew priority or focus a location; crews that keep their assignment retain their setup progress. Target and observed-teammate reports are read-only. Sustained gunhouse flames follow the displayed ship pose and current fire intensity; internal smoke uses authored outlets. Flames stop when burning stops, and emitted smoke finishes dispersing.

Uneven flooding can list a ship while it still has hull HP; bow or stern flooding changes its trim. **Own damage control** now shows your list direction, trim, floodwater and draft change, and target damage names the low side/end too. Draining a survivable load can restore balance. When hull failure, flooding or capsize causes loss, pumps stop and the ship keeps responding to its water load as its descent gathers speed. A wreck can roll over or settle by an end; balanced flooding can still sink it level. See the [flooding and sinking review](assets/reviews/flooding-motion/README.md).
