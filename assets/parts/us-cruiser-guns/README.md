# US cruiser main guns

Original Blender recipes for the 8-inch/55 cruiser turrets, authored against approved GameModels3D
(World of Warships) visuals only. No reference geometry is loaded, copied or shipped: each recipe draws the
catalog's closed `gunhouseMesh` as the visible gunhouse and adds its own fittings, barrels and canvas seals.
Fidelity to the approved model is the target; nothing here certifies historical accuracy.

The Baltimore 8-inch/55 Mk 12 triple (`us-8in55-mk12-triple`, `assets/parts/us-main-guns/geometry.py`,
visual `agm019_8in55_ca68`) already existed and is untouched.

| Part | Recipe | Source vehicle + visual | Barrels |
| --- | --- | --- | --- |
| `us-8in55-mk16-triple` | `mk16_triple.py` | pasc020 Des Moines A1, `agm025_8in55_triple_mk16` | 3 |
| `us-8in55-ca32-triple` | `ca32_triple.py` | pasc107 New Orleans AB1, `agm006_8in55_ca32` | 3 |
| `us-8in55-mk14-mod1-triple` | `mk14_mod1_triple.py` | pasc507 Indianapolis A1, `agm020_8in55_mk14_mod1` | 3 |
| `us-8in55-mk14-mod2-twin` | `mk14_mod2_twin.py` | pasc106 Pensacola A1, `agm021_8in55_mk14_mod2` | 2 |

Evidence: <https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc020>,
`.../pasc710`, `.../pasc107`, `.../pasc507`, `.../pasc106`, `.../pasc108` (Baltimore, for comparison).

For every part below, weapon and armor values are provisional game calibration scaled from the nearest
siblings in `guns.json` (`us-8in55-mk12-triple` and `skc34-203-twin`); plate families use commonly published
figures with estimated facet boundaries.

## Why each mount is a separate part

Each candidate was compared with the registered Baltimore Mk 12 visual (`agm019_8in55_ca68`: gunhouse
7.84 m wide and 3.69 m tall, pivot 1.258 m, trunnion 2.208 m, barrel spacing 1.700 m, flat raked face, a
transverse rangefinder across the after roof) by overlaying reference renders and by reading bounds, joint
nodes and mesh cross-sections. All four are visibly different, so all four are registered.

- **`agm025` Mk 16 (Des Moines, Salem)** — a different generation: 9.94 x 9.66 x 2.77 m gunhouse against
  Baltimore's 9.5 x 7.8 x 3.0 m, barrel spacing 2.196 m against 1.700 m, pivot 1.300 m, a deeply raked face
  carrying four ladders and three tall canvas ports that stand above the roof knuckle, a forward working
  tray under the guns and an after platform with a splinter screen. Nothing on it reads as a Mk 12.
- **`agm006` CA-32 (New Orleans)** — a *round-faced* turret: the face is curved in plan and raked 26
  degrees, the gunhouse is 6.4 m wide and only 3.1 m tall (Baltimore 7.8 x 3.7 m), the barrels are 1.151 m
  apart against 1.700 m, the pivot is 1.302 m and the trunnion 1.530 m against 2.208 m, and the rangefinder
  is carried in two hoods that project from the after quarters to 8.6 m across instead of a tube over the
  roof. Different shape and different datums.
