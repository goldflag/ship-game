# British destroyer and escort guns

Original reusable builders for the Royal Navy's destroyer, escort and cruiser-secondary mountings, called through
`assets/parts/library.py`. Every recipe here is authored geometry: the approved GameModels3D World of Warships visuals
were measured for silhouette, joint datums and which ships share a mounting, and no reference mesh is loaded or shipped.
Nothing in this directory is a historical certification. Weapon and armor values are provisional game calibration scaled
from the nearest sibling in `guns.json`, kept physical (real muzzle speed, projectile mass, plate thickness) so the
simulation applies the world pace itself. Elevation limits are commonly published figures for each mounting, not
measurements from the models, which carry none.

- `qf_47_*.py`: the 4.7-inch QF destroyer mountings.
- `qf_45_mkiv_twin.py`, `qf_45_mkv_twin.py`, `qf_45_mkiv_single.py`: the 4.5-inch QF mountings.
- `qf_4in_mkxix.py`: the 4-inch QF Mk XIX high-angle twin, open and enclosed hoods.

## British 4.7-inch destroyer guns

### 4.7-inch QF Mk XII twin (CP Mk XIX)

`qf-47-mkxii-twin` is the original reusable Tribal/J-class main mounting
(`qf_47_twin.py`). Geometry follows the approved
[GameModels3D Jervis A artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsd107)
visual `bgm079_120mm_45_qf_cp_mkxix_twin`. Jupiter (1942, pbsd717), Cossack
(pbsd517) and Eskimo (pbsd718) fit the identical visual — same mesh, same
11,567-triangle bounds — so the collection gains one variant, not four.
Geometry is independently authored from measured proportions; this is not
historical certification.

The mounting is an open-backed weather shield, not a turret. The catalog
`gunhouseMesh` is a closed coarse envelope of the authored shield surface: the
same plan half-breadths, the same 12° nose rake, the same eave at 2.06 m and
the same cambered roof, sampled at seven stations and closed over the gun
slots, the sighting windows and the open rear so that the armour is the
protection the mounting offers rather than its plating pattern. The recipe
draws the fine version of that identical surface as 24 mm plate, with the rear
open, a gun slot cut through the head of the front face and on over the roof
for each barrel, and a sighting window in each cheek.

Inside and behind the shield the recipe adds the rotating roller path and
turntable, the tapered pedestal with three trunnion standards and their
journals, a central king post to the roof crown, per gun a cradle, two recoil
cylinders, a toothed elevating quadrant, a sliding jacket and chase with a
recessed bore and an elevating port shield that rides up through the roof slot,
the layers' seats and elevation handwheels bracketed off the outboard
standards, an overhead loading rail under each side of the roof, and the rear
working platform with its loading trays, hoist head, guard rails and access
ladder. Pivot, barrel spacing and muzzle datums come from the approved model's
`Rotate_Y`, `Rotate_X` and `HP_gunFire` nodes.

Elevation limits are the commonly published figures for the CP Mk XIX mounting,
−10°/+40°, not something the approved model can show: its joints have no
limits. Muzzle velocity (808 m/s), shell weight (22.7 kg), the 0.673 m recoil
stroke and the 10–12 rounds per minute behind the 5.5 s reload are likewise
published mounting data. Penetration, damage, dispersion, drag and ammunition
are provisional game calibration scaled from the 127 mm siblings, and shield
plating is taken as the usual quarter-inch splinter protection; none of it is
certified historical performance.

Known approximations: the approved model's roof slot stops 0.65 m abaft the
front face, which would foul the barrel well below the published +40°, so the
authored slot is carried forward to the front face; the gun-slot sill is
0.13 m lower than the model's so the barrel clears at full depression; the
elevating port shield is shorter than the model's tall plate for the same
reason; the fixed deck ring under the mounting is not part of the component,
because the Shipbuilder owns the structure below the sole; and the rear
loading gear is moved outboard of the breech's recoil sweep, which the approved
model does not keep clear.

```sh
bun run part:build qf-47-mkxii-twin
bun run part:check qf-47-mkxii-twin
```

### 4.7-inch QF Mk IX shielded single

