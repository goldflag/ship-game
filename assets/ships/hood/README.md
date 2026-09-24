# HMS Hood — May 1941

As at the Denmark Strait sortie. Open `/?ship=hood` or select her in port or Custom battle.

`blueprint.json` and `build.py` are the durable inputs; `author-blueprint.py` and `authoring/lines.json` record how the blueprint was made. Reusable equipment comes from `assets/parts/`. Generated Blender scenes and runtime models are build outputs.

## Approved brief

- **Vessel and fit:** HMS Hood, May 1941. GameModels3D [pbsb507](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb507), its only hull and artillery configuration (`A_Hull`, `A1_Artillery`): four twin 15-inch Mk II, seven twin 4-inch Mk XIX, three octuple 2-pdr pom-poms, four quadruple .50 Vickers, five UP projectors, Type 279 and 284 radar. No accepted mismatch.
- **Paint:** the source's "1941" scheme (`pbep307`): one blue-grey over hull and upperworks, darker grey steel roofs, black mast tops, red-oxide bottom, teak weather decks. Swatches in `appearance.json` interpret it under the fleet's lighting; they are not measured historical paint. The teak weather decks keep the retired brick-node teak's stain (its baked mean, `hood-authored-teak`, darker than King George V's) and its 0.16 m planks with 3.4 m butts and 3 mm seams, now drawn by the game. It wears In commission, drawn by the game like every ship's (plating, mottling, runoff, tide stain, funnel soot); Blender bakes only fine paint grain. Ensign as the fleet's white ensign; the source shows no pennant numbers.
- **Reference policy:** GameModels3D only. Fidelity is to that model; nothing here certifies historical accuracy.
- **Build route:** a Blender recipe like King George V, Bismarck and Yamato, at the owner's request, rather than the construction editor that `assets/AGENTS.md` prefers for new ships. The main hull is the authored station loft, not an adjustable `custom-hull`.

## How it was made

- **Hull:** 167 control stations measured off the reference as a lines plan (`authoring/lines.json`, 24 levels each; shaft bossings, bilge keels and rails excluded). The forecastle-deck break at z 42.8 m is two stations 0.3 m apart. 262.17 m overall, 31.59 m beam over the bulges, 10.12 m keel below the reference waterline; the loft displaces 48,280 t there.
- **Superstructure:** tiers are plan outlines traced from section cuts of the reference and made symmetric; heights come from its deck levels. They are blueprint `structures`, so collision, obstruction and the visual model share them. Open decks (the conning-tower platform, admiral's bridge, upper bridge and compass platform, the after control tower roof) are thin plates; `build.py` draws their plated screens, canvas dodgers and rails. Amidships the shelter deck is a roof over an open-sided well on the upper deck, carried on pillars and deck beams round the boiler- and engine-room casings.
- **Mounts and fittings:** datums are the reference hardpoints (hull centred, so z is shifted +1.584 m; `ship:overlay` measures 1.55–1.57 m). The 15-inch turrets reuse `bl-15-mkii-twin` (built from pbsb507), the 4-inch `qf-4-mkxix-twin`, the pom-poms `qf-2pdr-mkvi-octuple`, and both funnels the registered original `hood-forward-funnel` recipe, with ship-local cap grilles. The masts, spotting top, directors, rangefinder towers, UP launchers in their tubs, Vickers quads, searchlights, boats and derricks, screws and rudder are authored in `build.py` at the reference positions and sizes. Window bands and hull scuttles follow the windows the reference paints into its textures.
- **Protection:** plate families and thicknesses as the reference model carries them (305/178/127 mm belts, 76/51 mm decks, barbettes and conning tower), simplified to planar plates.

## Limitations

- **Gameplay values:** speed (29 kn), internals, flooding, stability (GM 7% of beam), damage control and underwater protection are provisional game calibration, not an as-built survey.
- **Non-firing fittings:** the Vickers quads and UP projectors are visual only.
- **Detail:** superstructure fittings (doors, vents, Carley floats, lockers, piping, rigging) are simplified and placed procedurally, not at the reference positions; the reference's smaller deck gear (reels, winches, fire-fighting gear, lockers) is mostly omitted. The Type 279 arrays are two plain frames.
- **Splinter screens:** the 4-inch deck-edge screens stand 1.0 m, against the reference's 1.4 m, so a 4-inch barrel depressed to −10° clears them at every bearing.
- **Turret arcs:** clearance interlocks (`mountClearance`) stop B at about ±138° and X at about ±136°, and stop a depressed superfiring barrel over its neighbour. These are game clearance envelopes, not recovered mechanical stops.

## Commands

```sh
python3 assets/ships/hood/author-blueprint.py            # regenerates blueprint.json; then:
bun -e "import {writeLocalDamage} from './assets/ships/author-local-damage.ts'; await writeLocalDamage(['hood'])"
bun assets/ships/author-flood-spaces.ts hood
bun assets/ships/author-stability.ts hood
bun -e "import {writeLocalDamage} from './assets/ships/author-local-damage.ts'; await writeLocalDamage(['hood'])"
bun run ship:build hood && bun run ship:review hood && bun run ship:check hood
bun run ship:hydrostatics && bun run multiplayer:content
```

The first local-damage pass only lets the flood-space helper compile; the last one covers the final rooms. Keep the current fixed views in `generated/review/`; captures and reference measurements belong in ignored `.build/`. Follow the [ship pipeline](../../../docs/ship-pipeline.md) and [model review](../../../docs/ship-model-review.md).
