# Working in scripts

| Directory | Holds |
| --- | --- |
| `tests/` | `run.ts` (the `bun run test` runner and `known-failures.json` ledger), `check.ts` (`bun run check`), and `*-browser.*` modules that export `check…` functions for `ship:browser:check` |
| `browser/` | The account-free harness driver (`harness.ts`), `ui:shot` (`shot.ts`) and the saved-design cache (`designs.ts`). See [browser verification](../docs/browser-verification.md) |
| `diagnostics/` | Standalone pages and measurement scripts. `app.html` is the harness page; most others are one-off studies and may be stale |
| `construction/` | Construction authoring CLI, review server and `check-browser.ts` |
| `ships/`, `parts/`, `aircraft/` | The asset pipelines behind `ship:*`, `part:*` and `aircraft:*` |
| `multiplayer/` | Simulation content, WASM build, Rust toolchain lookup (`toolchain.ts`; cargo is not on PATH), type and definition generators |
| `build/` | Vite plugins, `bootstrap.ts`, per-worktree dev port |

- Do not add a Playwright launcher or a temporary diagnostics page for a UI check. Use or extend `browser/harness.ts`.
- Scripts write to ignored `.build/`, never to `assets/` or `docs/`.
- `tsconfig.construction.json` typechecks `construction/`, `browser/` and the harness page; other scripts are
  typechecked only when listed there, so add a new script directory to it.
