# Fleet fidelity 01 · original authoring record

Targets: Yamato (7 April 1945 exterior / trial datum), Baltimore (October 1943 / limiting keel draft), Enterprise CV-6 (June 1942 / pre-bulge reference datum). The assigned workspace began at master `8e0be03`; Bismarck's baseline and other worktrees were not changed.

`author.py` is the versioned, deterministic migration from each preserved `reports/fidelity-01/before/blueprint.json`. It records original lofts, substantive structure surfaces, protection, compartment arrangement and gunhouse facets in the blueprint/catalog. It is an explicit authoring tool, not a hidden build dependency. It does not read game geometry or textures. Re-running it intentionally replaces the three blueprints from the preserved inputs; edit this authoring record or the current blueprint deliberately, not both independently.

After changing this migration:

```sh
python3 assets/ships/fleet-fidelity/author.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python assets/ships/fleet-fidelity/deck_surface.py
bun run ship:compile yamato
bun run ship:compile baltimore
bun run ship:compile enterprise-cv6
```

`deck_surface.py` replays the original CV-6 slab/opening/camber construction into versioned blueprint triangles. It reads no generated model. The older CV-6 offsets generator remains a preserved initial transcription workflow; do not run it over a fidelity blueprint without reapplying this migration and the deck-surface authoring step.

Production builds use each ship's `build.py` and the shared `scripts/ships/blender_fidelity.py` helpers. All significant loft/deckhouse surfaces derive from blueprint data; small fittings are original procedural geometry. Independent yaw/elevation/recoil/socket and elevator IDs are preserved. Runtime axes are +X starboard, +Y up, -Z bow; Blender axes are +X bow, +Y port, +Z up, with runtime = (-BlenderY, BlenderZ, -BlenderX).

Use `ship:build`, `ship:check`, `ship:review`, `ship:compare` and `ship:independence` for each target. Shared `scripts/ships` changes invalidate all four presets, including Bismarck. Local Blender 5.2.0 LTS was used; no callable Blender MCP was available. Generated `.blend`, GLB and rendered views are outputs. Original sources, reference art and prior measurements remain under assets.

The historical-before-after review mode uses twelve identical original cameras, primary/qualified historical evidence, actual exported triangle measurements and CPU protection probes. Restricted scans stay local. Enterprise's discontinuous contract sheets are not mislabeled as a registered Midway plan. Review ZIPs include original inputs and all page dependencies, excluding rebuildable Blender scenes and restricted references.

Known limits are in each discrepancy register. Nominal plating, many armor boundaries, exact fitting locations, internal subdivision and flooding capacities remain approximations. Export checks and triangle counts do not certify historical fidelity.

## Completed review · 5 September 2026 (Pacific)

The three presets now have vessel-specific hull/structure collision surfaces, documented provisional protection and substantially revised original equipment. Yamato gains the recurved stem/bulb, faceted gunhouses and more articulated tower/funnel/AA geometry; Baltimore retains its measured cruiser lines and bridge polygons while gaining distinctive gunhouses and service/aircraft-handling detail; Enterprise gains shared cambered deck/elevator surfaces, open hangar portals and supported galleries, island and end-deck fittings. This is an implemented fidelity upgrade, not a claim that every historical discrepancy is closed.

| Ship / review record | Content hash | Triangles | Mesh nodes | GLB bytes | Mounts / barrels |
| --- | --- | ---: | ---: | ---: | ---: |
| [Yamato](../yamato/reports/fidelity-01/README.md) | `e386fddd3669bac5b108603829564e96773463d4255fd37bac444015edf8db0a` | 264,906 | 110 | 11,623,044 | 5 / 15 |
| [Baltimore](../baltimore/reports/fidelity-01/README.md) | `0079ff92853af02a9f22fae2001babdc8a4d65940d79fe4eae9beb946b006887` | 260,522 | 126 | 8,587,524 | 9 / 21 |
| [Enterprise CV-6](../enterprise-cv6/reports/fidelity-01/README.md) | `e968df81e5fbf119177548826b2dc4377f4a8e6ef3611b75984dadbe0d89e52d` | 206,818 | 222 | 7,512,012 | 42 / 54 |
| [Bismarck shared rebuild](../bismarck/reports/validation.md) | `ef5c6fefab2763a1ee2669c7a46c8afcc9f3df4bf625d8dcb47bc68b5f086068` | 364,170 | 96 | 21,566,248 | 10 / 20 |

