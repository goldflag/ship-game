# US 5-inch/25 Mk 19 open mount

Original Blender recipe for the 5-inch/25 single open anti-aircraft mount, authored against one approved
GameModels3D (World of Warships) visual only. No reference geometry is loaded, copied or shipped: every piece
is drawn from measurements taken off that model. Fidelity to the approved model is the target; nothing here
certifies historical accuracy.

| Part | Recipe | Source vehicles + visual | Barrels |
| --- | --- | --- | --- |
| `us-5in25-mk19-single` | `mk19_single.py` (`create_mount`, builder `us-5in25-mk19-single`) | pasc106 Pensacola A_ATBA and B_ATBA, pasc107 New Orleans AB_ATBA: `ags007_5in25_mk19_mod6` | 1 |

Evidence: <https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc106>, `.../pasc107` and
`https://gamemodels3d.com/games/worldofwarships/data/current/common/visual/usa/gun/secondary/ags007_5in25_mk19_mod6/ags007_5in25_mk19_mod6.model`.

## One part for both ships

Both vehicle schemes fit the same resource, `common/visual/usa/gun/secondary/ags007_5in25_mk19_mod6`, at all
eight `HP_AGS` hardpoints in every configuration (Pensacola's A and B hulls, New Orleans's AB), and the
skeleton each hardpoint carries (`Rotate_Y`, `Rotate_X`, `Roll_Back1`, `gunFireEffect`) has identical
transforms on the two ships. There is no variant to split, so one part serves both.

## Datums

The reference is one skinned mesh of 1444 triangles. Its joint nodes, at 15 m per source unit, put the
training joint (`Rotate_Y`) 0.207 m above the hardpoint, on top of the fixed stand; the elevation joint
(`Rotate_X`) 1.466 m above the hardpoint on the yaw axis; and the muzzle (`Roll_Back1`, `gunFire1`) 3.065 m
forward of and 0.237 m above that joint. The drawn barrel's axis is 1.701 m above the hardpoint, 0.158 m in
radius at the slide face, tapering straight to 0.095 m at the muzzle round a 0.132 m bore.

The catalog puts the trunnion on the bore axis, as the US Bofors quad does for its smaller offset, so the
muzzle socket lands on the drawn muzzle: `pivotHeight` 1.70, `trunnionForward` 0, `muzzleForward` 3.065,
`barrelBaseRadius` 0.158. `barbetteRadius` 0.70 is the stand's sole. `gunhouseSize` [2.55, 2.9, 2.2] is the
training structure from the after deck edge to the front locker, across the platform, and up to the slide.

## What is modelled

- **Fixed (`<id>.base`):** the decagonal stand, vertex forward, 0.699 m radius at the sole and 0.600 m at the
  training race; hollow (0.46 m bore) with a foundation plate, so the breech end can drop into it.
- **Training (`<id>.yaw`):** the two-level platform (after deck top 0.341 m, forward deck 0.570 m) with the
  reference's slot in the after edge and its chamfered starboard-after corner; the carriage side frames, each
  the reference's sloping wedge with the triangular cheek on it and a trunnion cap with hub and bolts at the
  apex; the front web, the elevating gear case with its pinion, and the cross shaft between the gunners'
  gearing; the pointer's (port) and trainer's (starboard) leaning pedestals, indicator drums with two cranked
  handwheels each, the arms down to the gear boxes on the cross shaft, and the seat pans on their posts and
  arms; the starboard training drive
  (leaning housing and tilted gear box) and the port elevating drive (slanted block, gear box and motor); the
  corner guard rails; the forward locker; the fuze setter on the port after deck with its three pots between
  funnel dividers, setting cranks and the hooded indicator tower with its dial; the loader's step seat; and a
  coaming round the breech well.
- **Elevating (`center.elevation`):** the slide's front block and collar, the rammer housing to starboard, the
  loading tray to port, the recoil cylinder over the chase, the trunnion pins, the toothed elevating arc, the
  sight box with its two dial heads on stalks, and the ring-sight bar with the pointer's and trainer's
  telescopes.
- **Recoiling (`center.recoil`):** the tapered barrel and dark bore, the breech ring and block, and the
  operating lever.

## Weapon values

