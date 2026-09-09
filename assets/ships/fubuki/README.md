# Fubuki

## Approved brief

Approved in conversation: Fubuki-class destroyer, [GameModels3D Fubuki `pjsd106`](https://gamemodels3d.com/games/worldofwarships/vehicles/pjsd106), Fubuki (A) module `PJUH706_Fubuki_1942`, hull `A_Hull_1943`, `AB1_127_50`, `A_AirDefense`, stock `AB1_Torpedoes`, default directors/finders and depth-charge outfit. Two twin 127 mm Type C mounts and three triple 610 mm torpedo banks; five twin 25 mm, two twin and four single 13.2 mm AA mounts.

GameModels3D is the sole external visual reference. Match the approved default gray finish, reddish-brown deck areas and weathered underwater hull; no optional camouflage or unshown flags/markings. The source's conflicting year labels are accepted without assigning a verified historical year. This models the source game's A configuration, not a certified historical Fubuki refit. Source scale/loading/waterline remain unverified. Internals, protection and gameplay performance use provisional game conventions.

## Authoring

Versioned `blueprint.json` and original recipes are the durable inputs. `authoring/definition.py` creates the base specification; the blueprint also contains the shared stability and local-damage authoring results. Normal rebuilds use the checked-in blueprint. External model geometry/textures remain comparison-only under ignored `.build/`.

The hull, bridge, funnels, torpedo banks, boats, rigging, fittings and hull paint are independently authored. Main turrets and twin 25 mm guns reuse the registered original Type C and Mogami recipes; single and twin 13.2 mm guns use the original shared Type 93 builders. Weapon joints, muzzle sockets and equipment IDs remain independent for CPU-driven combat and inspection.

The source's middle torpedo bank is displayed facing aft; the game's trainable launchers reset forward and rotate into either broadside firing arc. This is a neutral-pose difference. Launcher arcs, ammunition, protection, compartment layout, stability and 35-knot performance are provisional gameplay data. The 118.75 m scale and draft are reference alignment assumptions, not verified displacement/loading measurements. Small fittings and internal machinery are interpretations of visible source detail.

```sh
bun run ship:compile fubuki
bun run ship:build fubuki
bun run ship:review fubuki
bun run ship:check fubuki
```
