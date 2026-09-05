# USS Enterprise (CV-6), June 1942

Original reconstruction targeting the Battle of Midway configuration, before the
1943 hull bulges and enlarged flight deck. **Historical accuracy is in progress,
not certified at 100%.** See the [discrepancy register](reports/discrepancies.md).

The [reference and method audit](reports/reconstruction-method.md) links the
drawings and dated photos, explains the fitting work, and separates measured
anchors from inferred shapes and unfinished comparisons.

The model is authored in meters with the reference waterline at runtime Y=0,
bow -Z and starboard +X. The declared loading datum is a 25 ft 11½ in draft
(7.9121 m); this is a reference full-load condition, not a documented sounding
for a particular hour of the battle. Hull length refers to the steel hull,
not the longer after flight-deck projection. `hull.beam` is the maximum modeled
hull envelope at the main/forecastle decks, not waterline beam.

```sh
bun run ship:compile enterprise-cv6
bun run ship:build enterprise-cv6
bun run ship:check enterprise-cv6
bun run ship:review enterprise-cv6
python3 assets/ships/enterprise-cv6/authoring/measure_export.py
```

Open the game with `?ship=enterprise-cv6`. The preset has eight single 5-inch,
four quadruple 1.1-inch and thirty single 20 mm mounts. A blueprint bridge
viewpoint places the bridge camera on the starboard island.

`blueprint.json` is the editable, versioned ship definition. The per-ship
`build.py` consumes its loft sections, polygons and component placements. The
shared component catalog contains the US open mounts. No commercial game
geometry or textures are used. All generated geometry is independently authored.

`authoring/hull-offsets.csv` records a selected transcription of C&R 189522.
`authoring/generate_blueprint.py` creates the initial blueprint from that
transcription and dimensional anchors. Run it explicitly when revising the
transcription; it replaces the blueprint and is not invoked during ship builds.
Subsequent direct blueprint edits should be reflected in the generator before
regenerating. The raw contract offsets are not silently presented as a final
1942 as-built survey.

The retained source has separate gun yaw/elevation/recoil/muzzle nodes, three
elevator lift datums, a radar pivot, four propeller pivots, a rudder pivot,
crane datums and hidden simulation volumes. Gun articulation is implemented
in the existing renderer-free combat simulation. Flight operations and controls
for elevator, propeller, crane and radar motion are not implemented.

`reports/dimensions.json` measures actual exported vertices and triangle
intersections independently of declared dimensions. It records source-specific
differences, including the distinction between molded and outside-plating beam.
`reports/runtime-articulation.json` records the loaded WebGPU model through
18 combinations of full traverse, elevation and recoil. These are engineering
checks; the discrepancy register tracks historical evidence separately.

In the development port, `window.shipTrialArticulation({trainFraction: 1,
elevationFraction: 1, recoilFraction: 1})` previews catalog joint limits on the
loaded ship. Use `window.shipTrialArticulation(null)` to restore the original
pose. Launching automatically restores it; the hook is unavailable in production.

References remain under `references/`, outside the served `public/` directory.
The source register identifies the originating Navy document and the digital
host. The scan host requests links instead of redistribution of its original
files on websites or social media. These retained copies are local research
material; do not publish them as game art.

Authoring was performed with local headless Blender. No Blender MCP tools were
exposed in this session.
