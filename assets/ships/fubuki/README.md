# Fubuki

## Approved brief

Approved in conversation: Fubuki-class destroyer, [GameModels3D Fubuki `pjsd106`](https://gamemodels3d.com/games/worldofwarships/vehicles/pjsd106), Fubuki (A) module `PJUH706_Fubuki_1942`, hull `A_Hull_1943`, `AB1_127_50`, `A_AirDefense`, stock `AB1_Torpedoes`, default directors/finders and depth-charge outfit. Two twin 127 mm Type C mounts and three triple 610 mm torpedo banks; five twin 25 mm, two twin and four single 13.2 mm AA mounts.

GameModels3D is the sole external visual reference. Match the approved default gray finish, reddish-brown deck areas and weathered underwater hull; no optional camouflage or unshown flags/markings. The source's conflicting year labels are accepted without assigning a verified historical year. This models the source game's A configuration, not a certified historical Fubuki refit. Source scale/loading/waterline remain unverified. Internals, protection and gameplay performance use provisional game conventions.

## Authoring

Versioned `blueprint.json` and original recipes are the durable inputs. `authoring/definition.py` created the base specification; the blueprint also contains the shared flood-space, stability and local-damage authoring results, so normal rebuilds use the checked-in blueprint. External model geometry/textures remain comparison-only under ignored `.build/`.

The September 2026 accuracy pass re-measured the ship against `pjsd106` like a lines plan. `authoring/lines.json` holds 82 control stations (half-breadths at 27 levels from keel to deck edge, bilge keels, brackets and rudders excluded) and `authoring/hull.py` writes `blueprint.hull` from it: a fine V forebody under a flared forecastle with a deck-edge lip, a narrow afterbody with a flat counter and a small vertical transom, a level main deck at 3.38 m and a vertical forecastle break at z −20.6. `authoring/structures.py` writes the re-traced superstructure (plan outlines at several heights, surface lofts for the wheelhouse, towers and casings) and `authoring/funnels.json` the measured funnel sections, which it carries up the 10.5° rake to the inclined rims. After a hull change run `author-flood-spaces.ts`, then `author-stability.ts` with `stability` removed. The stated 2,300 t is kept; the measured hull displaces 1,895 t at the reference waterline, so the buoyancy scale is 1.21.

The hull, bridge, funnels, torpedo banks, boats, masts, rigging, fittings and hull paint are independently authored in `build.py`, `geometry.py` and `fittings.py`. Main turrets and twin 25 mm guns reuse the registered original Type C and Mogami recipes; single and twin 13.2 mm guns use the original shared Type 93 builders. Weapon joints, muzzle sockets and equipment IDs remain independent for CPU-driven combat and inspection.

Accepted differences from the reference: the source's middle torpedo bank is displayed facing aft, while the game's trainable launchers reset forward and rotate into either broadside arc. The after deckhouse's tapered end stops at z 37.6 (reference 38.25) so the after gun clears it at full train and depression, and the lifelines fold down beside the two port 13 mm singles, which stand at the deck edge. The reference's extra stern fittings (depth-charge roller rack, small cranes, reels and mortar) are not modelled. Launcher arcs, ammunition, protection, compartment layout, stability and 35-knot performance are provisional gameplay data. The 118.75 m scale and draft are reference alignment assumptions, not verified displacement/loading measurements. Small fittings and internal machinery are interpretations of visible source detail.

```sh
bun run ship:compile fubuki
bun run ship:build fubuki
bun run ship:review fubuki
bun run ship:check fubuki
```

Appearance follows the [shared fleet finish](../../../docs/ship-appearance.md).
`appearance.json` preserves this recipe’s colors, scheme and deck coverings while
adding the shared matte materials and restrained original surface wear. Existing
markings and plank detail remain intact; this is not a new historical-accuracy claim.
