# Bismarck · May 1941 fit in launch-era plain paint

24 May 1941 fit; standard 9.33 m reference draft (not battle load)

Open `/?ship=bismarck` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

## Approved brief

The requested refinement uses only [Bismarck ’41 on GameModels3D](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsb708), with `A_Hull` and the corresponding A equipment. The reference supplies the target shapes; geometry and textures remain independently authored. Its A rangefinders have no mattress aerials; the existing sensor joint IDs remain stable.

Comparison uses 15 m per source unit, a 2 m longitudinal offset to align the hull ends, and a +0.85 m reference height adjustment to align the midship weather deck. The source loading condition is unverified; this alignment does not establish a historical waterline.

Authored hull: 250.5 m long, 36 m beam, 9.33 m draft. These are model inputs, not a new historical-accuracy certification.

- **Exterior:** Angular forward deckhouse and sloping bridge hood; broad lower tower, slender upper shaft and separate signal enclosure with shallow forward apertures and taller side windows. The funnel has a swept lower forefoot and open searchlights. The continuous aft deckhouse joins the raised base beneath Caesar. Quarter-length hull shoulders taper more sharply while retaining the maximum beam. Revised rangefinders, boat stowage, main gunhouses and three-bladed screws remain original interpretations; small fittings and surface detail are visual estimates of the approved model.
- **Internals:** Plate thicknesses and machinery sequence evidence-based; room boundaries and hull-conforming plate envelopes approximate. Standard-draft datum, not battle displacement.
- **Weapons:** Independent gunhouse polygons; historical bore and turret frames. Simplified geometry and AP budget, no fuze, spall or material penetration model. AA: eight twin 105 mm, eight twin 37 mm and twelve single 20 mm mounts use original visual placements and provisional CPU fire control. Two upper quad 20 mm fittings remain decorative.

The 150 mm and 105 mm side batteries use conservative operating envelopes from the approved game's firing sectors, with its endpoint dead zones removed. Main elevation follows A artillery's −1° to +30° range. These are not independently verified mechanical or historical stops. The user chose reference fidelity for combined turret poses: opposing extreme main-turret angles can intersect even in the source model (for example Anton 145°/+10° with Bruno −138°). Preserve those source ranges; this accepted limitation is not a collision-free independent-pose claim. The reusable original `sk-c34-380-twin` builder owns main-turret geometry and preserves separate traverse, elevation and recoil joints.

The twin 37 mm mounts now reuse `flak-37-bismarck-1941`'s original builder, with reconstructed rearward trunnions and narrower barrel spacing. The reference supplies no AA travel sectors. Full-circle AA clearance remains unresolved: the reference itself has rail contacts at some inboard poses, including the funnel and aft-control 20 mm mounts. Its forward upper 37 mm barrels also contact the signal house at high elevation when rotated about the inferred trunnions. Our single 20 mm geometry and nearby tower/funnel access stairs remain approximations with additional clearance failures. Retained game travel is provisional; these contacts are not a visual-acceptance pass or a claim about historical mechanical limits.

```sh
bun run ship:compile bismarck
bun run ship:build bismarck
bun run ship:review bismarck
bun run ship:check bismarck
```

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md). Preserve the original `baseline/` unchanged. The recipe is split into `bismarck_kit.py` (shared vocabulary) and region modules (`bismarck_hull.py`, `bismarck_forward.py`, `bismarck_midships.py`, `bismarck_aft.py`, `bismarck_armament.py`) that `build.py` runs in dependency order.

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
On 2026-09-24 the owner replaced the March–May 1941 Baltic camouflage (black and white bands, false bow waves,
dark ends and the red deck recognition fields) with the paint she wore at launch: one light grey over hull,
upperworks and turrets, dark-grey steel decks and platform tops, a black boot top, a dark-red bottom and plain
teak weather decks. `appearance.json` names these swatches; they keep the previous recipe's light grey, deck grey
and fittings greys and the fleet teak stain `#9c8769`, and are appearance estimates, not measured historical paint.
The fit (geometry) stays the approved May 1941 reference configuration. The ship wears In commission, drawn by the
game like every ship's; the game draws 0.16 m planks with 3.4 m staggered butts and 8 mm caulking (`decking`).
The boats' timber is declared fittings.