`qf-47-mkix-single` is the original reusable single mounting
(`qf_47_single.py`). Geometry follows the approved
[GameModels3D Acasta A artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsd105)
visual `bgm075_120mm_45_qf_mkix`, which Icarus (pbsd106), Gallant (pbsd506) and
Anthony (pbsd605) also fit, so again there is one variant. The part is named
for the gun the approved resource names — the 4.7-inch QF Mk IX — rather than
for a mounting mark, because those four ships carried CP Mk XIV, XVII and XVIII
mountings behind one shared World of Warships visual and the model cannot tell
them apart. It is the same gun and the same ballistics as the Mk XII twin; only
the mounting differs.

The shield is a flat-roofed box with chamfered rear corners, vertical sides, a
front face raked back 0.19 m per metre of height, an open rear, one gun port in
the front face and a notch in the forward roof plate for the barrel. The
catalog `gunhouseMesh` is again the closed coarse envelope of that surface with
the port, the notch and the open rear closed over. The recipe adds the roller
path, the rotating gun platform on radial knees, the pedestal and its two
trunnion standards, the cradle, recoil cylinders, elevating quadrant, sliding
barrel and elevating port shield, the layers' seats, handwheels and sight
boxes, external rungs up each side wall, and the twin loading trays on struts
behind the shield.

Elevation limits are the commonly published figures for the CP Mk XVII/XVIII
mountings, −10°/+40°; the A-class CP Mk XIV that Acasta and Anthony actually
carried was limited to +30°, and the approved model, which is shared by all
four ships, does not distinguish them. Ballistics are identical to the twin and
carry the same provisional-calibration caveat.

Known approximations: the flat roof is modelled without the model's small
front-edge scallops outboard of the notch; the notch itself runs from 0.2 m
abaft the front face rather than the model's short slot, for barrel clearance
at +40°; the loading tray and rear gear are carried outboard of the breech's
recoil sweep; and the fixed deck ring is again left to the Shipbuilder.

```sh
bun run part:build qf-47-mkix-single
bun run part:check qf-47-mkix-single
```

### 4.7-inch/50 QF Mk XI twin

`qf-47-mkxi-twin` is the original reusable L-class main mounting
(`qf_47_lightning_twin.py`). Geometry follows the approved
[GameModels3D Lightning A/B artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsd108)
visual `bgm086_4_7in_50qf_mkxi`. It is the only vehicle in the listing that fits
this visual, so the collection gains one variant. The part is named for the gun
the resource names — the 4.7-inch/50 QF Mk XI — and no mounting mark is
invented; the L and M classes carried it in the Mk XX twin, but nothing in the
approved model states that. Geometry is independently authored from measured
proportions; this is not historical certification.

This is a genuinely different weapon and a genuinely different mounting from the
other two British 4.7-inch parts, not a variant of either. The approved visual
carries 2,964 triangles against the Mk XII twin's 11,567, it is 5.10 m long
against 3.02 m, and its barrels are 2.442 m apart against 0.966 m. Where the
Mk XII and Mk IX are open-backed weather shields, this is a fully enclosed
gunhouse, so the catalog `gunhouseMesh` is both the armour and the visible
shell, as on the 28 cm German sibling: six transverse stations carry the tumbled
sides, the raised centre section, the two gun troughs and the sloping nose, and
the closed solid is drawn directly by the recipe.

The recipe adds the rotating stalk between the gunhouse floor and the deck ring,
an elevating mantlet housing and cap over each gun port with a ring boss further
out on the chase, the sliding barrels with their muzzle swell and recessed bore,
a periscope hood and aerial on the crown, roof grab rails on posts seated on the
authored facets, a sighting port in each cheek, the rear access doors with their
hinges and handles, the rear roof step on brackets, and a rung ladder up each
rear quarter on standoffs. Pivot, barrel spacing and muzzle datums come from the
approved model's `Rotate_Y`, `Rotate_X` and `HP_gunFire` nodes.

Weapon values are the published Mk XI figures rather than the 4.7-inch/45 values
used by the other two parts, because this is a different gun: a 28.12 kg shell
at 774 m/s against 22.7 kg at 808 m/s, 6–10 rounds per minute behind the 7.5 s
reload, 250 rounds per gun in a 150 SAP / 100 HE outfit which sets the 0.4 HE
stock fraction, and a 38.2 t gunhouse-with-guns. Elevation is the published
−10°/+50° of the manually worked mounting, and train the published ±150° at
10° per second; recoil is the same 26.5-inch stroke as the 4.7-inch/45 guns.
Penetration, damage, dispersion and drag are provisional game calibration scaled
from those siblings, and plating is again taken as the same estimated quarter
inch; none of it is certified historical performance. Elevation limits and the
other published values come from the mounting literature, not from the model,
whose joints have no limits.

