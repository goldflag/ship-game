# PR conflict resolution: LFS-aware comparison records

Integrated master `c7b213a2d3c666a26525854f741c4f8be4809e7d` into PR #50.
The only conflicts were six generated comparison `build.json` records. The source
merge preserves the aircraft resting-pose repair while adding master's asset URL
handling. Current ship models, compiled definitions, original recipes and the
preserved Bismarck baseline are unchanged by this integration.

`ship:check all` identified stale comparison records for Bismarck, Yamato,
King George V, Baltimore, Enterprise and Type VIIC. All six were regenerated with
`bun run ship:compare <id>` and local Blender 5.2.0 LTS using the merged pipeline.
Only the build records are tracked; rendered comparison output and served review
pages follow master's ignore rules. No content hash was edited to accept stale
output, and no ship rebuild was necessary.

The Git LFS history rewrite changed the verifier's baseline commit and the Git
representation of four archival binaries. The corresponding baseline is now
`37abc50684cd4e850a862e029e380df1d9a6297f`. All ten original model files and all
eight preserved Bismarck baseline files have identical content across the rewrite,
including comparison of LFS pointer oids with original and hydrated file SHA-256.
`baseline-lfs-migration.json` records those checks.

Validation:

- All six comparison-generation commands passed.
- `bun run test`: **709 passed, 0 failed across 99 files**, 16,248 ms (eight workers).
- `bun run build`: passed all eleven ship checks, aircraft checks, TypeScript and
  the production bundle. The existing large-chunk advisory remains.
- `python3 assets/ships/attachment-audit/verify.py`: passed for the original ten
  ships, retained source/model/image hashes, node IDs, 50 fixed views, 120 runtime
  poses and 78 open-component cases. Existing captures remain valid because the
  model and authoring inputs did not change; no new model inspection is claimed.
- `git diff --check`: passed; no unresolved paths remain.

Full test/build output and per-ship comparison logs are retained beside this
report as `merge-c7b213a2-*.txt`. Historical interpretation limits and the separately
documented King George V contact candidates remain unchanged.
