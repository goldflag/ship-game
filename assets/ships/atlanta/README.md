# USS Atlanta (CL-51)

CL-51 · 1942 exterior after the GameModels3D pasc006 A hull · reference design waterline

Open `/?ship=atlanta` or select this ship in port or Custom battle.

This is a legacy Blender-recipe preset (like Takao, Alaska, Hood and Mogami), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py` from `authoring/lines.json` and the measured
superstructure blocks), `build.py`, `atlanta_kit.py` (shared vocabulary: materials, primitives, barbettes, gun seats,
merged rails and wires), `atlanta_fittings.py` (bow bulwark, tubs and shields, funnel tops, masts and rigging,
directors, torpedo mounts, depth-charge gear, boats and davits, crane, searchlights, ground tackle, deck gear, hull
numbers and underwater gear), `atlanta_windows.py` (glazing) and `atlanta_rails.py` (platform rails) are the durable
inputs; the guns come from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

## Approved brief

- **Vessel and fit:** USS Atlanta (CL-51) as she stood in 1942, the only configuration GameModels3D offers: World of
  Warships vehicle [`pasc006`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc006), hull
  `asc006_atlanta_1942`, configuration `A_Hull`. Eight twin 5-inch/38 Mk 32 Mod 12 mounts (six on the centreline in
  superfiring groups fore and aft, two in the waist), four 1.1-inch/75 quadruple mounts, eight single 20 mm Oerlikon
  Mk 4, two quadruple 21-inch Mk 14 torpedo-tube mounts, six depth-charge throwers and two stern roller tracks, two
  Mk 37 and four Mk 44 directors, two torpedo directors, a 2.5 m rangefinder and an SC-1 radar. Catapults are not part
  of this fit.
- **Paint:** the reference's default (plain) scheme as `bun run ship:reference pasc006 --render` shows it; no
  permoflage or camouflage.
- **Reference policy:** GameModels3D only: no photographs, plans, War Thunder, Sketchfab or other models. Armour zones
  and thicknesses come from the reference's armour model; other gameplay values are provisional game calibration.
  The reference's fit is taken as it stands, even where it looks unhistorical.

## Model and simulation basis

The hull is an original authored-stations loft: 122 stations of 29 points measured on the reference's hull group with
`ship:lines` (capped passes merged per station on its probed weather deck; see the note in `authoring/lines.json`),
from the keel on the centreline to the deck edge. The stem follows the reference's centreline profile (nearly upright
to the waterline, then raked to the stem head at 7.94 m), the raked, rounded transom is cut by the reference's
transom face, and four stations that caught the hawse pipes, a bullnose or a bilge keel's tip take their
neighbours' mean. At the reference's y = 0 design waterline it is 164.76 m overall (161.6 m on the waterline),
16.32 m in beam (16.15 m on the waterline), 6.25 m to the keel and 8,515 t; the sheer rises from 3.64 m amidships to
7.94 m at the stem and 4.22 m at the stern. Above the forecastle edge the flared bow bulwark (8.45 to 8.85 m) carries
the bullnoses, as the reference's does.

The 71 superstructure blocks were traced from plan cuts of the reference every 5 cm and followed up through the
levels, sheer-aware where a tier stands on the sloping deck; funnels are lofts through measured rings under their
clinker screens. Windows and portholes (118 openings) were read off orthographic renders of the reference's painted
textures with the depth of the wall each lies on, and are glazed on this model's own wall where it stands close to
the reference's. Guard rails on the platforms (390 courses) are the reference's thin rail courses with open space
under them, stanchions stepped on this model's platforms; the rigging (shrouds, stays, braces, the foremast's aerial
fan, the four long aerials to the main yard and the main yard's fan) runs between the reference's wire ends.

Mounts sit at the reference's hardpoint datums with its horizontal sectors: eight `us-5in38-mk32-mod12` twins
(three superfiring forward, two in the waist, three aft), four `us-11in75-quad` and eight `us-20mm-oerlikon-mk4`.
Every 5-inch mount carries a `mountClearance` envelope against the blocks it can reach and its neighbours. The two
quadruple torpedo mounts train out over their own side and fire within 30 degrees of the beam; six depth-charge
throwers and two stern tracks release at the reference datums. The Mk 37 directors and the SC-1 aerial are trained
by the rig; the Mk 44 directors, the torpedo directors, the 2.5 m rangefinder, searchlights, masts, the crane, boats in
their davits and cradles, rafts, ground tackle, bollards, fairleads, reels, hatches, hull numbers, the two screws,
shafts and struts, the rudder and the bilge keels are simplified original constructions at the reference's
positions and sizes.

Machinery (two firerooms under the funnels and two engine rooms in a unit arrangement, two shafts), magazines, flood
spaces, stability (GM 7% of beam) and damage-control values are game estimates; the visual reference does not
establish internal plans. The 89 mm belt over the machinery citadel, 51 mm magazine and lower belts, 32 mm armoured
and magazine decks, 89 mm and 25 mm bulkheads, 25 mm magazine sides, 32 mm barbettes, the 65 mm conning tower and the
25 mm steering-gear box read their zones and thicknesses from the reference's armour model and are fitted to the
authored loft; hull and superstructure plating are 13 and 10 mm. The native trial gives 32.5 kn, 1.67 deg/s in a
hard turn and a 638 m turning circle.

## Accepted approximations

- Displacement at the reference waterline (8,515 t, 6.25 m keel draft) is the reference's loading, a little over the
  published full-load figure; the stated mass equals the loft's displacement.
- Superstructure blocks are measured prisms and straight lofts: small overhangs step and curved faces are faceted.
  Glazing covers the openings whose wall here stands near the reference's; hull scuttles and other painted texture
  detail are not modelled.
- The torpedo tubes are authored at zero train and rest trained forward; the reference stows them trained aft.
- The waist 20 mm mounts carry an installed depression stop at 0 degrees and the stern pair at -2 degrees, so their
  barrels stay over the splinter shields the reference draws round them.
- Deck-edge rails are two simplified courses kept out of the gun arcs; platform rails keep the reference's courses
  with stanchions at most 1.6 m apart.
- Boats are closed hulls (the launches' open wells and the whaleboats' interiors are decked over); anchors, the
  bullnoses (the stem's centre chock is a dark plate, not an opening), the Mk 37 houses, the crane, masts and the
  SC-1 bedspring are simplified; the hull number is drawn in a plain stroked face at the reference's size and place.
- Handling (32.5 kn), stability, mass distribution, flooding compartmentation and weapon values are shared game
  calibration, not historical measurements. Model fidelity and export checks do not certify historical accuracy.

Atlanta takes the placeholder's place in the US cruiser line of the research tree.

```sh
python3 assets/ships/atlanta/author-blueprint.py   # add --structures only to re-measure from .build/atlanta
bun assets/ships/author-flood-spaces.ts atlanta && bun assets/ships/author-stability.ts atlanta && bun assets/ships/author-damage-control.ts atlanta
bun run ship:build atlanta
bun run ship:review atlanta
bun run ship:check atlanta
```

`author-blueprint.py` keeps the local-damage and damage-control calibration; flood spaces and stability are rebuilt by
their helpers after every run of it (`author-stability.ts` fills `stability` only when absent, and the script writes
the blueprint without it). Keep the current fixed views in `generated/review/`. Reference downloads, measurements and
comparison captures stay in ignored `.build/`.
