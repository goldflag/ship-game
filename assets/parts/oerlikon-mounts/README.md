# 20 mm Oerlikon multiple mounts

Five original recipes in `assets/parts/oerlikon-mounts/geometry.py` (`create_mount`, one entry point that
switches on `mount['weapon']['id']`). All of them carry the same 20 mm automatic, so the gun — receiver,
spring casing, barrel, flash hider, drum magazine, cocking gear and cradle collar — is drawn once and the
variants differ in the stand, the shield and the sighting gear. Geometry is authored from station, radius and
profile numbers measured off the approved GameModels3D references; no reference mesh or transform is imported,
and nothing is copied from the existing Oerlikon or Flak parts.

| Part | Reference visual | Fitted to |
| --- | --- | --- |
| `us-20mm-oerlikon-mk15-quad` | `usa/.../aga225_20mm_oerlicon_quadruple` | Maine, Maine +, West Virginia '44 |
| `bl-20mm-oerlikon-mkv-twin` | `uk/.../bga020_20mm_oerlikon_mk_v` (and the identical Commonwealth `uga2003`) | 58 Royal Navy ships from Delhi to Thunderer, plus Gambia and Pioneer |
| `us-20mm-oerlikon-twin-tripod` | `usa/.../aga070_20mm_oerlikon_twin` | Burrows, California, Christopher, Osborne |
| `us-20mm-oerlikon-mk14-twin` | `usa/.../aga214_20mm_oerlikon_mark14_twin` | Joshua Humphreys, Joshua Humphreys +, New Jersey, United States, Vallejo, Worcester |
| `us-20mm-oerlikon-mk4-twin` | `usa/.../aga224_20mm_oerlikon_mk4_twin` | West Virginia '44 |

`aga018_20mm_oerlikon_mk20_twin` (41 US ships) is triangle-for-triangle the same visual as the panasia
`zga010_20mm_oerlikon_mk20_twin` already in the catalog as `us-20mm-oerlikon-mk24-hsienyang`, so no part was
built for it. `uga2003_20mm_oerlikon_mk_v` is likewise identical to `bga020` and shares one part.

### What is modelled

The quadruple is a rocking tub on a low training pedestal: a twelve-sided deck ring and cone, a transverse
yoke beam with two elevation standards and their trunnion pins, and the elevating tub itself — side walls,
floor strips, a front sill, a leaning front shield with one port per gun in a banded plate, a rear splinter
plate with two ventilation ports, and grab rails on the outside of the tub. Inside, the port gunlayer has a
platform, seat pan, back rest, foot plate, reflector sight and elevation handwheel; the starboard loader has
two ready-service lockers on brackets and a foot plate. The four guns sit in cradles on a pair of cross beams
tied to the trunnion shaft, each with a case chute under the breech.

The Mk V twin is a wide cylindrical pedestal carrying a training platform with an L-shaped splinter shield —
low across the front, carried up to port into the layer's shelter — a seat, foot plate and ready locker
inside it, two elevating struts with trunnion pins, a twin cradle with recoil cylinders, an elevation
gearcase, case chutes, the layer's grips and a sight standard with a foresight ring on an outboard arm.

The US twins share a gun group: two guns at 0.19 m, drums outboard on their feed throats, a cradle box with
cheeks and a cross tie, the trunnion shaft, shoulder arms with pads, shoulder yokes behind the breeches and
case chutes. `twin-tripod` stands on three splayed legs with a tie ring and a central training column and
carries the wide notched shield with a ring sight; `mk14-twin` uses the same tripod with the gun group 0.103 m
higher, the narrower shield, a fixed splinter apron on the yoke and the Mk 14 gyro sight box over the
breeches; `mk4-twin` puts that same upper works on a tapered cone pedestal and adds the layer's splinter
plate to port.

### Joints and clearance

Every part follows the shared contract: `yaw`, then per barrel `X.elevation` on the trunnion axis at the
simulation's uniform lateral station, `X.recoil` under it, and `X.muzzle` on the bore at `muzzleForward`.
Barrel tubes are authored on those same stations, so the tube tip coincides with its muzzle socket in all
five parts (`tipOffsets` are zero). Barrels, receivers, breech casings, feed throats and drums recoil;
cradles, shields, sights, seats and shoulder gear elevate; pedestals, stands, yokes, platforms, fixed shields
and crew platforms on the carriage train only. Each part's sole plane is at z = 0.

