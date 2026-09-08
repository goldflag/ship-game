# Reproducing Shōkaku authoring and reviews

Run commands from the repository root. The durable inputs are `../blueprint.json`, `../build.py`, `../recipe-inputs.json` and `assets/parts/ijn-carrier-guns/geometry.py`. The version-1 blueprint is shared with historical presets and future player-built ships. Stable assembly/joint/socket IDs and the documented coordinate conversion are mandatory.

## Build

```sh
bun run ship:compile shokaku
bun run ship:build shokaku
bun run ship:check shokaku
bun run ship:review shokaku
```

`generate_blueprint.py` deliberately replaces the blueprint. If changing that original arrangement recipe, regenerate and restore the calibrated stability/local damage inputs before building:

```sh
python3 assets/ships/shokaku/authoring/generate_blueprint.py
bun assets/ships/author-stability.ts shokaku
bun -e 'import { writeLocalDamage } from "./assets/ships/author-local-damage"; await writeLocalDamage(["shokaku"]);'
```

Blender MCP was not exposed during this task. The recorded builds and reviews used local Blender 5.2.0 LTS at `/Applications/Blender.app/Contents/MacOS/Blender`. Use available Blender MCP tools when exposed; report the actual tool and version used.

## Source geometry review

The scripts open the generated scene, require its hash to match the compiled definition and write to `reports/geometry-<hash-prefix>/`. They do not save changes to the production scene. Run each against a freshly opened source so previous review poses/isolation do not leak between checks:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b assets/ships/shokaku/generated/source.blend --python-exit-code 1 --python assets/ships/shokaku/authoring/review_windows.py
/Applications/Blender.app/Contents/MacOS/Blender -b assets/ships/shokaku/generated/source.blend --python-exit-code 1 --python assets/ships/shokaku/authoring/review_decks.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python assets/ships/shokaku/authoring/review_decks.py -- --glb public/models/shokaku.glb
/Applications/Blender.app/Contents/MacOS/Blender -b assets/ships/shokaku/generated/source.blend --python-exit-code 1 --python assets/ships/shokaku/authoring/review_rudders.py
/Applications/Blender.app/Contents/MacOS/Blender -b assets/ships/shokaku/generated/source.blend --python-exit-code 1 --python assets/ships/shokaku/authoring/review_attachments.py
/Applications/Blender.app/Contents/MacOS/Blender -b assets/ships/shokaku/generated/source.blend --python-exit-code 1 --python assets/ships/shokaku/authoring/review_mechanisms.py
/Applications/Blender.app/Contents/MacOS/Blender -b assets/ships/shokaku/generated/source.blend --python-exit-code 1 --python assets/ships/shokaku/authoring/review_geometry.py
/Applications/Blender.app/Contents/MacOS/Blender -b assets/ships/shokaku/generated/source.blend --python-exit-code 1 --python assets/ships/shokaku/authoring/review_closeups.py
python3 assets/ships/shokaku/authoring/review_reference_overlay.py
```

Read the scripts' stated contact tolerance, intended-bearing exclusions, discrete sampling and conservative neighbor-bound methods. Inspect the generated images, hidden support interfaces and intermediate poses. Numeric checks alone are not historical or visual acceptance. Keep registration anchors and unresolved source questions from the [current review](../reports/acceptance.md); remake overlays if geometry changes. In the rendered profile overlay, only the profile region is comparative evidence; the lower render-frame edge crosses the source's plan region.

The window regression examines actual bridge-glass interiors against every opaque island triangle. It fails against the retained `reports/correction-02/before/source.blend` (54 coplanar panes), and must pass against the rebuilt source. Existing ship-boat glazing is a separate component outside this bridge regression. The reference overlay uses a single isotropic S02 registration, distinguishes floor plates from bulwark tops, and records all four island floor landmarks. S02 is a modern secondary plan; S10 supplies dated photographic corroboration. Neither is imported into production geometry.

The deck regression examines upward horizontal triangles at all four island walking elevations, including the adjacent flight-deck seam. It fails on positive-area overlaps within 1 mm coplanarity or missing deck surfaces. Shared edges and opposite-facing hidden bearing contacts are allowed. It checks actual meshes in both source and GLB; the game export must carry the current definition hash. Hidden hangar ceilings, flight-deck markings and fittings at other heights are outside this regression's scope. This is an explicit Blender review command, separate from `bun run test`.

The retained deck baseline has five overlapping surface pairs. Reproduce its expected failure (exit 1) without overwriting current evidence:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b assets/ships/shokaku/reports/correction-03/before/source.blend --python-exit-code 1 --python assets/ships/shokaku/authoring/review_decks.py -- --out /tmp/shokaku-decks-before.json
```

`--out` permits an archived source hash; its four floor elevations and structure IDs must match the current definition. See the [deck correction record](../reports/correction-03/README.md) for the matched before/after evidence.

The tandem rudder check samples each retained yaw joint from -35 to +35 degrees in 5-degree increments against the fixed exterior, excluding intended stock interfaces, and tests all 225 independent neighbor combinations. Normal surface-carrier steering currently leaves these retained rudder joints static; manual source/export pose review does not imply a shipped rudder animation. Their rounded profile landmarks come from S02, with the tip translated to the nominal 8.87 m draft and the concealed crown fitted to the authored hull clearance envelope. Fin thickness and hidden afterbody offsets remain estimates.

## Actual game review

Start the development server and open `/?ship=shokaku`. Evaluate `runtime_review.js` in that page with Orca's browser evaluation command or a dedicated review browser. The harness captures the existing development `Game` diagnostics instance and restores its temporary prototype wrapper. Reloading removes it; no production hook is added.

