# Italian battleship gun mounts

Original reusable 381 mm/50 Model 1934 triple main turrets for the Littorio
class. One recipe, `m1934_triple.py`, serves both catalog parts and switches on
`mount['partId']`; the catalog owns the armor facets and the weapon data.
Geometry is independently authored from measured proportions. This is not
historical certification.

The GameModels3D resource names the turret `m1939`. The catalog keeps the gun's
Model 1934 designation; the resource name is recorded here only so the visual can
be found again.

Both mounts use the commonly published elevation limits of −5° to +35°: the
reference visual carries no mechanical stops, so the travel is an authored game
approximation. Weapon and armor values are provisional game calibration; the
plate families use commonly published figures (350 mm face, 200 mm side, 200 mm
roof, 280 mm rear) with estimated facet boundaries.

## 381 mm/50 Model 1934 triple

`it-381-50-m1934-triple` follows the approved
[GameModels3D Roma artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pisb508)
visual `igm011_381mm50_barrels_3_m1939_tower`, the second-turret fit. The same
three turret visuals serve Roma (pisb508), Vittorio Veneto (pisb108) and the
Littorio as modelled for the Azur Lane collaboration (pisb708).

The catalog `gunhouseMesh` is both the armor and the visible shell: a raked face
plate from the 5.85 m floor edge up to the 4.66 m knuckle at 2.66 m, tumblehome
flanks that reach 5.09 m half-beam amidships, a flat roof cresting at 3.71 m
over station −2.86 and a five-station rounded back plate. The recipe adds the
6.90 m turntable sole, the 6.80 m working platform cut off square under the
sponsons, the rear corner sponsons with their buttresses, crown hatch hoods,
forward access doors and flank lockers, the raised rear platform (trunk, deck,
stiffened bulwark, boarding step, the 2.0 m cylindrical sighting hood, the two
anti-aircraft pads and the stern lockers), flank ladders with roof grab hoops,
the roof deflector strips behind the face knuckle, guard strips beside the
centre port, sliding barrels with the chase taper and muzzle swell, and flexible
`gun_bloomers` canvas seals.

Joint datums come from the reference's own nodes: trunnion 4.431 m forward at
1.365 m above the sole, muzzle 18.338 m forward, barrel spacing 2.583 m, 0.49 m
jacket radius. The support attachment is the sole at Y = 0; the Shipbuilder owns
the barbette below it, and `barbetteRadius` is 6.5 m against the 6.90 m sole.

Approximations: the sponsons, buttresses, rear platform and their fittings are
faceted reconstructions of rounded reference shells; the several small hinges,
handrails and internal boxes inside the sponsons are left out; the barrel's
constant jacket is carried 0.55 m further forward than the reference's taper
break so the canvas cuff stays on it through the full 1.2 m recoil stroke; cloth
folds and plate seams remain approximate. Library review stays unreviewed until
installation review passes.

```sh
bun run part:build it-381-50-m1934-triple
bun run part:check it-381-50-m1934-triple
```

## 381 mm/50 Model 1934 triple, short rear

`it-381-50-m1934-triple-short` follows visual
`igm010_381mm50_barrels_3_m1939_life_boat`, the first-turret fit on the same
three ships. Its armored shell is byte-identical to the second-turret visual's —
the same 34 welded vertices — so it reuses the same catalog `gunhouseMesh`,
turntable, working platform, sponsons, buttresses and barrels.

The variant differs above the shell: no raised rear platform, no cylindrical
hood and no flank ladder. Instead the recipe draws the boat stowage on the
working platform (two skids and two chocks each side), a ladder up the raked
face just to port of the centre gun, a ladder with a grab hoop on the rounded
back plate, and the local-control hood on the roof crown.

Same approximations as the platform variant, less the rear platform fittings.

```sh
bun run part:build it-381-50-m1934-triple-short
bun run part:check it-381-50-m1934-triple-short
```
