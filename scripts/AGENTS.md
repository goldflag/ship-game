# Working in scripts

| Directory | Holds |
| --- | --- |
| `tests/` | `run.ts` (the `bun run test` runner and `known-failures.json` ledger), `check.ts` (`bun run check`) with its test selection (`affected.ts`), and `*-browser.*` modules that export `check…` functions for `ship:browser:check` |
| `browser/` | The account-free harness driver (`harness.ts`), `ui:shot` (`shot.ts`) and the saved-design cache (`designs.ts`). See [browser verification](../docs/browser-verification.md) |
| `diagnostics/` | Standalone pages and measurement scripts. `app.html` is the harness page; most others are one-off studies and may be stale |
| `construction/` | Construction authoring CLI, review server and `check-browser.ts` |
| `ships/`, `parts/`, `aircraft/` | The asset pipelines behind `ship:*`, `part:*` and `aircraft:*` |
| `multiplayer/` | Simulation content and WASM build (`prepare.ts` runs both), `multiplayer:check`, Rust toolchain lookup (`toolchain.ts`; cargo is not on PATH), type and definition generators |
| `build/` | Vite plugins, `bootstrap.ts`, `dev.ts` (`bun run dev`) and the per-worktree dev port, `release.ts` (`bun run build`) on the keep-going step runner (`steps.ts`), the not-bootstrapped guard (`ready.ts`) |

- Do not add a Playwright launcher or a temporary diagnostics page for a UI check. Use or extend `browser/harness.ts`.
- Scripts write to ignored `.build/`, never to `assets/` or `docs/`.
- `tsconfig.construction.json` typechecks `construction/`, `browser/` and the harness page; other scripts are
  typechecked only when listed there, so add a new script directory to it.
- Under `bun run`, `Bun.which` finds node_modules/.bin first; filter PATH when you want a system tool (`systemTool` in
  `multiplayer/toolchain.ts` does).

## Runners

- `bun run check` runs a test when it changed, sits beside a changed module under the same stem, reaches a changed file
  through imports (transitively, including `import()`, `new URL(…, import.meta.url)` and `?raw`/`?url` imports, but not
  `import type`) or by a repository path it reads, or scans the repository (`SCANNERS` in `tests/affected.ts`: the
  line-width, tracked-evidence and Water Pro isolation tests; add a new scanning test there). It prints the rule behind
  each selection. `package.json`, `bun.lock`, tsconfigs, `vite.config.ts`, `tests/run.ts` and `crates/` select every test.
- `check`, `test`, `dev` and `build` stop at once with "Worktree not bootstrapped" when node_modules lacks a dependency.
  Test failures name `scripts/tests/known-failures.json` and say which of them it lists.
- `bun run build` and `bun run multiplayer:check` run every step even after one fails; only simulation content or
  preparation, which the rest read, stops them. Each step prints its status and seconds, a failing step the tail of its
  log, and a summary ends the run; the exit status is non-zero if any step failed. Logs are in `.build/release/` and
  `.build/multiplayer-check/`; `--verbose` (or `CI`) streams the output instead.
- `multiplayer:prepare[:dev]` announces a WASM rebuild when cargo starts compiling, and says when it replaces a release
  build or a module it did not write (each output directory records what it holds in `build.json`). Build A/B variants
  outside the game's module: `bun scripts/multiplayer/build-wasm.ts --out-dir .build/wasm-simd --rustflags '-C
  target-feature=+simd128'`. Extra RUSTFLAGS get their own `.build/wasm-target/<hash>` cargo cache unless `--target-dir`
  names one, and only the default output writes `src/generated/naval-version.json`.
- `bun run dev` writes `.build/dev-server.json` at once with `status: "preparing"`; wait for `status: "ready"` before
  reading `url`. The record is removed when the server stops.
- A stale legacy ship in `ship:check` names the stage whose inputs changed (definition fields, geometry recipe inputs or
  the export recipe); `build.json` keeps one hash per stage, not per file.
