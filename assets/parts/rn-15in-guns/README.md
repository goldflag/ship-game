# British 15-inch/42 twin mountings

One recipe, `bl_15_twin.py`, builds the five registered parts of this family and
switches on `mount['partId']`. The catalog owns the closed armor shell
(`gunhouseMesh`) and the weapon data; the recipe owns the turntable skirt, the
sliding guns, the canvas port covers and the service fittings. The support
attachment is the sole at Y = 0 and nothing is drawn below it: the Shipbuilder
owns the barbette. Geometry is independently authored from measured proportions
of the reference visuals; this is not historical certification.

Across all five parts: weapon and armor values are provisional game
calibration; plate families use commonly published figures with estimated facet
boundaries. The GameModels3D source carries no joint limits, so elevation uses
the commonly published limits for these mountings after their inter-war
modification, −5° to +30°. Library review stays unreviewed until installation
review passes.

## 15-inch Mk I twin — `bl-15-mki-twin`

Source: [GameModels3D Queen Elizabeth](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb106),
visual `bgm009_15in42_mk1` (A and Y turrets of Queen Elizabeth, Warspite and
Renown, with no rangefinder).

Merged as the same shape, measured with Chamfer distance on sampled surfaces
against a 0.073 m noise floor: `bgm158_15in42_mk1` (Repulse) and
`bgm2013_15in42_mk1` (Royal Sovereign) are the same mount and are not built as
separate parts. The Hood mount (`bgm048`) differs from this one by roughly
0.2–0.27 m mean distance and is a separate part below.

The shell is a seven-station loft: a vertical transom with chamfered rear
quarters, flanks leaning inboard about 21° to a knuckle near Z = 2.1, a cambered
roof that runs flat at 2.82 m aft of amidships and falls to 2.17 m over the gun
ports, and a face raked aft 21.5° drawn as the short interval between the last
two stations (330 mm plates throughout that interval). Plate families are
330 mm face, 280 mm sides and rear, 114 mm roof.

Fittings: the vertical turntable skirt on the plan of the armor itself, so the
rear quarters overhang the barbette; three roof cowls (one on the centreline,
one each side) with a dark forward aperture and a guard rail; the wedge-shaped
raised rear roof plate with its flush round hatch cover, hinged hatch and
handles; a ladder up each flank on standoffs, hooking over the roof knuckle; and
a ladder up the port rear quarter. Gun-port surrounds stand proud of the face
around each aperture.

Joint datums are taken from the reference joint nodes: yaw on the sole plane,
trunnion 2.73 m forward at 1.01 m, muzzles 14.71 m forward, barrel axes 2.48 m
apart, barbette radius 4.8 m against a 4.76 m half-beam at the sole.

Barrels slide through flexible `gun_bloomers` cuffs on a constant 0.50 m jacket
that spans the 1.1 m recoil stroke; the fixed seam is cast onto the real face
and the intermediate cloth rings are draped over the armor at depression and
kept outside the jacket at high elevation. At full depression the slack is
clamped just above the sole, so nothing hangs below the attachment plane.

Approximations and omissions: the rounded plan is faceted at seven stations;
the small handles, the ladder feet that continue down the barbette on the
reference, and the hinge detail of the hatches are simplified; the canvas fold
pattern is authored, not measured.

Silhouette IoU against the reference at rest, common scale: side 0.969,
top 0.976, front 0.987, rear 0.987, iso 0.975.

```sh
bun run part:build bl-15-mki-twin
bun run part:check bl-15-mki-twin
```

## 15-inch Mk I twin with rangefinder — `bl-15-mki-twin-rf`

Source: the same vehicle, visual `bgm010_15in42_mk1_rf` (B and X turrets).
`bgm159_15in42_mk1_rf` (Repulse) and `bgm2014_15in42_mk1_rf` (Royal Sovereign)
measured as the same shape and are not built separately.

The body, fittings and datums are exactly those of `bl-15-mki-twin` — the recipe
shares the code — plus the transverse rangefinder. The recipe reads
`rangefinderWidth` (9.74 m) and `rangefinderForward` (−5.0 m) from the catalog
entry and builds, on each side, the rounded housing running from the rear roof
plate out to the flank and past it, the bracket web that carries the projecting
end and is sunk into the flank it is welded to, its round and hexagonal
lightening holes, the step plate on the forward top edge and the handrail with
its three posts. The housing therefore projects 0.11 m past the turret's widest
point on each side, as on the reference.

Silhouette IoU at rest: side 0.969, top 0.972, front 0.972, rear 0.972,
iso 0.974.

```sh
bun run part:build bl-15-mki-twin-rf
bun run part:check bl-15-mki-twin-rf
```

## 15-inch Mk II twin — `bl-15-mkii-twin`

Source: [GameModels3D Hood](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb507),
visual `bgm048_15in42_mk2`, which fits all four of that model's turrets. The
B-turret visual `bgm052_15in42_mk2_b` measured as the same shape with a flank
ladder added, so it is not built as a separate part.

