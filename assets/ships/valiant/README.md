# Valiant — original battleship

Valiant is a fictional conventional battleship built in the ship editor, not a
reconstruction of HMS Valiant or any historical vessel. The user requested an
original, realistic fictional battleship. The design uses a single adjustable
hull, three triple main turrets, a stepped enclosed bridge, two funnels, a timber
weather deck and restrained named gray paints. No external visual reference or
imported geometry is used. Published original component variants remain intact.

## Editable design

`blueprint.json` is the versioned construction source used by both the editor and
Rust compiler. It contains the hull sections, superstructure, armor assignments,
bulkheads, equipment and installation settings. No per-ship Blender recipe is
required. `recipe-inputs.json` records the registered original component sources;
the retained catalog revision and component hashes control publication.

- Nominal 252 m hull, 35 m beam; sixteen adjustable transverse stations, raked
  stem, tapered stern and rounded bilges.
- Three original 406 mm Mk 7 triple turrets, with the second turret raised on its
  integrated working well. Eight twin 127 mm Mk 32 Mod.12 secondary mounts and
  ten twin 40 mm Bofors Mk.1 mounts. Each has native integrated ammunition.
- Four 40 MW geared-turbine packages, two 80 MW exhaust-capacity funnels, four
  linked screws and two supported rudders. The compiler generates physical
  shaft supports. Machinery floor and transverse bulkheads remain inspectable.
- Three stepped deckhouse sections, chamfered bridge corners, wraparound splinter
  galleries, supported searchlight wings, roof brows, tapered aft control tower
  and separate funnel ventilation trunks. Two Mk 38 directors and a radar mast;
  enclosed navigation and command bridges,
  searchlight wings, two stowed motor boats, splinter-protected AA stations,
  bridge windows, doors, ladders, hatches, vents, lockers, capstans, anchor
  windlasses/chains, mooring gear, an ensign staff and deck railings.
- Naval-gray fittings and hull, light-gray upperworks, gray steel platforms,
  natural teak weather deck and red oxide underwater coating. No national flag
  or historical camouflage is implied.

Native loading is approximately 52,947 t, with 5.56 m initial roll metacentric
height. The 160 MW rated plant supplies 101.92 MW effective propulsion after
auxiliary reservation and the retained screws' efficiency, giving an estimated
23.9 knots. These are compiler/game results, not certified performance figures.

## Assumptions and limits

This is an original arrangement using existing US and generic component recipes.
Component historical-review qualifications remain those of the library. Armor,
loading, plant capacity, ammunition packaging and performance are game estimates,
not certified naval architecture. The nominal side protection is 280 mm and the
weather deck 110 mm; there is no claim of a researched armor scheme or complete
historical torpedo-defense system. Working wells must remain clear of transverse
boundaries. The four screws use the retained starboard-hand variant.

The main hull has planar section panels, a level weather deck and simplified
underwater appendages. Boats remain stowed; searchlights are unlit and the mast's
radar aerial is static. The ensign staff carries no flag. Gun travel is defined
for this arrangement and checked by native clearance; sampled review cannot
prove every continuous combination of independently moving guns.
The fixed review's large instantaneous jumps can exhaust the clearance solver's
sweep budget on the low main turrets. Incremental 5-degree review reaches the
authored endpoints, including independently opposed neighboring mounts, without
physical obstruction; a budget stop is not an alternate mechanical limit.

## Open and reproduce

```sh
bun run ship:edit valiant --port 5347
bun run ship:compile valiant
bun run ship:build valiant
bun run ship:check valiant
bun run ship:review valiant
bun run ship:trial valiant --seconds 30
```

The editor URL is `http://127.0.0.1:5347/tools/construction/editor.html?ship=valiant`.
Use **Save local copy** to put an independent editable copy in the player library,
or **Sea Trials** to sail the repository design. Published fixed views live in
`generated/review/`; extra captures and diagnostics stay in ignored `.build/`.
