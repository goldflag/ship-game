# 40 mm/56 Bofors quadruple mounts (US Mk 2 family)

Three catalog parts share one recipe, `assets/parts/us-bofors-quad/geometry.py:create_mount`, which
switches on `mount['weapon']['id']`. Geometry is original, drawn from measurements taken off the
approved GameModels3D references; no reference mesh, transform or texture is loaded, and nothing is
copied from another recipe.

| Part | Reference visual | Fitted to |
| --- | --- | --- |
| `us-40mm-bofors-mk2-quad` | `usa/.../aga008_40mm_bofors_mk2` | 43 ships, Independence, Yorktown, Iowa, Cleveland, Gearing, Laffey and others |
| `us-40mm-bofors-mk2-shielded-quad` | `usa/.../aga056_40mm_bofors` (and `uk/.../bga012_40mm_bofors_mk2`) | 43 US ships, Essex, Midway, Montana, Iowa, Baltimore, Alaska, plus 8 RN ships with the RP Mk II: Lion, Duke of York, Leander, Fiji, Uganda, Albemarle, Danu, River Gambra |
| `us-40mm-bofors-mk2-mk19-quad` | `usa/.../aga175_40mm_bofors_mk2_mk19` | Franklin D. Roosevelt, Wichita, Boise, Kidd |

`bga012` was compared against `aga056` triangle by triangle: 2989 triangles each, every triangle
matching in position, differing only in a handful of UV vertex splits and in the material grouping.
The RN RP Mk II is therefore the same model and is listed as a ship group of the shielded part
rather than a fourth recipe.

### What is modelled

Fixed to the training frame: the 14-sided sole ring and roller path, the pintle housing and the
centre machinery casing with the training motor, the carriage deck and its two side sills, the two
trunnion standards (each a pair of 58 mm cheeks round an open gun bay, with a heel, a forward nose
block and a bearing boss on the elevation axis), the trapezoidal loaders' platform on its bearers
and knees with slots for the chutes, the four-stanchion handrail round it, the two ready-service
lockers, the four curved ammunition chutes with clips lying in them, the four forward spent-case
chutes, and the two gunners' outriggers: bracket plate, cross beam, seat stalk, bucket seat and
back, footrest on its bracket, gearbox, shaft and spoked handwheel. The elevation and training power
drives sit on the front of the carriage, asymmetrically, as on the reference.

Elevating with the guns: one receiver housing per pair with a recessed side panel and a dark front
recess, the toothed elevating arc (a circular segment of radius 0.515 m about the trunnion) with its
pinion, the cradle guides and recoil cylinders, the front cradle brackets, the automatic loader guide
and a loaded clip over each breech, and the two open sight cages - two arches over a base rail, with
a ring sight forward and a peep aft - carried outboard on a bent arm from the receiver housing.
Recoiling: the barrel tube with its jacket, stepped chase and flared flash hider, a dark bore, the
breech block and the recoil rod.

The shielded part adds a 45 mm splinter shield: side walls that bow out to y +-2.167 and drop to the
platform aft, and a front wall with the four reference cut-downs (one per gun pair, one per sight).
It is carried on two knees per side off the outrigger, a bracket on the platform edge and a strut
from each standard nose. The Mk 19 part adds a lattice pylon over the port gun pair - two A-frames
on fore-and-aft bearers, cross braced - carrying the director trunnion, housing, dish and feed horn;
the whole pylon rides that pair's elevation joint, so it follows the guns.

### Joints and provisional values

Nodes are `component.yaw`, then per barrel `X.elevation` (child of yaw), `X.recoil` and `X.muzzle`,
with ids `left-outer, left, right, right-outer` from port to starboard. All four elevation joints lie
on one trunnion axis.

| Value | Metres | Source |
| --- | --- | --- |
| `trunnionForward` | -0.012 | centre of the elevating arc segment |
| `pivotHeight` | 1.766 | bore height at that station |
| `muzzleForward` | 2.418 | gunFire node, 2.430 m of bore run from the trunnion |
| `barrelSpacing` | 0.66 (see below) | best fit to the real 2 + 2 layout |
| `caliberM` / `recoilM` | 0.040 / 0.15 | given |
| `elevationMinDeg` / `elevationMaxDeg` | -10 / +85 | given |

