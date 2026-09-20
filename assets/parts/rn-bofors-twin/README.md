# Royal Navy twin 40 mm Bofors mountings (`assets/parts/rn-bofors-twin`)

One recipe, `geometry.py:create_mount`, builds all four British twin Bofors mountings; it dispatches
on `mount['weapon']['id']`. Barrels, cradles, receivers and the loaders' clips are shared because all
four carry the same water-jacketed twin 40 mm gun; the shared builder takes optional jacket radii and
a feed station so a variant can differ without disturbing the others. Everything around the gun is
authored separately per mounting. Geometry is original: the GameModels3D references were measured (connected
components, joint arcs, `gunFire` node matrices) but no reference mesh, transform or texture is
loaded, and no geometry is taken from another recipe.

### `qf-40mm-bofors-staag-twin` — STAAG Mk II

Reference visual `common/visual/uk/gun/aaircraft/bga036_staag_markv` (vehicle `pbsb110`). Fitted to
Conqueror, Vanguard, Marlborough (and B), Thunderer, Cumberland, Monmouth, Neptune, Drake, Goliath,
Cheshire (and AL), Gibraltar, Cyclops, Jutland, Daring, Somme, the Conqueror variants and Cursed
Fang. The Commonwealth visual `uga2009_staag_markv` (Irresistible) is the same shape — identical
triangle count and bounds, two vertices apart by at most 4 mm — so Irresistible shares this part.

The stabilised twin sits in a faceted armoured tub on a roller path. Modelled: the roller path,
training rack and pedestal; the plated rotating deck on radial brackets with a kerb; the full-width
front plate with its raked wings, gun-port cheeks either side of the firing slot, vision slits,
hatches, ribs and lifting eyes; side plating that stops short of the stern, leaving an open after
deck guarded by a tubular rail on stanchions; the trunnion cheeks with their bearings and bridging
beam; the gyro and elevating-gear housing with the stabiliser case on its crown; both layers' seats,
backrests, footplates and handwheels; their ring sights on braced arms with foresight beads; ready-use
lockers with clip racks and spent-case bins; the Type 262 radar on its own stand with yoke, dish,
feed boom, waveguide and guard hoops; and an outboard access ladder with a grab rail. Each gun has a
water-jacketed barrel with bands, a water pipe, a flash hider and a dark bore, its own receiver,
breech casing, cocking lever, feed hopper with loaded clips and case chute, on a shared cradle with
recoil cylinders under an armoured casing.

### `qf-40mm-bofors-hazemeyer-twin` — Hazemeyer Mk IV

Reference visual `common/visual/uk/gun/aaircraft/bga060_40mm_bofors_mark_iv_hazemeyer` (vehicle
`pbsa108`). Fitted to Implacable, Monarch, Lion, Hawke, Duncan, St. Vincent, Incomparable,
St. Lawrence, Defence, Barfleur and Scarlet Thunder.

The Dutch triaxially stabilised twin stands open on a wide low platform. Modelled: the roller path,
the plated platform on brackets with a kerb; the stabilising bed with cross-level rams and roll links;
the broad trapezoidal gun frame with splayed legs, wing plates, cross beams and braces; the open rear
blast frame; the stabilised director/predictor tower with ribs, instrument face and hand holes; the
Type 282 aerial mast carrying a tilted frame with two yagi booms and their dipoles; both layers'
seats, backrests, footrests, training and elevating handwheels and ring sights; ready-use lockers
with clip racks, spare-barrel boxes, junction and telephone boxes and cable runs; the guard rail
round the platform; and an after access ladder.

### `qf-40mm-bofors-mkv-twin` — Mk V twin

Reference visual `common/visual/uk/gun/aaircraft/bga025_40mm_bofors_twin` (vehicle `pbsa111`). Fitted
to Eagle, Audacious, Monarch, Lion, Fiji, Neptune, Belfast, Bóinn, Jutland, Daring, Somme, Delhi,
Mysore, River Gambra, Vampire II and the Audacious variant. The Commonwealth visual
`uga2016_40mm_bofors_twin` (Cayuga) is bit-identical and shares this part.

