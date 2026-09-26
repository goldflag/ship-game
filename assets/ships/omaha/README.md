# USS Omaha (CL-4)

Open `/?ship=omaha` or select her in port or Custom battle.

This is a legacy Blender-recipe preset (like Alaska, Hood and Yamato), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py`) and `build.py` with its modules are the
durable inputs; her guns are original parts in `assets/parts/us-omaha-guns/`. Generated Blender scenes and runtime
models are build outputs.

## Approved brief

- **Vessel and fit:** USS Omaha (CL-4) as GameModels3D World of Warships vehicle
  [`pasc005`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc005) fit A shows her: hull
  `asc005_omaha_1923` (A_Hull). Two twin 6-inch/53 Mk 16 turrets; eight single 6-inch/53 Mk 13 (six casemate
  drums `agm160`, two open drums `agm159`); eight 1.1-inch/75 quadruple mounts; four .50-calibre Browning M2
  (no 3-inch/50); four triple 21-inch torpedo mounts; two catapults, carried empty; two Mk 7 directors; two 3.6 m
  rangefinders; four funnels. The reference fit is taken as it stands.
- **Paint:** the reference's default plain scheme: one light grey over hull and upperworks, dark grey decks and
  roofs, black funnel tops, a red-oxide bottom.
- **Reference policy:** GameModels3D only. No photographs, plans or other models. Armour zones and thicknesses come
  from the reference's armour model; every other gameplay value is a provisional game estimate.
- **Unhistorical points kept from the reference:** it puts a later light-AA fit (1.1-inch quadruple mounts and
  .50-calibre guns, no 3-inch/50) on the 1923 hull, and fits four triple torpedo mounts. Both are modelled as the
  reference shows them.

## Model and simulation basis

The loft is `ship:lines` from the cached reference (`authoring/lines.json`), sampled at 127 stations; the
authoring script sets the forecastle and quarterdeck lines, the stem and forefoot profile, the flat keel and the
stern tips, and rebuilds outlying stations (bilge keels, torpedo pockets, an anchor recess at the deck edge) from
their neighbours. The superstructure is prisms traced from reference plan cuts at every tier (`--structures`
takes the traced tier files in `.build/omaha/`), with the funnels, midships casings, the forward shelter and the
after superstructure's lowest tier as measured tables. Where the lowest forward tier runs out over the side
beside the lower 6-inch drums it becomes a sponson shelf over a bowl fairing, as the reference's cuts show.

Mounts, directors, rangefinders, torpedo pivots and tube muzzles are the reference hardpoints. The 6-inch singles
are authored at the centre of their arcs (forward guns 0-130 degrees off the bow, after guns 50-180), so the rest
rule trains them fore or aft; blocks beside a drum give up its working circle, and the tier that roofs a drum lifts
its floor 5 cm clear of it (the tier under it rises with it). Armour: 76 mm citadel belt, 37 mm citadel deck and
forward bulkhead, 76 mm after bulkhead, 25 mm magazine boxes, 16 mm upper side and upper deck, 37 mm conning
station and 38/21 mm steering-gear box, all from the reference's armour model fitted to this loft.

`build.py` draws the loft and the prisms; `omaha_bridge.py` the navigation platform round the pilot house (its
wings, girder, rails, side-light screens, flag boxes, binnacle, pelorus stands and lockers), the pilot house roof
and chart-house rails, the after control station's trestle and rangefinder platform and the after superstructure's
roof rails; `omaha_fittings.py` the casemate hoods and sponson fairings, funnel caps, masts and lookout stations,
directors, rangefinders, searchlights, catapults, boats and davits, torpedo mounts, deck gear, screws, shafts,
rudder and bilge keels; `omaha_windows.py` the windows and scuttles the reference paints into its textures, read
off orthographic textured renders and seated on this model's own walls.

Machinery (four shafts, four boiler rooms under the funnels, two turbine rooms), magazines, flood spaces,
stability, damage control and weapon performance are game estimates. The native trial gives 35.0 kn at full power,
21.3 kn (61 %) and 1.65 degrees a second in a hard turn, 90 degrees in 31.9 s and a 761 m turning circle.

After an authoring change:

```sh
python3 assets/ships/omaha/author-blueprint.py --structures .build/omaha/blocks-fwd.json,.build/omaha/blocks-aft.json,.build/omaha/blocks-aftlow.json
bun assets/ships/author-flood-spaces.ts omaha
bun assets/ships/author-stability.ts omaha
bun run ship:build omaha
bun run ship:floating omaha && bun run ship:sweep omaha && bun run ship:check omaha
```

Without `--structures` the script keeps the current blueprint's traced tiers. Reference caches, traced tiers,
measurements and comparison captures stay in ignored `.build/`.

## Accepted approximations

- **Proportions of the reference:** its hull is 169.8 m long and 19.2 m wide at the waterline (published: 169.3 m
  and 16.9 m); the model keeps the reference's breadth. At the reference's waterline she draws 3.95 m and
  displaces 7,428 t (published: 4.3 m mean, 7,050 t standard, 9,500 t full load).
- **Torpedo mounts:** the catalog's `us-mk15-fast` triple tube stands in for the Omaha's own; the forward pair in
  the hull-side pockets train only 15-35 degrees before their after ends meet the pocket's back wall.
- **Upper forward 6-inch singles:** at +20 degrees with full recoil their breech dips about 9 cm into the deck
  they stand on (`sweep-accepted.json`); the reference shows no breech well. The forward shelter between them
  ends 0.8 m forward of the reference's so their breeches, trained right aft, pass clear.
- **Superstructure:** tiers are prisms, so the after control station steps where the reference tapers, and the
  drums' recesses are circles cut from the traced tiers. The reference's tubs round the upper forward guns are
  left to the guns' own drums.
- **Glazing:** windows and scuttles are placed where the reference paints them; an opening whose wall here stands
  more than 0.3 m (0.4 m for a window strip) from the reference's wall is left out, and windows are glazed in
  strips that follow this model's facets.
- **Paint:** linear-RGB interpretations of the reference's hull texture, not measured paint; its rust streaks are
  left to the runtime long-deployment wear. Boats have ship-grey hulls under white canopies.
- **Fittings:** boats, davits, cranes, catapults, searchlights, ladders and rigging are simplified original
  shapes; no aircraft is carried. The mainmast's lookout stations, yards and signal truss are at the reference
  heights; small deck boxes, lockers and fire-fighting gear are mostly left out.
- **Guns:** the four gun parts are original recipes registered for recipe use (`guns.json`, `library.json`);
  they are not in the Shipbuilder construction catalog.
