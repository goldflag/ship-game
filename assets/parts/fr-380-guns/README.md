# French battleship quadruple main-gun mounts

## 380 mm/45 Model 1935 quadruple

`fr-380-45-mle1935-quad` is the original reusable Richelieu main turret
(`mle1935_quad.py`). Geometry follows the approved
[GameModels3D Richelieu main artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pfsb108)
visual `fgm049_380mm_45_mle_1935`. Richelieu, Jean Bart and Gascogne
(`pfsb108`, `pfsb518`, `pfsb508`) all fit that one visual at every position, so
there is a single variant and no rangefinder or short-rear sibling to merge.
Geometry is independently authored from measured proportions; this is not
historical certification.

The catalog `gunhouseMesh` is both the armor and the visible shell: a seven
station loft with vertical flanks that widen from 5.05 m half-breadth at the
chamfered back plate to 6.15 m amidships, a knuckle that rises from 2.15 m at
the face to 2.90 m aft, one shoulder chine into a 4.40 m half-breadth roof, and
a roof that slopes from 3.64 m down to 2.77 m over the guns. Plate families use
the commonly published 430 mm face, 300 mm side, 270 mm rear and 195 mm roof
figures with estimated facet boundaries; the rear corner interval carries the
rear family.

The recipe adds the 7.13 m rotating sole flange (cut off along the two rear
quarter lines, as the reference roller ring is), the two short flank walkways on
its rim with their two-rail guards, the rear-quarter rangefinder pods with
recessed optical panels and window housings, the trainers' armored sight
scuttles half sunk into the flanks, shoulder grab rails, the forward roof
sighting hood with its periscope, a roof hatch, and the gun-port frame: three
partitions between the four ports carrying access rungs, a lintel that rises
forward off the roof knuckle and a sill lying on the sole flange. The support
attachment is the sole at Y = 0; the Shipbuilder owns the barbette below it.

Barrels slide through flexible `gun_bloomers` cuffs on a constant 0.41 m jacket
that spans the 1.2 m recoil stroke, then taper to a 0.348 m muzzle rim. The
fixed seams are bedded in the front rim of the port frame, and intermediate
cloth rings are draped over the armor and kept outside the jacket at high
elevation. Pivot (3.44 m forward, 1.14 m high), muzzle reach (16.11 m) and the
barrel axis heights come from the approved model's `Rotate_X`, `Roll_Back` and
`gunFire` joint nodes.

Approximations, beyond the usual cloth and small-fitting simplifications:

- **Barrel spacing.** The reference `gunFire` nodes put the bores at ±1.466 m
  and ±3.416 m — two pairs with a wider gap between the inner pair, because of
  the central partition. `barrel_layout` only supports one even pitch for a
  quadruple, so the catalog `barrelSpacing` is 2.28 m: the outer bores land
  within 5 mm of the reference and the inner bores sit 0.33 m too far inboard.
  That is the least-squares best even pitch and the whole top-view difference.
- **Face rake.** The reference face is one plane raked about 17°, from x = 5.16 m
  at the floor to x = 4.34 m at the roof. The armor shell draws it as one upright
  plate at x = 4.70 m; the gun-port frame and the canvas hoods stand in front of
  it, so the rake is not visible in any silhouette.
- **Gun-port hoods.** The reference carries four rigid flared shrouds from the
  roof knuckle down to the barrels. They are reconstructed as articulated canvas
  covers on a raised port frame, so they follow elevation and recoil.
- **Frame partitions** are 0.62–0.68 m wide rather than the reference 0.36–0.42 m,
  so the canvas seams are bedded in real structure instead of floating.
- The small pads the reference hangs below its sole plane are omitted; nothing
  sits below the yaw datum.

Elevation is carried at the commonly published limits of −5° to +35°; the source
model carries no elevation stops. Weapon and armor values are provisional game
calibration (884 kg at 830 m/s, 30 s reload). Library review stays unreviewed
until installation review passes.

Measured at 3 230 triangles and 15.10 × 3.64 × 25.14 m. Silhouette IoU against
the reference at a common scale and rest pose: side 0.969, top 0.940, front
0.967, rear 0.967, iso 0.958.

