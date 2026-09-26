# Omaha-class guns

Original Blender recipes for the guns of USS Omaha (CL-4) in her GameModels3D fit A, authored against the
approved GameModels3D (World of Warships) visuals only. No reference geometry is loaded, copied or shipped:
each recipe draws the catalog's closed `gunhouseMesh` (where the mount has one) as the visible shell and adds its
own fittings, carriage and barrels. Fidelity to the approved model is the target; nothing here certifies
historical accuracy.

These parts were built by the Omaha ship agent: the gun branch planned for them (`goldflag/us-omaha-guns`)
ended with no commits.

| Part | Recipe | Source vehicle + visual | Barrels |
| --- | --- | --- | --- |
| `us-6in53-mk16-twin` | `mk16_twin.py` `create_mount` | pasc005 Omaha A, `agm031_6in53_mk16_twin` | 2 |
| `us-6in53-mk13-single` | `mk13_single.py` `create_open_single` | pasc005 Omaha A, `agm159_6in53_mk13_single` | 1 |
| `us-6in53-mk13-casemate` | `mk13_single.py` `create_casemate` | pasc005 Omaha A, `agm160_6in53_mk13_single` | 1 |
| `us-50cal-browning-m2` | `browning_m2.py` `create_mount` | pasc005 Omaha A, `aga055_browning_m2_mod2` | 1 |

Evidence: <https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc005> (the vehicle page's scheme, its
visuals and the gun armour models `common/armor/gameplay/usa/gun/main/agm031…`, `agm159…`, `agm160…`).

Datums are the visuals' own joint nodes (`Rotate_Y`, `Rotate_X`, `Roll_Back1`, `HP_gunFire*`), read from the
vehicle page's scheme; gunhouse shapes were measured from the visuals in the mount frame. Weapon values are
provisional game calibration: the 6-inch/53 figures use commonly published values (105 lb / 47.6 kg shell at
3,000 fps / 914 m/s, 6–7 rounds a minute), penetration is the mean of `bl-6in50-mk21-twin` and
`sk-c25-150-triple` scaled to this shell by mass^0.7 and reference speed^1.4 at 5,000 m (165 mm), and the
.50-calibre's is `type93-13-single` scaled the same way at 1,000 m (6 mm). Drag, AP and HE blocks follow
`assets/parts/author-ap.ts` and `author-he.ts`. Masses, rates of train and elevation and ammunition counts are
estimates. The gun armour is the reference armour model's 25 mm throughout (turret face, sides, roof, rear and
floor; drum sides and roof); the drum floors (13 mm) are estimates.

The parts are registered for Blender-recipe ships (`guns.json`, `library.json`); they are not yet published to
the Shipbuilder catalog (`construction.json`, `part:publish`).

## `us-6in53-mk16-twin` — 6-inch/53 Mk 16 twin mount

Datums: pivot (trunnion height) 1.877 m, trunnion 0.662 m forward of the training axis, muzzle 6.257 m, gun axes
0.678 m apart. The gunhouse is 6.15 m long, 3.09 m wide and 2.85 m tall over a turntable skirt 3.05 m across:
slab sides, a roof cambered 0.33 m that falls to a vertical face, and an open-topped recess 1.38 m wide in the face
that both guns work out of. Elevation −5/+30 degrees, 150 degrees of training either side.

Approximations: the catalog shell has a flat rear plate and the reference's shallow rear bevel (0.22 m proud on
the centreline) is recipe detail, as are the chin under the recess, the sight hoods on the front roof corners and
the long tubes on brackets along each roof edge; the reference paints its side doors, which are drawn as thin
plates; port shields are round metal shields on the slides, not canvas.

## `us-6in53-mk13-single` and `us-6in53-mk13-casemate` — 6-inch/53 Mk 13 single mounts

Both visuals carry the gun in the same sixteen-sided training drum, 3.67 m across and 1.71 m tall with a flat face,
0.709 m above the drum's sole, and work it through a slotted port between two sighting ports. The open single
(`agm159`, the upper forward casemates) stands its drum 0.72 m up on a pedestal mount and leaves the drum's back
open over the breech; the casemate (`agm160`, the other six guns) is the drum closed, standing on the yaw datum,
with only the chase outside it. Datums: pivot 1.430 m (single) and 0.708 m (casemate), trunnion on the training
axis, muzzle 5.750 m and 5.686 m. Elevation −5/+20 degrees.

Approximations: the open single's pedestal, carriage, slide, recoil cylinders, sights and breech are simplified
original constructions at the reference's sizes; its open back is a declared `apertures` loop of the catalog
drum, with a liner and jambs drawn inside; the casemate draws nothing inside the drum but the port shutter.

## `us-50cal-browning-m2` — .50-calibre Browning M2 on a deck pedestal

Datums: trunnion on the gooseneck head 1.614 m up (bore line) and 0.014 m aft of the training axis, muzzle
1.089 m. The reference poses the gun at 30 degrees; every part of the elevating mass was turned back to the
horizontal about the trunnion. Elevation −10/+85 degrees. No shield, so the mount is `open-pedestal`.

Approximations: the cast gooseneck is a swept eight-sided arm; spade grips, sight bar and ring sight are rods.
