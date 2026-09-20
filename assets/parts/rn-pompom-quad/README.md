# Quadruple 2-pounder Mk VII pom-pom (`assets/parts/rn-pompom-quad`)

One recipe, `geometry.py:create_mount`, draws the Royal Navy quadruple 2-pounder (40 mm QF Mk VIII) power
mounting and switches its shield set on `mount['weapon']['id']`. The body is shared; only the plating differs.

| Part | Reference visual | Fitted to |
| --- | --- | --- |
| `qf-2pdr-mkvii-quad` | `uk/.../bga002_2_pdr_mkvii_quad` | Albemarle, Black Swan, Dido, Duke of Bronte, Emerald, Hampshire, Hawke, Hawkins, Indomitable, Iron Duke, Rodney, Rooke, Surrey |
| `qf-2pdr-mkvii-quad-shielded` | `uk/.../bga072_2_pdr_mkvii_quad`, and the identical `commonwealth/.../uga2002_2_pdr_mkvii_quad` | Implacable, King George V, Duke of York, Renown, Royal Sovereign, Colossus, Ocean, Theseus, Devonshire, Uganda, Gambia, Haida, Huron, Hobart and 14 more |
| `qf-2pdr-mkvii-quad-plated` | `uk/.../bga088_2_pdr_mkvii_quad` | Cossack, Cossack B, Eskimo, Nottingham |
| `qf-2pdr-mkvii-quad-screened` | `uk/.../bga152_2_pdr_mkvii_quad` | Renown, Renown '44 |

`uga2002` was compared vertex set to vertex set against `bga072`: the two meshes hold the same positions, so
the Commonwealth fit is served by the shielded part rather than a fifth id.

### What is modelled

Training base: sole plate and roller path, the two-level rotating platform (layers' deck at 0.66 m aft, working
deck at 0.48 m under the guns, bow step at 0.42 m), the low forward frame webs and case tray, two tapered
trunnion standards with their bearings and caps, the elevating gear case, four inclined ready-use belt lockers
on the wings with brackets and lid handles, aft handrails along the chamfered deck edge with corner posts, and
the two layers' stations: seat column, seat pan and back, footrest, sight standard, ring sight with its spider
and bead arm, the transverse sight bar, hand control wheel, control box and column.

Elevating mass: two circular cheek plates concentric with the trunnion, their stiffening boss and ribs, the
toothed elevating rack (an arc about the trunnion, so it stays in the gear case at every angle), the trunnion
shaft and hubs, the open box frame with an unplated back so the four breeches stay visible, the frame face webs
and lintels that leave each gun its own aperture, feed platforms and eight belt hoppers with their chutes, and
per gun a cradle, recoil cylinder, recuperator, cradle ring and elevating link.

Recoiling per gun: receiver, breech casing, recoil rod, charging handle, feed tray, case chute, and the tube
itself as one surface (water jacket, two jacket bands, chase and flash cone) with a bore shadow.

### Joint layout

`yaw` on the sole datum; four `<id>.elevation` joints on one trunnion axis at `(-0.04, ±0.3375 / ±0.1125,
1.31)`, each with a `recoil` child and a `muzzle` node at `(1.695, 0, 0)` local. Everything that elevates hangs
on the outermost elevation joint and is offset back to the mount centreline, so the block pitches rigidly.
The real guns stand in two columns of two, 0.45 m apart laterally and 0.518 m apart vertically; the simulation
fires from one uniform row, so the tubes carry a 0.1125 m lateral and a 0.259 m vertical offset from their
sockets (`tipOffsets` in `params.json`, worst case 0.282 m, none along the bore). `barrelSpacing` 0.225 m is the
uniform spacing that minimises that worst case.

### Clearances

