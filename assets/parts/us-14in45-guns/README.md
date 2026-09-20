# US 14-inch/45 Mk 8 mounts

Two original reusable turrets for the Shipbuilder catalog: the New York-class
twin and the Pennsylvania-class triple. They are one family — a round-nosed
shell with sloping flanks on a wide turntable ring, a deeply raked face plate
and canvas gun-port covers — so `us14in45_common.py` owns the rig, the plate
casting, the sliding barrels, the covers and the service fittings, and each
recipe file owns only its own stations and fittings.

Geometry is independently authored from measured proportions of the approved
GameModels3D visuals; no reference mesh is loaded, copied or shipped, and this
is not historical certification. In both entries the catalog `gunhouseMesh` is
both the armor and the visible gunhouse; the recipe draws that shell and adds
everything outside it. The support attachment is the turntable sole at Y = 0
and nothing static sits below it — the Shipbuilder owns the barbette beneath.

Weapon and armor values are provisional game calibration; plate families use
commonly published figures with estimated facet boundaries. Library review
stays `unreviewed` until installation review passes.

## 356 mm/45 Mk 8 twin — `us-14in45-mk8-twin`

Source vehicle [New York (pasb006)](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasb006),
visual `agm125_14in_45_mk8`. New York and Texas carry this mount at all five
positions. Texas' second visual `agm126_14in_45_mk8` is **merged into this
part**: its 88-triangle armor shell is vertex-identical to `agm125`'s (same 50
welded vertices at 1 mm rounding). The coordinator's ledger scores the pair
0.076 m apart and a resampled symmetric mean chamfer here gives 0.060 m — both
at or under the 0.073 m noise floor. The only differences are
service fittings: `agm126` drops the roof handrails and the rear roof riser and
adds a second pair of flank ladders amidships. This part follows the registered
`agm125` arrangement.

Shell: a 2.0 m wide vertical rear plate, a rear chamfer opening to the full
5.54 m knuckle at x = −6.67, flanks raking inboard from a floor edge widest at
x = 0 (±4.27 m) to a constant ±2.77 m roof knuckle, a shallow shouldered roof
falling from 2.61 m aft to 2.48 m forward, and a 44° glacis from the roof break
at x = 1.72 down to a narrow nose lip at x = 4.13. Nine lofted stations, 63
vertices, 122 facets.

Fittings: the 4.70 m turntable sole; a raised transverse riser over the rear
roof and a splinter coaming at the head of the glacis; two hinged sighting
hoods with hinge rod, lugs, vision slit and handle; a low welded rail on
stanchions along each roof edge; a flank ladder on standoffs up the port
quarter with its foot step; a centre ladder up the glacis between the gun
ports; raised gun-port frames; and two sliding barrels with tapered chase,
muzzle swell and dark bore.

Datums taken from the reference joint nodes: yaw on the sole, trunnion
2.239 m forward at 1.228 m, muzzle 13.714 m forward, barrel spacing 2.232 m.
Barrels slide 1.1 m through `gun_bloomers` cuffs on a constant 0.465 m jacket
that spans the whole stroke; the fixed seams are cast onto the real glacis and
the intermediate cloth rings are draped over the armor and kept outside the
jacket at every 5° step.

## 356 mm/45 Mk 8 triple — `us-14in45-triple`

Source vehicle [Arizona (pasb506)](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasb506),
visual `agm162_14in45_triple`, carried by Arizona at its three-turret positions. The
middle-turret visual `agm163_14in45_triple` is **merged into this part**: its
shell is vertex-identical to `agm162`'s (same 65 welded vertices), and every
one of its 65 components is also present in `agm162` — `agm163` simply omits
the roof-rail stanchions and the flank ladder. The coordinator's ledger scores
the pair 0.083 m apart (0.090 m resampled here), i.e. at the 0.073 m noise floor
and accounted for entirely by those missing rails.

Shell: a rounded transom, a cambered roof (a parabolic 0.44 m crown-to-knuckle
camber, crown falling from 3.04 m aft to 2.77 m forward), flanks raking in to a
constant ±2.97 m knuckle from a floor edge widest at x = 0 (±4.62 m), and a
warped 46°–52° face plate running from a curved roof break near x = 2.2 down to
a straight front lip at x = 4.65. Nine lofted stations, 63 vertices, 122 facets.

Fittings: the 5.02 m turntable sole with its ring of radial foot brackets (laid
out by casting the gunhouse foot radius, so the wider rear quarters carry none,
as on the reference); the splinter coaming at the head of the glacis; the two
rangefinder end hoods on the rear corners, each a housing rooted in the upper
flank carrying a pod, bracket, cap and end window reaching 4.38 m off the
centreline; the rear-quarter equipment fairings; the two AA seatings the
reference rig carries on the after roof (`HP_AF_1/2` at x = −6.59, y = ±0.77);
roof edge rails fore and aft of the ladder; a port flank ladder on standoffs;
forward sole rails; and three sliding barrels with tapered chase, muzzle swell
and dark bore in long canvas sleeves.

Datums from the reference joint nodes: trunnion 2.799 m forward at 1.119 m,
muzzle 14.106 m forward, barrel spacing 1.308 m. The 0.435 m jacket carries the
cuff through the 1.1 m stroke.

## Approximations and what was left out

- The lofted shells trade a few centimetres of plan accuracy for the 128-facet
  budget: the twin drops four floor-edge vertices (worst error 0.13 m) and the
  triple three (worst 0.17 m), and the triple's four-point rings approximate the
  roof camber to within 0.03 m. The triple's rearmost 0.06 m tip is not modelled.
- The reference's 0.08–0.10 m skirt lip along the flank foot is folded into the
  side facet rather than modelled as a separate step, except at the nose and the
  front lip where it carries the face plate.
- The real jackets taper slightly over the recoil stroke; ours are constant
  there, as the sliding weather seal requires. The barrels stop just behind the
  trunnion so the breech end stays inside the gunhouse and above the sole at
  full elevation and recoil — the reference hides the same region inside the
  gun-port shrouds.
- Cloth folds, plate seams, hoists, the interior and the small rear items the
  reference hangs below its sole plane are not modelled.
- Elevation uses the commonly published limits for these mounts (−5° to +30°)
  rather than a recovered mechanical stop. Note that as built both classes were
  limited to about +15°; the catalog table uses the modernised limit. At full
  depression the muzzles necessarily pass below the mount's own sole plane, 11 m
  out; no static structure does.

## Build

```sh
bun run part:build us-14in45-mk8-twin
bun run part:check us-14in45-mk8-twin
bun run part:build us-14in45-triple
bun run part:check us-14in45-triple
```
