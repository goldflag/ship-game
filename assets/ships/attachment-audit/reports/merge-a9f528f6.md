# PR #50 integration with repository cleanup

Integrated master `a9f528f6043659b44311b7fcee73fc424712ee0e`, including PR #54.
The comparison records and page conflicts were regenerated with `ship:compare`
for Bismarck, Yamato, Baltimore, Enterprise, Type VIIC and King George V.
The original ship recipes, published models and joint IDs are unchanged.

The regenerated records exclude obsolete review ZIPs and duplicate GLBs. Old
local ZIPs were moved outside the checkout before regeneration. Master's
updated `ship:check` validates retained files and publishes missing served copies
under the ignored `public/ship-reference/` directory. This replaces the temporary
copy restoration described in the preceding merge record.

Validation:

- 92 tests pass across ten affected game/simulation/preset test files, with a
  20-second timeout, including the HTTP checks for every port review link.
- `bun run build` passes every registered ship check, aircraft checks, TypeScript
  and the production bundle. Vite retains its existing large-chunk advisory.
- The attachment audit still verifies ten repaired ships, 50 fixed views, 120
  runtime articulation poses and 60 open-gun component poses against their
  unchanged model/source hashes.
- `git diff --check` passes.