All four were compiled, rebuilt and reviewed through the shared pipeline. The three upgraded ships also passed complete `ship:independence` builds with the raw game cache unavailable (already absent, so no cache move was necessary). Per-vessel dimensional audits and the Yamato component audit pass. The three decoded hull meshes are watertight with zero degenerate/nonmanifold faces/edges; all 27 / 10 / 8 room envelopes fit their respective hulls. Bismarck's blueprint, original recipe and preserved baseline were not changed; its refreshed hash reflects shared build inputs.

`bun test --timeout 20000` passed **247 tests, 0 failures, 30,803 assertions across 36 files**. `bun run build` passed all ship/aircraft freshness checks, TypeScript and Vite; the existing large-bundle advisory remains. The new fleet structural tests cover posed hull-end and bridge hits, AP exits, dry high hits, empty air, waterline traversal, sea breaches/flooding, sight/inspection agreement, effective armor replacement, Baltimore's broad transom, Yamato's bulb air gap and ammunition/machinery arrangement, Enterprise's open hangars/elevator surfaces and mixed-definition world-space impact normals. Existing opening-salvo damage-budget tests retain their explicit pre-pass fixture; current Yamato separately survives the 1 km / 5 km opening salvos without fictitious flooding from above-water strikes.

Five fixed material views for every ship and twelve neutral before/after views per target were inspected. `contact_sheets.py` assembles these unchanged renders for readable reporting. Local portable reviews are at `/ship-reference/<ship-id>/index.html`. Use Reference review on the corresponding port card. Explicit filenames avoid Vite's directory-URL SPA fallback; an HTTP regression verifies that every port link serves evidence, not the game. Original source registers and restricted scans remain in assets; only explicitly redistributable evidence enters the packs.

## Live-game method and limits

Orca's embedded browser loaded the exact hashes above using WebGPU. `runtime-review.js` is an explicit development-console helper, not production code. Ship selection, custom-battle launch, battery selection/fire, inspection and return-to-port used actual UI controls. The helper exercised twelve combinations of train (-1/0/+1), elevation (minimum/maximum) and recoil (rest/full), then restored neutral pose. Maximum CPU/rendered muzzle errors were 2.747 mm (Yamato), 1.317 mm (Baltimore), 0.0324 mm (Enterprise) and 2.167 mm (Bismarck), all below the existing 25 mm tolerance.

Each target launched as player against a mixed Yamato/Baltimore/Enterprise fleet at 1 km, fired both batteries, exposed armor hover and internal selection, and returned to port with tick 0, Exterior mode and no floodwater. Ammo changes were Yamato main 900→891 / secondary 900→894; Baltimore 1350→1344 / 4320→4312; Enterprise 2880→2876 / 66800→66788. Only aligned, clear mounts fired; the counts are not claims that every mount can bear on one target. Enterprise's starboard-island bridge camera was also inspected.

Separate, deliberately seeded 203.2 mm shell trajectories tested each enemy definition in the live game, through the ordinary CPU collision/damage/effects path. Bow, stern and bridge entries/exits reduced integrity while remaining dry; high empty-air shots missed. Valid descending entries crossed the flat gameplay waterline **inside** the hull and produced damage and positive floodwater on all three ships. Shots initialized outside the hull already underwater were discarded before contact; those retained negative controls are not flooding passes. Exact events, coordinates, water quantities, hashes and captures are in the per-ship runtime records (the mixed-hit series is under Yamato).

The helper deliberately immobilized enemy controllers and posed the player broadside after UI launch. The first Yamato run accidentally selected astern after zeroing its speed; the logged movement is retained, and later runs use STOP. No hull integrity, module health or floodwater was edited to create results. Runtime photographs with `-canvas` suffix are direct WebGPU canvas captures, excluding the HTML HUD; Yamato's other PNGs include the UI. No retouching or model substitution was used. Background-tab/desktop capture interruptions required the canvas fallback.

Observed frame readings varied roughly 20–54 in port and 10–33 with four actors under changing desktop load, tab occlusion and effects. Controls, loading, inspection, firing and reset remained functional, but this is **not a controlled performance benchmark or large-fleet certification**. All models pass the existing size/triangle guardrails; maximum-size fleets and slower hardware remain unverified. Flight operations, new UI design and unrelated master features were outside this pass.
