# German destroyer guns

Original reusable single mounts for the German destroyer main battery, authored
against approved GameModels3D visuals. Geometry is independently authored from
measured proportions; nothing here is a historical certification, and no
reference mesh is loaded by a recipe.

Both shields are open at the back. The catalog `gunhouseMesh` is a single-surface
armor envelope whose rear doorway and gun port are declared `apertures`; the
recipe draws that same envelope and gives it plate thickness with a solidify
modifier, so the visible shield and the armor stay on the same facets and the
open rear reads as a real plate edge.

## 15 cm Tbts KC/36 single

`sk-c36-150-single` is the Z-31 class main gun (`tbts_kc36_150.py`). Geometry
follows the approved
[GameModels3D Z-31 AB1 artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsd207)
visual `ggm076_150mm_tl_c_36`. The same visual serves Z-32, Z-33, Z-34, Z-38,
Z-39, K. Schoenberg, G. J. Maerker and the Gaede AB2 hull, so the collection
gains one variant; the Z-31 twin turret at position 1 is a different visual
(`ggm077_150mm_1drhl_c_38`) and is not this part.

The shield is a lofted prism cut by one raked front plane: vertical flanks that
swell to 1.31 m half-beam amidships, rounded roof shoulders, a crowned roof that
falls from 2.26 m aft to 2.01 m forward, and a front plate raked 24° from
vertical down to a deck lip 1.45 m forward of the yaw datum. The recipe adds the
roller path and working floor, the framed rear bulkhead and hoist trunk, the
cradle, trunnion bearings and recoil cylinders, layer's and trainer's seats,
handwheels and sight boxes, the raised cambered roof hood, the rear hood plate
cut to the rim outline, flank steps, ready lockers and handrails.

The barrel slides through a flexible `gun_bloomers` canvas cover whose seam is
cast onto the raked plate around the gun port and whose cuff rides the 0.20 m
jacket 1.9 m forward of the trunnion. The source draws that cover as a fixed
faceted snout welded to the shield; carrying it as canvas is what lets the bore
clear the port through the whole arc.

Pivot (1.308 m), trunnion offset (0.015 m) and muzzle datum (5.748 m) come from
the approved model's `Rotate_X` and `gunFire` nodes. Elevation limits are the
commonly published −10°/+30° for the Drh LC/36 mounting, not values read from
the model; the modelled gun port is sized to that sweep, which makes it taller
than the source's static opening. Weapon values are provisional game calibration
scaled from the 15 cm SK C/28 sibling (45.3 kg at 875 m/s, 7.5 s reload); plate
thicknesses are estimated splinter protection, not certified armor.

Known approximations: the two large vision openings in the front plate are
recessed wells, not cut armor; cloth folds, small deck fittings and the sight
gear are simplified; the interior is representative rather than a mechanism.

## 12.7 cm SK C/34 single

`sk-c34-127-single` is the Z-23 class main gun (`sk_c34_127.py`). Geometry
follows the approved
[GameModels3D Z-23 B1 artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsd108)
visual `ggm071_127mm_sk_c34`, shared by Maass, T-61, Z-35, Z-44 and the Gaede
AB1 hull. Z-23's own A1 position uses the same visual, so there is one variant;
the 12.7 cm/45 SK C/41 at Z-23's B1 forward position is a different visual and
is not this part.

The shield is squarer than the 15 cm: near-upright flanks at 1.30 m half-beam
aft narrowing to 1.17 m forward, chamfered roof shoulders, a roof falling from
2.18 m aft to about 2.00 m forward, and a front plate that stands almost upright
to the wall top before raking back onto the roof. The gun port is a tall narrow
slot. The recipe adds the roller path, deck plate and stringers, the pedestal and
trunnion carrier, the framed gun bulkhead, the training gear trunk and ready
rack, cradle, trunnion bearings and recoil cylinder, both gunners' seats,
handwheels and sights, the slot frames, the upright sight blades and the flat
spray plates that lean out over the shoulders, the rear hood plate and flank
handrails.

Pivot (1.225 m), trunnion offset (−0.111 m) and muzzle datum (4.251 m) come from
the approved model's joint nodes. Elevation limits are the commonly published
−10°/+30° for the Tbts C/36 mounting, not values read from the model. To clear
the bore at full elevation the slot is opened to the sweep envelope and the
front roof line is flattened about 0.14 m against the measured stations; the
static source needs neither. Weapon values are provisional game calibration
(28 kg at 830 m/s, 5 s reload) with the shared AP/HE and linear-drag
conventions; plate thicknesses are estimated splinter protection.

Known approximations: the vision openings are recessed wells rather than cut
armor, so the front plate reads as solid where the source is largely open; the
canvas cover is a single bag where the source shows a stepped cover and fairing;
interior gear is representative.

```sh
bun run part:build sk-c36-150-single
bun run part:check sk-c36-150-single
bun run part:build sk-c34-127-single
bun run part:check sk-c34-127-single
```
