# United States battleship gun mounts

Original reusable heavy US triples for the Shipbuilder catalog. The catalog owns
the closed armor shell (`gunhouseMesh`, which is both the armor and the visible
enclosure) and the weapon data; the recipes here own the roller path, the
service fittings, the sliding barrels and the cloth gun-port covers. The
attachment is the sole plane at Y = 0; the Shipbuilder owns the barbette below
it. Geometry is independently authored from measured proportions against the
approved GameModels3D visual references; no reference mesh is loaded, shipped or
used as a builder input, and this is not historical certification.

The Iowa 16-inch/50 Mk 7 (`us-16in50-mk7-iowa`, `assets/parts/us-main-guns`) is a
separate, earlier part and is not touched by either recipe.

## 406 mm/45 Mk.6 triple

`us-16in45-mk6-triple` is the original reusable North Carolina and South Dakota
main turret (`mk6_triple.py`, builder `us-mk6-triple`). Geometry follows the
approved [GameModels3D North Carolina A artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasb012)
visual `agm012_16in45_mk6`. That one visual is fitted at all three turret
positions of the ships checked in both classes — North Carolina (pasb012),
Alabama (pasb508) and Massachusetts (pasb518) — so one part covers them and
there is no rangefinder variant to split off.

The catalog `gunhouseMesh` is the armor and the visible shell: a six-station
loft with the 41° raked face, flanks that flare out to a 1.44 m belt knuckle and
fall back in to a flat 2.86 m roof, a plan that widens from the chamfered rear
corners to a 12.24 m beam abreast the guns, and a floor that lifts aft into the
rear overhang. The recipe adds the 6.25 m roller path, four ladders climbing the
raked face on welded shoes, the low roof-edge rails on their stanchions, two
chamfered sight hoods per flank behind rain flanges with forward-facing optical
slits, the rear rangefinder hoods with their cap plates lying on the roof, the
starboard rear access platform on gusset brackets, the shallow starboard
under-floor fairing and the drip brackets along the lower side plate.

Joint datums are taken from the reference's own joint nodes: yaw on the sole,
trunnions 4.08 m forward at 1.407 m, barrels on the centreline and ±2.94 m, and
muzzles 16.86 m forward. Barrels slide through flexible `gun_bloomers` cuffs on
a constant 0.54 m jacket that spans the 1.2 m recoil stroke; the fixed seams are
cast onto the real raked face and the intermediate cloth rings are draped over
the armor and kept outside the jacket, so the covers stay seated from −2° to
+45° and through full recoil.

Approximations: the reference's rounded under-floor belly and the part of its
starboard training-gear fairing that hangs below its own roller plane are lifted
onto the sole plane (nothing may sit below the yaw datum); the face carries no
aperture, so each barrel passes through the closed armor behind its cover; cloth
folds, sight optics, the rangefinder's internal brackets and small service
fittings are approximations. Weapon and armor values are provisional game
calibration; plate families use commonly published figures (406 mm face, 241 mm
side, 292 mm rear, 178 mm roof) with estimated facet boundaries. The reference
publishes no elevation stops, so the catalog's −2°/+45° interval follows commonly
published limits rather than a recovered mechanical stop. Library review stays
unreviewed until installation review passes.

```sh
bun run part:build us-16in45-mk6-triple
bun run part:check us-16in45-mk6-triple
```

## 305 mm/50 Mk.8 triple

`us-12in50-mk8-triple` is the original reusable Alaska-class main turret
(`alaska_triple.py`, builder `us-alaska-triple`). Geometry follows the approved
[GameModels3D Alaska A artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc510)
visual `agm177_12in50_mk8_triple`, which that ship fits at all three positions,
so one part covers the ship checked (Alaska, pasc510). At 12 inches the gun sits exactly on the
capital-gun threshold, so it is built to the same standard as the 16-inch
mounts: closed articulated covers, one cover per barrel, and a closed armor
shell.

The `gunhouseMesh` is a seven-station loft: a rounded back plate carried on
three facets, a single tumblehome side plate from the floor line to the roof
line, a 9.92 m beam abreast the guns, the roof breaking down at x = 2.61 m and
the 41° raked face below it. The recipe adds the 5.13 m roller path, four
ladders on the face with hand-hold hoops at the roof knuckle, the vertical flank
ladder and its roof hoop, two sight hoods per flank, the swept rangefinder
wings — tapered arms let through the after shoulder, capped outboard and carrying
the optical window and eyepiece box — the athwartships roof grab rail, the
starboard roof hatch, the flank grab stanchions on their feet and the drip
brackets along the lower side plate.

Joint datums come from the reference's joint nodes: trunnions 2.358 m forward at
1.212 m, barrels on the centreline and ±2.49 m, muzzles 13.923 m forward. The
barrels slide on a constant 0.425 m jacket through the 1.0 m recoil stroke, with
the same cast-seam, draped-ring cloth treatment as the Mk 6.

Approximations: the rear undercut is lifted onto the sole plane and the rounded
back plate is reduced to three facet stations; the rangefinder wing is a tapered
solid without its inner bearing structure; cloth folds, optics and small service
fittings are approximations. Weapon and armor values are provisional game
calibration; plate families use commonly published figures (325 mm face, 133 mm
side and rear, 127 mm roof) with estimated facet boundaries. The reference
publishes no elevation stops, so the catalog's −3°/+45° interval follows commonly
published limits. Library review stays unreviewed until installation review
passes.

```sh
bun run part:build us-12in50-mk8-triple
bun run part:check us-12in50-mk8-triple
```

## 406 mm/45 Mk.1 twin

`us-16in45-mk1-twin` is the original reusable Colorado-class main turret
(`mk1_twin.py`, builder `us-mk1-twin`). Geometry follows the approved
[GameModels3D Colorado A artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasb008)
visual `agm156_16in45_mk1`, fitted at all four turret positions; the West
Virginia 1941 fit (pasb507) carries the same shape, so one part covers both
ships and there is no rangefinder variant to split off.

This is a deliberately low-detail source — the shell is 120 triangles and the
model carries no ladders, hatches or sight hoods — so the recipe adds only what
the visual shows and invents nothing. The `gunhouseMesh` is a six-station loft:
a narrow back plate, sides that flare to a 10.56 m beam abreast the guns and
draw back in forward, a roof that rises aft from 2.28 m at the head of the face
to 2.96 m over the back plate, and the 41° raked face below it. The recipe adds
the 5.10 m roller path, the two rangefinder arms lying across the after
shoulders with their raised optical blocks and windows, the roof sighting post,
and the sole footboards whose outboard edge follows the shell's floor line, with
the step cleats standing astride it.

Joint datums come from the reference's joint nodes: trunnions 2.976 m forward at
1.107 m, barrels ±1.037 m, muzzles 16.018 m forward. The barrels slide on a
constant 0.52 m jacket through the 1.2 m recoil stroke, with the same cast-seam,
draped-ring cloth treatment as the other two mounts; the reference's gun-port
hoods are close-fitting, so these covers are correspondingly tight.

Approximations: the six stations round off the reference's small forward corner
chamfer; the rangefinder arms are solid slabs without their bearing structure;
cloth folds and the cleats are approximations. Weapon and armor values are
provisional game calibration; plate families use commonly published figures
(457 mm face, 241 mm side, 229 mm rear, 127 mm roof) with estimated facet
boundaries. The reference publishes no elevation stops, so the catalog's
−3°/+30° interval follows commonly published limits. Library review stays
unreviewed until installation review passes.

```sh
bun run part:build us-16in45-mk1-twin
bun run part:check us-16in45-mk1-twin
```
