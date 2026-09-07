# PR #50 conflict resolution

Integrated master `b2fe6f2d12b50f924dc1d3c81d91524f88927a80`.
The only conflict was `src/game/BattleEnvironment.test.ts`: retain master's
speed-and-direction fixtures for combat effects and funnel smoke, including
the corresponding assertions. Ship authoring inputs and model outputs are
unchanged by this merge.

Validation:

- 91 tests pass across nine affected game/simulation test files, with a 20-second
  timeout. Coverage includes weather, effects, camera/input, HUD, game loading,
  aircraft resting/folding poses, submarines and bots.
- `bun run build` passes every registered ship check, aircraft checks, TypeScript
  and the production bundle. The existing large-chunk advisory remains.
- `git diff --check` passes.

The repository cleanup omitted 701 duplicate review files while the checker still
expects local copies. For validation, they were restored from retained sources
and checked against the comparison manifests' SHA-256 values, then removed
again. No model rebuild or regenerated review output is included in this merge.
