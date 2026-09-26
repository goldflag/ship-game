# USS New Orleans

New Orleans · 1944 exterior after the GameModels3D pasc107 B_Hull fit (hull asc014_new_orlean_1944) · reference design
waterline

Open `/?ship=new-orleans` or select this ship in port or Custom battle.

This is a legacy Blender-recipe preset (like Takao, Alaska, Hood and Mogami), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py`), `build.py`, `new_orleans_kit.py` (shared
vocabulary: materials, primitives, barbettes, gun seats, merged rails and wires), `new_orleans_fittings.py` (masts,
directors, radars, funnel tops, aviation, boats, searchlights, bulwarks, deck gear and rails),
`new_orleans_underwater.py` (screws, shafts, bossings and brackets, rudder, skeg, bilge keels, propeller guards),
`new_orleans_walls.py` (the traced bulwarks, splinter screens and gun tubs), `new_orleans_lockers.py` (the ready-use
lockers by the guns) and `new_orleans_windows.py` with its table (bridge glazing) are the durable inputs; the guns come from `assets/parts/`. `authoring/` keeps the measurement scripts
and their outputs. Generated Blender scenes and runtime models are build outputs.

## Approved brief

- **Vessel and fit:** USS New Orleans (CA-32) in 1944, as GameModels3D World of Warships vehicle
  [`pasc107`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc107) shows her: hull
  `asc014_new_orlean_1944` (the only New Orleans hull on GameModels3D) with the later anti-aircraft fit of
  configuration `B_Hull` (cached as `pasc107-b` with `bun run ship:reference pasc107 --hull B_Hull --name pasc107-b`;
  the default `pasc107` cache loads the A anti-aircraft fit instead). Three triple 8-inch/55 turrets of the CA-32
  pattern, eight single 5-inch/25 Mk 19, six quadruple 40 mm Bofors Mk 2, seventeen twin 20 mm Oerlikon (Mk 20) and
  nine single 20 mm Oerlikon Mk 4, two catapults (fitted empty), six Mk 51, two Mk 28 and two Mk 31 directors, and
  SG (two), SK and SM radars. The reference's fit is taken as it stands, even where it looks unhistorical.
- **Paint:** the reference's default (plain) scheme, as `bun run ship:reference pasc107-b --render` shows it; no
  permoflage or camouflage.
- **Reference policy:** GameModels3D only: no photographs, plans, War Thunder, Sketchfab or other models. Armour
  zones and thicknesses come from the reference's armour model (`asc014_new_orlean_1944` armour); other gameplay
  values are provisional game calibration.

## Model and simulation basis

The hull is an original authored-stations loft of 125 stations (`authoring/lines.json`), measured by
`authoring/measure-lines.ts`: the shared `ship:lines` walk over the `pasc107-b` cache with a deck finder of its own
(the reference's deck plating spans the centreline and stops short of the shell round the anchor pipes), the
forecastle break at the measured step of the side plating (reference z 5.02), walks started below the propeller guards
and eleven levels up to the flared forecastle's deck edge. The frame is centred on the length (reference z + 0.611 m).
At the reference's y = 0 design waterline it is 179.78 m overall and 176.0 m on the waterline, 18.48 m in beam
(18.41 m on the waterline), 7.07 m to the keel and 13,217 t. The forecastle deck falls from 9.15 m at the stem to
6.23 m amidships and 5.97 m at the break; the main deck abaft it stands at 3.6 m, rising to 4.3 m at the stern. The
skeg, bilge keels, four screws on their shafts and brackets, the balanced rudder and the propeller guards are original
constructions at the reference's positions.

Superstructure blocks come from plan traces of the reference every 5 cm (`authoring/plans.ts`, the shared
`ship:slice --plan --sym` trace) carried up level by level by `authoring/structures.py`: a block continues while its
outline moves little, ends at a roof, platform or overhang, splits where it comes apart and where its outline jumps
between two levels. A block whose levels nearly all match its middle level (nine tenths of each outline within 15 cm,
over 85% of its height) is a prism; one whose walls taper (the funnel uptakes' flares, sloped platform edges) is a
straight loft through the few levels its shape needs, each level resampled where its neighbour's points fall on it so
the facets follow the walls. Cells are kept only under a surface of the reference (so the deck inside a tub or an open
bridge does not come back solid), the main barbettes and every open gun's working circle are cut out, and small lintels
are carried to the block they rest on. Keeping cells under a surface also fills an open deck that bulwarks wall in
under a platform, so `authoring/enclosures.py` drops the slabs that came back over four of them (the lower bridge round
the pilothouse, the open navigating bridge round the director tower's base, the midships 20 mm tub round its tower,
and the director platform abaft the tower, where vertical lines through the reference find only the deck and the
platform above), carries the pilothouse, the tower base and the tub's tower down to their decks, and lists the
bulwarks those slabs' outlines had hidden from the wall trace; `author-blueprint.py` and `authoring/walls.py` both
apply it. Two more measured blocks are corrected in `author-blueprint.py`: the open navigating bridge's deck
(bridge-010) runs unbroken to the pilothouse top instead of a sawtoothed U that let the sea show through, and the after
deckhouse (after-superstructure-079) keeps three of its twelve plan levels (6.2, 8.775 and 9.7 m), whose trace noise and
small steps had crumpled its sides. The funnels are raked extrusions of one measured section with
sooted caps; the forward funnel's cowl covers the forward part of its mouth and rises to 22.47 m at its after face, arched
across, as the reference's does.
Bulwarks, splinter screens and gun tubs, which the block trace
drops as too thin, are traced as polylines by `authoring/walls.py` and drawn as 6 cm plating; where one crosses a
light or secondary gun's working circle (the catalog part's swept rests, shield and platform, measured on the built
model by `authoring/mount_envelope.py` into `authoring/mount-envelopes.json`) it bulges round the gun onto a small
sponson floor. The bridge's windows and portholes were read off orthographic renders of the reference's painted
textures (`authoring/windows.py`); `new_orleans_windows.py` glazes each on this model's own wall where that wall
stands within 35 cm of the reference's and faces the view.

Mounts stand at the reference's hardpoint datums, each foot on the deck the reference stands it on: the catalog's
`us-8in55-ca32-triple`, `us-5in25-mk19-single`, `us-40mm-bofors-mk2-quad`, `us-20mm-oerlikon-mk24-hsienyang` (the
twin Mk 20 mounts) and `us-20mm-oerlikon-mk4`. Every mount carries a `mountClearance` installation envelope (barrels
with the recoil stroke, and a carriage box; the CA-32 gunhouse's rangefinder hoods are two capsules a side) against the
blocks it can reach and the bulwarks and tubs within its reach (6 cm thin structures along the traced walls, which the
recipe does not draw twice), and neighbouring mounts whose working circles overlap are interlocked. Firing obstructions
are fore-and-aft strips of the deckhouses (each boxing only the runs that lie inside the outline all along the strip),
the stowed boats and catapults, the ready-use lockers by the guns, the four posts under the midships 20 mm platform,
the forecastle ahead of No. 1 turret (which its barrels would otherwise meet at full depression) and the quarterdeck
boat winch. Nos. 1 and 3 turrets train to ±132°
and ±128° at the horizontal and ±141° to ±150° once elevated; the forward 20 mm twins and the after control
platform's single Oerlikons rest elevated 10° and 5°, over the tub wall ahead of them. The Mk 31, Mk 28 and Mk 51
directors stand at the reference's director datums; SK, both SG and SM aerials and the four large directors turn,
and the ensign flies from the mainmast gaff.

Masts and yards, directors, radars, searchlights, the aircraft crane, catapults, boats and davits, ground tackle,
bollards, fairleads, vents, hatches, lockers, rafts, rails and the underwater gear are simplified original
constructions at the reference's positions and sizes.

Machinery (four firerooms under the funnels, two engine rooms in four spaces, four shafts), magazines, flood spaces,
stability (GM 7% of beam) and damage-control values are game estimates; the visual reference does not establish
internal plans. The 127 mm belt over the machinery and 32 mm side forward of it (y -1.86 to 1.57 m), the 57 mm decks,
the forward magazines' 83 mm crown, 102 mm magazine sides and 76 mm ends, 89 mm citadel bulkheads, the 40 mm citadel
bottom, 127 mm barbettes, the conning tower (127 mm sides, 76 mm roof) and the 51 to 63 mm steering-gear box read
their zones and thicknesses from the reference's armour model and are fitted to the authored loft; hull and
superstructure plating are 25 and 13 mm.

The paint is the reference's plain scheme sampled through its own UVs: one haze grey over hull, upperworks and
turrets, deck blue over the timber weather decks and steel roofs, a black boot-topping from 0.24 to 0.76 m and a
fouled olive-brown bottom, black funnel caps (`appearance.json`); the 8-inch barrels are haze grey like their gunhouses,
and the shafts carry the bottom paint. The twin Oerlikons' canvas case bags are shaded smooth: faceted, their twenty
elevation keys each made 9.6 MB of the model.

## Accepted approximations

- Displacement at the reference waterline (13,217 t, 7.07 m keel draft) is the reference's loading, heavier than the
  class's published full load; the stated mass equals the loft's displacement. The beam (18.48 m) is the
  reference's.
- Superstructure blocks are measured prisms and straight lofts: small overhangs step and curved faces are faceted,
  neighbouring blocks and screens can leave seams up to about 0.15 m (between bridge-019 and bridge-021, for one), and
  the reference's glazing bars, pillars and wing brackets in the open spaces under the bridge wings and in the lower
  bridge are not modelled (the spaces themselves are open). Only the bridge's windows and portholes are glazed; doors,
  scuttles on the hull and deckhouses and other painted texture detail are not modelled, and openings whose wall here
  stands away from the reference's are left out. The director platform carries its two binoculars and the lookout
  platform above it its two sky lookouts, but the open bridge has none of the reference's gyro repeater, pelorus stands,
  indicator and switch boxes; the crane beams by No. 2 turret, the davit abreast the bridge and the hawser reels are not
  fitted.
- The catalog Oerlikon, Bofors and 5-inch parts sweep wider than the reference's own guns, so traced screens and tubs
  bulge round them: up to 0.39 m at the bridge wings' single Oerlikons and 0.33 m on the after control platform, on
  small sponson floors; the two ready-use lockers beside the bridge-wing Oerlikons stand 0.6 m abaft the reference's.
  The forecastle capstans stand 0.44 m high (caps at 7.72 m) under No. 1 turret's overhang, and the chains run from
  them to the hawse pipes without a windlass.
- The reference poses its 20 mm guns about 30 degrees up. At their trunnion height, which the catalog mounts share (the
  reference's muzzle datums give 1.17 m for the twins and 1.15 m for the singles), the forward twins and the after
  control platform's singles cannot depress over the tub wall ahead of them, so they rest at 10 and 5 degrees.
- Masts, yards, radars, directors, the crane and the catapults are simplified; the catapults are empty, as in the
  reference, and no aircraft are carried. The funnel mouths are capped black with bars laid over them where the
  reference's are open over an inner grating, and their rims are level where the reference's fall about 0.7 m aft. The reference shows no torpedo tubes or depth-charge gear, so none are
  fitted.
- Handling (32.7 kn), stability, mass distribution, flooding compartmentation and weapon values are shared game
  calibration, not historical measurements. Model fidelity and export checks do not certify historical accuracy.

New Orleans takes the placeholder's place in the United States cruiser line of the research tree.

```sh
# Re-measure only when the reference or a measurement script changes (needs the pasc107-b cache and a venv with
# numpy, scipy, shapely, scikit-image and Pillow):
bun assets/ships/new-orleans/authoring/measure-lines.ts
bun assets/ships/new-orleans/authoring/plans.ts .build/new-orleans/plans.json 3.675 34 0.05 --box -12,0,-92,12,45,92
python assets/ships/new-orleans/authoring/structures.py .build/new-orleans/plans.json assets/ships/new-orleans/authoring/lines.json .build/new-orleans/structures.json
python assets/ships/new-orleans/authoring/walls.py .build/new-orleans/structures.json > assets/ships/new-orleans/new_orleans_walls.py
python assets/ships/new-orleans/authoring/windows.py > assets/ships/new-orleans/new_orleans_windows_data.py

# A change that leaves the hull, blocks and rooms alone keeps the gameplay data as it stands:
python3 assets/ships/new-orleans/author-blueprint.py --keep-gameplay
# after re-measuring, rebuild it (this ship has no hand calibration in them yet):
python3 assets/ships/new-orleans/author-blueprint.py --structures .build/new-orleans/structures.json
bun -e "import { writeLocalDamage } from './assets/ships/author-local-damage.ts'; await writeLocalDamage(['new-orleans'])"
bun assets/ships/author-flood-spaces.ts new-orleans && bun assets/ships/author-stability.ts new-orleans && bun assets/ships/author-damage-control.ts new-orleans

bun run ship:build new-orleans
bun run ship:review new-orleans
bun run ship:check new-orleans
```

`mount-envelopes.json` is re-measured from a built model with
`blender -b assets/ships/new-orleans/generated/source.blend --python assets/ships/new-orleans/authoring/mount_envelope.py`
when a gun part changes. Keep the current fixed views in `generated/review/`. Reference downloads, measurements and
comparison captures stay in ignored `.build/`.
