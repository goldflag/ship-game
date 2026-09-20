# Japanese destroyer guns

Original shared builders, called through `assets/parts/library.py`:

- `type_c.py`: the existing Yukikaze twin 127 mm Type C recipe, extracted with its independent elevation/recoil joints and installation-specific deck-height callback.
- `aa.py`: the existing Mogami Type 96 recipes, preserved without combining catalog variants.
- `type_93.py`: independently authored single and twin 13.2 mm mounts, based on the approved [GameModels3D Fubuki A configuration](https://gamemodels3d.com/games/worldofwarships/vehicles/pjsd106). Includes pedestal, fork, bearings, receiver, ammunition feed, cooling fins, sights and variant-specific controls/seats or shoulder rests.
- `type_98.py`: an independently authored 10 cm/65 Type 98 twin, the Akizuki-class dual-purpose mounting, based on the approved [GameModels3D Akizuki AB1 artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsd108) visual `jgm055_100mm65_type98`.
- `destroyer_mountings.py`: four further 12.7 cm/50 mountings beside the Type C twin (Type A twin, Type B twin, the enclosed "Type 5" twin and the Type B single), each authored against one approved GameModels3D visual.

Downloaded models are comparison-only. Type 93 identification follows the approved source configuration; dimensions and operating limits are game conventions, not independently verified historical specifications. Installation review on Fubuki does not certify arbitrary installations on other ships. Standalone previews remain generated under `.build/parts/`.

Type C fabric follows the full front-and-roof gun-slot perimeter through the
shared pitching-cover morphs. Its cuff does not recoil; the barrel slides
through it. Reduced circular tessellation preserves the muzzle/joint contract.
Type 93 cooling ribs are spaced more coarsely for the inspection mesh, and
small unsupported decorative magazine apertures are omitted.

Type C's 13e3e07 published assembly sets a 6,460-triangle ceiling. The refinement
now separates the raised aft roof from the low forward shoulders, with rounded
ends, a raked front apron, relocated roof rail feet and longer floor knees.
The visual shell is authored in yaw-local coordinates for both standalone and
installed models. The original armor definition is unchanged. Canvas folds,
front sight housing and access-door detail remain simplified. Fubuki and
Yukikaze retain this exact registered part, their pivots and weapon values.

## 10 cm/65 Type 98 twin

`type98-100-twin` is the enclosed Akizuki mounting. The approved model fits one
gunhouse: `jgm055_100mm65_type98` serves every mounting on Akizuki (pjsd108) and
is also the visual on HSF Harekaze (pjsd708), Kitakaze (pjsd219), Fuyutsuki
(pjsd710) and Harugumo (pjsd210), so the collection gains one variant.

Pivot, spacing and muzzle datums come from the approved model's joint nodes:
`Rotate_X` gives a 1.904 m trunnion 0.277 m forward of the yaw axis, `Roll_Back1`
and the two `gunFire` nodes give a 5.901 m muzzle datum at 0.660 m spacing. The
model's muzzle bore radius reads 0.050 m, which confirms the 100 mm scale.

The catalog's closed `gunhouseMesh` is also the visible shell: 6.2 m by 4.8 m on
the sole, flanks vertical to a 2.12 m knuckle, a domed crown at 3.005 m, a rounded
stern and a front face raked aft about 16 degrees to a knuckle, then a steeper
glacis. Authored on top of it: the rotating sole with radial floor knees, the
pivoting mantlets, sliding barrels with breech rings, cradles and recoil cylinders,
the fixed splinter web between the slots, the roof-eave guard rail, two levels of
flank handrail on standoffs, the recessed shoulder ladders, the twin rear door
with its frame and handles, the trainer's hood to port, the layer's telescope fin
to starboard, roof hatch covers, the raised roof grating and the flank lockers.

The mounting is dual-purpose: the two slots are cut through the roof so the guns
swing up through it. The approved model closes each slot with a rigid pivoting
mantlet rather than a canvas bloomer, so no `create_bloomer` cover is used here;
the mantlet plate is what seals the slot at every elevation. The published
elevation limits for the Type 98 mounting, −10 to +90 degrees, are what the
catalog carries; the approved model has no mechanical stops of its own, and no
historical certification is claimed. Traverse, traverse and elevation rates,
reload, muzzle speed, projectile mass, ammunition stowage and plate thickness are
provisional game calibration scaled from the nearest siblings (`type3-127-typec-twin`
and `skc33-105-c31-twin`), kept physical: the simulation applies the world pace, so
nothing here is pre-scaled.

Known approximations. The approved model's two roof slots and their shared
mantlet unit are drawn here as one armoured trough with a separate fixed splinter
web between the guns, because the armour shell is limited to 128 vertices and 128
triangles; the front opening of that trough is the mesh's one declared aperture.
The trough sole sits 0.08 to 0.22 m lower than the model's, and the mantlet radius
is 0.60 m against the model's 0.96 m, so that the mantlet, cradle and recoiling
breech clear the sole through the whole elevation range instead of passing through
it as they do in the source. The bow shoulders run up to 0.15 m fine of the source
plan, a faceting artefact of an eight-station loft. Service detail inside the
trough, the sight optics and the rail stanchion spacing are simplified. Isolated
clearance does not certify neighbouring mounts or a ship's surrounding galleries;
library review stays `unreviewed` until installation review passes.

```sh
bun run part:build type98-100-twin
bun run part:check type98-100-twin
```

## Further 12.7 cm/50 destroyer mountings

`destroyer_mountings.py` adds four more mountings for the same 12.7 cm/50 gun beside the existing
Type C twin. Each is authored against exactly one approved GameModels3D destroyer gun visual; none
of them is the Type C, and `type_c.py` and its catalog entries are untouched. The catalog's closed
`gunhouseMesh` is both the armor shell and the visible gunhouse, as on `sk_c34_triple.py`; the recipe
draws that shell and adds the rotating sole with its radial knees, the apron down to the deck, the
sliding barrels, the gun-port hoods, service rails, doors, ladders, ready lockers and roof fittings.
No reference geometry is loaded or shipped: the source was measured for station outlines, joint
datums and the position of fittings only.

- `type3-127-typea-twin` — Type A twin, from the [Shinonome A1 artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsd706)
  (`jgm153_127_50_twin_type_a`); the Shinonome B configuration (pjsd596) fits the same visual.
  A rounded-rectangle house 5.0 m long and 3.6 m wide with a flat roof, a long raked forward glacis
  and two closely spaced guns — barrel axes 0.66 m apart against the Type C's 1.07 m, and a hull
  0.9 m narrower. Authored features: eight roof hatches, the fore-and-aft training rail on posts,
  a forward periscope, the raised mount captain's platform and hood on the port forward roof (the
  one fitting that breaks the mounting's symmetry in the source), three ranks of flank grab rails,
  two rear doors with hinges and handles, a centreline rear ladder and two ready lockers.
- `type3-127-typeb-twin` — Type B twin, from the [Akatsuki AB1 artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsd107)
  (`jgm148_127mm50_type_b`). A wider, taller house on the Type C body plan: near-vertical sides to
  a flat roof at 2.5 m, a continuous walkway flange with guard rails at 2.07 m, an aft roof house
  and the large port-side sight house whose domed forward hood reaches 3.36 m. The Hatsuharu
  secondary slot (`jgs021_127mm50_type_b`, pjsd206) is the same mounting at reduced detail — its
  envelope, roof house and port hood match this visual, not the Type C and not the Type B single —
  so it is recorded as a shared user rather than a second part.
- `type3-127-type5-twin` — the enclosed twin the source names `127mm_50_type5`, from the
  [Hayate A artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsd510)
  (`jgm176_127mm_50_type5`); Yamagiri (pjsd111, pjsd891) fits the same visual. A much larger fully
  enclosed turret: 7.9 m long, 6.1 m over the walkway flange, 3.4 m to the roof, trunnions 1.64 m
  forward of the yaw datum. Authored features: the walkway flange and its rails, six roof hatches,
  ventilator mushrooms, the light forward tripod, boarding steps bracketed off each flank, rear
  doors, ladder and ready lockers. **Naming:** the resource name is the only evidence for the
  designation, so the part keeps the family prefix the Type C uses and is called "Type 5"; the
  model is plainly not a Type D, which externally resembles the Type C. No historical mounting
  designation is asserted.
- `type3-127-typeb-single` — Type B single, from the [Shiratsuyu AB1 artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsd207)
  (`jgm152_127mm50_type_b`); Yudachi (pjsd507) fits the same visual. One gun in a tall weather hood
  that flares outward with height (±1.72 m at the skirt, ±1.95 m at shoulder level), with two ranks
  of bracketed side shelves, a roof-edge rail, four roof hatches, a wireless whip on stays, a single
  rear door, a rear ladder and ready lockers.

**Gun ports.** All four sources show a rigid hood around each barrel rather than a canvas seal, so
no bloomer is authored here; instead the hood pitches with its gun. The hood is the moving half of
the port: the barrel is always centred in it, its rear stays inside the shell through the whole
elevation interval, and fixed cheek plates frame the slot it works through. `create_bloomer` remains
in use for the Type C, whose source does show fabric.

**Joints and limits.** Pivot height, trunnion offset, muzzle distance and barrel spacing are read
from the source's `Rotate_Y`/`Rotate_X`/`Roll_Back1`/`gunFire` nodes, in metres (one source unit =
15 m), and the exporter checks the muzzle world positions against the catalog. The source models
have no elevation limits, so commonly published limits per mounting are used and are game
conventions, not certified data: Type A −5°/+40°, Type B twin −7°/+75°, Type B single −7°/+55°, and
−10°/+75° for the enclosed twin. All other weapon values (910 m/s, 23 kg, 7 s reload, penetration,
damage, HE, ballistics, 12 mm protection — 16 mm for the heavier enclosed mounting) are the
`type3-127-typec-twin` figures for the same gun, kept physical so the simulation's world pace
applies unscaled. They are provisional game calibration, not historical performance data.

**Known approximations.** The shells are six-station lofts of 54 vertices and 104 triangles each,
so rounded corners read as chamfers and the Type B single's squarer plan is softened; plate seams,
sight glass detail and the finer roof clutter are simplified; the Type B single's slight
port/starboard asymmetry in the source is modelled symmetrically; the Type A's rear corner is about
0.1–0.2 m blunter than the source; small aerials and the deck-level fittings each source carries
below its skirt are omitted.