Provisional game calibration from the commonly published 5-inch/25 figures and the two open 5-inch siblings,
`us-5in38-mk21-single` and `us-5in51-mk7-open-single`, kept physical so the simulation applies the world pace.

| Value | Catalog | Basis |
| --- | --- | --- |
| Shell, muzzle speed | 24.5 kg, 657 m/s | published AA common shell |
| Elevation | -10 / +85 deg | published |
| Reload | 3.4 s | 17.5 rounds per minute, the middle of the published 15-20 |
| Traverse, rates | +-160 deg at 15 deg/s, elevation 15 deg/s | Mk 21 sibling |
| Recoil, ammunition, armor | 0.38 m, 360 per barrel, 6 mm | Mk 21 sibling |
| Damage | 10 (HE 20) | Mk 21's near-equal 25 kg shell |
| Penetration | 52 mm | mean of the siblings' 65 and 82 mm scaled to this shell by mass^0.7 and 5 km reference speed^1.4 (48.5 and 55.0 mm) |
| Drag, dispersion | 0.052017 /s, 1.3 mrad | `k = 0.5 * 1.225 * 0.25 * area * v / m`; the Mk 7's looser spread for the shorter gun |
| Reference speed | 397.477 m/s | the catalog's 5000 m, 10 m launch solution for this drag |
| AP, HE | 0.6125 kg fill; 1.96 kg fill, 60% HE stock | `author-ap.ts` and `author-he.ts` formulas; HE is the main load for an AA common gun |
| Mount mass | 9000 kg | between the Mk 7 pedestal (8500 kg) and the Mk 21 (13154 kg): a much shorter gun and slide than the Mk 21, but a training platform, fuze setter and crew stations the Mk 7 lacks |

## Approximations

- **Trunnion.** The reference elevates about a joint 0.237 m below its bore; the recipe's trunnion is on the
  bore axis, so the slide swings about a point 0.237 m higher than the reference's at high elevation.
- **Breech well.** The reference's platform, its carriage wedge and a raised box on the after deck are solid
  under the slide, which would pass through them above about 45 degrees (the game never elevates it that far).
  The recipe opens a well 1.33 m long and 0.64 m wide through both decks between the carriage frames, keeps the
  wedges only in the two side frames plus a front web, drops the centre box, and hollows the stand, so the
  slide's breech end sits 0.20 m above the sole at +85 degrees.
- **Elevating arc.** The reference's arc is centred on its own lower pivot. The recipe's toothed arc is
  concentric with the trunnion (0.58 m tip radius, so its lowest point is 1.12 m rather than 1.04 m) and meshes a
  pinion on a gear case standing on the front web.
- **Sight box.** At the reference position the box on the slide's starboard side overlaps the starboard cheek and
  would cut through it as the gun elevates. The box, its two stalks and dial heads are moved 0.095 m outboard and
  carried by a bracket over the cheek head.
- **Loading tray.** The reference draws the slide's port half as a solid block with a sloping top. The recipe
  keeps that profile as the tray's outer wall and lowers the tray floor to 1.535 m, so the breech ring and lever
  run back along an open trough in recoil instead of cutting through the block.
- **Additions the reference lacks:** trunnion caps with hubs and bolts, the well coaming, breech block and lever,
  telescope eyepieces and objectives, the dial glasses, the fuze-setter indicator dial, a 12 mm cover plate on the
  rammer housing and the locker handle. The pointer/trainer and elevating/training-drive names are this recipe's
  reading of the reference, which labels nothing.
- **Facets.** The barrel has 16 facets where the reference has 8; the pedestals, telescopes, stalks and crank
  bosses keep low counts. The fuze-setter end posts are full-width boxes where the reference narrows them below
  the pots.

## Checks

- `part:build`, `part:check`, `part:publish` and `part:published:check` pass; 3652 triangles, five joints
  (`base`, `yaw`, `center.elevation`, `center.recoil`, `center.muzzle`), lowest point y = 0.000 (the sole).
  Size in game axes [2.985, 2.440, 4.814], bounds centre [-0.058, 1.220, -0.661]; centre of gravity
  [0, 0.95, 0], the area-weighted centroid of the rest pose.
- Silhouette overlap with the reference at a common scale, rest pose, on the published GLB: port side 0.966,
  starboard side 0.967, top 0.997, front 0.946, rear 0.945 (IoU). The model viewer's side-by-side comparison
  reads 4.81 x 2.98 x 2.44 m against the reference's 4.81 x 2.99 x 2.44 m.