The Mk II gunhouse is a genuinely different shape from the Mk I and is lofted
from its own seven stations: a tapered stern that keeps full height to X = −6.6
and then collapses to a low tail, truncated at −7.00 so that the last station
can carry the reference's fuller rear corner inside the shell's triangle
budget (it costs 0.09 m of tail), a smooth cambered roof around 2.98 m
with no knuckle chamfer, and a face raked aft about 27°. Plate families are
381 mm face, 279 mm sides and rear, 127 mm roof. The reference shows a visible
roller plate of 4.39 m radius under the shell; the catalog carries that as
`barbetteRadius`, but the recipe draws the same plan-shaped skirt as the Mk I
rather than a separate disc, so the roller path itself is not modelled.

Fittings: the long raised rear hood with its rounded crown, the raised rounded
side panel on each flank of the hood, the sighting drum with its cap, visor and
step, the crown stub and the three stubs on the hood's forward slope; one
handrail per side on stanchions running from the hood down to the forward roof
edge; an outrigger bracket each side carrying the small standing box and the
outboard step tab; and a single ladder up the raked stern, port of the
centreline, whose handrails carry on above the roof with knobbed heads. The
Mk II has no roof cowls and no flank ladders.

Joint datums from the reference joint nodes: trunnion 2.69 m forward at 1.13 m,
muzzles 14.53 m forward, barrel axes 2.48 m apart.

Approximations and omissions: the reference's outboard brackets (`bgm048`
components at Y ≈ ±4.3) float free of the turret in the source; here they are
carried on a modelled strut off the roof knuckle so the part has no floating
geometry. Hatch, fold and stanchion detail is simplified.

Silhouette IoU at rest: side 0.945, top 0.965, front 0.954, rear 0.954,
iso 0.954.

```sh
bun run part:build bl-15-mkii-twin
bun run part:check bl-15-mkii-twin
```

## 15-inch Mk I twin (Vanguard) — `bl-15-mki-vanguard-twin`

Source: [GameModels3D Vanguard](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb508),
visual `bgm101_15in42_mk1_vanguard` (A turret). The plan is within a few
centimetres of the Queen Elizabeth mounting above, but the roof and the gun
ports are not, so it is a separate shell and a separate branch of the recipe.

The shell keeps the Queen Elizabeth plan — rounded nose, widest amidships,
chamfered rear quarters — and changes the roof: instead of a flat crown strip
falling steadily forward, the Vanguard roof is a shallow gable that holds
2.82 m from the transom to about a third of the way forward, with the raised
aft plate reading as a split panel, and only then falls to the face. The face
is raked aft about 22°. Plate families are 330 mm face, 280 mm sides and rear,
114 mm roof, as for the Queen Elizabeth mount.

Fittings: the turntable skirt; a raised hood over each gun port, lofted from
five stations and seated on the roof plate it stands on, which is the most
obvious difference from the Queen Elizabeth roof; three roof cowls (the
centreline one offset to starboard, as on the reference); the vent stack and
flush hatch on the aft roof plate; a locker on each rear quarter with its three
hose runs dropping down the quarter plate; and a ladder up each flank at
X = −1.5 hooking over the roof knuckle.

Gun ports: the Vanguard mountings seal the port with a rigid circular shield
rather than canvas, so no bloomer is modelled. The shield is a drum struck in
the face around the bore, 1.30 m radius and 1.29 m wide, cut off at the sole
because the face covers everything below the aperture, and a tapered boss on
the gun rides out of it through the whole elevation arc. The reference's square
cover plate could not be carried as a separate plate without an aperture in the
armor shell; the boss stands in for it.

Joint datums from the reference joint nodes: trunnion 2.46 m forward at 1.05 m,
muzzles 14.60 m forward, barrel axes 2.53 m apart, jacket radius 0.53 m.

Approximations and omissions: the reference carries 0.10 m of underside apron
below its yaw datum and its gun-cradle drums reach 0.39 m below it. The sole
plane forbids both, and they account for 72% of the front-view difference —
restricted to the region at or above the sole, the front IoU is 0.974 rather
than 0.922. The roof pads and the smallest deck fittings are omitted.

Silhouette IoU at rest, common scale: side 0.959, top 0.971, front 0.922
(0.974 above the sole plane), iso 0.974.

```sh
bun run part:build bl-15-mki-vanguard-twin
bun run part:check bl-15-mki-vanguard-twin
```

## 15-inch Mk I twin with rangefinder (Vanguard) — `bl-15-mki-vanguard-twin-rf`

Source: the same vehicle, visual `bgm106_15in42_mk1_rf_vanguard` (B, X and Y
turrets). The body, fittings and datums are exactly those of
`bl-15-mki-vanguard-twin`; the recipe shares the code and adds the rangefinder
from `rangefinderWidth` (8.60 m) and `rangefinderForward` (−5.25 m).

Where the Queen Elizabeth rangefinder is a rounded bar on brackets, this one is
boxy: a plinth laid on the aft roof, a tall central hood with chamfered top
edges, and a square-section arm each side running out to a squared end housing
with its dark optical window. The housings reach 4.30 m from the centreline,
just inside the turret's own half-beam.

Silhouette IoU at rest: side 0.959, top 0.974, front 0.932 (0.973 above the
sole plane), rear 0.932, iso 0.961.

```sh
bun run part:build bl-15-mki-vanguard-twin-rf
bun run part:check bl-15-mki-vanguard-twin-rf
```
