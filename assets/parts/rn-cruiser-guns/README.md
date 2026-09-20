# Royal Navy cruiser main guns

Original Blender recipes for three Royal Navy cruiser main turrets. Each part maps to exactly one
GameModels3D (World of Warships) artillery visual, used for silhouette, proportions, joint datums and
which ships share a mount. The geometry here is authored from those measurements; no reference mesh is
loaded, copied or shipped. Model fidelity does not certify historical accuracy.

The catalog's closed `gunhouseMesh` is both the armor and the visible gunhouse in every recipe, so
protection and shape cannot drift apart. Everything else — roller plate, gun wells and their coamings,
gun-port rings, cowls and shields, cradles, trunnions, recoil gear, sighting hoods, ladders, rails,
hatches — is recipe detail.

| Part | Recipe | Visual | Vehicles |
| --- | --- | --- | --- |
| `bl-6in50-mk23-triple` | `bl_6in50_triple.py` | `bgm001_6in50_mk_xxiii` | pbsc107 Fiji, pbsc507 / pbsc528 Belfast, pbsc108 Edinburgh, pbsc109 Neptune |
| `bl-6in50-mk21-twin` | `bl_6in50_twin.py` | `bgm021_6in50_mk_xxi` | pbsc106 Leander (A1 and B1) |
| `bl-8in50-mk8-twin` | `bl_8in50_twin.py` | `bgm129_8in50_bl_mk8` | pbsc206 Devonshire, pbsc207 Surrey, pbsc538 Hampshire, and pbsc505 Exeter via `bgm105_8in50_bl_mk8` |

Evidence: `https://gamemodels3d.com/games/worldofwarships/` (vehicle pages and
`data/current/common/visual/uk/gun/main/<name>/<name>.model`).

## Variants

Every reference visual above fits one gunhouse shape at every position and configuration of every
vehicle listed, and none of them carries a rangefinder hood or projecting rangefinder ends, so each
collection gains exactly one part and there is no `-rf` split.

`bgm105_8in50_bl_mk8` (Exeter) and `bgm129_8in50_bl_mk8` were compared numerically: same triangle
count, and their rounded vertex sets are identical with zero points in either difference. They are one
mount, so Exeter shares `bl-8in50-mk8-twin`.

London's `bgm125_8in50_mk1` and `bgm126_8in50_mk1_rf` are a **different** 8-inch mount — shorter
gunhouse, a separate sleeve housing per gun, barrels visible much further aft — and `bgm126` adds
rangefinder arms. They are not built here and are recommended as a separate part with an `-rf` variant.

## 6-inch/50 Mk XXIII triple — `bl-6in50-mk23-triple`

Town/Edinburgh/Fiji gunhouse: a large squarish turret with a rounded rear in plan, a flat cambered
roof and a raked glacis cut by three open gun wells that notch down through the roof front edge. The
recipe adds the raised coamings around the well mouths, the flared gun-port rings, cradles with
trunnion pins and a recoil pair under each jacket, the pair of gunlayers' sighting hoods the reference
carries between the centre and port guns only, the roof hatch frame and lugs, the after periscope, the
rear hatches and steps, the flank hand rails and the after ladders.

Approximation: the reference sets the **centre gun 0.761 m aft** of the outer pair (trunnion x 0.216
against 0.977, muzzle 6.090 against 6.851). The catalog carries one trunnion and one muzzle datum per
mount, so all three guns use the outer-gun datum and the centre gun sits 0.76 m too far forward in
plan. Spacing (1.9812 m, the published 78 in) and pivot height (1.306 m) are exact.

## 6-inch/50 Mk XXI twin — `bl-6in50-mk21-twin`

The Leander-class mounting. The visual's name carries the **mounting** mark, Mk XXI; the gun in it is
the 6-inch/50 Mk XXIII, and the mounting is the one that elevates to +60 degrees. A smoothly rounded
gunhouse with a steeply raked glacis and a deep recess per gun, each lip carrying a curved cowl rib
that arches out past the plate. The recipe adds those ribs and their sill, the gun-port rings, cradles
and recoil gear, the centre sighting tower with its wing fins and periscope, the training rails under
each gun, roof lugs, rear steps, flank rails and after ladders.

## 8-inch/50 Mk VIII twin — `bl-8in50-mk8-twin`

The County-class turret: long and low, widest amidships, with a roof that falls gently forward and
then turns into a steep front plate. Each gun runs inside a drooping fairing that pierces that plate.
Those fairings are parented to the gun's elevation joint so the gun stays inside its shield through
the mounting's +70 degrees; the reference mesh is baked at rest and cannot settle whether WoWS
animates them. The recipe also adds the roller plate the reference models under the gunhouse, the step
ladder up the centre of the front slope, the two roof hatches, the starboard sighting hood, rear
stiles and steps, flank rails and after ladders.

## Weapon and armor values

Mass, elevation limits, traverse, rates, muzzle speed, projectile mass, recoil stroke and reload are
commonly published figures (navweaps.com gun and mounting pages for the 6"/50 Mk XXIII and the 8"/50
Mk VIII), taken as stated and not pre-scaled for game pace.

- Mk XXIII: 112 lb (50.8 kg) shell, 841 m/s, 6-8 rounds per minute per gun (7.5 s here), 16.5 in
  (0.42 m) recoil, -5 to +45 degrees, 10 deg/s elevation, 5-7 deg/s training (6 here), gunhouse
  161-182 long tons (175 t here, estimated within that range).
- Mk XXI: same gun and shell, -5 to +60 degrees, 84 in (2.1336 m) gun spacing, mounting 91 long tons.
- Mk VIII: 256 lb (116.1 kg) SAPC shell, 855 m/s, 3-6 rounds per minute (12 s here), 24 in (0.61 m)
  recoil, -3 to +70 degrees, mounting 205-220 long tons (213 t here, estimated within that range).
  Elevation 6 deg/s and training 5.5 deg/s are **estimated** from the published per-mark ranges.

Plate families use commonly published figures with estimated facet boundaries: 160 lb (102 mm) glacis
with 80 lb (51 mm) sides, rear and roof for the Edinburgh/Fiji triple; 40 lb (25 mm) all round for the
Leander twin; 40 lb (25 mm) all round for the County twin. Shell floors are thin steel plate and are a
game estimate. British cruiser plate of this period was non-cemented, so every face uses the catalog's
`steel` material.

`penetrationMm`, `damage`, `ammoPerBarrel` and `armorMm` are provisional game calibration scaled from
the nearest siblings in `guns.json` — `us-6in47-mk16-cleveland` for the two 6-inch mounts and
`skc34-203-twin` for the 8-inch — interpolated by caliber and muzzle speed. They are not historical
performance data.

## Approximations, in one list

- Mk XXIII centre-gun stagger of 0.761 m is not represented (one trunnion/muzzle datum per mount).
- Well and recess after ends are square in the armor shells; recipe coamings and ribs round them off.
- Rounded gunhouse surfaces are faceted, which costs a little silhouette at mid height on the twin.
- The Leander recess floor steps down 40 mm at its mouth so the gun clears it at full depression.
- The County gun fairings elevate; the reference cannot confirm that they do.
- `barrelSpacing` follows the reference joints for the 8-inch (2.102 m against the published 2.1336 m)
  and the published figure for the two 6-inch mounts.
- Pegs and lips the references hang below the turntable plane are omitted so each model's lowest point
  stays flat on the sole.
