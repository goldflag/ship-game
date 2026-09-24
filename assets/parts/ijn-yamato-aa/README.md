# Yamato 12.7 cm Type 89 twin AA mounts

Original Blender recipes (`type89_twin.py`) for the two Type 89 variants of Yamato's 1945 fit. The only
visual reference is GameModels3D Yamato `pjsb018` (the approved ship reference); it was used for
measurement and silhouette comparison only. No reference mesh is loaded, traced or shipped.

| Part | Builder | Reference visual | Yamato mounts |
| --- | --- | --- | --- |
| `type89-127-yamato-twin` | `ijn-yamato-aa-shielded` (`create_shielded`) | `jgs157_127mm40_type89_mod_a` | `ha-1-1..3`, `ha--1-1..3` (outer shelter-deck towers) |
| `type89-127-yamato-open-twin` | `ijn-yamato-aa-open` (`create_open`) | `jgs158_127mm40_type_89` | `ha-1-4..6`, `ha--1-4..6` (inner tubs) |

## Datums

The mount origin is the reference hardpoint, so the blueprint mount height is the hardpoint height and the
catalog pivot is the reference trunnion (`Rotate_X`) height. The ship supplies the tower (mod A) or the
tub floor (open mount) up to that plane.

| Datum | Mod A | Open |
| --- | --- | --- |
| `pivotHeight` | 0.789 | 2.037 |
| `trunnionForward` | -0.266 (trunnions aft of the training axis) | -0.389 |
| `muzzleForward` | 3.782 (barrel tip, `gunFire`; `Roll_Back1` is 3.708) | 3.627 |
| `barrelSpacing` | 0.652 | 0.652 |
| `barbetteRadius` | 3.3 (turntable) | 1.42 (deck ring) |

Weapon, ammunition, armor and limit values are unchanged from the earlier Yamato catalog entry (both parts
share them); only datums and housing dimensions follow the reference.

## Approximations

- Mod A: the turntable top is the reference's plane rising aft, but its front lip is held 8 cm lower so the
  barrels clear it at the catalog -10 degree depression (the reference model would touch at about -8
  degrees). The slot shield is drawn as one arc concentric with the trunnions; each gun carries a port
  collar and a sliding shutter over it, and the barrels pass through the shield face (named `cover`). The
  hood is closed at the rear as on the reference; its interior, breeches and hoists are not modelled. The
  gunlayer's sight bay is an elliptical arched recess with frames, a curved roof and binoculars. Hood facets
  are estimated from reference slices, not traced.
- Open mount: pedestal drum, U-shaped carriage (the well between the cheeks leaves room for the breeches at
  high elevation), per-gun cradle with paired recuperators ending in pointed heads, sliding breech,
  loading tray and rammer bar; pointer's arched housing with platform, seat, sight, binoculars and
  handwheels; trainer's seat and handwheel; fuze-setter cabinet with drawers; aft fuze drums and loaders'
  footboards. The reference's finer levers, sight linkages and small brackets are omitted. Each gun keeps
  its own cradle half so the two elevation groups stay independent.
- The catalog keeps `mountingStyle: open-pedestal` and no `gunhouseMesh` (the hood is recipe geometry, not
  an armor shell), so damage behaviour is unchanged.
