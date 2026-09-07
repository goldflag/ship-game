# Merge validation — 2026-09-07

Resolved the merge of naval mechanics commit `167773c530f12be221f6738ac253ae2a48ad3c76`
into performance commit `80de1237b47fb09c53b245541cd84bdd714d058d`.

`AircraftView.ts` retains projected-size LOD, frustum culling, distant silhouettes
and fixed-node matrix caching alongside the incoming expandable aircraft batches
and payloads. Contacts are added once before the distant-model cutoff, and
diagnostics use the total contact count across GPU pages. The regression exercises
2,305 model instances and distant contacts, exceeding the previous global limit.

The automatic AA merge also needed the candidate filter to use `meanHullY`, as
the incoming firing check does. Its range regression now includes a two-meter
wave trough, ensuring wave heave does not disable an intact ship's AA targeting.

Validation:

- Aircraft view, expandable instances and AA candidate regressions: 9 tests pass,
  1,128 assertions.
- AA, obstruction, ballistics, drag solver, combat, naval mechanics, CPU sea,
  game frame, fleet wakes and combat effects: 98 tests pass, 85,057 assertions.
- `bun run build` passes through WSL, including `ship:check all`,
  `aircraft:check all`, TypeScript and Vite. The existing bundle-size advisory remains.
- Authoring inputs and generated ship assets match the incoming merge parent;
  asset checks request no rebuilds. Existing model evidence remains under its
  recorded hashes.

The FPS captures in this directory predate this naval-mechanics merge. They are
retained as historical measurements, not benchmarks of the combined version.