Known approximations: the fore-decks each side of the raised centre sit 0.10 to
0.35 m lower than the approved model's, and the gun troughs correspondingly
deeper, so that the barrel and its chase boss clear the deck at full depression,
which the approved model does not manage; the nose is slightly narrower and more
pointed than the model's blunt front; the rotating stalk reaches the deck
whereas the model's ring stops 0.17 m above it, because the Shipbuilder owns the
fixed barbette below the sole; and the gun aperture in the front bulkhead is not
cut, as on the approved model, so the barrel and its mantlet housing pass
through the closed shell there, the housing standing in for the port seal.

```sh
bun run part:build qf-47-mkxi-twin
bun run part:check qf-47-mkxi-twin
```

## British 4.5-inch QF destroyer mountings

Three original reusable mountings authored against approved
[GameModels3D](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsd109) World of Warships
visuals. Geometry is independently authored from measured proportions; none of it is historical
certification, and no reference mesh is loaded by any recipe.

All three carry the same gun, the 114 mm (4.5-inch) QF, so they share one set of provisional weapon
values: 24.95 kg at 746 m/s, 12 mm plate on the twins and 6 mm on the single, and a 0.36 m recoil
stroke. Penetration, damage, dispersion, reload and ammunition are game calibration scaled from the
BL 4-inch Mk IX and 5-inch/38 siblings, not firing-table data; the simulation applies the world pace,
so nothing here is pre-scaled. Elevation limits are the **commonly published** figures for each
mounting, not measurements from the approved models, which carry no limits.

The three visuals share one architecture, and so do the recipes: a gunhouse with a central gun slot
that returns over the roof, a fixed divider between the two gun ports on the twins, and an elevating
port shield that pitches with the cradle. In every case the approved model draws that shield as a
rigid slab that fills the slot and passes straight through the gunhouse once the gun elevates. Here it
is instead curved on the trunnion radius, and the slot sill and back wall are cut deeper than the
approved visual, so no moving part enters the armor shell anywhere in the elevation, recoil and
traverse envelope. That is the one systematic departure from the source; it is stated per part below.

### 4.5-inch QF Mk IV twin

`qf-45-mkiv-twin` (`qf_45_mkiv_twin.py`) is the Battle-class main gun, authored against the approved
Jutland (pbsd109) A1/B1 artillery visual `bgm087_4_5in_45_mk4_2barrels`. The same resource is fitted
at all five main positions on Jutland and on Barfleur (pbsd719) and Somme (pbsd519). The Drake
(pbsc209) secondary `bgs128_4_5in_45_mk4_2barrels` is the same mesh re-exported — identical vertex and
triangle sets, identical bounds, only the buffer ordering differs — so the two are registered as one
part rather than two. The resource name is what the part is named for: World of Warships calls the
gun "4.5 in /45 Mk IV", and the brief's "Battle class" twin is this mounting.

The catalog `gunhouseMesh` is both the armor and the visible shell: a 2.16 m circular face arc
carried back on slightly flaring sides to a flat 4.68 m transom, vertical flanks to a 1.71 m knuckle,
then an inward-sloping upper face and a flat roof at 2.29 m. The recipe adds the fixed divider
between the two gun ports, the two elevating port shields with their muzzle collars, a recoil
cylinder and slide lug on each cradle, two sliding barrels with muzzle rims and recessed bores,
breech rings, the two rear access doors with handles and step brackets, the rear-wall ladder and its
head rail, the rear working platform on three brackets, the starboard ready-use locker, the flank
sight hoods seated on the plate they cut, and the roof hatch coaming and grab rails.

Datums come from the approved model's joint nodes: trunnion 0.101 m forward of the yaw axis at
1.388 m, muzzles 4.899 m forward, 0.948 m apart. The mounting is a between-decks mounting, so the
shell's skirt is the sole and the Shipbuilder owns the trunk below it. Elevation is the commonly
published −10°/+80° for the twin BD mounting.

Known approximations: the roof plan is a smooth taper rather than the source's stepped roof edge at
x = 0.47 m; the rear bustle and rear wall are merged into one 4.58 m transom; the port sill sits at
0.65 m and the back wall 0.65 m abaft the yaw axis, against 0.86 m and 0 m on the source, which is
what lets the shields and breeches clear at +80°. The approved model has no canvas gun-port covers,
so none are authored and `gun_bloomers` is not used.