Every elevating part except the tubes and their cradle gear sits inside the 0.645 m cheek circle about the
trunnion, and no fixed structure enters that circle: the standards, gear cases and sight gear stand outboard of
the cheeks (|y| ≥ 0.456 against a cheek at 0.405-0.45), the forward frame webs are never closer than 0.758 m to
the trunnion, and the cheek rim clears the layers' deck by 5 mm at every angle. Checked by render at -10, 0, 30
and 85 degrees and through the 0.1 m recoil stroke, with backface culling on; the depressed barrels pass 0.05 m
over the forward frame crown and clear the splinter and armour plating, which is outboard of |y| 0.43.

### Provisional values

`caliberM` 0.04, `barrelCount` 4, `recoilM` 0.1, elevation -10 to +80 degrees, `pivotHeight` 1.31,
`trunnionForward` -0.04, `muzzleForward` 1.655, `barrelSpacing` 0.225, `barrelBaseRadius` 0.072. Triangles:
5660 open, 6036 shielded, 6508 plated, 6352 screened. Model size (beam, height, length) 2.89 x 2.61 x 3.47 m
for the open mounting, 3.64 m across the screened outriggers.

### Known approximations

- The reference bakes the guns at 30 degrees; all stations were converted to the elevation frame about the
  trunnion before authoring, and the pivot was raised 0.06 m above the reference cheek centre so the two rows
  sit symmetrically about the axis.
- The reference sets the upper guns back 0.302 m along the bore. Muzzle sockets must sit at `muzzleForward`, so
  all four tubes are drawn to the same station and that stagger is not reproduced.
- Seats, sights and hand controls are carried on the training platform. On the reference they hang off a
  bracket on the elevating structure, whose swept path would drive them through the deck above 72 degrees.
- Below-deck ammunition supply, belt runs from the lockers to the hoppers and the training gear inside the
  pedestal are not modelled.

Fidelity is to the approved GameModels3D visuals at a common scale. Nothing here is a historical certification:
dimensions, rates, elevation limits and recoil stroke are model and gameplay inputs.

## Catalog values and installation

Weapon values in `guns.json` are provisional game calibration scaled from the nearest published sibling (the
real round and muzzle speed where they differ; reload copies the sibling's per-barrel cadence). The simulation
applies the world pace, so nothing is pre-scaled. Model dimensions are the measured GLB bounds. `barrelSpacing` is the simulation's uniform
single-row spacing; the joints and muzzle sockets sit exactly on it (the publish check requires this) and the
tubes are drawn where the reference has them, so the distances listed above under each part are the approximation.

| Part | Barrels | Sim spacing (m) | Mass (kg) | Reload per barrel (s) | Fits (structure below the 1.16 m wall) | Elevation reach on a bare deck |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `qf-2pdr-mkvii-quad` | 4 | 0.225 | 7750 | 0.52 | 5 m tub (1.91 m) | -10 to 48 deg |
| `qf-2pdr-mkvii-quad-shielded` | 4 | 0.225 | 8650 | 0.52 | 5 m tub (1.91 m) | -10 to 48 deg |
| `qf-2pdr-mkvii-quad-plated` | 4 | 0.225 | 8250 | 0.52 | bare deck (1.99 m) | -10 to 48 deg |
| `qf-2pdr-mkvii-quad-screened` | 4 | 0.225 | 9050 | 0.52 | 5 m tub (1.91 m) | -10 to 48 deg |

The tub column compares the mount's geometry below the retained gun tubs' 1.16 m wall (largest horizontal radius from
the yaw axis, in brackets) with the inner radius of the tubs' sparse wall boxes (3 m tub 1.14 m, 5 m tub 1.95 m).
It is a geometric check of the built model, not a simulation result; the tubs are retired from new catalogs but
saved designs and retained catalogs still carry them. Barrels, sights and shields above the wall overhang it.
The last column is the elevation range the native articulation resolver grants on a flat deck. The simulation's
generic open-mount proxy assumes a 1.55 m breech behind the trunnion, so a low trunnion cannot reach its catalog
maximum on a deck (the existing octuple pom-pom reaches 42 degrees for the same reason); a raised platform or a
per-mount proxy would lift it. The catalog limits stay the researched values.