- **`agm020` Mk 14 Mod 1 (Indianapolis, and two of Pensacola's four mounts)** — a turtle-back house: a
  curved crown rising to 3.35 m aft, vertical sides 5.9 m apart, a rounded stern, and guns working out of a
  recess between two forward wings rather than through ports in a raked face. Pivot 1.575 m and spacing
  1.117 m. Nothing in common with the Mk 12 silhouette.
- **`agm021` Mk 14 Mod 2 (Pensacola's other two mounts)** — the same turtle-back design with **two** guns
  in a narrower (4.78 m) house, and rangefinder hoods that reach further outboard. A different barrel count
  alone makes it a separate part; the house is narrower too.

Pensacola therefore fits two `agm021` twins and two `agm020` triples, which matches the published
arrangement of two twin turrets low and two triples superfiring. Northampton is not a World of Warships
vehicle, so no Northampton mount is registered: there is no approved visual for it.

## `us-8in55-mk16-triple` — 8-inch/55 Mk 16 three-gun turret

Source: pasc020 (Des Moines) A1 `agm025_8in55_triple_mk16`; pasc710 (Salem) A1 fits the same visual
unchanged, so one part covers both ships and no `-rf` variant is needed (neither fit adds rangefinder arms).

Datums are the visual's joint nodes: pivot 1.300 m, trunnion 2.100 m, muzzle 11.633 m, gun axes 2.196 m
apart (the commonly published figure is 85 in / 2.16 m). Real figures used: 451 tons (458 mt) turret weight,
-5 / +41 degrees at 8.2 deg/s, 5 deg/s in train, 28 in (0.71 m) recoil, 335 lb (152 kg) AP Mk 21 at
2500 fps (762 m/s), about 10 rounds per minute per gun (6 s reload) from the auto-loader. Plate families
follow the commonly published Des Moines turret figures: 8 in face, 3.75 in sides and roof, 2 in rear.

Approximations: the barrel is drawn with a constant jacket out to 4.90 m and then a three-segment taper,
where the reference tapers continuously from the face; the canvas bag is lofted from a seam on the face and
lifted over the roof knuckle rather than modelled as the reference's faceted cloth; the reference's two
below-deck ladders under the after platform (down to z = -0.42 m) are left out so the part sits flat on its
attachment plane; the upper flank sight hood, which the reference carries only to port, is drawn on both
flanks; the asymmetric aerial spreader on the crown is kept as the reference has it, to starboard.

## `us-8in55-ca32-triple` — 8-inch/55 triple turret (CA-32 pattern)

Source: pasc107 (New Orleans) AB1 `agm006_8in55_ca32`, fitted at all three positions, so the collection
gains one variant.

**Naming.** The visual's own designation is `ca32`, that is USS New Orleans (CA-32), and that is what the id and
the part name state. Published sources disagree about the gun mark in these turrets: NavWeaps lists the New Orleans
class with Mark 11 guns and reserves Mark 9 for Pensacola, Northampton and Portland, while Wikipedia lists New Orleans
herself with Mark 14 Mod 0 guns in a round-faced turret. The evidence here supports only "the New Orleans (CA-32)
8-inch/55 triple turret", so no mount mark is claimed.

Datums: pivot 1.302 m, trunnion 1.530 m, muzzle 10.102 m, spacing 1.151 m. Real figures: 294 tons turret
weight, -10 / +41 degrees at 8 deg/s, 150 degrees of training at 3.5 deg/s, 29.65 in (0.753 m) recoil,
260 lb (118 kg) projectile at 2700 fps (823 m/s), 3-4 rounds per minute (17 s reload). Plate families follow
the commonly published class figures: 8 in face, 2.75 in sides, 1 in roof; the rear plate (1.5 in) and the
floor are estimates.

Approximations: the rounded face and flanks are faceted into seven plan points a side; the reference has no
separate turntable disc (its skirt reaches the deck), so a 5 cm sole is added under a 4 cm shell floor to
keep the entry's `gunhouseBaseHeight` positive; the flank ladder stringers are drawn as plate fins, as in
the reference, with the rungs between them; the small after-roof vane post, which the reference carries only
to starboard, is drawn on both sides.

## `us-8in55-mk14-mod1-triple` — 8-inch/55 Mk 14 Mod 1 triple mount

Source: pasc507 (Indianapolis) A1 `agm020_8in55_mk14_mod1`, fitted at all three positions; pasc106
(Pensacola) A1/B1 fits two of the same mounts, so one part serves both ships.

**Naming.** `mk14_mod1` is the visual's own designation and is kept in the id and name. Wikipedia describes
the Portland class (Indianapolis) as carrying Mark 9 8"/55 guns in three triple mounts, and NavWeaps lists
Mark 14 as the rearmament gun fitted to those cruisers, so the two designations describe the same mount at
different dates. Nothing here certifies which mark a given ship carried on a given day.

Datums: pivot 1.575 m, trunnion 1.539 m, muzzle 9.755 m, spacing 1.117 m. Real figures: 247 tons mount
weight, -10 / +41 degrees at 8 deg/s, 150 degrees of training at 3.5 deg/s, 29.65 in (0.753 m) recoil,
260 lb (118 kg) projectile at 2700 fps (823 m/s), 3-4 rounds per minute (17 s reload). Only one gunhouse
figure is commonly published for the class (2.5 in / 63.5 mm): it is used for the face, and the side,
shoulder, crown and floor plates are estimates below it.

Approximations: the catalog shell is the turtle-back body and ends at the back of the gun recess
(x = 1.628 m), which is the real armored face; the two forward wings that flank the recess, the glacis
between them, the recess deck and the port frames are drawn as recipe detail (gun-port fairings), so the
armor does not extend into the wings. The curved crown is faceted into a ten-point section lofted over five
stations. The recess deck is drawn 5 cm lower than the reference's so that the guns clear it at the full
-10 degrees of depression; with the reference height they foul it.

## `us-8in55-mk14-mod2-twin` — 8-inch/55 Mk 14 Mod 2 twin mount

Source: pasc106 (Pensacola) A1/B1 `agm021_8in55_mk14_mod2`, the two lower turrets; the same hull's other two
mounts are `agm020` triples, registered above.

Datums: pivot 1.575 m, trunnion 1.534 m, muzzle 9.603 m, gun axes 1.118 m apart. Real figures: 187 tons
mount weight, elevation, training, recoil, shell and muzzle velocity as for the Mod 1 triple above. The
commonly published Pensacola class turret figure is a range, 0.75-2.5 in (19-64 mm): the face takes the
maximum and the crown the minimum, and the intermediate plates are estimates.

Approximations: as for the Mod 1 triple (shell ends at the recess face, wings and recess deck are recipe
detail, faceted crown, recess deck lowered 5 cm). The rangefinder hood is drawn as one box passing through
the flank plate, since on this narrower house the reference hood reaches inboard past the wall.
