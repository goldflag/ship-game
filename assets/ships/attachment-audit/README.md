# Fleet attachment repair

Scope: inspect and repair floating equipment on the ten ships registered at the
start of this pass, including
AA mounts, their platforms, radar/director equipment, deck fittings, boats and
underwater appendages. Reconcile changed fittings with each preset's dated fit.
The repair and review pass is complete for those ten presets. Historical
reconstruction limits remain documented below and in each discrepancy register.

The initial source was commit `b020bbf`, with a clean worktree. No Blender MCP tools
were exposed. Inspection and builds use local Blender 5.2.0 LTS. Bismarck's
preserved baseline is untouched. Original geometry and the existing versioned
blueprints remain the authoring sources; generated models are rebuild outputs.

## Reproduction

`scan.py` scans original object bounding boxes. It found detached clusters on all
ten registered presets. This is a candidate finder, not a contact certificate:
the hull's box can contain an AA gun that is above the actual deck.

`contact_scan.py` instead uses evaluated world-space meshes, triangle intersection,
closed-solid containment and vertex/surface proximity at 25 mm. It retains source
and definition hashes. Objects are graph nodes, so internally disconnected meshes, free support ends
and equipment buried in a deck still require visual review. Coatings, clearances and mechanically interlinked chains
also require interpretation; an isolated cluster is not automatically a defect.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python-exit-code 1 --python assets/ships/attachment-audit/contact_scan.py \
  -- after bismarck yamato baltimore enterprise-cv6 type-viic \
  liberty-cargo liberty-collier victory-cargo flower-corvette fletcher