Triangles: 4680 open, 5036 shielded, 4972 with the director. Size in game axes [w, h, l]:
[3.98, 2.21, 3.79], [4.38, 2.38, 3.79] and [3.98, 3.16, 3.79]; bounds centre [0, 1.10, -0.52],
[0, 1.19, -0.52] and [0, 1.58, -0.52]. The lowest point of every part is z = 0.000.

### Known approximations

- **Barrel stations.** The four guns really stand in two pairs at y +-0.8925 and +-0.6315. The
  simulation puts muzzles on one evenly spaced row, so the joints and muzzle sockets follow
  `barrelSpacing` while the tubes, receivers, cradles and chutes keep their true stations. At the
  chosen 0.66 the sockets sit at +-0.99 and +-0.33, leaving the outer tubes 0.098 m and the inner
  tubes 0.302 m from their sockets. A spacing of 0.762 equalises all four at 0.251 m and is the
  strict minimum of the worst offset; 0.595 puts the outer sockets exactly on the outer tubes and the
  inner ones 0.334 m off. All three are listed in `params.json`; the recipe does not depend on the
  choice.
- The mechanical trunnion pin is 32 mm below the bore on the reference. `pivotHeight` is the bore
  height instead, so that the muzzle sockets land exactly where the simulation expects them.
- The gun bay between each pair of cheeks is left open below z = 0.83 and the receiver housing is
  0.82 m long behind the trunnion rather than the reference's 0.94 m, so the breech clears the
  standard at +85 degrees. The reference model closes that bay and would not clear.
- The curved ammunition chutes are treated as fixed carriage fittings. They pass through slots cut in
  the loaders' platform, matching the reference, and do not elevate.
- The reference bakes its barrels at 30 degrees; all comparisons were made at that pose.

Fidelity is to the approved GameModels3D models at a common scale. Nothing here is a historical
certification of the mount's dimensions.

## Catalog values and installation

Weapon values in `guns.json` are provisional game calibration scaled from the nearest published sibling (the
real round and muzzle speed where they differ; reload copies the sibling's per-barrel cadence). The simulation
applies the world pace, so nothing is pre-scaled. Model dimensions are the measured GLB bounds. `barrelSpacing` is the simulation's uniform
single-row spacing; the joints and muzzle sockets sit exactly on it (the publish check requires this) and the
tubes are drawn where the reference has them, so the distances listed above under each part are the approximation.

| Part | Barrels | Sim spacing (m) | Mass (kg) | Reload per barrel (s) | Fits (structure below the 1.16 m wall) | Elevation reach on a bare deck |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `us-40mm-bofors-mk2-quad` | 4 | 0.660 | 11000 | 0.50 | bare deck (2.13 m) | -10 to 83 deg |
| `us-40mm-bofors-mk2-shielded-quad` | 4 | 0.660 | 12400 | 0.50 | bare deck (2.13 m) | -10 to 83 deg |
| `us-40mm-bofors-mk2-mk19-quad` | 4 | 0.660 | 11400 | 0.50 | bare deck (2.13 m) | -10 to 83 deg |

The tub column compares the mount's geometry below the retained gun tubs' 1.16 m wall (largest horizontal radius from
the yaw axis, in brackets) with the inner radius of the tubs' sparse wall boxes (3 m tub 1.14 m, 5 m tub 1.95 m).
It is a geometric check of the built model, not a simulation result; the tubs are retired from new catalogs but
saved designs and retained catalogs still carry them. Barrels, sights and shields above the wall overhang it.
The last column is the elevation range the native articulation resolver grants on a flat deck. The simulation's
generic open-mount proxy assumes a 1.55 m breech behind the trunnion, so a low trunnion cannot reach its catalog
maximum on a deck (the existing octuple pom-pom reaches 42 degrees for the same reason); a raised platform or a
per-mount proxy would lift it. The catalog limits stay the researched values.