Renders at -10, 30 and 85 degrees plus a recoil pose were inspected for every part. Three clearances needed
geometry that the reference does not have, and are called out as approximations below.

### Provisional values

Elevation -10 to +85 degrees, 20 mm bore, 0.03 m recoil stroke for all five. Trunnion, pivot and muzzle
stations, barrel spacing, triangle counts and measured sizes are in `params.json`, taken from the built
models. These are model fits, not historical or mechanical certification.

### Known approximations

- The quadruple's reference is one staggered row: alternate guns sit 0.28 m further back so the 0.31 m drums
  nest at 0.20 m spacing. The model keeps that stagger in the receivers, casings and drums but runs every
  tube out to the common muzzle station, so two of the four guns show more bare barrel than the reference
  and the four muzzles are level rather than alternating.
- The quadruple's reference barrel row sits 0.09 m to starboard of the training axis. The model is symmetric
  about the axis, because the simulation row is.
- The quadruple's training cone was lowered to 0.22 m and the rear splinter plate started at the tub's top
  edge; the reference's 0.29 m apex is swept by the tub above about 80 degrees.
- The narrow-shield twins are open under the guns between y +/-0.26, with the lower apron carried as a fixed
  plate on the yoke instead of hanging from the shield. The reference's solid plate sweeps through its own
  training column near zero elevation.
- The US twins' trunnion pins were moved outboard to y +/-0.30 on a yoke head; the reference's supports stand
  at y +/-0.095, inside the cradle they carry.
- The Mk V's trunnion is placed on the bore (the reference hangs the bore 0.074 m above the strut heads) and
  its deck ring starts at z = 0 rather than 0.069 m below it.
- Crew fittings are representative: seat, back rest, foot plates, lockers, handwheel and sights are modelled
  where the reference shows a shape at that station, not to a drawing.

Fidelity here is to the approved GameModels3D visuals at a common scale. Nothing in this section is a
historical claim about the Mk 15, Mk V, Mk 14 or Mk 4 mountings.

## Catalog values and installation

Weapon values in `guns.json` are provisional game calibration scaled from the nearest published sibling (the
real round and muzzle speed where they differ; reload copies the sibling's per-barrel cadence). The simulation
applies the world pace, so nothing is pre-scaled. Model dimensions are the measured GLB bounds. `barrelSpacing` is the simulation's uniform
single-row spacing; the joints and muzzle sockets sit exactly on it (the publish check requires this) and the
tubes are drawn where the reference has them, so the distances listed above under each part are the approximation.

| Part | Barrels | Sim spacing (m) | Mass (kg) | Reload per barrel (s) | Fits (structure below the 1.16 m wall) | Elevation reach on a bare deck |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `us-20mm-oerlikon-mk15-quad` | 4 | 0.200 | 2000 | 0.45 | 5 m tub (1.73 m) | -10 to 38 deg |
| `bl-20mm-oerlikon-mkv-twin` | 2 | 0.325 | 1000 | 0.45 | 5 m tub (1.49 m) | -10 to 47 deg |
| `us-20mm-oerlikon-twin-tripod` | 2 | 0.190 | 1000 | 0.45 | 3 m or 5 m tub (0.98 m) | -10 to 45 deg |
| `us-20mm-oerlikon-mk14-twin` | 2 | 0.190 | 1000 | 0.45 | 3 m or 5 m tub (0.79 m) | -10 to 51 deg |
| `us-20mm-oerlikon-mk4-twin` | 2 | 0.190 | 1000 | 0.45 | 3 m or 5 m tub (0.79 m) | -10 to 51 deg |

The tub column compares the mount's geometry below the retained gun tubs' 1.16 m wall (largest horizontal radius from
the yaw axis, in brackets) with the inner radius of the tubs' sparse wall boxes (3 m tub 1.14 m, 5 m tub 1.95 m).
It is a geometric check of the built model, not a simulation result; the tubs are retired from new catalogs but
saved designs and retained catalogs still carry them. Barrels, sights and shields above the wall overhang it.
The last column is the elevation range the native articulation resolver grants on a flat deck. The simulation's
generic open-mount proxy assumes a 1.55 m breech behind the trunnion, so a low trunnion cannot reach its catalog
maximum on a deck (the existing octuple pom-pom reaches 42 degrees for the same reason); a raised platform or a
per-mount proxy would lift it. The catalog limits stay the researched values.
