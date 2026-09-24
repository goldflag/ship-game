# HMS King George V — early 1941

Early 1941 Home Fleet exterior, before December AA refit; hull and waterline measured from the GameModels3D reference

Open `/?ship=king-george-v` or select this ship in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; reusable equipment comes from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

Geometry reference: [King George V on GameModels3D](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb107) (`pbsb107`, hull `bsb016_king_george_v_1943`, GameModels3D only). It shows the 1943 fit; this ship keeps the early-1941 fit: four octuple pom-poms, UP launchers on B, Y and the quarterdeck, Type 279 at both mastheads, Type 284 on the forward director, a Walrus on the catapult. The 1943 model's Oerlikons, extra pom-poms and Type 271/273/281/282/285 radars are not modelled.

Authored hull: 227.08 m long, 31.434 m beam, 10.557 m draft (flat keel 10.50 m) at the reference's waterline, 45,272 t. These are model inputs measured from that model, not a historical-accuracy certification; its waterline is deeper than the 1940 standard load (29 ft) and a little above the early-war deep load.

- **Exterior:** Hull lines, waterline, superstructure tiers, funnels, masts and mount datums measured from the reference; the early-1941 light AA, radar and aircraft kept from the original recipe informed by Vickers plans and IWM photographs.
- **Internals:** Estimated machinery, magazines, partitions, flooding and stability for inspectable combat; not an as-built internal survey.
- **Weapons:** Ten 14-inch and sixteen 5.25-inch guns. Source-based bore, layout, speed and train/elevation; ballistics and damage calibrated for gameplay. Pom-poms, UP and aircraft are visual only.

## How it was made

- `authoring/lines.json`: control-station offsets measured from the reference like a lines plan (hull centred on its overall length, reference z + 0.57 m). `author-hull.py` writes the blueprint `hull` from it, with mass from the displacement at that waterline.
- `author-structures.py`: the superstructure block table (deck levels 7.35, 10.25 and 12.0 m, tower tiers, sponsons, director seats, funnel envelopes) and its obstruction proxies, read from reference plan cuts and roof heights.
- `build.py`: the Blender recipe. Director, HACS, turret and 5.25-inch datums are the reference hardpoints; the pom-pom stations are the original recipe's (`equipment-evidence.json`).
- After a hull change: `bun assets/ships/author-flood-spaces.ts king-george-v`, remove `stability` and run `bun assets/ships/author-stability.ts king-george-v`, then build. Do not rerun local damage; its committed bands were refitted to the new draft geometrically.
- `author-blueprint.py` is the retired 1940-datum study; it refuses a full run (`--catalog-only` still updates the gun parts).

```sh
bun run ship:compile king-george-v
bun run ship:build king-george-v
bun run ship:review king-george-v
bun run ship:check king-george-v
bun run ship:floating king-george-v
bun run ship:sweep king-george-v
bun run ship:overlay king-george-v --offset 0.57
```

## Accepted approximations and open questions

- The registered Mk VII gunhouses are 0.2 m lower than the reference's; A and Y sit so their roofs match, which leaves the gun axes 0.3 m high (B 0.2 m). The gun parts are shared with the construction catalog and are unchanged.
- One centreline rudder as on the reference; both rudder assemblies pivot on its stock, each carrying half the blade.
- The 5.25-inch sponsons lose the reference's long tails where a neighbouring mount trains over them, and the after deckhouse is notched to 8.35 m beside P4/S4.
- Open: the early-1941 pom-pom stations (hangar roofs abreast the fore funnel, boat deck abreast the after funnel) and the boat stowage are kept from the recipe rather than the 1943 model; the searchlight positions follow the reference's platforms.
- `ship:sweep` still finds A trained aft over B at 40° elevation (present before this pass); the ship has no interlock profile.

Keep the current fixed views in `generated/review/`. Ship report/reference archives are removed. Research downloads, diagnostic results and extra captures belong in ignored `.build/`; do not recreate a tracked archive. Keep source links and lasting limitations here.

Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
`appearance.json` preserves this recipe’s colors, scheme and deck coverings. It wears In commission, drawn by the game like every ship's (plating, mottling, runoff, tide stain, funnel soot); Blender bakes only fine paint grain.
The bare teak weather decks keep the retired brick-node teak's stain (its baked mean,
`king-george-v-authored-deck`) and its 0.16 m planks with 3.4 m butts and 3 mm seams,
now drawn by the game. This is not a new historical-accuracy claim.