While in port, these methods return serializable evidence:

```js
await window.shokakuReview.gridSweep();
await window.shokakuReview.independentPoses();
window.shokakuReview.neighborBounds();
```

The grid renders 627 frames, covering each mount's full 10-degree grid, exact endpoints and zero/half/full recoil. Different phase offsets give neighbors independent poses. Save results with the returned full hash in a new report folder. `runtime/closeups.js` captures the actual loaded GLB near all four gun variants with all surrounding ship geometry present. Its camera override is review-only, closer than the normal port zoom limit, and restored afterward. Returned image data URLs should be decoded to PNG files, not pasted into a text report.

`runtime/fidelity.js` captures matched forward/aft island and quarter/center stern cameras for the window/shape correction. Save decoded images and camera metadata under the returned hash; the before cameras are retained in `reports/correction-02/before/`. Keep Vite file watching disabled during long review fixtures, so writing report files cannot reload the game mid-sweep. Restart that preview after rebuilding a model, then reload the game and harness to avoid mixing a cached definition with a new GLB.

`runtime/decks.js` adds forward-high, aft-high and overhead views of every island walking level, with all ship geometry present. These views caught roof/deck overlaps missed by the lower window cameras. Decode the returned images and retain the camera coordinates as `decks-cameras.json` under the returned model hash. Inspect these views after changing a room cap, deck footprint or gallery junction, in addition to the five fixed views.

In port, `runtime/rudders.js` manually renders all 225 independent pairs of the retained tandem-rudder joints and returns three representative images. `runtime/inspection.js` uses the normal port tabs and volume buttons to inspect the revised conning-room hit surface, aviation service and a boiler compartment. Save their returned metadata and decoded images under the current hash. Both fixtures restore their temporary view/selection overrides.

For the gameplay fixtures, first use normal **Custom battle** UI to select Shōkaku, an allied Enterprise and an enemy Bismarck at 5 km. Start the battle, then evaluate these files sequentially:

| Script | Scope |
| --- | --- |
| `runtime/launch.js` | Creates the review helper and captures emitted events. Uses existing passive target behavior; launches six aircraft from each Japanese role. Requires the mixed fleet so all six models/three LODs load. |
| `runtime/recovery.js` | Resets the fixture, launches the three roles, recalls and advances bounded CPU steps until 18 aircraft recover and all 72 are ready. |
| `runtime/strike.js` | Relaunches Val/Kate flights and records real emitted projectile definitions at bomb/torpedo release; opens air operations. |
| `runtime/surface-fire.js` | Resets, places the player broadside and uses normal HE selection/fire queue. |
| `runtime/anti-aircraft.js` | Prepares Shōkaku versus a passive Enterprise. Six enemy aircraft are held in a stated airborne volume with elevated fixture HP; each gun group is left unselected for automatic AA. |
| `runtime/damage.js` | Resets and seeds real swept AP shells plus one armed torpedo outside the hull. Torpedo depth is overridden to reach the review boiler station; damage/flood state is never assigned directly. Returns `result: pass` only after hull, module and flood damage. |
| `runtime/reset.js` | Uses the normal pause-menu Return to port button, then asserts restored integrity/modules/air wing and no water. |

These are development review fixtures, not production APIs or historical firing scenarios. A live battle can end in victory before a recovery check completes; the common battle host then stops simulation. The retained [recovery record](../reports/runtime-2d438635/recovery.json) uses passive targets to finish the full launch/recovery cycle.

If Orca's background page closes during long checks, the retained `runtime/cdp.mjs` can evaluate scripts and save JSON/screenshots in a separately launched local Chrome review browser. It uses Bun's built-in WebSocket and Chrome's local debugging protocol; no automation package is required. `SHOKAKU_REVIEW_PORT` overrides port 52324. Use a separate temporary profile and loopback-only debugging listener, never a normal browsing profile:

```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --headless=new --remote-debugging-port=52324 --remote-debugging-address=127.0.0.1 --user-data-dir=/tmp/shokaku-chrome-review --no-first-run --no-default-browser-check --enable-unsafe-webgpu --window-size=1440,960 about:blank
bun assets/ships/shokaku/authoring/runtime/cdp.mjs goto 'http://127.0.0.1:52323/?ship=shokaku'
bun assets/ships/shokaku/authoring/runtime/cdp.mjs file assets/ships/shokaku/authoring/runtime_review.js /tmp/shokaku-ready.json
bun assets/ships/shokaku/authoring/runtime/cdp.mjs eval 'await window.shokakuReview.gridSweep()' /tmp/shokaku-grid.json
bun assets/ships/shokaku/authoring/runtime/cdp.mjs screenshot /tmp/shokaku-port.png
```

Use the actual development-server port in the URL; 52323 was used for the recorded review. Keep long operations yielding so tool output and status remain observable. Stop only the isolated review browser when finished.

After durable model changes, rebuild and repeat the affected source and exported-game checks. Run relevant simulation tests and `bun run build`; compiler/shared-input changes also require `ship:check all` and rebuilding stale outputs. Preserve prior evidence under its original hash.

Retain one current visual review set, the regression baselines and unique gameplay evidence. The five fixed views live in `generated/review/`, with their exact hash in `cameras.json`; do not duplicate them under reports. Keep the current blueprint and compiled definition at their canonical paths instead of copying them into review folders. Historical gameplay reports retain their original hashes, aggregate repeated events and disclose which representative samples remain. Superseded exploratory reports are available in Git history.
