# U-570 fidelity validation · 6 September 2026

Current export: `0cdcb80b8790f728b709cd73c96abb53655305d5c03259983b1f0b91594ffe63`.

- `ship:compile`, `ship:build`, `ship:review`, `ship:compare` and the production build's `ship:check`: passed. Local Blender used; no Blender MCP tools available.
- `bun test --timeout 60000`: **428 passed, 0 failed**, 54 files, 167,136 expectations (129.42 seconds).
- `bun run build`: **passed**, including all fleet/aircraft checks, TypeScript and Vite. Existing large-chunk advisory remains; no build error.
- Actual exported hull: 47,594 triangles, zero degenerate triangles, zero nonmanifold edges. Four primary dimensional targets, fourteen exported landmarks, six compound spaces and four structural probes pass. Full model: 80,300 triangles, 41 meshes, 2,391,124 bytes.
- Twelve matched source/original/current views and five standard views inspected. In-game port, gun traverse/elevation/recoil, all eight submarine joints, torpedo launch, deck-gun fire, 50 m dive, 7 m recovery and battle reset inspected.
- UI launch reduced torpedoes 14→13; deck-gun fire reduced main ammunition 220→219. The actual simulation reached 49.99988 m depth at 3.90977 m/s and returned to 7.0000015 m, with camera Y≈2.849499 m. Reset restored 220/1100 shells, 14 torpedoes and a zero-depth order.
- Real WebGPU water visibility checks at 7/50/150 m passed: about 12.36% of frame pixels clearly distinguish the hull, against a 2% minimum. Surface and periscope absorption coefficients restored. Pinned visibility fixtures and the deliberately seeded stern articulation pose are labelled separately from UI battle records.
- Portable review ZIP integrity passed (102 entries, about 50 MiB). Browser review: twelve views, historical overlay selectable, runtime gallery present, no broken loaded images or horizontal overflow. Port exposes the `Reference review` link.

Evidence: [fidelity report](fidelity-01/README.md), [measurements](measurements.json), [runtime records](fidelity-01/runtime/review.json), [source register](../references/sources.json), [remaining discrepancies](discrepancies.md). Principal dimensions and dated fitting choices have primary evidence; export/test success does not certify complete historical accuracy.

---

The following is the preserved earlier feature validation, before the fidelity pass:

# Type VIIC validation · 2026-09-05

Playable generic 1941 Type VIIC for **surface combat**. Diving, sonar and depth charges are outside this update. Export and gameplay checks do not certify historical accuracy; see the [discrepancy register](discrepancies.md) and [retained references](../references/sources.json).

## Asset pipeline

Authored through `ship:new`, `ship:compile`, `ship:build`, `ship:check` and `ship:review`. No Blender MCP tools were available in this session; scripted authoring, export, thumbnails and fixed review renders used local Blender. Durable geometry is in the original [recipe](../build.py) and [blueprint](../blueprint.json), with weapons in the shared component catalog.

Content hash: `790540939d476bf9503c191fbfd6d29a3f027941ebf4a4a9011a2f1c5885605b`.

- GLB: 23,486 triangles, 32 meshes, 55 primitives, 1,477,376 bytes.
- Hull bounds: 67.1 m overall length, 6.2 m beam, keel −4.74 m and casing top +2 m.
- Both independent gun assemblies passed three train/elevation/recoil checks each.
- All five fixed tube sockets passed position and direction checks; maximum position error below 0.000003 m.
- Stable gun joints, tube muzzle IDs and independent static screw, rudder and hydroplane pivot empties retained.
- Bismarck, Yamato, Baltimore and Enterprise were rebuilt for the shared compiler/catalog extension. Bismarck's preserved baseline was not modified.

See [machine export report](export.json). Visually inspected all five fixed renders: [profile](../generated/review/profile.png), [plan](../generated/review/plan.png), [bow](../generated/review/bow.png), [stern](../generated/review/stern.png), [quarter](../generated/review/quarter.png). These show the original casing, saddle shoulders, early tower, open platforms, separate guns and underwater fittings; contour and equipment-detail approximations remain registered.

## Automated validation

`bun test --timeout 15000`: **257 passed, 0 failed**, across 36 files, 31,852 assertions. The full-suite timeout allows the existing long-running bot-battle test to complete under combined test load.

`bun run typecheck` and `bun run build`: **passed**. Build includes all five ship checks, aircraft checks, TypeScript and the Vite production bundle. Vite reports a game bundle over its 7 MB warning threshold; this is a warning, not a failed check. [Command results](checks.txt).

Torpedo tests cover schema errors, per-tube ammunition/reload and launch spacing, bow/stern arcs, malformed aim, arming and duds, fixed speed/depth/course and range expiration, swept contact against every registered hull, first contact with allies/wrecks, contact damage and local flooding, hostile-only scoring, delayed sinking/one frag, reset, moving-target lead, bot friendly-lane checks, bot firing and deterministic results at different display rates. The deck and platform guns remain independently operable through shared gun logic. Camera regressions cover hull switches during real model loading, preserved orbit, full-hull framing and ship visibility above the instruments.

