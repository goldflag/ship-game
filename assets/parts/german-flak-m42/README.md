# German 3.7 cm Flak M42 mounts (`assets/parts/german-flak-m42/geometry.py`)

Two original recipes for the late-war German automatic 3.7 cm gun on the LM/42 carriage, built by one
`create_mount` entry point that switches on `mount['weapon']['barrelCount']`.

| Part id | Reference visual | Fitted to |
| --- | --- | --- |
| `flak-m42-37-twin` | `germany/gun/aaircraft/gga043_37mm_flak_m42_zwilling` | Rhein, Weser, August von Parseval, Graf Zeppelin (+ B), Gneisenau, Bismarck (+ AL), Friedrich der Grosse, Anhalt, Knesebeck, Roon (+ CLR), Mainz (+ B), Cross of Dorn, Sharqi and the German destroyers T-22, T-61, Leberecht Maass, Gustav-Julius Maerker and Z-23/31/32/33/34/35/38/39/42/46/52 |
| `flak-m42-37-single-lm42` | `germany/gun/aaircraft/gga034_37mm_flak_m42` | Rhein, Prinz Heinrich, AL Prinz Heinrich, Prinz Sigismund, Roon, Z-39 |

The two references share one carriage: the same shield profile, pedestal, gunners' stations and bore line.
They are built from the same body code, with the shield half width, the cradle width and the shield's
central aperture taken from the variant table. This is a different, later weapon from the catalog's
`flak-37-bismarck-1941` (3.7 cm SK C/30 twin) and is modelled independently of it.

### What is modelled

Training group (parents to `yaw`): stepped deck sole and training race; two tapered splayed legs; a gun
well made of two side beams over a low floor; trunnion standards with bearings and elevation pinion
housings; an aft layer's frame with its standard, diagonals and foot shoe; ready-round racks and a
traverse gearcase with its handwheel on the starboard beam; the slotted shield with its rolled edges,
slot liners, face stiffener, forward shelf and the swept deflector bars that sit clear of the plate;
both gunners' stations - gear standard rising through a shield slot, aiming gearbox, handwheel, seat pan,
back rest, and a foot plate on the inner face of the shield.

Elevating group (parents to an `.elevation` joint): common cradle cheeks, floor, deck and front bearing;
trunnion bosses and pins; a toothed elevating arc; balance springs; per barrel a jacket with its collar,
a clip guide with its mouth and four loaded rounds, a feed ramp and a case chute; a ring sight with
cross wires on a bracket and a fore sight post.

Recoiling group (parents to a `.recoil` joint): receiver and top rib, breech ring and cap, charging
handle, spring housing, the stepped tube with its flash hider and bore shadow.

### Joint layout and provisional values

The references bake their barrels at exactly 30 degrees (the `gunFire` matrices carry 0.866/0.5), so the
trunnion was solved as the point on the reference bore line closest to the reference trunnion bracket.
Elevating and recoiling geometry is authored in the trunnion frame, where +X runs along the bore.

| | twin | single |
| --- | --- | --- |
| `barrelCount` | 2 | 1 |
| `barrelSpacing` | 0.306 | n/a |
| `trunnionForward` | -0.345 | -0.345 |
| `pivotHeight` | 1.222 | 1.222 |
| `muzzleForward` | 2.145 | 2.145 |
| `caliberM` | 0.037 | 0.037 |
| `recoilM` | 0.06 | 0.06 |
| elevation | -10 to +85 | -10 to +85 |
| triangles | 3966 | 3290 |

The true barrel stations are the uniform simulation stations, so every `.muzzle` socket sits on its tube's
axis and the tube tips land on the sockets exactly.

### Clearance

Clearance was proved by a triangle-overlap sweep of the built model: 39 elevation steps from -10 to +85
degrees, each at zero and full recoil, comparing every elevating or recoiling mesh against every fixed
mesh. No contact. The barrels leave the shield through the central aperture below the knuckle and through
the two apertures in the folded top band, and pass behind the shield above about 66 degrees.

### Known approximations

- The rotating head is a well - two side beams over a low floor - where the reference has a solid platform
  at z 0.99 to 1.16. The reference cannot reach -10 to +85 degrees without the breech fouling that platform.
- The central shield aperture is cut to z 0.972 rather than the reference's 1.064, and the forward shelf
  sits about 65 mm lower, so the barrel jacket clears at full depression.
- The elevating gear case outboard of the reference cradle became a fixed pinion housing on the standard,
  with a smaller toothed arc, for the same reason.
- The reference's two seats are offset from each other by 0.13 m fore and aft; here they are symmetric.
- Recoil stroke, elevation limits and calibre are catalog inputs, not measurements of the reference.
- Barrel tube radius is 0.0462 m against the reference's measured 0.0485 m prism, with 8 sides instead of 6.

These are checks of fidelity to the approved GameModels3D reference and of articulation; they are not a
historical certification of the LM/42 mount.

## Catalog values and installation

Weapon values in `guns.json` are provisional game calibration scaled from the nearest published sibling (the
real round and muzzle speed where they differ; reload copies the sibling's per-barrel cadence). The simulation
applies the world pace, so nothing is pre-scaled. Model dimensions are the measured GLB bounds. `barrelSpacing` is the simulation's uniform
single-row spacing; the joints and muzzle sockets sit exactly on it (the publish check requires this) and the
tubes are drawn where the reference has them, so the distances listed above under each part are the approximation.

| Part | Barrels | Sim spacing (m) | Mass (kg) | Reload per barrel (s) | Fits (structure below the 1.16 m wall) | Elevation reach on a bare deck |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `flak-m42-37-twin` | 2 | 0.306 | 2700 | 0.38 | 5 m tub (1.28 m) | -10 to 46 deg |
| `flak-m42-37-single-lm42` | 1 | 0.100 | 1400 | 0.38 | 5 m tub (1.25 m) | -10 to 46 deg |

The tub column compares the mount's geometry below the retained gun tubs' 1.16 m wall (largest horizontal radius from
the yaw axis, in brackets) with the inner radius of the tubs' sparse wall boxes (3 m tub 1.14 m, 5 m tub 1.95 m).
It is a geometric check of the built model, not a simulation result; the tubs are retired from new catalogs but
saved designs and retained catalogs still carry them. Barrels, sights and shields above the wall overhang it.
The last column is the elevation range the native articulation resolver grants on a flat deck. The simulation's
generic open-mount proxy assumes a 1.55 m breech behind the trunnion, so a low trunnion cannot reach its catalog
maximum on a deck (the existing octuple pom-pom reaches 42 degrees for the same reason); a raised platform or a
per-mount proxy would lift it. The catalog limits stay the researched values.
