# Published audio validation — 2026-09-05

The game publishes 13 one-shot sounds. Harbor, ocean, wind and engine ambience is excluded from the runtime catalog, public assets, audio graph and Settings dialog. The original recordings and prompts remain archived under `assets/` with `publish: false`.

- `bun run audio:build`: rebuilt the selected clips and removed the four excluded WAV files. The published manifest contains 13 clips, all with `loop: false`.
- `bun test`: **122 passed, 0 failed**. Audio coverage includes event routing/deduplication, resets, spatial mixing, obsolete saved-setting fields, source/output hashes and absence of excluded runtime files. Existing simulation tests also pass.
- `bun run build`: passed all ship asset checks, TypeScript and production bundling.
- Browser review at `http://localhost:5198/`: actual AudioContext loaded all 13 sounds with no failures. UI clicks played successfully; after their tails ended, port had zero active sources. Runtime and published manifest IDs matched exactly. Legacy saved `ambience` values were discarded.
- Sound settings expose exactly Master volume, Guns & impacts, and Controls & instruments, plus mute and preview controls. Each visible slider label remains explicitly associated with its range input.

The earlier generation and browser evidence lives in `initial-with-ambience/` and describes the superseded 17-clip iteration. Sound design remains an artistic approximation, not historical acoustic certification.

The final branch includes the current custom-battle implementation from master. Audio resets when fleets are replaced or returned to port; target selection retains event tracking. The full 122-test suite and production build passed after resolving the integration.
