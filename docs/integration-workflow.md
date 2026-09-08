# Integrating ship work

Run `bun run git:setup` once in the main checkout after cloning. It installs
repository-local settings shared by linked worktrees:

- `guns.json` merges by stable equipment ID. Independent additions and distinct
  fields of an existing entry merge; conflicting field edits, edit/delete pairs,
  incompatible additions and geometry-array changes remain conflicts.
- Git remembers reviewed resolutions (`rerere`), but does not stage them
  automatically. Inspect the diff and run the checks before staging a reused fix.
- Conflict markers include the common base (`zdiff3`).

The catalog driver never resolves model binaries or rewrites blueprint IDs.
Without setup, Git falls back to normal text merging. Install from the durable
main checkout: the driver config contains its absolute path so linked worktrees
can use it while replaying commits predating the script. Rerun setup if that
checkout moves. To remove it, unset `merge.ship-catalog.driver` with
`git config --local --unset merge.ship-catalog.driver`.

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

## During conflict resolution

Resolve blueprints, catalog entries and recipes first. Keep each stable joint and
socket ID. For `guns.json`, real conflicts are reported by catalog path; Git keeps
all three versions in the index even when the worktree file has no text markers.
Use `git show :1:assets/parts/guns.json` (base), `:2:` and `:3:` to review them.
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
Keep one import/property per line. Do not add another ship list to `package.json`
or a hard-coded preset count to the README. New per-ship documentation belongs
under `assets/ships/<id>/`; shared documentation should describe the workflow.

Shared compiler and recipe edits still require rebuilding affected assets.