The compact utility twin: an open-topped faceted shield tub raked back from a wide foot to a narrow
crown. Modelled: the roller path and training rack, the plated tub floor, the raked side and after
plating, and the forward plate built as seven strips so its three cut-outs stay open — the gun slot
on the centreline and a notch over each layer — leaving the four raised tabs that give the crown its
castellated line. Inside: the open pedestal fork with trunnion bearings and braces, the training
gearbox and shafting, a hoist trunk with head and foot boxes on the centreline aft, two swept blast
deflectors over the barrels on posts off the slot coaming, both layers' seats, backrests, footrests,
training and elevating handwheels and the open ring sights that look out through the notches, plus
ready-use lockers with clip racks, spent-case bins and grab rails along the after plating.

### `qf-40mm-bofors-rp-mk1-twin` — RP Mk I twin

Reference visual `common/visual/uk/gun/aaircraft/bga097_40mm_bofors_mk1` (vehicle `pbsa508`). Fitted
to Indomitable and Uganda.

The remote-power-controlled twin, unshielded and all machinery. Modelled: a stepped roller base with
the training rack between its two paths; a faceted drive body with ribs, a skirt, a crown and hatch,
outboard receiver casings, drive motors, junction boxes, elevation receivers and cable runs;
trunnion cheeks with their bearings and braces; an after grating on brackets with a tubular rail and
mid course round its open edge; two curved tubular arms sweeping out to caged ring sights; both
layers' bucket seats, backrests, footplates and hand controllers; ready-use lockers with clip racks
on the grating and a case bin beside each seat. The guns carry the thick water jackets this mounting
runs back over its trunnions, with a slim chase and a bulbous flash hider.

### Joints and articulation

All four mountings follow the shared AA contract. `yaw` sits on the sole plane (z = 0 in the recipe
frame, lowest model point 0.000 m). Each barrel has `<side>.elevation` at the uniform simulation
station `(trunnionForward, ((n-1)/2 - i) * barrelSpacing, pivotHeight)`, a `<side>.recoil` child at
that origin and a `<side>.muzzle` on the bore at `muzzleForward`. Because both references are
symmetric, the true barrel stations are the uniform stations, so no tube is offset from its socket
and the muzzle sockets land exactly on the simulation's muzzles (0.000 m worst error over the four
inspected bearing/elevation/recoil poses). Cradles, recoil cylinders, casings, sights on the cradle
and the elevating-gear housing parent to an elevation joint; barrels, receivers, breech casings, feed
hoppers, clips, case chutes and water pipes parent to their barrel's recoil joint; everything else
parents to `yaw`.

Provisional values, from the built models:

| | STAAG Mk II | Hazemeyer Mk IV | Mk V | RP Mk I |
| --- | --- | --- | --- | --- |
| `barrelCount` / `barrelSpacing` | 2 / 0.25 m | 2 / 0.25 m | 2 / 0.25 m | 2 / 0.25 m |
| `trunnionForward` | 0.23 m | 0.00 m | 0.00 m | 0.20 m |
| `pivotHeight` | 2.06 m | 1.91 m | 1.91 m | 1.90 m |
| `muzzleForward` | 2.79 m | 2.44 m | 2.29 m | 2.26 m |
| `caliberM` / `recoilM` | 0.04 / 0.12 m | 0.04 / 0.12 m | 0.04 / 0.12 m | 0.04 / 0.12 m |
| elevation | -10 to +90 deg | -10 to +85 deg | -10 to +85 deg | -10 to +85 deg |
| size (w, h, l) | 4.08 x 3.54 x 4.37 m | 3.68 x 3.99 x 3.91 m | 2.76 x 2.58 x 3.82 m | 2.60 x 2.40 x 3.74 m |
| triangles | 4412 | 4702 | 3936 | 4060 |

### Clearance

A triangle-level sweep over thirteen elevations from full depression to full elevation, at zero and
full recoil, reports no contact between elevating or recoiling geometry and fixed structure on any of
the four mountings. The only reported contacts are each trunnion pin inside its own bearings and
through the cheek plate, which is a journal in its housing. Several shapes were changed to reach
that: the STAAG's gyro housing was shortened so the elevating-gear housing clears it at full
depression; the Hazemeyer's director tower was moved aft with a low bed carrying it forward, and its
guard rail opened across the bow since the rail trains with the mount and the barrels sweep over it;
the Mk V's hoist trunk was moved aft off the breech's arc and its blast deflectors set outboard of
the cradle; and the RP Mk I's drive body was capped at z = 1.10 on the centreline with its receiver
casings moved outboard, and its after grating drawn back to x = -0.64 m.

