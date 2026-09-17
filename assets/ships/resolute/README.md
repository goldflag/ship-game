# Resolute

Resolute is an original, fictional battleship built with the version-1 construction
blueprint and the shared Rust compiler. It is not HMS Resolute, a historical refit,
or a reconstruction of a reference model. The brief is a conventional heavy
surface combatant with a raked bow, chamfered bilges, stepped bridge, two funnels,
and four twin main turrets in forward/aft superfiring pairs. No external reference
geometry or textures are used.

## Editable source and fit

`blueprint.json` is the complete ship construction source. There is no per-ship
Blender recipe. Every hull section, support, boundary, surface assignment and
fitting retains a stable editable ID. `recipe-inputs.json` lists original reusable
component dependencies discovered with `part:inputs`; the source's exact retained
catalog revision and component hashes govern construction publication.

- 220 m overall hull, 32 m maximum beam. Planar freeform sections preserve a
  tapered plan, raised forecastle, forward-raked stem and rising stern underbody.
- Four original `sk-c34-380-twin` covered-blister variants: eight 380 mm barrels.
  Raised Bravo/Charlie supports surround their full catalog working wells.
- Eight `us-5in38-mk30-mod0-single` secondary mounts; six detailed
  `us-20mm-oerlikon-mk4-hsienyang` single AA mounts. Every weapon has its own
  magazine package; AA uses the 2,000-round rack variant.
- Two original generic 40 MW boiler/geared-turbine packages, independently linked
  to two capital-ship funnels and four exact Fletcher starboard screw variants.
  Two Fletcher rudders have separate modeled skegs; four shafts have physical
  supports. Machinery, magazines, protective deck and transverse bulkheads are
  inspectable through normal game internals.
- Mk37 forward director, compact aft optical rangefinder, two retained aftermast
  variants, two stowed lifeboats/davits, searchlights, vents, doors, ladders,
  hatches, anchoring/mooring fittings and railings with gun-station working gaps.
- Named naval gray and deck gray steel finishes, red oxide below the central
  waterline band, and black boot topping. Retained equipment keeps its published
  neutral finish. No national markings or historical camouflage are implied.

Native loading is approximately 38,813 t with 5.93 m initial roll metacentric
height. Rated machinery totals 80 MW; auxiliary reservation and catalog propeller
efficiency yield 50.96 MW effective power and an estimated 19.4 knots. These are
compiler/game results, not certified naval architecture.

## Lasting assumptions and limits

This is a playable original design with deliberately mixed existing equipment
variants, not a claim that this international fit was built. Component metadata
retains its existing historical-review qualifications. Machinery mass, plant
rating, magazine capacities, service allowances and ammunition are explicit game
estimates. The generic plant includes boilers, turbines, gears and auxiliaries;
there is no detailed steam-cycle or shaft-routing simulation. The four retained
screws all have the catalog's starboard hand rather than counter-rotating pairs.

The hull uses faceted planar sections and simplified chines, not a smooth loft;
small transitions at the ends of the underwater paint/chamfer run remain visible
out of water. Armor uses a provisional 300 mm central side belt, thinner ends,
100 mm central weather deck, a 55 mm lower protective deck, 16 mm bulkheads and
20 mm default structural skin. This is not a researched armor arrangement.
The broad raised support drums accommodate the compiler's square working-well
reservation and are not replicas of a historical barbette. Their structural
skin does not claim full historical barbette protection.

Doors and hatches are closed fittings; boats remain stowed. Searchlights are
unlit, rigging is limited to the retained mast assemblies, and the ship has no
aircraft or torpedo battery. Railings are omitted at secondary gun working arcs.
Native clearance can stop travel toward decks, support drums, boats or railings;
blocked poses are not certified travel. Large diagnostic pose jumps can also
reach the conservative sweep budget and require smaller steps. Sampled review
is not a proof of every pose or a historical-fidelity certification.

## Reopen and reproduce

```sh
bun run ship:edit resolute --port 5195
bun run ship:inspect resolute --source
bun run ship:compile resolute
bun run ship:build resolute
bun run ship:check resolute
bun run ship:review resolute
bun run ship:trial resolute --seconds 15
bun run model:viewer
```

The editor opens at `http://127.0.0.1:5195/tools/construction/editor.html?ship=resolute`.
The model viewer uses `http://127.0.0.1:5180/?ship=resolute` after registration.
Current published fixed views are in `generated/review/`. Extra close-ups,
articulation samples, trial logs and browser captures belong only under ignored
`.build/construction/resolute/`.
