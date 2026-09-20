# US destroyer guns

Original reconstructions of the older United States destroyer mountings: the 4-inch/50 pedestal
gun carried by the Wickes and Clemson flush-deckers, and the 5-inch/51 pedestal gun that replaced
it. Reference is GameModels3D only, for silhouette and proportions; every recipe here is authored
geometry and loads no source mesh. Weapon and armor values are provisional game calibration, kept
physical (real muzzle speed, projectile mass, reload and plate thickness) so the simulation applies
the world pace itself; they are not certified historical firing data.

Elevation limits are **published figures for the mounting type**, not measurements from the source
models, which carry no limits: −10°/+20° for the 4-inch/50 pedestal mounts and −10°/+20° for the
5-inch/51 pedestal mounts. Some later 5-inch/51 mountings are quoted at +30°; raising the catalog
value would need the shield channel re-checked (see below).

## 4-inch/50 Mk 9 pedestal mount — `us-4in50-mk9-single`

`ags040_4in50_mk12` on the Wickes (pasd027, AB_Artillery HP_AGM_2/3/4). The same visual carries the
Clemson (pasd019) and Sampson (pasd002) broadside positions. An open pedestal mount: no shield, so
the catalog entry has `gunhouseSize` only and no `gunhouseMesh`.

Authored from the model's own datums: yaw race at the sole, trunnions 1.124 m above deck (the
catalog rounds the bore line to 1.12), muzzle 3.52 m forward, bore 102 mm read off the muzzle rim.
The recipe builds the deck ring and its holding-down bolts, the training race, the pedestal column,
the trunnion fork, the slide with its recoil and counter-recoil cylinders and elevating screw, the
sliding gun (breech block, breech ring, jacket, tapering chase and muzzle swell), the layers' seat
brackets, seat pans, foot plates and the four handwheels on their gear cases, the sighting
telescopes on the slide, and the fore-and-aft carriage rails with the forward grab rails.

Known approximations: the source model's pedestal is a solid body up to trunnion height and its
slide passes through it; the authored column stops at 0.52 m and continues as a two-cheek fork, so
nothing interpenetrates through the sweep. Small deck fittings outboard of the seats (the trainer's
gearbox and its crank) are not reproduced, and the reference's flat tray over the breech is
replaced by the two rails that clear the rising breech.

## 4-inch/50 Mk 9 shielded pedestal mount — `us-4in50-mk9-shielded-single`

`ags039_4in50_mk12` on the Wickes (pasd027 HP_AGM_1) and the Clemson (pasd019) forecastle position.
A component-by-component comparison with `ags040` shows the same mount under a splinter shield plus
its back frame, so this is registered as a second part sharing the whole carriage, not a separate
mounting.

The shield is the catalog `gunhouseMesh`: a 6.4 mm single-skin shell of 46 vertices and 66 faces,
lofted from five stations (front plate 1.29 m wide at the bottom, flanks flaring to 1.72 m at the
open back, roof rising from the knuckle to 1.878 m). The open back and floor are one declared
aperture; the gun port is the other. The recipe draws that same shell and adds an inner liner one
plate-thickness inside, so the open back and the gun port read as plate edges, plus the shield feet
on the rail outriggers and the diagonal stays to the flank plating.

Known approximation: in the source model the roof knuckle closes over the gun port and would foul
the jacket above roughly +12°. The authored shield carries the gun port aft through the knuckle as
an open channel, so the gun clears the plating over the whole published elevation range. The two
sighting slits either side of the gun port are not cut (they are 86 mm wide in the source and below
the armor mesh's face budget).

## 5-inch/51 Mk 7 open pedestal mount — `us-5in51-mk7-open-single`

`ags085_5in51_mk_7_mod2` on the Nicholas (pasd014, A_Artillery HP_AGM_3/4). The open version of the
mounting: `gunhouseSize` only, no `gunhouseMesh`.

Datums from the model: trunnions and bore line 1.22 m above deck, muzzle 4.70 m forward, breech
ring 509 mm across, jacket 420 mm, chase tapering to a 220 mm muzzle swell. The recipe builds the
wide deck flange and bolt ring, the stepped pedestal base and training race, the column and
trunnion fork, the long slide with twin recoil cylinders and the elevating arc, the sliding gun,
the two low working platforms on their stays, the seat brackets, the four handwheels and their gear
cases, the sighting telescopes, and the side sight platforms with their rails.

Known approximations: as on the 4-inch mount the column becomes a fork above 0.62 m so the slide
sweeps clear; the source model's sight platform crosses the centreline over the breech and is
replaced by two side platforms; the source's handwheels sit at different heights port and
starboard and are authored symmetrically.

## 5-inch/51 Mk 7 shielded pedestal mount — `us-5in51-mk7-single`

`ags086_5in51_mk_7_mod2` on the Nicholas (pasd014 HP_AGM_1/2): the same pedestal mount behind its
shield, again confirmed component by component against `ags085`.

The shield is the catalog `gunhouseMesh`: 54 vertices, 78 faces, 6.4 mm plate, lofted from six
stations — a flat front plate 1.65 m wide, a raked upper plate, flanks flaring to 2.06 m at the
open back and a roof at 1.977 m. Open back and floor are one aperture, the gun port the other; the
recipe adds the liner, the feet and the stays. As on the 4-inch shield, the gun port is carried aft
through the raked plate as a channel so the jacket clears the plating at full elevation.

## Checks

Each part was built with `part:build`, measured with the delivered kit, overlaid against its own
reference from side, top, front and rear at a common scale, swept from −10° to +20° in seven steps
with and without full recoil against every fixed part, and tested against an identical mount abeam
at the closest plausible spacing (2.6 m for the 4-inch singles, 3.0 m shielded, 3.4/3.6 m for the
5-inch). No overlaps remain in any pose. Backface-culled renders show no inverted faces, and both
gunhouse meshes pass the closure, winding and outward-volume proof.
