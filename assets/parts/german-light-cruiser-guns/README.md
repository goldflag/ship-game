# German light-cruiser gun mounts

Original reusable mounts for the German 15 cm light-cruiser guns. Each part maps
to exactly one approved [GameModels3D](https://gamemodels3d.com/) gun visual and
is authored from measured proportions of that visual; no reference geometry is
loaded, copied or shipped. Fidelity to the approved model is the target. This is
not historical certification.

In every part the catalog `gunhouseMesh` is both the armor and the visible
housing, so the plates the game resolves are the plates the player sees. The
recipes add the turntable or pedestal, the sliding guns, the canvas or shield
gun ports and the service fittings the reference shows.

## 15 cm SK C/25 triple (Drh LC/25)

Two parts, because WoWS fits two visuals with the same armor shell but different
fitting-out:

| Part | Recipe | Visual | Ships that share it |
| --- | --- | --- | --- |
| `sk-c25-150-triple` | `sk_c25_triple.py` | `ggm057_149mm60_drhtr_c25` | Koenigsberg [pgsc105](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsc105) A1/B1, Leipzig pgsc516 A, Mainz pgsc518 A1 |
| `sk-c25-150-triple-nurnberg` | `sk_c25_triple_nurnberg.py` | `ggm029_149mm60_drhtr_sk_c25` | Nuernberg [pgsc106](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsc106) AB, Nuernberg '44 pgsc717 A, Weimar pgsc517 A |

The two visuals were compared numerically (bounds, connected components, joint
nodes) and visually from five views. Their gunhouse shells are the same body:
7.56 x 6.10 x 2.73 m, vertical flanks to a 1.95 m knuckle, folded shoulders at
about 37 degrees, a ridged roof crowning at 2.88 m over x = -1.76 m, a rounded
five-station back plate and a 22-degree raked face. They are **not** the same
model. The Nuernberg fit carries a raised triangular roof plate, one shoulder
guard rail per run instead of two, brackets standing outboard of the face
corners instead of the Koenigsberg fit's flat face panels, rear quarter
platforms and a rear door instead of footsteps and centreline rungs, square
caps on the ventilator cowls, and its face ladder to starboard of the centre
gun with one more rung. Its mount is also the heavier, faster-training one. The
two recipes therefore repeat their shared construction rather than importing one
another, as the brief requires.

The gunhouse encloses three guns in separate ports, each with its own canvas
bag: the reference shows three independent sleeves and bags 0.60 m apart in
breadth, not a common mantlet. Barrels slide through `gun_bloomers` cuffs on a
constant 0.205 m jacket section that spans the whole 0.37 m stroke; the fixed
seams are cast onto the real raked face and the intermediate cloth rings are
draped over the armor at depression and kept outside the jacket at elevation.

Weapon values are commonly published figures for the gun and the Drh LC/25
mounting: 45.5 kg at 960 m/s, 6 to 8 rounds per minute per gun (8 s in the
catalog), -10 to +40 degrees, 0.37 m recoil, 6 deg/s training and elevation on
the Koenigsberg mounting and 7.6/8 deg/s on the heavier Nuernberg one, 136.9 t
and 147.2 t of revolving weight. `penetrationMm`, `damage`, `ammoPerBarrel` and
`armorMm` are provisional game calibration scaled from `sk-c28-150-twin` and
`type3-155-triple`; plate families use commonly published figures for the
Koenigsberg-class turret, 30 mm face and 20 mm sides, rear and roof, with
estimated facet boundaries.

Approximations: the canvas seam stops just under the roof knuckle, where the
reference bag returns about 0.12 m higher; the Nuernberg roof plate's base edge
is pulled 0.20 m aft of its reference station so the guns clear it at full
elevation; the small ladder the Nuernberg visual hangs below its turntable is
omitted, so the sole stays flat at Z = 0 for the attachment socket; fine plate
seams, cleats and the shoulder rail stanchion count are simplified.

## 15 cm SK L/45 shielded single (MPL C/16)

`german-sk-l45-150-single` (`sk_l45_single.py`) follows
`ggm047_150mm_sk_l45` on Karlsruhe
[pgsc104](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsc104),
which fits it at all eight broadside positions in both A1 and B1, so there is
one variant. **WoWS does not model an Emden 15 cm mount**: its Emden (pgsc502)
carries 10.5 cm guns only, below this catalog's calibre. The 15 cm SK L/45 in
MPL C/16 is nevertheless the same gun and mounting the interwar Emden carried,
so the part is registered against the Karlsruhe visual, which is the visual WoWS
fits to that ship.

This is a shielded pedestal gun, not a turret. The catalog owns a thin closed
shield slab: a 50 mm face and 20 mm flanks and roof drawn as both surfaces of a
plate that is open at the rear, 2.52 x 2.30 x 1.90 m, with straight flanks, a
rounded nose reaching 0.99 m on the centreline, a nose that leans back above the
sill and a roof falling forward from a 2.33 m rear coaming. Everything the open
back exposes is recipe detail: the deck flange, revolving pedestal, roller race
and carriage deck, the trunnion cheeks and bearings, the cradle with its yoke
and recoil cylinders on the elevating mass, the sliding gun with its breech
housing, rear cap, recoil slide, wedge handle and loading tray, the layers'
seats, the two handwheels a side on their shaft and standard, and the open
sights on the cradle. The ship provides the port: the gun and cradle stay clear
of a port the size of the shield opening through the declared travel.

Weapon values are commonly published figures for the gun and the MPL C/16
mounting: 45.3 kg at 835 m/s, 5 to 7 rounds per minute (10 s in the catalog),
-10 to +27 degrees, 0.45 m recoil, 17,116 kg. The source records the mounting as
manually worked, so the catalog's 8 deg/s training and elevation rates are game
values scaled from `sk-c28-150-twin`, not published mount rates.
`penetrationMm`, `damage`, `ammoPerBarrel` and `armorMm` are provisional game
calibration scaled from `sk-c28-150-twin` and `type41-152-kongo-casemate`; the
shield plate is 30 mm in the reference model, and the catalog's 50/20 mm
families are the commonly published range for German 15 cm shielded deck
mounts with estimated facet boundaries.

Approximations: the armor shell must be closed, so the two sight openings in the
reference's shield plate are drawn as framed and glazed panels rather than
holes; the reference's mounting flange reaches 0.10 m below its root, and here
the sole is kept flat at Z = 0 so the attachment socket sits on the true bottom
plane; the second, aft handwheel of the reference and the finest rear gear are
not modelled.

```sh
bun run part:build sk-c25-150-triple
bun run part:check sk-c25-150-triple
bun run model:viewer
```

Library review stays unreviewed until installation review passes: standalone
clearance does not certify a neighbouring mount or a particular ship's
galleries.