## In-game inspection

Verified in the actual game using Orca's embedded browser and the WebGPU renderer at `http://127.0.0.1:5197/?ship=type-viic`.

- Port Exterior, Armor and Internals load. Hull plating, tower, guns, six compartments and six modules remain inspectable; selecting Twin diesel engines resolves `module:diesels`.
- Both guns were previewed at positive and negative train/elevation limits and with recoil. Maximum CPU-to-renderer muzzle mismatch was below 0.000002 m. [High pose](in-game-articulation-high.png), [low pose](in-game-articulation-low.png); matching JSON diagnostics retained alongside them. Port simulation remained at tick zero.
- VIIC versus VIIC at 1 km: one player launch consumed one round (14 → 13); enemy bots launched their four bow tubes. Running torpedoes appeared with visible wakes. Enemy impacts caused a forward-room breach, flooding and sinking. The player's torpedo hit the enemy for 340 HP; the target showed 24% structure and 60.4 m³ flooding in Gunnery. [Combat diagnostics and visible UI text](in-game-combat.json).
- VIIC versus Bismarck at 5 km: selected torpedoes and launched through the live Fire button. [Final chase view and running torpedo](in-game-launch-final.png), [matching diagnostics and control bounds](in-game-launch-final.json).
- Switching from VIIC to Bismarck in port and inspecting the larger enemy both preserve readable full-hull framing: [port switch](in-game-port-switch.png), [target internals](in-game-inspect-bismarck.png).
- Pause froze the CPU tick and effect state ([record](in-game-pause.json)). Returning to port restored 14 torpedoes and full integrity, with no projectiles/events and tick zero ([record](in-game-reset.json)).

## Interface finish review

The controls retain the existing naval instrument styling. Desktop at 1137 × 906: [actual HUD capture](ui-desktop.png). Phone at 390 × 844: [expanded Gunnery capture](ui-mobile.png), [DOM/control measurements](ui-mobile.json). Phone weapon buttons measure 45.5 × 58 CSS pixels, with no horizontal content overflow.

The regular screenshot command timed out because no Orca app window was visible. Full-page browser capture succeeded for the desktop HUD and expanded phone Gunnery. The subsequent unobscured phone-HUD capture timed out and remains unverified; no synthetic UI composite was used.

Independent finish-review disposition: **ship**.

| Finding | Status | Evidence |
| --- | --- | --- |
| Chase framing | Resolved | Desktop recapture shows the complete VIIC above the armament, with the sight clear. |
| Ship and inspection framing | Resolved | Port-switch and inspection recaptures show the complete Bismarck at readable scale. |
| Documentation | Resolved | PRODUCT.md and DESIGN.md describe surface operation, torpedoes, key 3 and the conditional sixth slot. |

No open material findings within the reviewed fixes. Mobile capture verifies expanded Gunnery; unobscured mobile HUD remains unverified.

## Master integration

Integrated `origin/master` at `02008e4` before merging this feature. Preserved the new Statistics tab, inspection hover behavior, bounded impact-mark work, seeded bot crew model and first-strike shell-follow hold. The torpedo rows now live in the shared Statistics adapter, grouped by component. Submarine bots obey target-acquisition delays and delayed observations; evasive turns take precedence over bringing tubes to bear. Gun crews retain their own errors and firing cadence.

The combined version passes **282 tests across 39 files**, 33,070 assertions, with `bun test --timeout 15000`; `bun run typecheck` and `bun run build` also pass. No asset recipe, compiler, blueprint or catalog changed during integration, so the previously built model/hash and articulation checks remain applicable.

The actual port Statistics panel was opened in-game and showed five tubes, fourteen rounds, 533 mm diameter, 44 kn speed, 5 km range and 300 m arming distance at simulation tick zero. See [visible panel text](ui-port-statistics.json). Capturing this integrated panel timed out; no new screenshot is recorded.

## Damage-realism integration, 2026-09-05

The earlier combat screenshots above record the original hull-HP implementation. The combined version uses local module damage, positional flood openings, finite damage-control crews and permanent weapon loss. Torpedo hits cannot sink a hull by subtracting abstract HP or automatically detonate a magazine when its module reaches zero. Flooded supply spaces disable tubes until drained; loaded tubes preserve fighting strength after the deck guns are lost. Six module immersion cutoffs use the fleet's provisional 0.3 m estimate. The submarine retains its six-room waterplane/reserve-buoyancy approximation pending an authored stability profile.

Rebuilt the model through `ship:build`, inspected its five fixed views, and verified mounted articulation at both traverse limits, full elevation and recoil. The maximum muzzle mismatch was 0.002 mm. Scene transforms, hierarchy, mesh and texture bytes match the original model; the definition hash changed for the compiler and module metadata. The final five-ship build passes. Torpedo coverage passes 24 tests, and all 373 combined test cases are verified; see the [integration report](../../../reviews/damage-realism/master-integration.md) for run details and evidence.
