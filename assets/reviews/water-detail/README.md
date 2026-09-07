# Distant water detail — 2026-09-07

At 24×, the water around a stationary Bismarck 5 km away became nearly a solid
blue patch. Disabling fog did not restore it (Atlantic fog starts at 8 km).
Moving the detailed water mesh to the target did not restore it either.
Bypassing mip filtering exposed small ripple marks but left the flat shading.
Those experimental changes are not retained.

Water Pro's Fresnel shader clamped the incident cosine to at least **0.05**
and bent reflection normals to that angle. At a 29 m eye height, even flat
water at 5 km has a cosine of only **0.0058**. Many different distant wave
slopes therefore received identical reflectance. Reducing the positive guard
to **0.0001** restores their lighting differences. The matching orthogonal
component is derived from the guard to keep the corrected normal normalized.
Wave simulation, quality settings, normal-map filtering, haze and mesh budgets
are unchanged. The normal filtering and weather still soften distant water;
the small-wave sea state does not produce individually resolved crests at
every range and viewing angle.

- [Before, Medium, 5 km / 24×](before.png)
- [After, Medium, 5 km / 24×](after.png)
- [After, High, 5 km / 24×](high-after.png)
- [After, High, 20 km / 32×](high-20km-32x.png)
- [After, Medium, normal 1× view](medium-1x.png)

These are unedited 1920 × 1080 game-canvas captures on WebGPU. The fixture
uses the real Game renderer, ocean, sky and ship model, seed 1, Atlantic map
default conditions and a fixed ocean tick. The images expose water shading
without the binocular overlay. No model geometry was changed.

## Repeatable regression

Run `bun run dev` and open `/scripts/diagnostics/water-detail.html`.
`window.waterDetailResult.passed` must be true. `?quality=medium` selects
Medium; the default is High. `?webgl=1` requests the real WebGL fallback.
`?legacy=1` reinstates the retired clamp and must fail the grazing response
check. Private Game fields are accessed only in this development fixture.

The GPU test evaluates the production Fresnel shader at shallow incident
cosines of 0.003, 0.01 and 0.03. Before the fix all three produced red-channel
values of **186**. After the fix they produce **250, 239, 211**. Steeper
angles retain their **136, 14, 5** values. The extended test also checks a
20 km sight angle, the horizon, and a back-facing slope: reflection normals
must remain finite, normalized and facing the eye. See the [original failing
check](before-check.json), [Medium result](after-check.json), [High result](high-check.json),
and [legacy negative control](legacy-check.json).

`waterReview.prepare(range, magnification)` sets a stationary view (defaults
5,000 m and 24×); `await waterReview.still()` renders and returns its PNG.
Query parameters `range` and `zoom` set the initial view. Manual frames advance
Three.js's node clock, allowing repeatable captures in background browser tabs.

Validation: the GPU test failed before the patch and passed afterward on
Medium and High. All 95 relevant camera, game/frame, underwater visibility,
ballistics and combat tests passed. `bun run build` passed with the existing
bundle-size warning. WebGL full-scene verification did not complete: the fallback
remained at initial ocean shader compilation during the review. The shared
shader's verified backend is WebGPU. The fresh checkout lacked KGV's ignored comparison ZIP;
its original archive was restored from a matching local checkout and verified
against the recorded hash. No ship authoring or generated ship changes remain.
