# US 14-inch/50 three-gun turrets

Two original reusable triple mounts for the same 14-inch/50 gun, `us-14in50-newmexico-triple`
and `us-14in50-tennessee-triple`. The catalog owns the closed armor shell and the weapon data;
`common.py` owns the rig, the rotating sole, the sliding jackets and the canvas seals that both
classes share, and the two recipes beside it own everything that differs. Geometry is
independently authored from measured proportions; this is not historical certification.

The two approved visuals are **not** the same shell. Sampling both gunhouse bodies at a common
scale gives a mean Chamfer distance of 0.115 m in both directions, a 95th percentile of 0.21 m
and 21% of each surface more than 0.15 m from the other, so they are registered as two parts
rather than one shape with a flag. What differs is listed under the Tennessee section below.

Weapon and armor values are provisional game calibration; plate families use commonly published
figures with estimated facet boundaries. The sources carry no elevation stops, so both parts use
the commonly published limits of −5° to +30° with a 1.15 m recoil stroke. Fine cloth folds, plate
seams and the small service fittings remain approximations. Library review stays unreviewed until
installation review passes.

## 356 mm/50 New Mexico triple

`us-14in50-newmexico-triple` (`newmexico_triple.py`, builder `us-14in50-newmexico`) follows the
approved [GameModels3D New Mexico artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasb034)
visual `agm065_14in50_3gun_turret`, which that model fits at all four turret positions. It is the
New Mexico-class mount as WoWS models it (New Mexico, pasb034); no other visual was merged into it.

The catalog `gunhouseMesh` is the armor and the visible shell both: a six-station faceted body
2.88 m tall, 12.88 m long and 10.64 m across, with a shallow-vee rear plate, flanks that lean in
about 22° from the 5.32 m half-breadth at the sole to the 4.32 m roof edge, **one flat roof plane**
falling 0.57 m from the rear to the forward edge, and a glacis raked about 41° from vertical.
Plate families are 457 mm face, 229 mm side, 127 mm roof and 229 mm rear; the rear vee and the
forward cheeks are carried at the rear and face figures through the loft's interval overrides.

The recipe adds the 5.02 m sole and roller path, the rectangular gun-port frames cut into the
glacis (brow, sill and two jambs, each seated on the plate at its own height because the face
rakes aft), sliding 12-sided jackets that taper 0.62 m to 0.49 m over the 3.89 m out to the jacket
mouth, canvas seals on a rounded-rectangle seam bolted to each frame, the **rangefinder end hoods**
that project outboard to y ±5.35 at the after quarters with a rounded weather cap and an optical
window in the outboard end, the **louvred hoist fairings** on the after flanks, the after crew
hatch, a training-sight hood and the slim periscope mast that reaches 3.47 m on the roof
centreline, roof-shoulder periscope hoods, flank ladders on standoffs, grab rails and the sole toe
blocks. The support attachment is the sole at Y = 0; the Shipbuilder owns the barbette below it.

Joint datums are taken from the reference joint nodes: trunnion 2.889 m forward at 0.996 m above
the sole, 1.812 m barrel spacing, muzzles 15.741 m forward. Barrels taper 0.41 m to 0.29 m with a
0.315 m muzzle swell and slide through the cuffs on a constant 0.56 m jacket band that spans the
full recoil stroke.

Approximations and omissions: the reference's rear plate runs to a true point on the centreline
and this shell keeps a 0.40 m wide blunt rear facet so the loft stays closed; the reference's
hoist fairing and one small rear fitting dip about 0.05 m below the sole plane and are seated on
it here; the reference's four flank louvre tabs are drawn as a recessed vent band with four slats;
the three roof AA hardpoints are not modelled (the ship owns any turret-top mounting); the thin
sole plates that the reference draws outside the shell are covered by the full turntable disc.

```sh
bun run part:build us-14in50-newmexico-triple
bun run part:check us-14in50-newmexico-triple
```

## 356 mm/50 Tennessee triple

`us-14in50-tennessee-triple` (`tennessee_triple.py`, builder `us-14in50-tennessee`) follows the
approved [GameModels3D Tennessee artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasb718)
visual `agm049_14in50_3gun_turret`, which California (pasb707) shares. No other visual was merged
into it.

Its shell is a seven-station faceted body 2.97 m tall, 12.99 m long and 10.66 m across. Plate
families are 457 mm face, 241 mm side, 127 mm roof and 229 mm rear.

What differs from the New Mexico shell, measured from the two references in the same frame:

| | New Mexico `agm065` | Tennessee `agm049` |
| --- | --- | --- |
| Rear plan | one vee facet: centre (−8.30, 0) straight to the after corner (−7.55, 3.64) | an extra chamfer: centre (−8.33, 0) to (−7.92, 2.64) to (−7.58, 3.64), and both rear facets stand vertical |
| Roof | a single flat plane, 2.88 m aft falling to 2.31 m forward (2.9°) | an outer plane 2.84 m falling to 2.21 m (3.4°) with a 0.11 m border band and a panel raised 0.10 m inside it — total height 2.94 m |
| Glacis rake | about 41° from vertical | about 46° from vertical, reaching further forward (4.74 m against 4.64 m) |
| Gun ports | rectangular frames recessed into the plate, 1.23 m wide and 1.49 m tall | no frame at all; the plate is clean and each gun carries a tall rounded canvas hood 2.70 × 1.39 × 1.86 m |
| Sliding jacket | 12-sided, 0.62 m to 0.49 m, from the trunnion out to 6.77 m | short, 0.48 m to 0.44 m, only from 5.42 m to 6.82 m — the rest is under the cloth |
| Face fittings | three cleats on the sole below the ports | five rows of small cleats around each port on the plate, the seam bolts of the cover |
| After quarters | rangefinder end hoods out to y ±5.41 at z 2.10–2.76 | **none** |
| After flanks | a proud hoist fairing to y ±4.55 with a four-slat louvre band | **none** |
| Roof centreline | a 0.78 m periscope mast reaching 3.47 m | nothing standing |
| Sole | thin plates outside the shell, outer radius about 5.02 m | a full 5.19 m disc 0.10 m thick, the shell floor 0.07 m above it |
| AA hardpoints | three on the after roof | six |
| Shared | trunnion 2.889 m / 0.996 m, spacing 1.812 m, muzzle 15.741 m | trunnion 2.748 m / 0.942 m, spacing 1.813 m, muzzle 15.739 m — the same gun on the same roller path |

The recipe adds the 5.19 m sole and roller path, the short sliding jackets, the tall hooded canvas
seals that give this variant its blistered face, the ring of seam cleats bolted round each port,
roof periscope hoods, the after crew hatch and training-sight hood, ventilation hoods on the after
plate, flank ladders on standoffs, grab rails and the sole steps. The support attachment is the
sole at Y = 0.

Approximations and omissions: the roof border rim is drawn as a chamfer between the outer band and
the raised panel rather than as a flat band with a separate riser, to stay inside the shell's
128-vertex budget; the rear plate keeps a 0.40 m wide blunt facet on the centreline; the after
ventilation hoods and the roof hoods are plausible fittings rather than features the reference
shows, and they are kept low enough not to break the reference silhouette; the six roof AA
hardpoints are not modelled; the reference's circular floor arc over the roller path is closed
flat by the loft.

```sh
bun run part:build us-14in50-tennessee-triple
bun run part:check us-14in50-tennessee-triple
```
