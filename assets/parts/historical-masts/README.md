# Historical mast packages

Twelve original, fixed mast assemblies for Shipbuilder. `geometry.py` builds them
through the registered construction library and shared paint materials. No
reference mesh, texture, UV, source vertex, or published assembly is an authoring
input. GameModels3D is the sole visual source; the dates below are resource labels,
not independent certification of a historical refit.

The additions fill gaps beyond the existing Fletcher, Baltimore, Bismarck,
Yukikaze and KGV adaptations: fighting tops, early tripods, US cage masts, a narrow
French lattice, an Italian tubular tower and postwar radar packages. Bridge
superstructures, funnels, cranes and separately mounted weapons are excluded.

## Sources and scope

Each link is the inspected vehicle page. Full resource paths, fitted radar
resources, selected A/AB scheme components and source geometry checksums are in
[`catalog-reference-extractions.json`](../../../tools/ship-overlay/catalog-reference-extractions.json).
“Exact” in the viewer's source register identifies the selected visual resource;
it does not claim that the original result duplicates every fitting.

| Stable part ID | Source / labeled fit | Assembly | Triangles | Budget |
| --- | --- | --- | ---: | ---: |
| `mikasa-1905-foremast` | [Mikasa / 1905](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pjsb011) | Pole foremast, two fighting tops | 2,256 | 4,000 |
| `dreadnought-1906-foremast` | [Dreadnought / 1906](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb503) | Tripod foremast and spotting top | 2,596 | 4,000 |
| `michigan-1916-cage-mainmast` | [South Carolina page / Michigan 1916 resource](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasb001) | After cage mast | 5,028 | 8,000 |
| `gangut-1918-foremast` | [Gangut / 1918](https://gamemodels3d.com/en/games/worldofwarships/vehicles/prsb104) | Upper pole foremast and lookout | 2,400 | 4,000 |
| `hood-1941-mainmast` | [Hood / 1941](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pbsb507) | Tripod mainmast and signal platform | 2,296 | 4,000 |
| `scharnhorst-1939-mainmast` | [Scharnhorst / 1939 resource](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsb507) | Mainmast, signal deck and yards | 3,028 | 4,000 |
| `roma-1943-mainmast` | [Roma / 1943](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pisb508) | Tubular mainmast and signal drum | 1,996 | 4,000 |
| `arizona-1941-mainmast` | [Arizona / 1941](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasb506) | After tripod spotting mast | 3,944 | 6,000 |
| `colorado-1945-cage-foremast` | [Colorado / 1945](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasb008) | Upper cage, spotting top, CXAM/SG/Mk3 | 7,236 | 8,000 |
| `halland-1955-foremast` | [Halland / 1955](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pwsd110) | Radar pole foremast, Type 293Q/974 shapes | 2,412 | 4,000 |
| `friesland-1956-foremast` | [Friesland / 1956](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pwsd510) | Upper foremast, DA-01 and aerials | 2,092 | 4,000 |
| `le-fantasque-1943-foremast` | [Le Fantasque / 1943](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pfsd108) | Narrow lattice, SF dome and SA reflector | 1,922 | 4,000 |

Michigan is an explicitly uncertain variant match: the page and mesh names name
different sister ships. It is labeled Michigan here and `close` in the reference
register. The other fit dates also come from resource filenames, not historical
plans. Do not infer an exact real-world refit from those filenames.

Existing non-Fletcher mast comparators were 4,540–7,360 triangles; Fletcher was
420. New pole/tripod packages target at most 4,000, the larger Arizona package
6,000, and the two densely braced cages 8,000. These are per-component mesh totals,
not per material. The recipes use low-sided rods and shared materials, without
extra textures or modeled fasteners that do not affect the useful silhouette.

## Attachment and reuse

Authoring axes are +X forward, +Y port, +Z up, in metres. The shared exporter makes
the single runtime conversion `(-Y, Z, -X)`. Each component has a stable
`component.root` and `component.socket.<id>` nodes. These are fixed structures:
radars and director-like fittings are visual shapes, without moving joints,
weapon, detection, power, or balance capabilities.

The primary `attachment` socket is on an actual sole. Tripods and the Friesland
brace package expose the other feet as `support-*` sockets. Cages expose four
points on their annular foundation; their primary socket deliberately is not at
the empty ring center. Le Fantasque uses one lattice foot plus its other three
feet. The installation must support **all** feet/rings, not merely the primary
snap point. Gangut, Colorado and Friesland begin above the bridge roof: the
installation supplies that roof and supporting structure. Michigan starts at
its cage ring rather than incidental neighboring deck fittings in the crop.

`construction.json` records the measured exported bounds with a small rounding
margin. The normal mast AABB is its conservative collision envelope, including
platforms and yards. It intentionally does not allow another part through an
open cage. There are no below-deck occupancy volumes. Mass and CG are explicit
provisional package estimates, not measured historical engineering data. No
existing ship or capability rating is changed by these additions.

Use `bun run part:inputs <id>` for original source dependencies and
`bun run part:build <id>` for a clean preview. Publish through `part:publish` and
`part:thumbnails`; never reuse downloaded comparison GLBs as build inputs.

## Visual basis and remaining limitations

Front, side, rear, top and quarter views were inspected at a common metric scale
for each source/result pair, with no independent resizing. The original Blender
scene and exported GLB were reviewed after corrections. Blender MCP's scene query
failed to connect in this session; local Blender and inspected renders supplied
the same before/after loop. Temporary comparisons belong in ignored `.build/`.

These are simplified reusable visual adaptations and retain `unreviewed` status
for historical-fidelity acceptance. Principal mast heights, spread, platform
levels, bracing and fitted radar families were prioritized. Remaining differences:

- Mikasa and Dreadnought omit small spotting instruments, signal baskets and some
  fighting-top internals; the Dreadnought top is a simplified enclosure.
- Michigan's cage uses a regular crossed-tube construction, simplified wing
  galleries and spotting-top outline; the page/resource identity remains uncertain.
- Gangut's lookout fittings and Hood's signal-platform edge shape/yard rigging
  are simplified. Ship-mounted fittings near their bases are not included.
- Scharnhorst omits the dense parallel signal halyards and small signal hardware;
  its platform edge profiles are approximate.
- Roma's platform is a faceted interpretation of the source's curved outline;
  fine horn, drum and access details are simplified.
- Arizona and Colorado use chamfered spotting houses instead of all source
  curvature and window divisions. Their platform perimeter and truss detail
  remain approximate; no separate searchlights or weapons are included.
- Halland's navigation radar is a simplified box and its aerial fittings are
  reduced. Friesland's DA-01 support/reflector and upper aerials are simplified.
- Le Fantasque's lattice and SA reflector retain fewer members and a chamfered
  rim; the SF radome uses a low-sided cap.

Source crops can contain disconnected neighboring fittings and source rigging
that belongs to the ship. Such fragments are context, not a requirement to add
floating geometry to a reusable package. Fine seams, bolts, loose cables and
external stays are generally omitted. These limitations prevent claiming an
exact reconstruction. Per-installation moving-neighbor clearance still requires
review, even though the mast itself has no articulation.

Rebuild one viewing reference with:

```sh
BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender \
  python3 scripts/parts/extract-comparison-equipment.py --part mikasa-1905-foremast
```

The source selector retains whole islands inside its documented crop, plus the
Mikasa main pole and named fitted radars. Checksum changes require reinspection.
`schemeComponents` pins the inspected A/AB fit and avoids mixing later upgrades.
Only ignored geometry-only reference GLBs are produced; no source textures are
fetched. The model viewer's component-comparison page reads these files.