```

Initial exact-contact candidates are under `reports/before/*-contact.json`:
Bismarck 436, Yamato 280, Baltimore 153, Enterprise 533, Type VIIC 63,
Liberty Cargo 63, Liberty Collier 42, Victory Cargo 58, Flower 37 and Fletcher 219.
These include small paint/detail offsets and do not count unique confirmed bugs.

## Confirmed shared causes

- Open-gun pedestals, cheek plates, barrels and seats lacked the intervening
  carriage/slide/support geometry. Every one of the ten open catalog components
  failed physical connectivity at all tested poses before the repair.
- Enclosed gun bearing rings used a constant offset from yaw instead of the
  catalog gunhouse floor. This left a gap between barbette and gunhouse on
  non-default datums, including Yamato, Baltimore and Fletcher.
- Shared turret roof handholds lacked feet and used a flat maximum-height datum
  over sloping roofs. They now follow the actual original gunhouse triangles.
- Boat cradle crosspieces did not reach the curved hull. Chocks now bear against
  the hull; thwarts/oars have their own physical support.

`check_open_mounts.py` calls the real shared original gun recipe for every open
catalog component and checks physical connectivity from foundation through all
meshes, at minimum/zero/maximum elevation with rest/full recoil. The retained
before result fails; the original repaired result passes all 60 cases. The
carrier-combat integration adds three catalog parts; all 78 current cases pass. This supplements
the existing exported GLB pivot/muzzle checks, without replacing in-game review.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python-exit-code 1 --python assets/ships/attachment-audit/check_open_mounts.py
```

## Historical basis and limits

- [US Navy OP 909, March 1943, pp. 18–22](https://www.maritime.org/doc/gun20mount/part2.php):
  the Mark 2/4 single 20 mm mount has a bolted pedestal, column, trunnion bracket,
  cradle and shoulder-rest control. The generic pair of seats was inappropriate
  for this mount. Our recreated geometry preserves the existing catalog datums;
  it is not a dimensionally complete factory reconstruction. The online edition
  also includes later changes, which do not establish a June 1942 modification.
- [US Navy OP 911](https://www.maritime.org/doc/gun20mm/index.php) describes the
  separate gun, cradle/carriage and stand. It corroborates the load path, not the
  fitted variant or exact positions aboard every vessel.
- Yamato: the retained Kure Museum `museum-searchlights.jpg` shows the lower
  forward light, raised after light tubs and tapered supports; the preserved
  Alexpl 7 April 1945 plan/profile provides qualified placement context. These
  are museum/secondary reconstructions. New foundation heights follow our
  existing deck surfaces; exact support fabrication remains interpreted.
- Baltimore: retained Navy 1943 profiles and bridge plan establish the director
  and AA stations. The Mk 8 array needs a roof support; a floating array is not a
  historical configuration. Pedestal/web dimensions remain reconstructed.
- Enterprise: retain the June 1942 pre-Bofors inventory. The aft Oerlikons now
  follow the narrower authored aft galleries, and their bases meet gallery deck
  level. The existing source register distinguishes contract drawings, 1942
  photographs and class evidence. No later-refit weapons are added here.
- Bismarck, Type VIIC, Fletcher and the convoy presets retain their existing
  dated source registers. Mechanical supports correct demonstrable gaps; their
  presence alone does not validate every original placement or dimension.

The manual text was accessible through web retrieval on 6 September 2026;
direct archival image downloads returned HTTP 403. No missing figure is claimed
to have been inspected. Existing locally retained reference photographs/plans
were used where available. No competitor geometry or textures enter the builds.

## Model verification

Every ship in the initial ten-preset roster has been rebuilt from the repaired original recipes and
reviewed in profile, plan, bow, stern and quarter views. The final contact reports
match both the published definition hash and the original Blender file SHA-256.

| Preset | Initial candidate islands | Final candidate islands |
| --- | ---: | ---: |
| Bismarck | 436 | 0 |
| Yamato | 280 | 59* |
| Baltimore | 153 | 0 |
| Enterprise | 533 | 0 |
| Type VIIC | 63 | 0 |
| Liberty Cargo | 63 | 0 |
| Liberty Collier | 42 | 0 |
| Victory Cargo | 58 | 0 |
| Flower Corvette | 37 | 0 |
| Fletcher | 219 | 0 |

*Yamato: 46 mechanically interlinked chain clusters (1,104 separate link/detail
objects), ten operations-room scuttle coatings and three conning-tower vision
slits. These are retained surface/clearance details, not unsupported equipment.
The scanner deliberately does not join a chain just because its bounding boxes
overlap. The retained close-ups and fixed views provide the necessary context.

All existing exported node IDs are retained, including independent yaw,
elevation, recoil, propeller and rudder pivots. Baltimore's static funnel surface
IDs are explicitly retained by authoring the identified shells before their
foundation geometry. Bismarck's baseline has no changes.

The original aircraft gear dimensions also exposed a separate runtime issue:
all parked aircraft were level, leaving tail wheels 0.68–1.76 m above the deck.
`src/simulation/aircraftGroundPose.ts` computes the tail-down resting pitch and
height from the original wheel positions and radii. The CPU composes carrier
motion and taxi heading with that pitch, and the renderer follows the same
pose. Tests measure all three exported aircraft at all three LODs, with a 20 mm
allowance for tyre tread and mesh simplification. Flight-deck camber and loaded
tyre compression remain approximated by the existing deck datum.

Validation retained in this pass:

- All 78 current open-gun component cases pass at elevation/recoil extremes.
- Latest master integration: `bun test --timeout 30000` passes 691 tests across
  97 files; `bun run build` passes. See `reports/merge-fe0df0be.md`.
- Original repair suite, `bun test --timeout 20000`: 583 tests pass across 82 files.
- After the final support changes, convoy and Game/ShipBatching tests: 44 pass.
- `bun run build`: passes every registered ship check, aircraft checks,
  TypeScript and the production bundle. Vite retains its existing large-chunk
  advisory.
- All 50 fixed views and 19 runtime close-ups were visually inspected. All 120
  runtime articulation poses pass; maximum CPU-to-rendered muzzle error is
  2.75 mm. The retained evidence matches the final published models.
- `verify.py` passes for all ten ships, including source/model hashes, retained
  node IDs, current review images and the 78 open-component cases.

Full-suite, final model-test and production-build output is retained under
`reports/tests.txt`, `reports/model-tests.txt` and `reports/build.txt`.

## Reproducing the retained checks

`runtime_review.py` drives an already loaded Orca development port. Orca's page
connection repeatedly closed during this pass, so the remaining captures used
an isolated headless Chrome 152 browser with the Metal backend, the same Vite
server and the same game/helper code. The fallback is `runtime_headless.mjs`
(requires an installed `playwright-core`; point `ATTACHMENT_BROWSER_DRIVER` to
its package directory). No production diagnostics hook or alternate renderer
was added. Runtime JSON identifies the fallback captures.

The last visual pass corrected two issues which a contact graph alone cannot
exclude: Flower's tracks clipping through the rising counter deck, and cargo
platform columns ending alongside the hull. Victory's separate after bridge
sponsons now have beams/knees into the upper accommodation wall. These changes
are in the original convoy and Victory recipes, with interpretation limits in
the respective discrepancy registers.

Run `python3 assets/ships/attachment-audit/verify.py` after capturing every current
model. It rejects stale hashes, missing review images, lost pre-existing node
IDs, incomplete runtime poses and newly detached candidates. The resulting
`reports/verification.json` records model/source hashes and retained image hashes.

## PR integration with master

Master `54bf4113` adds King George V after the initial audit baseline. It was
rebuilt as another consumer of the shared gun recipes. All 114 existing exported
node IDs survive, its dimension checks pass, and its five fixed views and twelve
in-game articulation poses were inspected. `reports/pr-integration.json` records
this additional integration evidence; it is separate from the ten-ship contact
audit above. King George V's existing historical discrepancy register still
applies.

Enterprise's runtime captures were refreshed with master's folding aircraft
wings. The new wing-fold rendering test now composes folding with the aircraft's
resting pitch; gear-contact tests still pass for all three aircraft and all LODs.
An existing weather-test fixture was updated for master's funnel-smoke object.
Comparison packages were regenerated against the merged references. Generated
review ZIPs remain local under master's ignore rules.

After integration, `bun test --timeout 20000` passes all 650 tests across 93 files,
and `bun run build` passes all eleven ship checks, aircraft checks, TypeScript and
the production bundle. Logs are retained in `reports/pr-tests.txt` and
`reports/pr-build.txt`. The initial six-worker run exceeded the default five-second
limit in a Yamato penetration test; the complete rerun used the explicit timeout
above and passed without changing the simulation assertion.

Master `fe0df0be` subsequently connects Bismarck's original AA fittings to combat.
The merged recipe retains the repaired foundations, carriages and barrel
supports while preserving all 236 upstream node IDs for its 38 mounts and 64
barrel chains. Parenting now snapshots the authored transforms once per mount;
it no longer rebuilds Blender's whole dependency graph for each individual
fitting. The final model passes the contact scan with zero detached candidates,
all five fixed views were inspected, and twelve fresh runtime poses pass.
Earlier Bismarck evidence is preserved under
`reports/prior-bismarck-5b0621b5851d/`; current evidence matches the new model hash.
See `reports/bismarck-aa-integration.json` for the upstream ID and articulation
checks. The open-component verifier now follows the actual catalog inventory.
