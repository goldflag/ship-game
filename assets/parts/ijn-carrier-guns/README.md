# Shōkaku carrier AA mounts

Original Blender recipes for the four anti-aircraft mounts of Shōkaku's December 1941 fit. The only visual
reference is GameModels3D Shōkaku `pjsa108` (A hull; World of Warships builds the ship from Zuikaku 1944). It was
used to measure and compare silhouettes only; no reference mesh is loaded, traced or shipped.

| Part | Builder (function) | Reference visual | pjsa108 hardpoints |
| --- | --- | --- | --- |
| `type89-127-a1-twin` | `ijn-carrier-type89-open` (`type89_twin.create_open`) | `jgs009_127mm40_type_89` | HP_JGS_1–4, 7, 8 |
| `type89-127-a1-mod2-twin` | `ijn-carrier-type89-mod2` (`type89_twin.create_shielded`) | `jgs003_127mm40_type89_mod_a` | HP_JGS_5, 6 |

`geometry.py` is the earlier carrier recipe. Yukikaze's ship recipe still imports its `create_mount` for its
own triples, so it stays unchanged.

## Datums

Each mount's origin is the reference hardpoint. The ship supplies the support up to that plane.

| Datum | Open A1 | Mod 2 |
| --- | --- | --- |
| `pivotHeight` | 2.11 (bore axis; the reference trunnion node sits 5 cm higher at 2.163) | 0.912 |
| `trunnionForward` | -0.231 | -0.317 |
| `muzzleForward` | 4.107 | 3.783 |
| `barrelSpacing` | 0.682 | 0.677 |
| `barbetteRadius` | 1.47 (deck disc, 0.11 m below the datum) | 3.31 (turntable, sole on the datum) |

Weapon, ammunition, armor, limit and rate values are unchanged; only datums and housing dimensions follow the
reference.

## Approximations

- Open A1: raked A-frame cheeks with a V web between them. The web is held under the cradles' sweep; at the
  reference's height it would foul the cradles at high elevation. Only its shoulders outboard of the cradles
  climb the cheeks. Each gun keeps its own cradle
  half, breech guard and pair of hexagonal recuperators, so the two guns elevate independently. The reference
  uses one common cradle. The central loading tray starts 1.07 m behind the trunnions so the recoiling breeches
  (0.45 m stroke) clear it. The pointer's hooded station, the fuze setter, the trainer's sight, the fuze drums
  and the loaders' trays follow the reference's layout. Its fine levers, linkages, cables and small brackets are
  omitted.
- Mod 2: the hood follows the Yamato Type 89 recipe's construction, re-measured for jgs003. The turntable top
  rises aft (0.21 m at the front lip, 0.89 m at the rear). The slot shield is one arc concentric with the
  trunnions (r 1.75), and the port collars and shutters slide over it. The reference is a low-detail model, so
  the roof hatches, vents, side door and ladder are recipe detail. The hood interior is not modelled.