### 4.5-inch QF Mk V twin

`qf-45-mkv-twin` (`qf_45_mkv_twin.py`) is the Daring-class main gun, authored against the approved
Daring (pbsd110) A1 artillery visual `bgm102_4_5in45_mk_5`. The cruiser secondary
`bgs034_4_5in45_mk_5` (Cheshire pbsc508 and sisters) is **byte-identical** to it — same vertex
positions, same index buffer, same hashes — so the two are one part. The source's 3.9 m overall
height is not the gunhouse: the roof crowns at 3.46 m and the extra 0.4 m is the after guard rails
and the ladder stanchions standing on it; there is no radar or tall shield on this visual.

The `gunhouseMesh` is the rounded 5.05 × 3.96 m gunhouse: a flat 2.23 m face, faceted forward
shoulders, parallel flanks, a tapered stern closing on a 1.3 m transom, and the roof rounded in from
a 2.96 m knuckle to a 3.44 m crown, with the gun slot cut through the face and the roof. It begins at
0.66 m, on the trunk; the recipe draws the 1.83 m deck ring, the 1.675 m trunk, eight trunk brackets,
the port divider, both elevating shields and their collars, recoil cylinders and slide lugs, the two
sliding barrels, the tapered-stern ladder carried above the roof, two roof hatch coamings, the after
guard rails on posts, flank handrails on standoffs at two heights, and the forward sight hoods.

Datums from the joint nodes: trunnion 0.711 m forward at 2.169 m, muzzles 5.448 m forward, 0.886 m
apart. Elevation is the commonly published −15°/+80° for the Mk VI twin mounting.

Known approximations: the plan is a 15-point polygon against the source's smoothly rounded corners,
and the roof is one faceted round-over rather than a continuous surface; the slot sill is 1.35 m
against 1.65 m on the source, which is what lets the barrel and shield clear at +80° and −15°.

### 4.5-inch QF Mk IV single

`qf-45-mkiv-single` (`qf_45_mkiv_single.py`) is the single shielded mounting at Jutland's HP_BGM_3,
authored against `bgm093_4_5in_45_mk4_1barrel`; no other vehicle in the scan carries it. It is the
same gun as the twin above, in a shield rather than a gunhouse.

The approved shield is an open-backed thin plate with a separate rear canopy over the loading space.
The catalog `gunhouseMesh` is the **closed wedge solid** of that envelope — a 3.03 × 2.94 m shield
rising to a 2.41 m crown with the gun slot cut through the face and the crown — so the crew space
behind it is not represented in the armor and the mount reads as closed from astern. The recipe adds
the three-step pedestal between the deck and the shield floor, the rear canopy with its fascia,
cheeks, stays and floor plate, the elevating port shield with its collar, the recoil cylinder and
slide lug, the sliding barrel, the layers' sight hoods and glasses, the training handwheels on their
shafts, the rear steps and the flank grab rails.

Datums from the joint nodes: trunnion 0.162 m **abaft** the yaw axis at 1.623 m, muzzle 4.665 m
forward. Elevation is the commonly published −10°/+80°.

Known approximations: the closed back described above is the material one; beyond it the shield plan
is a 13-point polygon against the source's rounded brim, the canopy is a flat roof rather than the
source's curved hood, and the slot sill (0.88 m) and back wall (0.95 m abaft the yaw axis) are cut
deeper than the source's so the barrel clears at +80°.

### Building and checking

```sh
bun run part:build qf-45-mkiv-twin
bun run part:check qf-45-mkiv-twin
bun run part:build qf-45-mkv-twin
bun run part:check qf-45-mkv-twin
bun run part:build qf-45-mkiv-single
bun run part:check qf-45-mkiv-single
```

Library review stays `unreviewed` for all three until installation review passes.

## 4-inch QF Mk XIX twin

`qf-4-mkxix-twin` and `qf-4-mkxix-twin-enclosed` are the two original reusable
4-inch QF Mk XVI high-angle guns on the twin Mk XIX mounting (`qf_4in_mkxix.py`,
entry points `create_mount` and `create_enclosed_mount`). Geometry follows two
approved GameModels3D visuals; it is independently authored from measured
proportions and is not historical certification.

### The two hoods

