# Admiral Hipper · 1943 source fit

Editable construction conversion of the existing original Hipper preset. The
source is `blueprint.json`, authored with `ship:new`, revision-safe `ship:apply`
batches, and the shared Rust compiler. Blender authors reusable components only.

## Approved conversion target

The original [Hipper brief](../admiral-hipper/README.md) records approval of
[GameModels3D pgsc108](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsc108),
A hull and A/AB equipment: plain gray hull/upperworks, timber decks and red
underwater finish. Its source asset is labeled `hipper_1943`; this is a model-fit
target, not independent certification of a historical 1943 refit.

On 2026-09-15 the external viewer required sign-in. The user explicitly approved
using the existing original Hipper preset as the conversion target. Its original
source and inspected local previews guide this conversion. Fresh external-reference
verification remains incomplete. No downloaded ship model supplies geometry.

## Construction and assumptions

The 205.4 m hull retains the original station profiles and 21.12 m beam, with
editable vertex pieces split at the painted waterline. Structural tiers, bridge
window rows, funnel jacket, hangar, mast supports and boat frames remain native
construction geometry. Named source paints use shared metric surface finishes.

The exact registered gun variants retain four twin 203 mm turrets, six twin
105 mm mounts, four twin 37 mm mounts, eight twin 20 mm mounts, six single 20 mm
mounts and six single 40 mm mounts. Four triple 533 mm banks retain the original
outboard traverse and firing arcs. The original boats, SL8 covers, catapult,
director optics, funnel cap, capstans, hatches, searchlights, three screws and
rudder have reusable original component recipes and immutable catalog identities.

Internal arrangement and gameplay values remain provisional. The source declares
18 mm default structural skin, a 20 mm machinery floor and six 20 mm transverse
bulkheads; this is not a historical armor or compartment plan. Two magazines and
an 82 MW nominal steam package are physically fitted. Two explicitly authored
5,800 t distributed load packages represent unmodeled machinery, protection,
stores and outfit. They are not hidden ballast. Propulsive efficiency and
auxiliaries leave 52.234 MW effective power; speed is the compiler's estimate,
not a calibrated historical speed trial.

Main gun barbettes are closed exterior supports; their hoist interiors are not
reconstructed. The accepted opposite-hand propeller approximation is retained.
Aft 37 mm mounts rest broadside to clear their native support arrangement. Aft
searchlight landings sit 0.30 m farther outboard to clear mast legs. Small leveling
seats support capstans and hatches on the sloping deck. Windows use opaque dark
glazing; boats, catapult, directors and searchlights have no independent operating
simulation. Fine portholes, anchor cables, some rigging and minor deck fittings
are not fully reconstructed.

Gun travel is subject to native collision interlocks around the superstructure
and neighboring weapons. Declared mechanical ranges do not promise unobstructed
travel at every elevation. Review records blocked requests separately from
CPU/render agreement; a large diagnostic move can also exhaust the conservative
sweep budget. Those are not cleared paths.

## Reopen and validate

```sh
bun run ship:edit admiral-hipper-construction
bun run ship:inspect admiral-hipper-construction
bun run ship:render admiral-hipper-construction
bun run ship:trial admiral-hipper-construction --seconds 15
bun run ship:build admiral-hipper-construction
bun run ship:check admiral-hipper-construction
bun run ship:review admiral-hipper-construction
```

Fixed exported-model previews live in `generated/review/`; exploratory images,
close-ups, sampled poses and trial diagnostics stay in ignored `.build/`.

This conversion exercises a substantially larger compiler budget than the starter
ships: 131,072 intermediate convex cells, 4,194,304 face vertices per checked
collection, 128 faces per cell and 16,384 flooding connections. Intermediate
counts differ from final runtime cells. The compiled definition is large and
source compilation/initial trial loading can take tens of seconds. Reset reuses
the same verified immutable definitions and does not recompile the source.
The compact published definition is approximately 77 MiB. Construction presets
import it as JSON text to avoid TypeScript's per-leaf inference overhead; the
game still loads the complete definition, and the production build reports a
large bundle. This is not yet an optimized fleet-scale structural representation.

The registered preset is `admiral-hipper-construction` (displayed as
“Admiral Hipper · 1943 source fit”); the original `admiral-hipper` remains available.
The inspected exported profile, plan, bow, stern and quarter views are retained
above. Gun close-ups and independent torpedo-bank poses were inspected against
their physical supports. The sampled native sweep includes 150 gun poses and
five torpedo arrangements; conservative sweep-budget stops remain unresolved
requests rather than certified clearance.

Validation: `ship:build`, `ship:check`, `ship:review`, relevant native and
TypeScript tests, and `bun run build` passed. The final 15-second native sea trial
traveled 36.2 m with steering response, fired eight main-gun rounds, and reset
tick, ammunition and integrity. On the authoring machine it took about 87 seconds
to load, 24 seconds to simulate and 0.24 seconds to reset. The editor-to-game
handoff and the afloat model were also inspected; these timings are not a
performance guarantee for other machines.