### Known approximations

These are interpretations of the approved GameModels3D visuals at a common scale, not historical
certification of either mounting, its stops or its fittings.

- Both radars train but do not elevate. The STAAG's Type 262 stands on posts rising from the rotating
  deck, as the reference shows; the Hazemeyer's Type 282 array keeps a fixed 30 degree tilt on the
  mast. Linking either to an elevation joint sweeps it through the mounting.
- The STAAG's layers' ring sights and seats train only, matching where the reference carries them on
  the after structure.
- Ammunition on the elevating mass is limited to the receiver feed hoppers and their loaded clips.
  Outboard drums large enough to read swept through the trunnion cheeks at high elevation, so deck
  ready-use lockers with clip racks carry the rest of the ammunition read.
- The Hazemeyer's director tower is about 0.6 m further aft than the reference box, which reaches
  forward to a station the breech cannot clear through the required elevation range.
- Panel lines, hatches and ribs on the STAAG shield are raised plating rather than the reference's
  surface detail.
- The Mk V's tub keeps a constant width from foot to crown; the reference plating draws in from about
  +/-1.36 m at mid height to +/-1.02 m at its foot.
- The Mk V's single arched blast cover is built as two swept hoods, one per barrel, so the slot stays
  clear through the elevation range.
- The RP Mk I's drive body is one faceted block with ribs, motors and cable runs rather than the
  reference's box-by-box machinery, and it is lower and its after grating shorter than the reference
  so the breech clears them.
- The reference barrels are baked at 30 degrees; all comparison renders of these models use the same
  pose, plus -10, +85/+90 and full recoil for clearance.

### Not built here

`bga022_40mm_bofors_mkv` (Colossus, Ocean, Jutland, Somme, Mysore) and its Commonwealth twin
`uga2015_40mm_bofors_mkv` (Cayuga) carry the Mk V name but are a different and smaller visual again
(3324 triangles, 3.19 x 2.18 x 2.51 m), not the `bga025` tub built here. They are not covered by this
recipe. The single-barrel British Bofors visuals (`bga061`, `bga033`, `bga012`, `bga2016`) are
outside this family.

## Catalog values and installation

Weapon values in `guns.json` are provisional game calibration scaled from the nearest published sibling (the
real round and muzzle speed where they differ; reload copies the sibling's per-barrel cadence). The simulation
applies the world pace, so nothing is pre-scaled. Model dimensions are the measured GLB bounds. `barrelSpacing` is the simulation's uniform
single-row spacing; the joints and muzzle sockets sit exactly on it (the publish check requires this) and the
tubes are drawn where the reference has them, so the distances listed above under each part are the approximation.

| Part | Barrels | Sim spacing (m) | Mass (kg) | Reload per barrel (s) | Fits (structure below the 1.16 m wall) | Elevation reach on a bare deck |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `qf-40mm-bofors-staag-twin` | 2 | 0.250 | 9000 | 0.50 | bare deck (2.18 m) | -10 to 90 deg |
| `qf-40mm-bofors-hazemeyer-twin` | 2 | 0.250 | 6300 | 0.50 | bare deck (2.07 m) | -10 to 85 deg |
| `qf-40mm-bofors-mkv-twin` | 2 | 0.250 | 5800 | 0.50 | 5 m tub (1.85 m) | -10 to 85 deg |
| `qf-40mm-bofors-rp-mk1-twin` | 2 | 0.250 | 5600 | 0.50 | 5 m tub (1.38 m) | -10 to 85 deg |

The tub column compares the mount's geometry below the retained gun tubs' 1.16 m wall (largest horizontal radius from
the yaw axis, in brackets) with the inner radius of the tubs' sparse wall boxes (3 m tub 1.14 m, 5 m tub 1.95 m).
It is a geometric check of the built model, not a simulation result; the tubs are retired from new catalogs but
saved designs and retained catalogs still carry them. Barrels, sights and shields above the wall overhang it.
The last column is the elevation range the native articulation resolver grants on a flat deck. The simulation's
generic open-mount proxy assumes a 1.55 m breech behind the trunnion, so a low trunnion cannot reach its catalog
maximum on a deck (the existing octuple pom-pom reaches 42 degrees for the same reason); a raised platform or a
per-mount proxy would lift it. The catalog limits stay the researched values.
