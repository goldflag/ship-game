# Convoy validation — plan-led revision 2

Reviewed 6 September 2026. Active designs: EC2-S-C1 Liberty Cargo, EC2-S-AW1 Liberty Collier, VC2-S-AP2 Victory Cargo and Cobalt-1941 Flower Corvette. Victory is a separate class. Deck-cargo/troopship originals remain archived; they are no longer active or shipped in the public download.

The following is the original pre-merge review. See [merge integration validation](merge-validation.md) for the subsequent rebuild against the newer fleet pipeline, current hashes, exact geometry-continuity evidence and updated test results. Earlier browser captures retain their original hashes; they are not relabeled as new runs.

## Model and schematic review

All four shared-pipeline `ship:build` and `ship:check` operations passed using **local Blender 5.2**. No Blender MCP tools were exposed to the agent. The saved original recipes, blueprints, joint/socket hierarchy and coordinate conversion remain authoritative. No Bismarck baseline or renderer-free simulation implementation was changed.

| Model | Triangles | GLB bytes | Mounts / barrels |
| --- | ---: | ---: | ---: |
| Liberty Cargo | 95,100 | 4,059,692 | 10 / 10 |
| Liberty Collier | 78,560 | 3,453,624 | 8 / 8 |
| Victory Cargo | 105,512 | 4,510,152 | 10 / 10 |
| Flower Corvette | 60,688 | 2,575,744 | 4 / 6 |

Reviewed pre-merge definition/recipe hashes:

```text
liberty-cargo    dc7cf7f609078887adae273a39e5470c91fd27f21742ebae1d4c188ed66d1794
liberty-collier  ca51cb169b28c21bf9e39cd06a1c149059c19e0f7b6a3f2d0b5c9fbb5c5d8603
victory-cargo    eaeb95e8778bee7f7f6cabc01822f88535c952399b647d4e3387d7c57fdb5ace
flower-corvette 5ef519792d7b8082a951e7a1503750031eb510a7e9b2045f48fa429e0c8ff69d
```

Five fixed review views per ship were rendered and inspected: profile, plan, bow, stern and quarter. [Merchant profile comparison](merchant-profiles.png) shows genuinely different unladen structural arrangements. Each ship also has a contact sheet under `generated/review/`.

Actual retained schematics were inspected: Cobalt's Port Arthur GA dated 19-Nov-1941, Thomas Sully's 1941 USMC/Gibbs & Cox profile and 1943 midship section, and Winthrop Victory HAER sheets 2, 3 and 6. [Reference register](../references/plans/README.md) distinguishes original drawings from later interpretations. Collier evidence includes ABS's class history and a dated Delta launch photograph, but no complete original collier GA was obtained.

[Same-scale profile comparisons](plan-comparisons/registration.json) include original scan, independent source render and cyan silhouette overlay: [Flower](plan-comparisons/flower-corvette-profile.png), [Liberty](plan-comparisons/liberty-cargo-profile.png), [Victory](plan-comparisons/victory-cargo-profile.png). Each uses one uniform camera-derived scale and LOA/waterline translation, not silhouette fitting or nonuniform stretching. Rendered alpha prevents color-keying from creating false hull holes. Scan folds/skew remain visible.

Review corrections included the Flower's stern-aperture clearance and shaped rudder, removal of ring-index exchange creases from the hull loft, flush side scuttles, open dinghies, and bilge keels. The collier received steel-colored lids clear of the detached bridge. Victory's missing upper accommodation level, taller funnel, higher forecastle, separated aft AA platforms and additional house derricks were corrected against the HAER profile.

## Passed automated checks

- `bun test src/game/ShipView.test.ts src/simulation/convoy.test.ts`: **37 passed, 0 failed; 12,894 assertions**, 5.01 seconds.
- Coverage includes all flood-cell/module corners inside the shared hull; displacement/restoring stability; both batteries training, firing, reloading and resetting; machinery loss, flooding/sinking and six-direction hits; eight-ship mixed combat; collier machinery/hatch placement; and clear Flower propeller aperture.
- Actual exported GLB node hierarchies passed full train/elevation/recoil matrices under translated, rotated and heeled ship poses. All six Flower muzzle sockets are checked, not just its four mounts.
- `bun run build`: **passed**, including all nine ship checks, thirteen aircraft checks, TypeScript and Vite production output.
- Existing large application-bundle warning remains (main game chunk about 9.13 MB); this is not a performance or historical-accuracy certification.

## In-game evidence

The short real-WebGPU matrix checks frozen port state, both articulation limits, Armor/Internals, engine/turbine isolation, clear selection and restored exterior view. One current-geometry run printed successful port/inspection/articulation assertions for **all four** ships, but its final result upload failed during the host sleep cycle. A second run streamed captures individually: **15 current images** for Flower, Liberty Cargo and Liberty Collier were retained in `browser-port/` before another wall-clock timeout prevented completion of Victory's capture set. These include inspected live exterior and elevated-gun views; the incomplete status is explicit in [partial-run.json](browser-port/partial-run.json). No completed current browser report is claimed.

The earlier complete five-battle WebGPU run (four individual ships plus eight-actor mixed fleet) passed movement, steering, firing, impact rendering and clean return/reset before the last model refinements. Its 25 captures and matching hashes are preserved in `browser-v2-intermediate/`; it is **not** represented as current-final-geometry battle evidence. Original revision-1 evidence remains in `browser-v1/`.

## Environment limitation

Clean full-suite and final full-battle reruns were interrupted by host sleep, not relaxed test assertions. The latest full suite recorded **404 passes and two wall-clock timeouts** (Bismarck transverse-armor containment and bow/stern penetrations). Those timed tests reported roughly 930–1,014 seconds; the system power log records repeated **Dark Wake Thermal Emergency** sleep cycles, including a 933-second sleep at 03:37:36 PDT. Earlier repeated runs timed out at different existing tests. The full WebGPU battle matrix likewise exceeded its wall-clock deadline.

No sleep/thermal protection, user application or unrelated agent process was disabled. A clean all-406-test result and current-final-geometry full browser battle result are **not claimed**. Re-run them once the host can remain awake normally; no timing limits were loosened.

## Accuracy limits

Successful exports only validate the implementation contract. Flower transverse offsets, funnel rake, fine fittings and paint remain reconstructed; its 1,170,000 kg operating mass is not a certified Cobalt displacement/draft pair. The dated Flower weapon inventory and exact collier 1945 armament are unresolved. Collier original body/GA evidence is incomplete. Victory/Liberty fine end sections, rigging and detailed houses remain simplified. Every ship's discrepancy register retains these limits.

Watertight spaces, permeability, pumps, CG/GM, gun performance and damage are gameplay approximations. The Flower's depth charges/minesweeping equipment and merchant cargo gear are visual only; no new ASW or cargo mission system is implied.
