# USS Enterprise (CV-6), June 1942

Original reconstruction targeting the Battle of Midway configuration, before the
1943 hull bulges and enlarged flight deck. **Historical accuracy is in progress,
not certified at 100%.** See the [discrepancy register](reports/discrepancies.md).

[Fidelity 01](reports/fidelity-01/README.md) records the shared cambered deck and
elevator surfaces, open hangars, supported galleries, island and deck fittings,
complete structural coverage, qualified protection, twelve matched views and
current WebGPU checks. Reference review in port opens the portable pack.

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
bun run ship:compare enterprise-cv6
bun run ship:independence enterprise-cv6
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
Reapply the [fidelity migration and deck-surface authoring](../fleet-fidelity/README.md)
after regenerating that initial input; do not overwrite the current fidelity
blueprint unintentionally. The raw contract offsets are not silently presented
as a final 1942 as-built survey.

The retained source has separate gun yaw/elevation/recoil/muzzle nodes, three
elevator lift datums, a radar pivot, four propeller pivots, a rudder pivot,
crane datums and hidden simulation volumes. Gun articulation is implemented
in the existing renderer-free combat simulation. This ship-detail pass does not
change flight operations or add elevator, propeller, crane or radar controls;
the newer master aircraft work remains outside its scope.

`reports/dimensions.json` measures actual exported vertices and triangle
intersections independently of declared dimensions. It records source-specific
differences, including the distinction between molded and outside-plating beam.
The earlier `reports/runtime-articulation.json` retains its own build context;
`reports/fidelity-01/runtime/review.json` records the current export through
twelve full traverse/elevation/recoil combinations and actual UI battery/reset
checks. These are engineering checks; historical evidence is tracked separately.

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
