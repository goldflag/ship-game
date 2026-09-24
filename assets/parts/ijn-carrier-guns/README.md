# Shōkaku carrier AA mounts

Original Blender recipes for the four anti-aircraft mounts of Shōkaku's December 1941 fit. The only visual
reference is GameModels3D Shōkaku `pjsa108` (A hull; World of Warships builds the ship from Zuikaku 1944). It was
used to measure and compare silhouettes only; no reference mesh is loaded, traced or shipped.

| Part | Builder (function) | Reference visual | pjsa108 hardpoints |
| --- | --- | --- | --- |
| `type89-127-a1-twin` | `ijn-carrier-type89-open` (`type89_twin.create_open`) | `jgs009_127mm40_type_89` | HP_JGS_1–4, 7, 8 |
| `type89-127-a1-mod2-twin` | `ijn-carrier-type89-mod2` (`type89_twin.create_shielded`) | `jgs003_127mm40_type89_mod_a` | HP_JGS_5, 6 |
| `type96-25-triple` | `ijn-carrier-type96-open` (`type96_triple.create_open`) | `jga173_25mm_type96` | HP_JGA_32–39, 45, 49 (B AA fit) |
| `type96-25-triple-shielded` | `ijn-carrier-type96-shielded` (`type96_triple.create_shielded`) | `jga004_25mm_type96_triple_1` | HP_JGA_40, 41 (B AA fit) |

`geometry.py` is the earlier carrier recipe. Yukikaze's ship recipe still imports its `create_mount` for its
own triples, so it stays unchanged. `author_catalog.py` rewrites these four catalog entries with the values
below.

## Datums

Each mount's origin is the reference hardpoint. The ship supplies the support up to that plane.

| Datum | Open A1 | Mod 2 | Open triple | Smoke-shield triple |
| --- | --- | --- | --- | --- |
| `pivotHeight` | 2.11 (bore axis; the reference trunnion node sits 5 cm higher at 2.163) | 0.912 | 0.915 | 1.23 |
| `trunnionForward` | -0.231 | -0.317 | -0.13 | 0.02 |
| `muzzleForward` | 4.107 | 3.783 | 1.68 | 1.83 |
| `barrelSpacing` | 0.682 | 0.677 | 0.28 | 0.30 |
| `barrelBaseRadius` | 0.18 | 0.12 | 0.048 | 0.048 |
| `barbetteRadius` | 1.47 (deck disc, 0.11 m below the datum) | 3.31 (turntable, sole on the datum) | 0.6 (foundation ring) | 1.7 (drum) |

The 25 mm visuals have no elevation joint. Their trunnions come from the barrels, which are baked at 30 degrees:
the bore line through them meets the reference muzzle points and the trunnion-pin component.

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
- Open triple: each gun keeps its own cradle, case chute and grips. The reference's long port elevating link is
  omitted because a rigid part cannot follow both of its ends through elevation. The chutes and rear grips are
  shortened, and the training well is left open, so they clear the deck at 85 degrees. Seats, sight and hand
  wheel are simplified.
- Smoke-shield triple: the twelve-sided drum is fixed (`<id>.base`) and the shield trains on it. The guns inside
  reuse the open triple's gun with a simplified hidden cradle. The notch floor under the slots is held 0.11 m
  below the reference so the flash hiders clear it at -10 degrees. The plan is a regular twelve-gon.
