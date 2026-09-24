# Bismarck · May 1941 fit in launch-era plain paint

24 May 1941 fit; standard 9.33 m reference draft (not battle load)

Open `/?ship=bismarck` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

## Approved brief

The requested refinement uses only [Bismarck ’41 on GameModels3D](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsb708), with `A_Hull` and the corresponding A equipment. The reference supplies the target shapes; geometry and textures remain independently authored. The fore and conning rangefinders have no mattress aerials; the aft 10.5 m rangefinder carries the slatted panel the reference shows on its after face. The existing sensor joint IDs remain stable.

Comparison uses 15 m per source unit, the reference shifted 1.985 m aft and 0.85 m up (its deck levels then agree with ours from the main deck to the foretop roof). The source loading condition is unverified; this alignment does not establish a historical waterline.

Authored hull: 250.5 m long, 36 m beam, 9.33 m draft. The 2026-09-24 realism pass refit the lines to the reference (mean half-breadth error 0.02 m): a fine forebody with a bulbous forefoot, a V run aft with the keel carried to the centreline skeg and shaft tube, and the reference's fuller midship bilge. Below the waterline she displaces 44,753 m³ (the reference 44,996 m³); the stability profile's buoyancy scale, which reconciles the stated mass with the hull, moved from 0.846 to 0.959. These are model inputs, not a new historical-accuracy certification.

- **Exterior (2026-09-24 pass against the reference, whole-ship silhouette IoU side 0.97, front 0.95, top 0.995):**
  - *Forward:* octagonal tower traced at five heights, plated gallery undersides and deep bulwarks; foretop 10.5 m rangefinder, target givers and flak target indicators; single-pole foremast stepped on the signal deck; SL-8 directors on tall pedestal towers; 7 m conning rangefinder, night directors and windows placed from the textured reference.
  - *Midships:* near-vertical oval funnel with a short forward sweep, raked inner cap, cowl ring and traced searchlight gallery with deep bowls; box-girder aircraft cranes on side-deck machinery bases; a transverse lattice catapult lying in the 01-deck trough; pitched single hangars, the chamfered double hangar and skid-platform boat stowage.
  - *Aft:* mainmast on the reference axis with its enclosed lookout, crosstree and W/T spreader, standing on a pillared platform; the aft searchlight tower with both searchlights and the GF 7 night rangefinder; re-traced control deck, director platform and pointed director house; the aft director with its mast and slatted panel; GF 9 on its own tower. The stern boat derrick is gone (the reference has none).
  - *Hull and deck:* bolstered bower anchors, stem and stern anchors, capstans, bitts, chocks and the V breakwater ahead of Anton; scuttle rows only where the reference paints them; twin parallel rudders, three shafts with the outer ones in long bossings, A-brackets and midship bilge keels. The 01 deckhouse follows the reference plan, recessed round the 150 mm barbettes.
  - Main gunhouses, three-bladed screws and small fittings remain original interpretations and visual estimates of the approved model.
- **Internals:** Plate thicknesses and machinery sequence evidence-based; room boundaries and hull-conforming plate envelopes approximate. After the hull refit the belt and transverse armour were refit to the new hull, interior side plates split into short planar strips, and nine end rooms shrunk to stay inside it (`dora-shell-room`, `steering-room`, both shaft rooms, the 90 and 150 voids, `forward-void`); flood spaces and stability were re-derived. Local damage calibration is unchanged. Standard-draft datum, not battle displacement.
- **Weapons:** Independent gunhouse polygons; historical bore and turret frames. Simplified geometry and AP budget, no fuze, spall or material penetration model. The six 150 mm turrets sit on the reference hardpoints. AA: eight twin 105 mm, eight twin 37 mm and twelve single 20 mm mounts on the reference hardpoints, with provisional CPU fire control; the 37 mm pivots on lipped decks stand 6.5–7.5 cm above them so the mounting soles clear the deck. Two upper quad 20 mm fittings remain decorative.

The 150 mm and 105 mm side batteries use conservative operating envelopes from the approved game's firing sectors, with its endpoint dead zones removed. Main elevation follows A artillery's −1° to +30° range. These are not independently verified mechanical or historical stops. The user chose reference fidelity for combined turret poses: opposing extreme main-turret angles can intersect even in the source model (for example Anton 145°/+10° with Bruno −138°). Preserve those source ranges; this accepted limitation is not a collision-free independent-pose claim. The reusable original `sk-c34-380-twin` builder owns main-turret geometry and preserves separate traverse, elevation and recoil joints.

The twin 37 mm mounts reuse `flak-37-bismarck-1941`'s original builder, with reconstructed rearward trunnions and narrower barrel spacing. The reference supplies no AA travel sectors, and Bismarck has no `mountClearance` interlocks. The articulation sweep finds no mount against the fixed ship except two accepted cases: the 105 mm mount 2 barrels reach the crane jib foot at their extreme after train with the guns depressed (the reference places the crane there), and Dora's depressed barrels reach the 20 mm mount 6 ring sights at ±130–145°. Independently posed neighbours still meet, all from the reference layout: Anton with Bruno and Caesar with Dora (above), Caesar with the aft 37 mm pair, Dora with the 20 mm mount 6 pair, and each 150 mm turret at 40° elevation with its neighbouring 105 mm mounts. Retained game travel is provisional; these contacts are not a visual-acceptance pass or a claim about historical mechanical limits.

Known approximations: the bow knuckle and cut-in anchor pocket are a smooth hull plus a rounded bolster; the upper tower galleries are rounder than the reference's straight-sided platforms and the foretop bulwark is one height; the reference cache lacks one propeller model, so its missing centre screw is not followed. The shared gun parts leave two small unattached pieces per mount (the main turrets' rear grab rails and the 37 mm left barrel group), unchanged by this pass.

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
