# 2 cm Flakvierling 38 (German light AA)

Three quadruple 2 cm C/38 mountings share one recipe,
`assets/parts/german-flakvierling/geometry.py` (`create_mount`, switched on the weapon id).
All three carry the same gun block and trunnion cheeks; they differ in the carriage below it,
in the shielding and in the sights.

| Part | Mounting | Reference visual |
| --- | --- | --- |
| `flak38-20-vierling` | Pedestal mounting, open, two loaders' platforms | `gga008_20mm_flack_38_quad` |
| `flak38-20-vierling-shielded` | Low deck carriage inside a large plated shield | `gga042_20mm_flack_38_quad` |
| `flak38-20-vierling-c35` | C/35 platform with the long rear trail | `gga035_20mm_flak_38_c35` |

Ships using the pedestal mounting include Bismarck, Tirpitz, Scharnhorst, Gneisenau, Admiral Hipper,
Yorck, Ägir, Schill, Z-23, Leberecht Maass and T-22 (29 vehicles). The shielded mounting appears on
Prinz Eugen, Hindenburg, Deutschland, Admiral Scheer, Grosser Kurfürst, Mainz, Weser and the later
Z-boats (31 vehicles). The C/35 mounting appears on Graf Zeppelin, Bayern, Friedrich der Grosse,
Roon, Hindenburg, Grosser Kurfürst, Anhalt and Gustav-Julius Maerker (14 vehicles).

### What is modelled

Per barrel: breech block, receiver with its feed way, ribbed barrel jacket, thin tube, conical flash
hider with an open muzzle, charging handle, cradle trough with its bearer, recoil-spring housing and
a box magazine hung outboard at that barrel's row. Per block: the two elevating frame plates that
straddle the carriage, trunnion pins, front web and cross ties, a spent-case chute per column,
footrests, the layer's seat, backrest and two handwheels, and the sights. The pedestal mounting
carries the tall braced ring-sight mast with its tie rod forward to a foresight bead; the shielded
mounting carries two such masts, one per column; the C/35 mounting carries low open ring sights on
the frame with beads out on the barrel columns.

On the carriage: fluted training pedestal on a sole plate with hold-down pads, training bearing,
turntable, carriage body, curved trunnion cheeks, elevation and training gear cases, two loaders'
platforms with tubular seat arms, seats and backrests, and a ready rack of four spare magazines per
side. The shielded mounting adds the shield (wings with aft-turned outer thirds, rimmed aperture,
sills, side returns, stiffeners and stays) and a roller step. The C/35 mounting adds the rear trail
with the trainer's seat, the forward spar, the transverse ready-ammunition rail with four hung boxes
and two end boxes, two loaders' seats with footplates, and the forward splinter plates.

### Joints and the 2x2 block

Barrel ids run port to starboard: `left-outer`, `left`, `right`, `right-outer`. The block is a 2x2
square, not a row: the two columns stand at y = +/-0.345 m and the two rows at +/-0.15 m in the
elevation frame, with the outer ids on the upper row. All four `*.elevation` joints share one
trunnion axis (`trunnionForward`, `pivotHeight`), so the block elevates rigidly.

The simulation fires from one uniform row, and the publish check requires each `*.muzzle` node to
sit within 25 mm of that row, so the joints are placed exactly as `assets/parts/aa_articulation.py`
places them: station i at `((n-1)/2 - i) * barrelSpacing`, on the bore axis, no vertical offset. The
tubes, receivers, cradles and magazines are offset from their joints to the true 2x2 stations. With
the best-fit `barrelSpacing` of 0.345 m every tube tip stands 0.172 m laterally and 0.150 m
vertically from its muzzle socket, a worst-case 0.229 m. This is the documented compromise between
the real block and the simulation's single row.

`recoilM` is 0.04 m along the bore; the tube, receiver, breech and flash hider recoil, the cradle,
spring housing and magazine do not.

### Clearances

Each mounting was swept from -10 to +85 degrees in 1 degree steps and checked for elevating
geometry entering fixed geometry, with the results confirmed in renders at -10, +30 and +85 degrees
and at full recoil. All three are clear. The geometry that makes this work, and where it departs
from the reference:

