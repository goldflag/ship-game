# USS Baltimore (CA-68)

CA-68 · October 1943 exterior · hull, superstructure and mount seats measured on GameModels3D `pasc108`

Open `/?ship=baltimore` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. `recipe-inputs.json` declares additional original dependencies. Generated Blender scenes and runtime models are build outputs.

## Reference and fit

The primary visual reference is the GameModels3D World of Warships vehicle
[`pasc108`](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasc108), `A_Hull` with its default
components (cached with `bun run ship:reference pasc108`; the overlay alignment is reference z + 0.216 m). The
policy is GameModels3D only: no photographs, plans or other models. The preset keeps its October 1943 fit and
equipment list; where the reference shows a later arrangement it is listed below rather than modelled.

Authored hull: 202.8 m long, 21.74 m beam, 6.88 m keel draft (the reference's; the previous NAVSHIPS-based
datum was 205.26 m, 21.59 m and 7.366 m). These are model inputs, not a historical-accuracy certification.

## How it was made

- **Hull.** `authoring/lines.json` holds 141 control stations measured on the reference like a lines plan (twenty
  levels from the keel to just above the belt, six to the deck edge); `authoring/author-hull.py` writes the
  blueprint's `authored-stations-v1` loft from it. Bilge keels, shaft brackets and the skeg are fins taken out of
  the loft and drawn by the recipe. `authoring/seat-armor.py` then re-seats the belt, bulkheads, protective deck
  and barbettes on the shell and fits the retained rooms and modules inside it. After any hull change run, in
  order: `author-hull.py`, `seat-armor.py`, `bun assets/ships/author-flood-spaces.ts baltimore`, remove
  `stability` and `bun assets/ships/author-stability.ts baltimore`.
- **Superstructure and mounts.** `authoring/author-structures.py` writes the deckhouse tiers, gallery decks,
  funnel casings and stacks, 40 mm tub pedestals, obstruction boxes and the installation clearance profile from
  outlines and heights measured on the reference, and moves every mount to its reference hardpoint (the 5-inch
  and 8-inch datums sit 0.25 m and 0.05 m below the reference gunhouse feet, matching the catalog gunhouses). IDs,
  parts and weapons are unchanged. Run `seat-armor.py` after it.
- **Recipe.** `build.py` draws the structures, splinter bulwarks, raked cowls, directors, masts, aircraft
  handling, AA tubs, deck fittings, forecastle bulwark, screws, rudder, skeg and bilge keels on those records.

```sh
bun run ship:compile baltimore
bun run ship:build baltimore
bun run ship:review baltimore
bun run ship:check baltimore
bun run ship:overlay baltimore --reference pasc108
```

Keep the current fixed views in `generated/review/`. Research downloads, diagnostic results and extra captures belong in ignored `.build/`.

## Limitations and accepted differences

- **Radar fit (open question).** The reference carries a bedspring on the foremast and a dish on the mainmast;
  the preset keeps its 1943 fit (SG on the foremast topmast, SK on the mainmast platform, Mk 8 on the Mk 34s,
  Mk 4 on the Mk 37s). The masts, platforms and yards follow the reference.
- **Not in the fit.** The reference's Mk 51 directors, sky lookout stands and searchlights are not modelled; their
  tubs and platforms are. The wing 5-inch mounts rest trained abeam in the static model (the game trains them fore
  or aft at rest).
- **20 mm.** Twenty-four visual singles: twenty-three on the reference stations, the twenty-fourth paired with the
  one on the after deckhouse gallery.
- **Gun parts.** The catalog 5-inch Mk 32 gunhouse is about 1 m lower and shorter than the reference's (side
  overlay IoU 0.64 at mount 51), and the shared 8-inch turret about 0.2 m taller and 0.6 m longer aft with a
  different face (0.68 at turret 1, barrels included); neither was changed here.
- **Clearance.** The 8-inch and 5-inch mounts carry installation interlocks against the deckhouses they can reach
  and between the superfiring pairs, so they stop at the superstructure instead of firing through it.
- **Internals.** Protection thicknesses, room envelopes, capacities, flooding and ballistics remain estimates; the
  retained rooms were only fitted inside the new shell.
- **Weapons.** Original catalog-based 8-inch triple, 5-inch twin and quad 40 mm components; AA rates and arcs are
  gameplay approximations.

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md): the weather deck is a blue-gray
timber material (0.127 m planks, 3.048 m butts, 3 mm seams, `decking`), wearing In commission. Teak decking for
the class is documented by J. G. Kuenzel in [Wood Requirements for Shipbuilding (1950), Table 2](https://doi.org/10.1093/jof/48.4.245);
the shade, margins and plank dimensions are interpretations.