`qf-4-mkxix-twin` is the open-backed hood of the
[Black Swan A artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsc101)
visual `bgs006_4in45_qf_mk_xix`. The same visual is the high-angle secondary of
Fiji (pbsc107), Belfast (pbsc507), Edinburgh (pbsc108), Hood (pbsb507),
Warspite (pbsb002) and Iron Duke (pbsb105), so one part covers the sloop main
battery and the capital-ship secondary fit.

`qf-4-mkxix-twin-enclosed` is the fully plated hood of the
[Devonshire secondary](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsc206)
visual `bgs127_4in45_qf_mk_xix`, shared with London (pbsc516), Belfast 1943
(pbsc528) and Sinann (pbsc708). The two visuals were rendered side by side at a
common scale before the split: they carry the same trunnion, muzzle and barrel
spacing datums and the same flanks and raked front, but the second runs its
plating 0.6 m further aft over a closed, overhanging tail instead of ending at
an open rim, and it is 0.9 m longer and 940 triangles heavier. That is a visible
difference in every view from astern, so they are registered as two parts rather
than merged.

### Authored geometry

The catalog `gunhouseMesh` is both the armor and the visible hood: a seven- or
nine-station loft of the flanks, rolled shoulders, crown and raked front, closed
underneath by the gunhouse floor at 0.39 m. The open-backed hood declares its
rear rim as an `open-back` aperture; the enclosed hood closes that end with a
tail cap and an overhanging underside. Both declare the two crown gun-port slots
either side of a 0.12 m centre rib as apertures. A solidify skin gives the plate
its 14 mm thickness inboard only, so the outer facets remain exactly the
catalog's.

The recipe adds the 0.98 m sole and roller path with sixteen rollers, the
working platform (full width and railed abaft the open hood; narrow, with a rear
door, under the plated tail), ready-use lockers, the centreline hoist trunk and
ready-round racks, three trunnion standards with their bearing caps, the forward
transverse frame, both layers' seats, handwheels on their gear housings and
sighting telescopes. Each gun carries a cradle, recuperator, elevating arc,
breech block and lever and a loading tray, with one connected sliding surface
from breech to muzzle, and a flexible `gun_bloomers` canvas cover whose fixed
seam follows its port slot and whose cuff rides the constant 0.135 m jacket.
Intermediate cloth rings are lifted onto the plating and kept outside the sleeve
through the whole travel.

Pivot, spacing and muzzle datums come from the approved models' joint nodes
(`Rotate_X` at 1.879 m and 0.131 m abaft the sole datum, `gunFire` at 3.538 m,
0.54 m apart); both visuals give identical figures. The 45-calibre barrel
length checks against the 4-inch bore.

### Values and approximations

Elevation limits of −10° to +80° are the **commonly published figures for the
twin Mk XIX high-angle mounting, not measurements from the approved models**:
both visuals close their crown over the guns, `bgs127` only from about 0.2 m
abaft the trunnion. A closed crown fouls the barrels above roughly +30°, so the
authored hoods carry the two port slots forward from 0.30 m abaft the trunnion.
That is a deliberate mechanical deviation from the visuals and the only one in
the silhouette above the shoulders.

Muzzle speed (811 m/s), shell mass (15.88 kg) and calibre are the published
figures for the Mk XVI gun. Reload, traverse and elevation rates, penetration,
damage, ammunition, mount mass and the 6 mm splinter plate are provisional game
calibration scaled from the 10.5 cm C/33 twin and BL 4-inch Mk IX siblings, kept
physical so the simulation can apply the world pace; they are not certified
firing data. No `ap`/`he` stock tables are authored here, matching the nearest
open high-angle sibling; run `assets/parts/author-ap.ts` and `author-he.ts` if
the battery needs them.

Known approximations: the open hood's rear flanks are carried to the floor on a
single transverse rim, where the approved visual rakes them forward from the
crown; the aft working platform is a plain rectangle rather than the visual's
stepped outline; interior loading gear, seats and sights are representative
rather than matched fitting for fitting; the enclosed hood's nose is coarser
than the open one's because both meshes stay inside the 128-facet budget.
Library review stays unreviewed until installation review passes.

```sh
bun run part:build qf-4-mkxix-twin
bun run part:check qf-4-mkxix-twin
bun run part:build qf-4-mkxix-twin-enclosed
bun run part:check qf-4-mkxix-twin-enclosed
```
