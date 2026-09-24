# Integrating ship work

Run `bun run git:setup` once in the main checkout after cloning. It installs
repository-local settings shared by linked worktrees:

- Ship blueprints (`assets/ships/*/blueprint.json`), the parts catalogs (`guns.json`, `library.json`,
  `construction.json`, `construction-library.json`) and the two generated ship tables
  (`src/ships/presetCatalog.json`, `assets/gameplay/hydrostatics.v1.json`) merge by record. A list whose
  entries all carry a unique `id` (or `partId`) merges entry by entry at any depth: mounts, structures,
  compartments, catalog parts, library components. Independent additions, deletions of unchanged entries and
  distinct fields of one entry combine, and a new entry lands beside the neighbour it had on its own side.
  Conflicting field edits, edit/delete pairs, incompatible additions, changes on both sides to a list without
  IDs (hull sections, vertices, positions) and two different reorderings remain conflicts, with base-aware
  line markers. The driver rewrites a file in its own exact style (two-space JSON with Python or JavaScript
  number lexemes and escaping, or the generated one-record-per-line layout); a file it cannot reproduce
  byte-for-byte falls back to Git's line merge.
- Git remembers reviewed resolutions (`rerere`), but does not stage them
  automatically. Inspect the diff and run the checks before staging a reused fix.
- Conflict markers include the common base (`zdiff3`).

The driver never resolves model binaries, hashes or build outputs, and never rewrites blueprint IDs. A
construction blueprint changed on both sides still conflicts at its `revision`. Without setup, Git falls back
to normal text merging. Install from the durable main checkout: the driver config contains its absolute path
so linked worktrees can use it while replaying commits predating the script, and every worktree runs the
main checkout's copy, so keep that checkout current. Rerun setup if it moves. To remove it, unset
`merge.ship-catalog.driver` with `git config --local --unset merge.ship-catalog.driver`.

## Before starting or integrating work

1. Fetch the current remote: `git fetch origin`.
2. Check `git status` and `git log --left-right --cherry-mark --oneline HEAD...origin/master`.
   Complete an existing merge/rebase before beginning another. Equivalent patches
   marked `=` may already be integrated; inspect them before replaying a branch.
3. Start independent work from current `origin/master`. In Orca, use its worktree
   command with the repository's default base, and keep each task in its own
   checkout. Never run two integration operations in the main checkout at once.
4. Assign one integrator to update the main checkout. Workers hand over source
   commits; they do not independently rebase or rewrite the shared main branch.

Do not rebase a shared branch behind another active worker. Fetch again before
integration and check whether the source commits have already landed.

## In a worktree

Linked worktrees share one repository: branches, `origin/*` and the stash are common to every
checkout, and each branch should be checked out in only one of them. Checked on 2026-09-23 with
Apple git 2.39.3 and bun 1.3.3.

- **Start a branch with `git switch -c <branch> origin/master`.** Never `git checkout master`:
  the main checkout holds `master`, so git refuses with `fatal: 'master' is already checked out`
  and leaves you on your feature branch. One session hid that stderr, and its next
  `git pull --ff-only origin master` fast-forwarded the feature branch instead of `master`.
- **Never `git checkout -B <name>` a branch another worktree has checked out.** Git 2.39 does not
  refuse: it silently resets that branch under the other worktree, whose commits are then reachable
  only from the reflog and whose index shows their changes as staged.
- **Diff with three dots: `git diff origin/master...HEAD`.** Another worktree's `git fetch` moves
  `origin/master` under you; the two-dot form then shows everything that landed since you branched,
  reversed, as if your branch deleted it. Three dots compare against the merge base.
- **Push the branch you are on, whatever its name.** Orca can rename a worktree's branch after you
  create it. Use `git push -u origin HEAD` and
  `gh pr create --base master --head "$(git branch --show-current)"`.