```sh
bun run part:build fr-380-45-mle1935-quad
bun run part:check fr-380-45-mle1935-quad
```

## 330 mm/52 Model 1931 quadruple

`fr-330-52-mle1931-quad` is the original reusable Dunkerque main turret
(`mle1931_quad.py`). Geometry follows the approved
[GameModels3D Dunkerque main artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pfsb506)
visual `fgm001_330_52_mle_1931`. The Strasbourg visual
`fgm007_330_52_mle_1931_prem` (`pfsb507`) is the same shape and is covered by
this one part: the two carry identical joint nodes (`Rotate_X` at 3.345 m /
1.006 m, muzzle at 15.344 m, bores at ±1.234 m and ±2.928 m) and their surfaces
differ by a 0.10 m mean separation that is confined to added flank ladders and
rails, the same relationship the catalog already treats as one shape for the
Texas and Repulse visuals. No separate part id was added.

The catalog `gunhouseMesh` is again both the armor and the visible shell: a
seven station loft with a short rear chamfer to the centreline apex, flanks that
widen from 3.99 m to 5.06 m half-breadth, a knuckle that falls from 2.70 m aft
to 1.83 m over the guns, one shoulder chine into a roof edge near 3.71 m
half-breadth, a roof that is flat at 3.08 m to x = −2.80 m and then slopes
forward, and a strongly raked face carried by the last loft interval (from
x = 3.95 m at the roof to x = 4.62 m at the floor, about 19°). Plate families
use the commonly published 330 mm face, 250 mm side, 270 mm rear and 150 mm roof
figures with estimated facet boundaries.

The recipe adds the 5.10 m turntable, the rear-quarter rangefinder pods with
their outboard optical panels, windows and forward end plates, the trainers'
armored sight scuttles, shoulder grab rails, the forward roof sighting hood, the
starboard-only trainer's periscope cluster the reference carries there, and the
gun-port frame (three partitions with access rungs, a lintel that rises forward
off the roof knuckle, a sill on the floor). Barrels slide through
`gun_bloomers` cuffs on a constant 0.42 m jacket that spans the 1.0 m recoil
stroke, then taper along this gun's long chase to a 0.272 m muzzle rim.

Datums and approximations:

- **Sole plane.** This reference draws below-deck structure: a 6.0 m radius
  roller disc at z = −0.44 … −0.07 m, side sponsons down to −0.72 m, and 0.18 m
  of gunhouse skirt below z = 0. The part's yaw datum is the deck (reference
  z = 0) and none of that is drawn; the Shipbuilder owns the barbette. All other
  heights are the reference's own, so everything above the deck lines up.
- **Barrel spacing.** The reference bores sit at ±1.234 m and ±2.928 m. With the
  single even pitch `barrel_layout` allows for a quadruple, `barrelSpacing` is
  1.95 m: the outer bores land within 3 mm and the inner bores sit 0.26 m too
  far inboard.
- **Gun-port hoods.** The reference's four rigid shrouds are reconstructed as
  articulated canvas covers on a raised port frame. That frame's lintel stands
  about 0.5 m higher than the reference hoods, because the bores have to clear
  it at the full +35° elevation the catalog carries.
- Frame partitions are 0.70 m wide so the canvas seams are bedded in real
  structure; the reference partitions are narrower.

Elevation is carried at the commonly published limits of −5° to +35°; the source
model carries no elevation stops. Weapon and armor values are provisional game
calibration (560 kg at 870 m/s, 30 s reload). Library review stays unreviewed
until installation review passes.

Measured at 2 986 triangles and 12.70 × 3.10 × 23.59 m. Silhouette IoU against
the reference at a common scale and rest pose, comparing only what a deck-mounted
part can draw (reference triangles below the deck removed): side 0.942, front
0.975, top 0.913, iso 0.928. Against the unclipped reference, which includes its
below-deck disc, skirt and sponsons, the same views score 0.832 / 0.834 / 0.858 /
0.893.

```sh
bun run part:build fr-330-52-mle1931-quad
bun run part:check fr-330-52-mle1931-quad
```
