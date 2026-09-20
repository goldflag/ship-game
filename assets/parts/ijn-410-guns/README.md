# Japanese 41 cm/45 Type 3 twin mounts

Four original reusable turrets for the Nagato class, all built by
`type3_410.py`, which switches on `mount['partId']`. The catalog owns the closed
armor shell and the weapon data; the recipe draws that shell and adds the
rotating sole, sliding barrels, canvas seals and service fittings. The support
attachment is the sole at Y = 0; the Shipbuilder owns the barbette below it.
Geometry is independently authored from measured proportions; this is not
historical certification.

Common to all three: weapon and armor values are provisional game calibration
(1020 kg at 790 m/s, 30 s reload); plate families use commonly published figures
(305 mm face, 230 mm side, 152 mm roof, 190 mm rear) with estimated facet
boundaries. The approved visuals carry no elevation stops, so the catalog uses
the commonly published limits of −2° to +35° with a 1.2 m recoil stroke.
Library review stays unreviewed until installation review passes.

## 41 cm/45 Type 3 twin

`type3-410-nagato-twin` follows the approved
[GameModels3D Nagato](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsb010)
visual `jgm046_410mm45_type3`, which that model fits at A and Y turrets.

The `gunhouseMesh` is a seven-station loft: a flared sole strake, a flank that
leans in at about 23°, a knuckle at the 2.7 m shoulder, a domed roof crowning at
3.16 m over a rounded seven-sided back plate, and a face raked back at 50° from
the vertical. The recipe adds the sole skirt carried down to the yaw datum, the
forward sill, the centre-line rear ladder on its standoffs, flank ladders welded
to the side plate, a flat ladder lying across the port roof slope, two runs of
two-rail roof stanchions (the forward run closes on the centre line abreast the
sight hood, as the visual's stanchions do), the port-side ventilator box, the
gunlayers' sight hood on the roof centre, forward cheek blisters, the raised
face spine with its ladder between the gun ports, and the rear-roof service
arch: two braced ribs open both ways, joined at the crown, with a king post
inside and a davit post and head on the roof just ahead of them.

Datums come from the approved model's joint nodes: trunnion 3.00 m forward at
1.21 m, muzzle 17.13 m forward. Barrel spacing is taken as 2.49 m from the drawn
bores rather than the 2.688 m of the `Roll_Back` nodes, which sit about 0.10 m
outboard of the tube centre lines on this visual (the Mutsu visual's nodes agree
with its bores at 2.49 m). Barrels slide through flexible `gun_bloomers` cuffs
on a constant 0.545 m jacket that spans the whole recoil stroke; the fixed seams
are cast onto the real face and return over the roof knuckle, and the
intermediate cloth rings are draped over the armor at depression and kept
outside the jacket at high elevation.

Approximations: the roof crown is a smooth dome rather than the visual's small
stepped panel; the arch's lightening holes, the plate seams and the fine service
fittings are simplified; the rear plate is a flat seven-sided cap instead of a
fully rounded one.

```sh
bun run part:build type3-410-nagato-twin
bun run part:check type3-410-nagato-twin
```

## 41 cm/45 Type 3 twin with rangefinder

`type3-410-nagato-twin-rf` follows the approved Nagato visual
`jgm047_410mm45_type3_rf_f`, the B turret. It shares the shell, sole, barrels,
cloth and most fittings with `type3-410-nagato-twin`; the difference is the
equipment on the rear roof. The service arch and its davit are replaced by a
transverse rangefinder housing 11.86 m across and 2.84 m deep, seated on the
roof, braced to both shoulders and carrying an end hood with a forward optical
window past each flank, plus a ventilator on its crown. The rear ladder moves
off the centre line to clear the housing and the aft roof rail run stops short
of it, as on the visual.

Nagato turret 3 carries the same equipment on a longer rear plate with the
housing further aft, and is registered separately as
`type3-410-nagato-twin-rf-aft`.

```sh
bun run part:build type3-410-nagato-twin-rf
bun run part:check type3-410-nagato-twin-rf
```

## 41 cm/45 Type 3 twin with rangefinder, housing aft

`type3-410-nagato-twin-rf-aft` follows the approved Nagato visual
`jgm048_410mm45_type3_rf_r`, turret 3. It is the same equipment as the B turret
but on its own shell, so it carries its own `gunhouseMesh`: the rear plate is
0.68 m longer (x −7.79 against −7.11), the midbody is 0.11 m wider (±5.19
against ±5.08), the front plate is 0.25 m wider, and the flared sole strake of
the A/Y and B visuals is replaced by a separate rubbing flange that stands
0.40 m proud round the midbody between x −2.92 and 4.55. The rangefinder housing
sits 0.65 m further aft (centred 5.05 m abaft the yaw axis) and 0.49 m higher,
on a taller seat. Sampled surface-to-surface distance against the B-turret
visual is 0.22/0.24 m mean with a 0.58/0.66 m 95th percentile, larger than the
0.15/0.36 m between the A/Y and B visuals that are already registered apart.

Its drawn bores also sit 0.10 m further outboard than on `jgm046`/`jgm047`, so
this part uses the 2.69 m spacing of its own visual and of the `Roll_Back`
nodes, where the other two Nagato parts use the 2.49 m their tubes are drawn
at. The mounts are physically the same; the difference is in how the source
visuals were authored.

The housing is drawn with the plan taper of both rangefinder visuals (the back
face is 6% narrower than the front) and carries the access ladder up its back
plate, as both visuals show. The forward roof rail run follows the roof edge and
stops abreast the sight hood instead of closing on the centre line, and the aft
run is shifted with the longer rear. Approximations: the housing seat is a plain
block rather than the visual's sloping skirt, and the roof grating forward of the
housing is left out.

```sh
bun run part:build type3-410-nagato-twin-rf-aft
bun run part:check type3-410-nagato-twin-rf-aft
```

## 41 cm/45 Type 3 twin (Mutsu)

`type3-410-mutsu-twin` follows the approved
[GameModels3D Mutsu](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsb506)
visual `jgm127_410mm45_type3_rf_old`, which that model fits at all four turrets.
Despite the resource name it carries no rangefinder housing, and it is a
different shell from the Nagato mount rather than a fitting variant: the plan is
egg-shaped with a rounded apex aft, the roof is flat at 2.92 m from the back
plate to amidships before falling away forward, and the face is raked at 51°.
Sampled surface-to-surface distance between the two visuals is 0.26–0.40 m mean
with a 0.64–1.47 m 95th percentile, against 0.15–0.36 m for the Nagato mount and
its own rangefinder variant.

Its own fittings are the centre-line rear ladder, forward flank ladders, the
face ladder between the ports, a low single-rail grab run on short stanchions
around the forward roof step with a short run further aft, the port-side
ventilator box, a centre sight hood, and stepped loader hoods on the roof
shoulders. Its gun-port covers are the bulbous cloth blisters of the visual,
reaching about 1.0 m around the bore, on a constant 0.505 m jacket; trunnion
3.47 m forward at 1.21 m, muzzle 16.72 m forward, spacing 2.49 m. The rammer
guides on the jacket are the short blocks of this visual rather than the Nagato
mount's long pair.

Approximations: the rounded rear apex is cut off by a 1.24 m flat cap plate, the
roof coaming ridges are left out, and the grab-rail stanchion spacing is
regular where the visual's is not.

```sh
bun run part:build type3-410-mutsu-twin
bun run part:check type3-410-mutsu-twin
```
