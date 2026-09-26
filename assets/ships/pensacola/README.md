# USS Pensacola (CA-24)

CA-24 · 1942 exterior after the GameModels3D pasc106 A hull (asc043_pensacola_1942) · reference design waterline

Open `/?ship=pensacola` or select this ship in port or Custom battle.

This is a legacy Blender-recipe preset (like Takao, Alaska, Hood and Mogami), by explicit request, rather than a
construction ship. `blueprint.json` (written by `author-blueprint.py` from `authoring/lines.json` and the traced
superstructure), `build.py`, `pensacola_kit.py` (shared vocabulary: materials, primitives, merged rails and wires),
`pensacola_fittings.py` (masts, aircraft crane, catapults, directors, rangefinder, radar, searchlights, boats, deck
gear, funnel pipes, bulwark rails and underwater gear), `pensacola_windows.py` (glazing and scuttles) and
`pensacola_bulwarks.py` (gun-tub and platform bulwark lines) are the durable inputs; the guns come from
`assets/parts/`. Generated Blender scenes and runtime models are build outputs.

## Approved brief

- **Vessel and fit:** USS Pensacola (CA-24) in the GameModels3D 1942 fit: World of Warships vehicle
  [`pasc106`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc106), configuration `A_Hull`, hull
  `asc043_pensacola_1942` (chosen by the owner over the 1944 hull). Two twin 8-inch/55 Mk 14 Mod 2 turrets (low,
  Nos. 1 and 4) and two triple 8-inch/55 Mk 14 Mod 1 turrets (superfiring, Nos. 2 and 3), eight single 5-inch/25
  Mk 19, four 1.1-inch/75 quadruple mounts, eight single 20 mm Oerlikon Mk 4, two catapults (fitted empty), four Mk 44,
  two Mk 19, one Mk 18 and one Mk 22 director, a 2.7 m rangefinder and a CXAM radar.
- **Paint:** the reference's default (plain) scheme as `bun run ship:reference pasc106 --render` shows it, which is
  not a camouflage: one light blue-grey over hull and upperworks, deck blue over the planked weather deck and over the
  steel roofs and platforms, black funnel caps and a red-oxide bottom without boot topping. A US national ensign
  flies from the mainmast gaff, as at sea.
- **Reference policy:** GameModels3D only: no photographs, plans, War Thunder, Sketchfab or other models. Armour zones
  and thicknesses come from the reference's armour model (`asc043_pensacola_1942` armour); other gameplay values are
  provisional game calibration. The reference's fit is taken as it stands even where it looks unhistorical.

## Model and simulation basis

**Hull.** An original authored-stations loft of 109 stations of 28 points, measured with `bun run ship:lines
pensacola --ref pasc106 --format sections --widest-below 1.5 --span -87.80,90.65 --high 0.125,0.25,0.375,0.5,0.625,
0.75,0.875,1` (`authoring/lines.json`). `author-blueprint.py` drops the stations whose shell walk failed (a lost stem
bar, a walk that stepped over a bilge keel and never turned the bilge, one that climbed the flush midships
superstructure), restores the flat keel of the centreline cut (-6.614 m from reference z -82.9 to 68.3), adds two
stations at the stem foot (the stem stands upright to 1.05 m before it rakes) and bends the stem head's stations onto
the measured stem line. At the reference's y = 0 design waterline it is 178.45 m overall (174.1 m on the waterline),
19.69 m over the belt (19.57 m on the waterline), 6.61 m to the keel and 13,673 t. The flush deck's sheer (7.8 m at
the stem head, 4.2 m amidships, 3.8-4.1 m aft), the flared, raked stem, the cut-up and counter of the cruiser stern
and the belt's step follow the reference.

**Superstructure.** Traced from `ship:slice pasc106 --plan <y> --sym --parts hull` cuts every 0.1 m from 3.85 to 40 m,
only over the stretches where the sheered deck lies below the cut (`.build/pensacola/measure/stack.py`). Each
footprint is followed up through the levels; a chain breaks where the outline changes abruptly (a deck, a platform,
an overhang). A chain whose outline stays put is a prism; one whose outline changes gradually (tapered or rounded
faces) is lofted through its levels on one set of bearings about its middle (`blocks2structures.py`), thinned
wherever the wall runs straight, and split in height to stay within the blueprint's surface limits; chains that are
not star-shaped, or that hold a light gun's tub, stay prisms. A block that starts within 0.35 m of the deck reaches
down into it; a level lost between tracks is closed; thin slabs that touch nothing are dropped; the deck a light
mount stands on stops at the mount's datum (the foretop's Oerlikon platform is the full 8.4 m wide at 24.9 m).

