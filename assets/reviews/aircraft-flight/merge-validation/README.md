# Aircraft merge validation

The aircraft changes were integrated with remote master `382c848` (including Fletcher) on 2026-09-06. No authoring inputs or generated models were changed by this integration.

- Full simulation, ship, game, schematic and aircraft-pipeline suite: **521 passed**, zero failures (`bun test src/simulation src/ships src/game src/schematic scripts/aircraft --timeout 30000`).
- `bun run build`: passed all fleet/aircraft asset checks, TypeScript and production compilation. Existing bundle-size warning remains.
- The aircraft load-failure fixture now creates its rejected promise when invoked, after ship loading. This avoids the timing-sensitive mocked rejection seen while validating the separate local-master integration. The six Game tests passed again after this test-only adjustment; runtime code was unchanged after the full suite/build.

Visibility, depth occlusion and faster launch measurements remain in [visibility-launch](../visibility-launch/README.md). Those measurements precede integration with the separately maintained local wing-folding update.