- The carriage top is kept inside the 0.583 m cheek-arc radius and the sight mast is rooted on the
  elevating frame outboard of the cheeks, so mast, layer's seat and handwheels swing past the
  carriage rather than through it. On the references, which are baked at one elevation, the sight
  arm's root and the layer's station lie inside the carriage body.
- The shielded mounting's central sill stops at 0.48 m and its wings start at 0.44 m laterally, so
  the block elevates through the aperture. The reference plate is continuous to 1.30 m across the
  centre and its own barrels would pass through it at low elevation.
- The C/35 ammunition rail and the loaders' backrests sit about 0.10 m lower than the reference,
  clearing the barrels and the swinging magazines at -10 degrees.

### Provisional values

| | pedestal | shielded | C/35 |
| --- | --- | --- | --- |
| `trunnionForward` | 0.00 | -0.11 | 0.04 |
| `pivotHeight` | 1.44 | 0.98 | 1.39 |
| `muzzleForward` | 1.76 | 1.65 | 1.80 |
| `barrelSpacing` | 0.345 | 0.345 | 0.345 |
| triangles | 3512 | 3284 | 3616 |

`caliberM` 0.02, `barrelCount` 4, `recoilM` 0.04, elevation -10 to +90 degrees.

Trunnion positions were taken from the curved cheek plate of each reference, which is a circular arc
of radius 0.583 m centred on the elevation axis; barrel length, row pitch and column pitch were read
from the baked barrel tubes (30 degrees on the pedestal and C/35 references, 45 degrees on the
shielded one).

### Known approximations

- One column pitch (0.345 m) for all three parts; the C/35 reference measures 0.36 m.
- Sight ring size and the spoke pattern are drawn in the conventional way, across the line of sight;
  the pedestal reference's sight head reads as a spoked wheel lying in the fore-and-aft plane.
- Magazines are modelled as plain angled boxes; feed mechanism, ejection ports and belt detail are
  not modelled.
- The elevating shield plating that wraps the crew on the shielded reference is not reproduced; only
  the deck-standing shield is.
- Seats, platforms and racks are placed where the references show them but are not dimensioned from
  any drawing.

Fidelity here is to the approved GameModels3D visuals at a common scale. Nothing in this section is
a historical certification of the weapon or its mountings.

## Catalog values and installation

Weapon values in `guns.json` are provisional game calibration scaled from the nearest published sibling (the
real round and muzzle speed where they differ; reload copies the sibling's per-barrel cadence). The simulation
applies the world pace, so nothing is pre-scaled. Model dimensions are the measured GLB bounds. `barrelSpacing` is the simulation's uniform
single-row spacing; the joints and muzzle sockets sit exactly on it (the publish check requires this) and the
tubes are drawn where the reference has them, so the distances listed above under each part are the approximation.

| Part | Barrels | Sim spacing (m) | Mass (kg) | Reload per barrel (s) | Fits (structure below the 1.16 m wall) | Elevation reach on a bare deck |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `flak38-20-vierling` | 4 | 0.345 | 1800 | 0.16 | 5 m tub (1.35 m) | -10 to 61 deg |
| `flak38-20-vierling-shielded` | 4 | 0.345 | 2300 | 0.16 | 5 m tub (1.70 m) | -10 to 36 deg |
| `flak38-20-vierling-c35` | 4 | 0.345 | 2000 | 0.16 | 5 m tub (1.66 m) | -10 to 57 deg |

The tub column compares the mount's geometry below the retained gun tubs' 1.16 m wall (largest horizontal radius from
the yaw axis, in brackets) with the inner radius of the tubs' sparse wall boxes (3 m tub 1.14 m, 5 m tub 1.95 m).
It is a geometric check of the built model, not a simulation result; the tubs are retired from new catalogs but
saved designs and retained catalogs still carry them. Barrels, sights and shields above the wall overhang it.
The last column is the elevation range the native articulation resolver grants on a flat deck. The simulation's
generic open-mount proxy assumes a 1.55 m breech behind the trunnion, so a low trunnion cannot reach its catalog
maximum on a deck (the existing octuple pom-pom reaches 42 degrees for the same reason); a raised platform or a
per-mount proxy would lift it. The catalog limits stay the researched values.
