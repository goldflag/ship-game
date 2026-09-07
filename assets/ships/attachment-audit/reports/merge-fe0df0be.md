# PR #50 integration with carrier combat

Integrated master `fe0df0be0020d6cea3492f9436a7750f89031e7e` (PR #46), preserving
the attachment repairs and CPU aircraft resting pose alongside squadron commands,
carrier follow controls, accuracy calibration and the new AA combat behavior.

Bismarck's repaired foundations, carriages, recoil collars and magazine supports
now use the upstream AA joint hierarchy. All 236 upstream node IDs survive,
covering 38 mounts and 64 barrel chains. Blender parenting snapshots transforms
once per mount and computes each child's local matrix, avoiding a full dependency
graph rebuild for every fitting. The original per-fitting approach was stopped
after repeated whole-scene updates dominated a native process sample; the batched
recipe completed authoring and passed the actual export/pivot checks.

Only Bismarck required a model rebuild. The checker identified stale comparison
packages for Yamato, Baltimore, Enterprise and Type VIIC; those were regenerated
from their unchanged models. Earlier Bismarck evidence remains under its original
hash in `prior-bismarck-5b0621b5851d/`.

Validation:

- `bun test --timeout 30000`: **691 pass, 0 fail**, across 97 files.
- `bun run build`: every registered ship check, aircraft checks, TypeScript and
  production bundling pass. Vite retains its existing large-chunk advisory.
- Bismarck's five fixed views and three runtime close-ups were inspected. All
  twelve articulation poses pass; maximum muzzle error is 2.17 mm. Its evaluated
  mesh contact scan reports zero detached candidate islands.
- All 78 open-gun component poses pass for the current 13-part catalog.
- `verify.py` passes against all ten repaired ships' current model/source hashes,
  50 fixed views, 120 runtime poses and all 78 component poses.
- `git diff --check` passes. The preserved Bismarck baseline is untouched.

See `bismarck-aa-integration.json`, `verification.json`,
`merge-fe0df0be-tests.txt` and `merge-fe0df0be-build.txt` for retained results.
These checks do not close the historical approximations in the discrepancy
registers.
