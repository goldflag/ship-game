# Working on this game

A Three.js/React client, one Rust simulation (native server and WASM worker) and a Blender/blueprint asset
pipeline. Read the row for your task, then the nested `AGENTS.md` in the directory you are changing.

## Code map

| Path | Owns |
| --- | --- |
| `crates/naval-sim` | The only simulation: battle tick, ships, weapons, damage, flooding, aviation, bots, PvE, the construction compiler. See [crates/AGENTS.md](crates/AGENTS.md) |
| `crates/naval-protocol`, `naval-wasm`, `naval-server` | Wire types (exported to `src/multiplayer/generated`), the browser worker build, the multiplayer server |
| `src/game` | Rendering and the `Game` facade: camera, ship views, effects, audio; `src/game/session` talks to the simulation. The game requires WebGPU (`src/game/webgpu.ts`) |
| `src/game/ocean` | The game's own ocean behind the `Ocean` facade (`game.ocean`): waves, surface, wake field, fog, reflections, underwater view. See [its README](src/game/ocean/README.md) |
| `src/game/sky` | The game's own sky behind the `SkyApi` facade (`game.sky`): atmosphere, sun, moon, stars, clouds, cloud shadows, shafts, rain and lightning, the sea's environment. See [its README](src/game/sky/README.md) |
| `src/game/audio.ts`, `src/game/GameAudio.ts`, `assets/audio/naval` | Sound: cue ids, combat-event cues and saved volumes (`audio.ts`); the Web Audio player that reads CPU events and poses (`GameAudio.ts`). Originals, prompts (`recipe.json`) and processing notes are in [assets/audio/naval/README.md](assets/audio/naval/README.md); `bun run audio:build` (Python 3 with FFmpeg or `afconvert`) writes `public/audio/naval` |
| `src/ui` | React HUD, port (`Garage.tsx`), battle dialogs (`battle/`), fleet command (`fleet/`), shared controls (`components/`). See [src/ui/AGENTS.md](src/ui/AGENTS.md) |
| `src/ui/shipbuilding` | The ship editor. See [its guide](src/ui/shipbuilding/AGENTS.md) |
| `src/progression` | Research trees, unlock rules and battle XP (three files shared with the accounts API) and the browser progress store. See [research progression](docs/progression.md) |
| `src/admin` | The admin page at `/admin` (players, roles, research grants), loaded without the game. See [accounts](docs/accounts.md#administrators) |
| `src/ships` | Blueprint and construction types, presets roster, design storage (IndexedDB and account cloud), local compile client |
| `src/simulation` | Retired TypeScript simulation kept only as test fixtures. Do not extend it; gameplay lives in `crates/naval-sim` |
| `services` | Accounts API, design storage, compile service (Bun, PostgreSQL) |
| `scripts` | Pipelines (`ships`, `parts`, `aircraft`, `construction`), test runner and browser checks (`tests`), browser harness (`browser`), diagnostics pages. See [scripts/AGENTS.md](scripts/AGENTS.md) |
| `assets` | Authoring inputs: blueprints, Blender recipes, parts. See [assets/AGENTS.md](assets/AGENTS.md) |
| `vendor/threejs-sky-pro` | The licensed Sky Pro bundle the game's sky replaced, kept only as a comparison behind Graphics `skyRenderer` (`src/game/comparison/SkyProSky.ts`), and its [patch record](vendor/threejs-sky-pro/PATCHES.md). Never read or grep its compiled `build/index.js` |
| `vendor/threejs-water-pro` | The licensed Water Pro ocean the game's ocean replaced, kept only as a comparison behind Graphics `oceanRenderer` (`src/game/comparison/WaterProOcean.ts`). Never read or grep its compiled `build/index.js`, even though its [patch record](vendor/threejs-water-pro/PATCHES.md) describes old hand edits; use the `.d.ts` files. See [its README](vendor/threejs-water-pro/README.md) |
| `public/models`, `src/generated`, `src/multiplayer/generated` | Build outputs. Never edit by hand |

## Read by task

| Task | Start here |
| --- | --- |
| Ship editor UI | [src/ui/shipbuilding/AGENTS.md](src/ui/shipbuilding/AGENTS.md), then [its README](src/ui/shipbuilding/README.md); data model in [shipbuilding](docs/shipbuilding.md) |
| HUD, port, battle dialogs, fleet command UI | [src/ui/AGENTS.md](src/ui/AGENTS.md), [DESIGN.md](DESIGN.md) quick reference, [shared controls](src/ui/components/README.md) |
| Rendering, camera, `Game.ts` | [README architecture](README.md#architecture), [ocean guide](docs/ocean-configuration.md), [ocean design](src/game/ocean/README.md), [sky design](src/game/sky/README.md) |
| Simulation, combat, bots, carrier operations | [crates/AGENTS.md](crates/AGENTS.md), then [air operations](docs/air-operations.md), [bot behavior](docs/bot-behavior.md) or [maneuvering](docs/maneuvering.md) |
| Aiming, gun laying, gun-aim circles | [Gunnery aim path](docs/gunnery.md): the sight, the input, the Rust mount and the drawn circle, with cadences and units |
| Research trees, XP, unlocks, locked ships | [Research progression](docs/progression.md) |
| A field crossing Rust and TypeScript (definitions, frames, commands) | The checklists in [crates/AGENTS.md](crates/AGENTS.md) |
| Multiplayer server, accounts, deployment | [Rust multiplayer](docs/rust-multiplayer-implementation.md), [accounts](docs/accounts.md), [deployment](docs/deployment.md) |
| See a UI or battle change in the real game | [Browser verification](docs/browser-verification.md): account-free harness, `bun run ui:shot`, saved custom designs |
| Script a battle, direct its camera, or make a video of it | [Films](docs/film.md): manual clock, directed orders for either side, camera rigs, `bun run film` |
| Build or refit a construction ship as an agent | [Agent construction authoring](docs/construction-authoring.md): `ship:summary`, guarded `ship:apply` batches, `ship:place`, `ship:view`, `ship:blender-import`/`ship:blender-export` (Blender as a front end that proposes batches), or the `ship-construction` MCP server |
| New ship, ship model, parts, aircraft, paint | [assets/AGENTS.md](assets/AGENTS.md), then the [ship pipeline](docs/ship-pipeline.md) |
| A premade ship "using the Blender pipeline", or a realism pass on one | [Blender-recipe presets](docs/ship-pipeline.md#blender-recipe-presets) |
| Merge, rebase or independent worktree | [Integration workflow](docs/integration-workflow.md) before starting |
| Anything else | The [documentation map](docs/README.md). `docs/archive/` is history, not guidance |

## Commands

| Command | Use |
| --- | --- |
| `bun run bootstrap` | First thing in a fresh worktree: install, simulation content and dev WASM, `.env.local` |
| `bun run check` | While iterating: incremental typecheck plus only the tests your diff affects. `--all` for every test |
| `bun run test` | Every TypeScript test, quiet. `bun test <file>` runs one file with full output |
| `bun run master:red` | What master's latest completed CI run fails, TypeScript and cargo tests, with the run's link |
| `bun run ship:browser:check -- --only <name>` | One editor browser check; `--list` shows them |
| `bun run ui:shot -- --state port\|editor\|battle` | A screenshot of the real game, no account needed |
| `bun run film -- <name>` | Film a staged battle shot by shot (`scripts/film/films/`); `--stills` to review camera work. See [films](docs/film.md) |
| `bun run dev` | Dev server. The URL is printed and written to `.build/dev-server.json`; each worktree has its own port |
| `bun run multiplayer:check` | Rust clippy and tests plus protocol checks (slow; CI runs it) |
| `bun run build` | The release gate. Run once before a PR, not to confirm a small change |
| `bun run ship:check all` | Which published ship outputs are stale; rebuild only those |

## Invariants

- Keep simulation renderer-free. CPU simulation owns combat poses, firing, hits, modules and flooding; GPU ocean samples are visual-only.
- Extend the existing naval instrument styling. Keep the ship and sea visible and damage feedback inspectable.
- Use one versioned blueprint/definition format for historical presets and future player-built ships.
- Generated files (`public/models`, `src/generated`, `src/multiplayer/generated`, `crates/naval-sim/src/definition.rs`) change through their generators, never by hand.
- Temporary output, captures, logs and downloads go in ignored `.build/`. Do not commit review evidence, `reports/` or `references/` directories.
- Searches skip data and build outputs (see `.ignore`). To search a blueprint or published model, name the file: `rg pattern assets/ships/<id>/blueprint.json`.
- Asset, model, paint and reference rules, and the four model acceptance checks, are in [assets/AGENTS.md](assets/AGENTS.md). They bind any change to ship models or combat geometry.

## Validation and integration

- `bun run test` and `bun run ship:browser:check` report only failures that are not in their [known-red ledgers](docs/browser-verification.md#known-red-tests-and-checks); do not re-prove a listed failure against master. `bun run check` and `bun run test` also skip failures that master's latest CI run has; for a cargo test, `bun run master:red` lists what master's CI fails (a few seconds).
- Iterate with `bun run check`; run relevant simulation tests and `bun run build` once before the PR. Model changes also require `ship:build`, fixed review views and articulation in-game. Rebuild affected assets after shared recipe changes; follow the pipeline's validation matrix.
- Start independent tasks from current remote master in separate worktrees. Only one integrator may mutate the main checkout; check for already-integrated patches before replaying commits.
- In a linked worktree, read [its git traps](docs/integration-workflow.md#in-a-worktree) first: `git switch -c <branch> origin/master`, never `git checkout master`, three-dot diffs, `git push -u origin HEAD`.
- Run `bun run git:setup` from the durable main checkout once per clone for ID-aware catalog merging and remembered resolutions with manual staging.
- Resolve authoring inputs first, run `bun run ship:check all`, and rebuild only stale outputs it identifies. Never automatically choose a binary side or rewrite hashes to bypass checks.
- To sign in to the game's test account (for example, to open the owner's saved custom designs), read `NAVAL_TEST_EMAIL` and `NAVAL_TEST_PASSWORD` from the gitignored `.env.local` in the main checkout (`git worktree list | head -1`); copy it into a new worktree if needed. Never commit, print into docs, or paste these values into PRs or artifacts.
- Keep the runtime roster in `src/ships/presets.ts`, one entry per line. Do not duplicate the roster in `package.json` or hard-code preset counts in shared prose.
