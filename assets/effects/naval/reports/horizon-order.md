# Firing smoke and horizon visibility — 2026-09-06

Firing smoke now fades over 4.5–6 seconds, down from 9–12. Initial size, expansion, ignition and cooling are retained; the existing fade and breakup curves run over the shorter lifetime. Other smoke recipes retain their own lifetimes.

The missing horizontal band was ocean overdraw. Three r185's `RenderList.sort` reverses the complete draw list for reversed depth, including explicit render/group priorities. Water Pro's transparent ocean has render order -30 and combat particles use 0, so the ocean was drawn after nearby smoke and spray. Bypassing smoke depth sampling and fog did not remove the band; hiding the ocean did. Correcting the draw order removed it.

`configureRenderOrder` compensates for this reversal while preserving depth sorting and stable ties. It runs after renderer initialization, leaving standard-depth backends on default sorting. Both opaque and transparent lists retain authored priorities. The regression exercises the installed RenderList implementation so an engine upgrade that changes this behavior is detectable. No vendor files are modified.

The reversed-depth GPU check also exposed disappearing gas when the camera was inside a volume: its full-screen bounding plane was exactly at far clip depth. It now uses mid-clip depth in both depth modes. Scene-depth clipping still determines actual volume visibility.

## Runtime evidence

Captures use the actual Game, CPU-fired guns, ocean, sky and final composition, at 1920 × 1080 with WebGPU and Medium quality. The 20 km cases use Pacific lighting/fog on the review ocean, with apparent ship size held constant by the review camera. Natural distance haze remains. Each before/after pair changes only renderer sorting; both use the shorter smoke recipe.

- Smoke: [before](../review/smoke-horizon-order-before.png), [after](../review/smoke-horizon-order-after.png).
- Water impact: [before](../review/splash-horizon-order-before.png), [after](../review/splash-horizon-order-after.png).
- Initial 5 km reproduction: [before](../review/horizon-range-before.png), [after](../review/horizon-range-after.png), covering both the lifetime and sorting changes.
- [GPU and horizon measurements](horizon-order-checks.json). Each image has adjacent camera/combat metadata.

The 38-row horizon check compares the same paused frame with the tested volume batch visible and hidden. With Pacific lighting/fog, minimum smoke contribution is 0.413 at 5 km and 0.084 at 20 km; splash contribution is 0.355 and 0.120. All exceed the 0.02 threshold. North Atlantic's fixed 5 km smoke view measures 0.226; its 16 km fog limit obscures the entire ship at 20 km, so it is not a useful far-range fixture. This comparison confirms visible contributions in the real composition; the isolated water-overdraw test below provides the strict failing control.

The isolated WebGPU test passes all six views for smoke and water volumes with both standard and reversed depth. Distant transparent water preserves every visible volume pixel (15,102 for smoke; 15,075 for water); an opaque foreground blocker leaves zero pixels. Disabling the sort correction makes this regression fail: water erases 7,072 of the 15,102 smoke pixels. Oblique views, camera-inside views and reset pass. A real salvo has 24 smoke lobes at 0.35, 1 and 4 seconds, and zero at 6 seconds. The full WebGL2 ocean composition was not separately validated; the previously recorded WebGL2 depth-copy limitation remains outside this check.

Validation: `bun test --timeout 30000 src/simulation src/game` passes 405 tests and 203,461 assertions. Four expensive simulation cases exceeded Bun's default five-second timeout on the first run; all pass with the larger limit. `bun run build` passes asset checks, TypeScript and Vite, with the existing bundle-size advisory.

## Repeat

Open `/scripts/diagnostics/combat-effects.html` on this checkout's Vite server and wait for `window.reviewReady`. The review renders explicit frames to avoid stale post-process textures in background tabs.

```js
const checks = await import('/scripts/tests/combat-effects-browser.ts');
await checks.checkCombatSmokeHorizon(review);
// User's lighting/fog for the 20 km review; diagnostic-only fields.
review.game.simulation.mapId = 'pacific-islands';
review.game.updatePortLighting();
for (const range of [5000, 20000]) {
  await checks.checkCombatSmokeHorizon(review, range);
  await checks.checkCombatSmokeHorizon(review, range, true); // splash
}
for (const reversed of [false, true]) for (const smoke of [true, false]) {
  await checks.checkCombatVolumeRendering(false, reversed, smoke);
}
```
