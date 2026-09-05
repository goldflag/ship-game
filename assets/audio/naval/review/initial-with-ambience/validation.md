# Initial audio validation — superseded by removal of ambience

This retained report describes the original 17-clip iteration, before the owner requested removal of all ambient playback. See the current validation report in the parent directory.

- All 17 ElevenLabs MCP generations succeeded; originals and prompts retained.
- All processed assets decode through the actual browser AudioContext: 17 loaded, no failed assets, four ambience sources. PCM peak/RMS values and hashes are in `build.json`.
- `bun test`: **107 passed, 0 failed**, including six new audio tests covering mount grouping, caliber routing, duplicate plate-impact suppression, independent magazine detonations, stale/reset events, camera-relative stereo, saved-setting validation and asset provenance/hashes. Existing simulation/frame-rate tests pass unchanged.
- `bun run build`: passed all four ship checks, TypeScript and production bundling. No ship geometry was changed.
- Browser review ran on this worktree at `http://localhost:5198/` using Orca. Ports 5173/5174 were already serving other local contexts and were not used for final validation.
- Actual game flow: loaded port, opened Sound settings, previewed gunfire, muted, checked disabled previews and persisted settings, changed master from 65% to 42% without resetting the scene, restored defaults, departed, changed engine order, fired eight shells (four mount booms), paused and returned to port. Browser evidence is retained in `browser-check.json`; it records live AudioContext states and source counts, not a subjective listening verdict. That short sailing run observed shots; impact event routing is covered by unit tests.
- Dispatched blur/focus events suspended/resumed the real AudioContext. This verifies the event handlers; native background-tab behavior still merits a human listening pass. Orca's background automation did not consistently focus the page, so browser click commands were supplemented with DOM/input event dispatch for reliable flow checks.
- Desktop Settings screenshot: `sound-desktop.png`, 1280 × 800, muted state. At a requested 390 × 844 viewport, DOM measurements showed a 352 × 812 dialog at (19, 16), 314 px sliders and no horizontal overflow. Orca returned a stale desktop compositor frame for mobile screenshot requests, so there is no mobile pixel approval.
- Independent Settings review: **resolved, no outstanding material findings**. The reviewer found that output elements could capture the implicit volume labels. Matching `htmlFor` / range `id` values now associate all four labels correctly; browser `label.control` checks confirmed each range. The semantic fix did not change the screenshot's appearance.
- Design detector reported only advisories for existing Settings colors/type sizes (the added 14 px label matches incumbent rows). No design system changes were needed for this local extension.

The palette is ready for in-game listening and creative tuning. Checks establish generation provenance, decodability, level headroom, event routing and lifecycle behavior; they do not certify historical acoustics or substitute for listening on the player's output device.
