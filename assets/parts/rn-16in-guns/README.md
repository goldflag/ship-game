# Royal Navy 16-inch gun mounts

## 16-inch Mk I triple

`bl-16-mki-triple` is the original reusable Nelson class main turret
(`bl_16_triple.py`). Geometry follows the approved
[GameModels3D Nelson A artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb517)
visual `bgm066_16in45_bl_mki`
(`common/visual/uk/gun/main/bgm066_16in45_bl_mki/bgm066_16in45_bl_mki`). Nelson
(pbsb517) and Rodney (pbsb717) both fit that one visual at all three turret
positions, so there is a single variant and no rangefinder flag: the flanking
optical arms belong to the shape itself. No other visual was merged into it.
Geometry is independently authored from measured proportions; this is not
historical certification.

The catalog `gunhouseMesh` is both the armor and the visible shell: a thirteen
station enclosure with the semi-circular back plate that reaches 8.49 m abaft
the training axis, flanks that taper gently from their widest point just
forward of the axis and tumble in about 16 degrees, a roof crowned 2 degrees
from the centreline, and the long face raked 23 degrees aft over its whole
2.7 m. At 14.14 m long and 11.38 m across the shell it is the widest mount in
this set; the rangefinder arms take the fitted part to 13.07 m overall. The
support attachment is the sole at Y = 0 and the Shipbuilder owns the barbette
below it, so `barbetteRadius` is 5.3 m against the 5.4 m turntable rather than
anything scaled from the shell's width; the gunhouse overhangs that sole fore
and aft exactly as the source does.

The recipe adds the turntable and roller path, the raised elevation-port rims
and coamings drawn onto the real raked face, the rangefinder arms (platform,
hood, transverse tube, root bracket, end window, locker and escape scuttle),
a flank ladder on each side laid on the tumblehome, the face ladder between the
centre and starboard guns, the starboard training-gear housing, the starboard
rear roof hatch, the two awning davits on the forward roof and the lifting eyes
along both roof knuckles. The one-sided fittings are one-sided in the source
too.

Pivot, spacing and muzzle datums come from the approved model's joint nodes:
`Rotate_X` gives the trunnion 3.523 m forward of the training axis at 0.912 m
above the sole, the three `gunFire` nodes give 2.488 m barrel spacing, and
`Roll_Back1` puts the muzzle 16.566 m forward. Barrels slide through flexible
`gun_bloomers` cuffs on a constant 0.543 m jacket that spans the whole 1.2 m
recoil stroke; the fixed seams are cast onto the real face around each port and
the intermediate cloth rings are draped over the armour at depression and kept
outside the jacket at high elevation.

Weapon and armor values are provisional game calibration; plate families use
commonly published figures (406 mm face, 254 mm side, 279 mm rear, 184 mm roof)
with estimated facet boundaries. The source carries no mechanical stops, so the
installed elevation range follows commonly published limits (−2° to +40°); the
canvas port is sized for the full range, which is a little taller than the
opening the source model shows. Known approximations: the shell floor sits
0.12 m above the sole plane where the source lets its floor and the gun-well
plate hang below the mount datum, so the model is flat-bottomed there; the
armour is closed and the elevation ports are read as rims, coamings and canvas
rather than as cut openings with a recessed tunnel; the rangefinder arms are
solid hoods instead of the source's open housings; and fine cloth folds, plate
seams and the full population of roof eyeplates remain simplified. Library
review stays unreviewed until installation review passes.

```sh
bun run part:build bl-16-mki-triple
bun run part:check bl-16-mki-triple
```
