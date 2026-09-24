# USS Alaska (CB-1)

CB-1 · 1944-45 exterior after the GameModels3D pasc510 A hull · reference design waterline

Open `/?ship=alaska` or select this ship in port or Custom battle.

This is a legacy Blender-recipe preset (like Yamato, Bismarck and King George V), by explicit request, rather
than a construction ship. `blueprint.json`, `build.py` and `fittings.py` are the durable inputs; reusable guns come
from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

## Approved brief

- **Vessel and fit:** USS Alaska (CB-1) as GameModels3D World of Warships vehicle
  [`pasc510`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc510) shows her, hull `asc026_alaska_1944`,
  the only non-event configuration: three triple 12-inch/50 Mk 8, six twin 5-inch/38 Mk 32 Mod 12, fourteen shielded quad
  40 mm Bofors, thirty-four 20 mm Oerlikons, two Mk 38 and two Mk 37 directors, fourteen Mk 57 and six Mk 51 AA directors,
  SK and two SG radars, two catapults and two boat/aircraft cranes.
- **Paint:** the reference's no-camouflage scheme: haze-grey hull and upperworks, deck-blue painted steel decks and roofs,
  red-oxide bottom; no boot topping or hull number. A US national ensign is added at the stern as on the fleet's other US ships.
- **Reference policy:** GameModels3D only. The catapults stay empty as the reference shows them. Armour zones and
  thicknesses come from the reference's armour model; other gameplay values are provisional game calibration.

## Model and simulation basis

The hull is an original authored-stations loft (149 stations) sampled from the reference at 15 m per source unit with
its y = 0 design waterline: 246.7 m overall, 27.3 m moulded beam, 9.85 m draft, 35,433 t at that waterline. The bulbous
forefoot, sheer and cut-up stern follow the reference; the centreline skeg and the rudder are separate plates. Deckhouse
tiers are prisms whose outlines and heights were measured from plan slices of the reference; the funnel is a measured
stadium with its exhaust. `author-blueprint.py` records how the blueprint was made and rebuilds it from those
measurements (`--loft`, `--structures`); rerun `author-flood-spaces.ts`, `author-stability.ts` and
`author-local-damage.ts`, then `bun run ship:hydrostatics` and `bun run multiplayer:content`, after any hull or
structure change.

Mounts sit at the reference's hardpoint datums. The 12-inch turret (`us-12in50-mk8-triple`) was already modelled from
this reference; the 5-inch Mk 32 Mod 12, Mk 2 shielded quad Bofors and Mk 4 Oerlikon reuse existing catalog recipes, and
all 57 mounts fire. Directors (the four large ones train as radar-rig pivots), masts, SK and SG radars, catapults, cranes,
whaleboats, life floats, ground tackle, rails, doors, scuttles and vents are simplified original constructions in
`fittings.py`.

Machinery (two fireroom/engine-room pairs on four shafts), magazines, flood spaces, stability (GM 7% of beam) and
damage-control values are game estimates; the visual reference does not establish internal plans. Belt (229 mm, 178 mm
below water), 102 mm armoured deck, 260 mm bulkheads, 330 mm barbettes, conning tower and steering-gear box read their
thicknesses from the reference's armour model and are fitted to the authored loft.

## Accepted approximations

- Deckhouses are measured prisms, so sloped roofs are flat and small overhangs step; minor deck clutter from the
  reference (hose reels, lockers, ammunition boxes, cable runs) is omitted or simplified. Rails are left out of the
  12-inch and 5-inch barrel arcs, as removable rails would be.
- Measured deckhouse outlines give way to each gunhouse's sweep: the shared 12-inch recipe lifts the reference's rear
  undercut onto the sole plane.
- `mountClearance` is a provisional CPU interlock: turret 1 stops at about ±136° trained aft (±117° at high elevation) so
  its barrels clear the forward deckhouse and turret 2; the other main and 5-inch mounts use their full installed travel.
  Firing obstructions are fore-and-aft strips of the deckhouse outlines. Light AA mounts are not interlocked.
- Stability, mass distribution, flooding compartmentation, handling (33 kn) and weapon values are shared game calibration,
  not historical measurements. Model fidelity and export checks do not certify historical accuracy.

```sh
bun run ship:build alaska
bun run ship:review alaska
bun run ship:check alaska
```

Keep the current fixed views in `generated/review/`. Reference downloads, measurements and comparison captures stay in
ignored `.build/`.