The funnel casings are single-sided shells, so their raw plan-section chains (`cuts.ts`, `funnel_levels.py`) give the
true outline with the steam pipes left out: 3.21 m across and 5.38 m long, straight sides and flattened ends, the
same on both funnels and raked aft 0.105. Each casing is one closed loft on its own rake line from its foot (the
forward funnel's 0.25 m flare at the deck, the after funnel's skirt over its stepped base) to the cap: a lip standing
0.13-0.15 m proud, tapering in to the rim of the mouth (half-widths read every 5 cm), the cap set on a slant 0.30 and
0.35 m higher at the front edge, and the mouth a 0.5 m well 0.12 m inside the rim. Rings sit 1.8 m under the mouth,
where the black cap paint meets the grey. The sloping apron round each casing under the cap, the gratings in the
wells, the forward funnel's cowl (its plan outline read every 0.1 m up to 20.95 m, flat back at reference z -14.40)
and the steam pipes on their measured centres are fittings.

Plating the plan tracer cannot see (the reference models it as single-sided plates) is traced from the same raw
chains (`walls2.py`): the runs that stand more than 15 cm from every block at the middle of each region are drawn into
a 3 cm raster, thinned to centre lines and followed up and down the levels for a foot and top at every vertex. They
are thin surfaced blocks (so hits and the clearance interlocks see them) with a rolled top edge along the measured
top: the eight 5-inch tubs (tops sloping from 10.25 to 10.85 m forward, 7.75-8.0 m aft), the bridge-top bulwark
(17.3-18.85 m, with its bulges round the Mk 44 directors), the sidelight screens and the ring round the Mk 22
director's trunk on the foretop (32.8-34.0 m, over the platform's flared floor, where the plan tracer had filled a solid
block). Vertical rays through the reference (`opentops.ts`) found three more platforms the tracer had filled: the
searchlight platform abaft the after funnel (floor 13.45 m), the Mk 18 director's platform on the after tower
(12.02 m) and the after Mk 44 directors' tubs (4.76 m); their blocks stop at the floor and their bulwarks are traced
the same way. The 1.1-inch tubs follow the
section chains round each mount, and the foretop and after-tower platforms' bulwarks their traced outlines. The windows and scuttles were
read off orthographic textured renders of the reference with the depth of the wall each lies on
(`windows_detect.py`, `windows_table.py`) and are set into this model's own walls where they stand within 0.35 m of
the reference's: 160-odd panes and rimmed scuttles on the bridge, deckhouses and hull.

**Mounts** sit at the reference's hardpoint datums: the 8-inch turrets are the catalog's exact
`us-8in55-mk14-mod2-twin` (agm021) and `us-8in55-mk14-mod1-triple` (agm020), the 5-inch/25 `us-5in25-mk19-single`
(ags007), the 1.1-inch quads `us-11in75-quad` (aga013) and the Oerlikons `us-20mm-oerlikon-mk4` (aga003). Wing
5-inch mounts carry their beam arc's centre as bearing; the light AA keep the reference's bearings. Barbettes are
measured (2.66 m radius, armour model and plan cuts). Every mount carries a `mountClearance` envelope (barrels with
recoil and a carriage box; the Mk 14 gunhouses' rangefinder hoods as capsules) against the blocks it can reach, the
superfiring pairs interlock against each other, and firing obstructions box the boats, catapults, the after tower's
lower legs and the forecastle deck rising ahead of No. 1 turret. `ship:sweep` finds no reachable contact.

**Fittings** are simplified original constructions at the reference's positions and sizes (hardpoints, part bounds
and plan cuts): the tripod foremast (raked main leg, side legs from the sponson deck, the spider of struts under the
foretop, the searchlight platform on its two columns, topmast and yard), the
pole mainmast with its gaff and the after tower's struts and legs, the aircraft crane (king post, braces, cranked
lattice jib), two powder catapults on their pedestals trained fore and aft (fitted empty), the spare float and
aircraft cradles, two Mk 19 directors (house, rangefinder arms, sight ports), four Mk 44 directors, the Mk 22 on the
foretop and the Mk 18 aft (both trained by the rig), the 2.7 m rangefinder, the CXAM on its railed platform at the
topmast head (yoke, side arms and a screen leaning back 23 degrees, turning), the RDF loop, six searchlights and four sky lookouts, two open 26 ft whaleboats under radial davits,
the pillars, cross-bracing and knee braces under the forward 5-inch sponsons, bollards, fairleads, capstans, the
two windlasses with their cables from the hawse-pipe collars, reels,
ventilators, paravanes, anchors, the jack and ensign staffs, funnel steam pipes, deck-edge rails, four broad-bladed
screws on shafts in bossings with A-brackets, the semi-balanced rudder (measured from the centreline cut) and the
bilge keels. About a hundred deck stores (ready-use lockers, hatches and skylights, the signal flag lockers, boat
winches, the stack of wooden boxes abaft the forward funnel, fuel-oil hoses, net baskets, cooling-water tanks) are
simple boxes and drums at the bounds of the reference's own fittings, seated on our decks.

