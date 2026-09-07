# Carrier operations validation

This revision implements the approved Air operations chart and linked flight roster, per-flight commands, Enterprise's 48-aircraft wing (18 F4F-4 / 18 SBD-3 / 12 TBD-1), six-plane launches, four active flight slots, twelve deck positions and separate hangar inventory. The CPU remains authoritative for positions, orders, deck handling, losses and weapons. Capacities and handling times are game balance choices.

## Reproduction and automated checks

- `bun test --timeout 30000`: 528 passed, zero failures across 65 files, before the final UI/input additions and rendering capacity fix. Full output: [full-tests.log](full-tests.log).
- The final focused run of `src/simulation/{airOperations,aircraft}.test.ts` and `src/game/{AircraftView,AirOperations,InputController}.test.ts*`: 36 passed, zero failures. [carrier-tests.log](carrier-tests.log) covers the 48-aircraft inventory, finite deck slots, launch limits, command validation and ownership, retained targets, individual recall, recovery/relaunch, map projection, aim/cursor handling, keybinding migration and bounded rendering allocations.
- `bun run build`: all ten ship checks and thirteen aircraft checks, TypeScript and Vite pass. The existing large-chunk warning remains. [build.log](build.log).
- The UI detector returned no findings for the new Air operations and compact FlightControl surfaces: [ui-detector.json](ui-detector.json).

Run `bun assets/reviews/carrier-operations/measure.ts` to reproduce [rotation.json](rotation.json). It starts a stationary Enterprise with an idle enemy 5 km away, disables AA, launches four six-plane groups and recalls at 181 seconds. It steps aircraft/deck handling at 60 Hz for 750 seconds; it does not advance full hull combat or resolve all weapon outcomes. All 24 launched planes recover (touchdown events from 296 through 663 seconds), none exhaust endurance, and deck occupancy never exceeds twelve. The regression tests also confirm all 48 are ready after servicing and a second six-plane launch succeeds. These are controlled traffic checks, not promised sortie durations or fleet performance benchmarks.

The original mixed nine-plane fixture lost four undamaged returning aircraft at the 650-second endurance limit. The fix adds explicit approach legs, alignment/separation clearance, low-endurance priority, matched final speeds and early lateral runway clearance. The regression now recovers all survivors.

## Runtime review

Reviewed the real app in Orca's embedded WebGPU browser at 1137 × 906 and 390 × 844 CSS pixels. Controls were exercised through the rendered DOM and pointer events. The existing development advance hook accelerated 65 seconds of full combat to reach active flights. The remaining battle continued normally.

- [Ready wing](map-ready.png): 48 accounted for, 12 deck / 36 hangar, six-plane launch buttons and visible sea/ship perimeter.
- [Active flight detail](map-flight.png): linked flight selection, two active flights, role-specific commands, mission state, endurance and individual aircraft expansion.
- [Narrow layout](map-narrow.png): chart and roster stack within a scrolling body; totals, exit and recall remain reachable. [narrow-check.json](narrow-check.json) confirms no horizontal panel overflow.
- [Follow view](follow-flight.png) closes the map and tracks the selected airborne aircraft, including its published articulated pose: [follow-check.json](follow-check.json).
- A chart patrol click reaches the CPU as the corresponding world position, with order confirmation: [patrol-check.json](patrol-check.json).

The larger initial instance allocation caused WebGPU validation errors when Three bound its full 101,376-byte matrix buffer as uniforms. Aircraft now use batches of at most 768 instances (49,152 matrix bytes), with extra batches for the full capacity. The rendering regression covers all 1,584 supported visible aircraft and checks each binding against 64 KiB. The final browser run recorded no console errors through launching, flight commands and viewport changes. Earlier failed-capture images are not retained as completion evidence. Observed browser FPS is uncontrolled and should not be treated as a performance comparison.

## Ship build and articulation

The shared blueprint compiler contract changed, so all ten affected ship outputs were rebuilt through `ship:build` using local Blender. Enterprise's `ship:review` and refreshed `ship:compare` passed. The five fixed generated views (plan, profile, bow, stern, quarter) were inspected under `assets/ships/enterprise-cv6/generated/review/`. No original hull recipe, aircraft mesh or Bismarck baseline changed.

The in-game [neutral](port-neutral.png) and [articulated](port-articulated.png) Enterprise views use ship content hash `33d5b2e2460f32b96649c67d458fe749ac088cb3f54621ba6769527f996f341b`. The full train/elevation/recoil preview retained twelve rendered deck planes and reported maximum muzzle disagreement of 0.0000303 m: [articulation.json](articulation.json), [port-diagnostics.json](port-diagnostics.json). Export and pose checks establish consistency, not historical accuracy.

## Remaining limits

Hangar transfers are abstract; elevator movement, deck crew and wing folding are absent. Deck parking and aircraft traffic have no physical collision solver. The dashed chart route represents the flight lead's current navigation point and mission destination; it does not predict every future maneuver. Approximate travel times exclude attack and recovery waiting. Maneuvering carriers, multiple carriers, AA and combat damage can alter recovery outcomes; the traffic fixture does not establish their timing. See the [runtime discrepancy register](../../ships/enterprise-cv6/reports/flight-discrepancies.md) for historical and flight-model limitations.
