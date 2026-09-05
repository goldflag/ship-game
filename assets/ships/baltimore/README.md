# USS Baltimore (CA-68)

Original, independently authored Baltimore-class cruiser reconstruction targeting October 1943. Built through the shared, versioned ship blueprint and component pipeline. Historical accuracy is **under review**, not certified.

The dimensional datum is the Navy's documented **24 ft 2 in limiting keel draft**. This is distinct from the **26 ft 10 in maximum navigational draft**, which includes projections below the keel. The 1945 tabulation does not establish Baltimore's precise October 1943 displacement.

| Dimension | Documented value | Source |
| --- | --- | --- |
| Length overall | 673 ft 5 in / 205.2574 m | NAVSHIPS 250-010, p. 26 |
| Length on waterline | 664 ft / 202.3872 m | NAVSHIPS 250-010, p. 26 |
| Extreme beam | 70 ft 10 in / 21.59 m | NAVSHIPS 250-010, p. 26 |
| Limiting keel draft | 24 ft 2 in / 7.366 m | NAVSHIPS 250-010, p. 27 |
| Maximum navigational draft | 26 ft 10 in / 8.1788 m | NAVSHIPS 250-010, p. 27 |

`blueprint.json` owns the hull stations, 120 retained hull sections informed by primary class comparisons, deckhouse footprints, nine main/secondary mounts, and provisional simulation volumes. `build.py` creates the retained Blender source, catalog guns, masts, directors, twin aircraft cranes, twin catapults, original indicative OS2U aircraft, light AA, four shafts, and a rudder. AA and aircraft are visual fittings, as in the Bismarck baseline.

Run:

```sh
bun run ship:compile baltimore
bun run ship:build baltimore
bun run ship:check baltimore
bun assets/ships/baltimore/measure.ts
bun run ship:review baltimore
```

Read [the source register](references/sources.json), [measurements](references/measurements.json), and [open discrepancies](reports/discrepancies.md). Reference photographs and scans remain reference-only assets. None are baked onto the ship. The wartime camouflage drawing provides geometry evidence; its later dazzle scheme is not used on the 1943 model.

For a readable source gallery and an explanation of the fitting process, read [references and reconstruction method](reports/references-and-method.md).

The actual GLB now matches overall length, beam, keel draft and waterline length within a 5 mm computational tolerance. This does not represent the uncertainty of the historical sources. See [the decoded-geometry measurements](reports/dimensions.json).

High-resolution original Baltimore bridge plans, a commissioning photograph, Quincy docking plans, and Canberra cross sections are retained under references/. The sister-ship sheets inform the class hull, staggered shafts and rudder. Later annotations and missile-conversion features are explicitly excluded from the 1943 fit. Full Baltimore hull offsets, five missing BGP sheets, fine superstructure layout, light AA placements, shield details, paint values and internal arrangements still require further evidence.

Open the playable preset at `http://localhost:5175/?ship=baltimore` while the development server is running. The ship is identified as a United States heavy cruiser.