**Gameplay data.** Machinery (four firerooms under the funnels and four engine rooms, four shafts), magazines,
flood spaces, stability and damage-control values are game estimates; the visual reference does not establish
internal plans. The citadel follows the reference's armour model and is fitted to the loft: a 102 mm belt over the
forward magazines (reference z -61.1 to -21.3) and 76 mm over the machinery (to 35.9), 25 mm lower citadel side,
38 mm magazine decks and 25 mm over the machinery, 65 mm and 25 mm bulkheads, the after magazines' 102 mm inner box
behind a 19 mm belt, 25 mm upper side and weather deck, 19 mm barbettes, a 32 mm conning tower and the 65 mm
steering-gear box; hull and superstructure plating are 25 and 13 mm. `ship:trial`: 32.5 kn, hard-turn speed 62% of
top, 1.63°/s, 90° in 32 s.

## Accepted approximations

- The loft is measured at the reference's y = 0 design waterline, whose loading (13,673 t, 6.61 m keel draft) is
  heavier than published full-load figures for the class (about 11,500 t and 5.9 m); the stated mass equals the
  loft's displacement, as on Takao.
- Superstructure blocks are measured prisms and straight lofts: small overhangs step, some sponson and platform
  edges show 0.1 m steps where a loft would not fit (a tub or a footprint that is not star-shaped), and curved faces
  are faceted. Painted texture detail other than windows and scuttles (doors, hatches, markings) is not modelled;
  openings whose wall here stands away from the reference's are left out.
- The forward funnel's cowl is closed at the back, where the reference's hood stands open aft over the grating; both
  casings use the forward funnel's measured outline (the after one measures the same); the after funnel's skirt keeps
  the traced steps of its base.
- Masts, the crane, catapults, directors, the radar and searchlights are simplified; the catapults are empty, as the
  brief asks (the reference's aircraft are not modelled). Rails stay out of the gun arcs.
- The covered gallery round the pilothouse at 12.47 m and the walkway round the midships house at 9.68 m stay filled
  to their bulwark tops (the tracer's blocks); both lie under the platforms above and show only their bulwarks.
- Deck stores the 8-inch gunhouses or depressed barrels would strike (three hatches under No. 1 turret's overhang, two
  hatches and a winch under No. 4's barrels) and three whose deck here stands away from the reference's are left off;
  the small bridge and deck furniture (telephones, switch boxes, voice tubes, fire-hose reels) is not modelled.
- Weather-deck planks use the Baltimore preset's plank size (0.127 x 3.048 m): the reference texture shows planking
  under the deck-blue paint but is too coarse to measure it.
- The 20 mm and 1.1-inch mounts stop at their tub and platform bulwarks through the clearance interlocks; the
  reference's own mounts would meet the same plating.
- Handling (32.5 kn), stability, mass distribution, flooding compartmentation and weapon values are shared game
  calibration, not historical measurements. Model fidelity and export checks do not certify historical accuracy.

Pensacola takes the placeholder's place in the US cruiser line of the research tree.

```sh
python3 assets/ships/pensacola/author-blueprint.py   # add --structures to re-measure from .build/pensacola
bun -e "import { writeLocalDamage } from './assets/ships/author-local-damage.ts'; await writeLocalDamage(['pensacola'])"
bun assets/ships/author-flood-spaces.ts pensacola && bun assets/ships/author-stability.ts pensacola && bun assets/ships/author-damage-control.ts pensacola
bun run ship:build pensacola
bun run ship:floating pensacola && bun run ship:sweep pensacola
bun run ship:overlay pensacola --textured
bun run ship:review pensacola
bun run ship:check pensacola
```

Keep the current fixed views in `generated/review/`. Reference downloads, measurements and comparison captures stay
in ignored `.build/`.
