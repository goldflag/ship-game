# Bismarck · 24 May 1941

An independent reconstruction authored from reviewed dimensions, historical drawings/photographs and neutral GameModels3D screenshots. The fit is 24 May 1941; the display uses a separate 9.33 m standard draft, not an asserted battle-day displacement or trim. The earlier original model remains untouched in `baseline/` and is not an input.

`blueprint.json` owns the newly authored hull sections, superstructure footprints, ten mount positions, 365 compiled physical protection plates, 39 internal envelopes and provisional handling. `build.py` creates fresh topology and materials, using the original reusable gun component catalog. No game-model vertices, offsets, UVs, textures or attachment transforms are production inputs. `generated/source.blend` and `public/models/bismarck.glb` are generated outputs.

The second exterior iteration added bridge/director tiers, gallery shields, funnel equipment, light AA, boat hulls and hangar doors, lattice cranes, deck fittings and original baked teak. The third correction reshapes the bow into a curved stem with a nearly vertical forefoot, and replaces the main gunhouses with a longer rear enclosure, narrower near-vertical sides, sloped shoulders and planar roofs. See the [correction report](reports/visual-iteration-03/README.md) and [preceding detail pass](reports/visual-iteration-02/README.md). The detailed light AA remains visual; the existing ten articulated main/secondary mounts retain their simulation contract.

```sh
# From the repository root; see scripts/reference/README.md for prerequisites.
bun run ship:reference bismarck     # Optional refresh: isolated raw cache → indexed raster pack
bun run ship:compile bismarck
bun run ship:build bismarck         # Original geometry, GLB, checks, thumbnail and comparison pack
bun run ship:review bismarck        # Five fixed export-review views
bun run ship:independence bismarck  # Repeat full build with raw game cache unavailable
bun run ship:check bismarck
bun test
bun run build
```

The retained GameModels3D pack is [browsable here](references/gamemodels3d/index.html), with source, camera, scale, visibility and per-image hashes in its manifest. Historical originals, crops and download provenance stay under `references/historical/`. The [specification](modeling-spec.json) records the common datum, source quality, reviewed targets, uncertainty and registration. WoWS EU 15.7.0.0 is comparison evidence, not historical ground truth.

Open [the comparison page](generated/comparison/index.html), or choose **Reference review** in port. It includes matched overall/detail views, historical overlays, protection sections, measurements, landmark deviations and downloadable [review ZIP](generated/comparison/bismarck-review.zip). Extract the ZIP and open `index.html` for offline review. Its Blender/catalog snapshot is editable; rebuilding uses this repository’s shared tools. The production GLB is also downloadable separately.

**Armor / Internals** in port show the same protection and spaces used by the CPU simulation. The complete hull and 22 major deckhouse/tower/funnel surfaces now also register hits, using provisional 20 mm hull and 8 mm superstructure plating where armor is absent. Those thicknesses are gameplay estimates. Filter by name and select a layer/room to inspect it. Main turret armor is compiled from the same 44 facets per component that Blender renders, and trains with its mount. Belt, backing, support and turtleback remain separate crossings; teak backing has zero assigned steel resistance. Magazine rooms sit above shell rooms; machinery follows six boiler rooms, two wing turbine rooms and the farther-aft central turbine room, with shaft passages and steering aft.

Exact original hull offsets and a complete measured general arrangement remain unavailable. Hull form, turret housing details, room boundaries, flooding capacities, small fittings and combat performance retain explicit approximations. Read the [discrepancy register](reports/discrepancies.md), [validation report](reports/validation.md) and [source register](references/sources.json) before interpreting successful build checks as evidence of historical accuracy.