- Swept from -10 to +85 degrees in 1 degree steps at 0, half and full recoil against every fixed and training
  mesh (triangle-pair BVH tests, with the coaxial trunnion pins as the positive control): no contact. The
  tightest margins are 6.8 mm between the arc and its pinion, 8 mm between the slide and the well sides, 9 mm
  between the sight box and the starboard cheek, 10 mm between the slide and the cheeks, 23 mm to the well coaming
  and 46 mm to the stand race. Every training part except the two decks, which bear on the race, clears the stand
  through a full turn in 10 degree steps.
- No floating geometry: at rest each of the 145 meshes intersects another or lies within 3 mm of one.
- The shared entry point was also called the way a Blender-recipe ship calls it (ship mesh helper, only
  `naval`, `dark` and `edge` materials, Pensacola's `HP_AGS_3` position and bearing): the base lands on the
  hardpoint, the yaw turns to the bearing and the muzzle sits 3.065 m out along it.

## Installation

- **Foot.** The part's origin is the stand's sole, which is the reference's `HP_AGS` node; nothing hangs below
  it. The installing ship owns the deck under the 0.70 m sole. On both ships the `HP_AGS` nodes sit 0.3 to 2.4 cm
  below the deck they stand on, so place the foot on that deck (`ship:hardpoints <vehicle> --match HP_AGS`).
  Positions are the reference's, in ship metres (+X starboard, +Y up from the source waterline, -Z bow); the
  odd-numbered hardpoints are to port (x < 0) and carry the negative bearing of each pair.

  | Ship | Hardpoint | x, y, z (m) | Bearing |
  | --- | --- | --- | --- |
  | Pensacola `pasc106` | `HP_AGS_1`, `_2` | +-7.176, 9.351, -28.800 | 0 |
  | | `HP_AGS_3`, `_4` | +-7.176, 9.105, -19.426 | +-45 |
  | | `HP_AGS_5`, `_6` | +-6.643, 6.571, 18.880 | +-135 |
  | | `HP_AGS_7`, `_8` | +-6.831, 6.571, 26.424 | 180 |
  | New Orleans `pasc107` | `HP_AGS_1`, `_2` | +-6.857, 8.805, -27.748 | +-45 |
  | | `HP_AGS_3`, `_4` | +-6.810, 6.227, -15.772 | +-45 |
  | | `HP_AGS_5`, `_6` | +-6.157, 6.227, -6.477 | +-45 |
  | | `HP_AGS_7`, `_8` | +-6.836, 6.227, 2.472 | +-45 |

- **Pivot and trunnion.** Trunnion 1.70 m above the foot on the yaw axis (`trunnionForward` 0); the muzzle is
  3.065 m forward of it at 0 degrees.
- **Working circles.** Fixed stand 0.70 m. Training structure 2.17 m (the port-after platform corner), from
  0.207 m up to 1.83 m. The gun reaches 3.07 m at 0 degrees (3.03 m at -10), its underside down to 1.07 m above
  the foot at -10. Two identical mounts need 4.35 m between yaw axes for their platforms, 5.24 m for one gun to
  clear the other's training structure and 6.14 m for both guns to train freely; the nearest pair on either ship
  is 7.5 m apart (Pensacola `HP_AGS_5` and `_7`).
- **Elevation.** Catalog -10 / +85 degrees; the model itself clears +85 on a flat deck. The native construction
  resolver's generic open-mount proxy (a 1.55 m breech behind the trunnion) grants -10 to +50.4 degrees on a
  bare deck (the Mk 21 sibling: +46.8), and at most about 61 with a raised barbette, whose trunk then stops the
  proxy. With an installation-envelope profile of the kind Blender-recipe presets carry (`barrelRadiusM` 0.158;
  its barrel capsule starts 0.65 m plus recoil behind the trunnion) the resolver grants the full -10 to +85, and
  only the structures and neighbours the ship declares can stop it.
- **Construction editor.** Like its siblings the entry declares no occupancy, so the native compiler treats it as
  a gun with a working well: it cuts a 0.70 m radius opening through the deck under the sole, sealed by the mount,
  reserves the standard 0.84 m depth below it and places the mount's ammunition module there.