- **Bootstrap before type-checking.** Without `node_modules`, `bunx tsc` downloads and runs the
  newest TypeScript (7.0.2 on 2026-09-23) instead of the pinned 5.8, so its errors are not the
  project's. Run `bun run bootstrap` (it installs with `--frozen-lockfile`) and use
  `bun run typecheck` or `bun run check`. If `bun.lock` ever shows as modified, restore it rather
  than commit it.
- **A conflict in `assets/ships/<id>/generated/build.json`: never hand-pick a hash.** Take either
  side, run `bun run ship:build <id>`, then `bun run ship:check <id>`, and commit what the build
  wrote.
- **Never use bare `git stash`.** The stash is shared, so `git stash pop` can take another
  session's entry. Prefer a temporary commit.

## During conflict resolution

Resolve blueprints, catalog entries and recipes first. Keep each stable joint and
socket ID. For the record-merged files, the driver prints each real conflict's record path
(`Conflicting edits at $.mounts[main-2].position`) and leaves line markers; when the lines themselves merge
but the records conflict (two edits to one ID-less list), the file stays conflicted without markers. Git keeps
all three versions in the index either way: `git show :1:<path>` (base), `:2:` and `:3:`.
During a rebase, "ours" is the updated destination and "theirs" is the replayed
commit—not necessarily the branch you originally authored.

Generated GLBs, Blender scenes and thumbnails are retained build outputs.
Ship reference archives and comparison pages are retired. Diagnostics stay in ignored `.build/`; they are not merge inputs.
These outputs are not independently editable merge sources. Keep a coherent candidate set,
then validate it against the resolved authoring inputs. Do not use an automatic
"ours" driver for them: that would hide stale or mismatched assets.

Run `bun run ship:check all`. It uses the runtime preset roster and reports every
failing ship instead of stopping at the first. Apply the narrow repair requested
by the checker:

- Stale compiled definition/model: `bun run ship:build <id>`.
- Stale thumbnail only: `bun run ship:thumbnail <id>`.
- Stale construction fixed views only: `bun run ship:review <id>`.

Build after source integration, and have one integration owner produce the final
outputs. Avoid rebuilding unchanged ships in multiple branches just to refresh
images. Never edit a content hash to make an old artifact pass. Do not commit old model
snapshots or recreate report/reference archives during integration.

Run relevant simulation tests and `bun run build` after publication completes.
Do not run model-loading tests while a build is publishing those same models.
Follow the ship pipeline's fixed-view and in-game review requirements for geometry
changes. Commit refreshed assets; summarize validation in the task response or PR description.

## Keeping additions local

`src/ships/presets.ts` is the runtime roster and the source for `ship:check all`.
Keep one `preset(id)` property per line. `src/ships/presetCatalog.json` and
`assets/gameplay/hydrostatics.v1.json` hold one ship per line, each after its own key line, so rebuilds of
different ships merge (Git needs an unchanged line between two changes), and the driver merges them by ship.
A merged record is only as current as its ship's published definition: after resolving the roster and
definitions, rerun `bun run ship:hydrostatics` and `bun run multiplayer:content` when either ship changed on
both sides, and validate with `bun run ship:runtime:check`.
Do not resolve generated metadata independently of those inputs.
Do not add another ship list to `package.json`
or a hard-coded preset count to the README. New per-ship documentation belongs
under `assets/ships/<id>/`; shared documentation should describe the workflow.

Construction presets separate build freshness from published content identity.
An unrelated native/compiler edit or a comment/type-only recipe edit should leave
published assets unchanged after checking. Actual recipe changes still require
validation/export; byte-identical results retain their content identity. Image
presentation changes do not invalidate the model. See the [construction build
contract](construction-authoring.md#build-and-publish).

Keep source edits and generated publication in separate commits when practical.
Workers still build and inspect their changes locally. The integrator combines
source changes first, runs the fleet checker and applies its narrow repairs, then
regenerates runtime metadata once. Do not replay obsolete generated-output commits
on top of a newly validated combined build. Git does not enforce the single-owner
rule; coordinate ownership before integration.

Shared compiler and recipe edits still require rebuilding affected assets.
