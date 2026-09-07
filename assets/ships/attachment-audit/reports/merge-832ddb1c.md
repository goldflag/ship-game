# PR conflict resolution: localized damage and current master

Integrated master `716c34f787ceaf658a2fe425da73e100f5a2ab45`, then
`832ddb1c484667c50c07c2a7d54877206b1d1097`, into PR #50.

The merged blueprints retain localized structural damage, generator/director
modules and fire profiles together with the repaired equipment positions.
Discrepancy registers retain both sets of documented approximations. Generated
conflicts were resolved by rebuilding all eleven presets from the merged sources;
no model hash was edited to accept an older export. The subsequent battle setup
and test-runner changes merge without conflicts and do not change these inputs.

## Validation

- `bun run ship:build <id>` and `bun run ship:review <id>` pass for all eleven
  registered presets, using local Blender 5.2.0 LTS.
- All 55 fixed views and 20 current in-game close-ups were visually inspected.
  All 132 articulation poses pass; maximum CPU/rendered muzzle difference is
  2.75 mm. Current runtime evidence uses an isolated headless Chrome/Metal session.
- `python3 assets/ships/attachment-audit/verify.py` passes for the original ten:
  current model, source and image hashes; stable node IDs; 120 runtime poses;
  50 fixed views; and all 78 open-component cases. The component inputs did not
  change after their successful carrier-integration run.
- Nine original ships have zero contact candidates. Yamato retains only the
  59 previously documented chain, coating and vision-slit groups.
- Bismarck retains all 236 upstream node IDs for 38 mounts. King George V retains
  all 114 IDs, with five fixed views and twelve poses checked separately. Its
  212 additional contact candidates remain untriaged outside the ten-ship repair
  scope; see `pr-integration.json`.
- Enterprise's three detail captures explicitly identify the 12-plane deck-slot
  fixture. The CPU owns those poses; normal startup still hides hangar aircraft.
- Fletcher's authored comparison images and legacy review page were regenerated
  from its current export and matching runtime capture.
- `bun run test`: **708 passed, 0 failed, 98 files**, 17,557 ms with eight workers.
- `bun run build`: **passed**, including all eleven ship checks, aircraft checks,
  TypeScript and the production bundle. The existing large-chunk advisory remains.
- `git diff --check`: passed. Bismarck's preserved baseline is unchanged.

Build/review/contact output is retained under `merge-832ddb1c-builds/`; full test,
production-build and runtime output are in the adjacent `merge-832ddb1c-*.txt`
files. Previous model evidence remains labeled under
`prior-damage-integration-504e58a7/`. Export and contact checks do not certify
historical accuracy; dated source registers and discrepancy reports still apply.
