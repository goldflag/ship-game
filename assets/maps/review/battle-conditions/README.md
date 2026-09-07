# Battle conditions review

Reviewed September 6, 2026 through Orca’s embedded Chromium browser using the actual WebGPU game at `http://localhost:5279`. Original conditions are authored in `assets/maps/battle-conditions.v1.json`; no ship models changed.

- [Desktop setup](setup-desktop.png): three aligned native selectors, descriptions, existing naval styling. Controls measure 44 px high.
- [Mobile setup](setup-mobile.png): 390 × 844 CSS viewport, stacked selectors with no dialog overflow. Dusk / Overcast appears in the launch briefing.
- [Dusk / Overcast](dusk-overcast.png): low western light, dense cloud, readable ship and instruments. Captured before the lunar fog addition, which has no effect in daylight.
- [Night / Clear](night-clear.png): fixed sun at −28°, low ambient fill, dark sky and visible sea/hull silhouette. Captured after the lunar fog correction. No star panorama is installed.
- [Noon / Fog](noon-fog.png): high sun with thick clouds and distance haze; the opposing ship at 5 km is obscured. HUD labels remain visible because weather does not change CPU targeting or contact rules.

In-game diagnostics confirmed selected conditions reached the live uniforms: Dusk / Overcast (sun 3°, cloud coverage 0.82, fog end 13,000 m), Night / Clear (−28°, 0.02, 28,000 m), Noon / Fog (70°, 0.65, 4,500 m). Returning from dusk and night restored the harbor (sun 36° / azimuth 58°, intensity 5, ambient 1.1, cloud coverage 0.38, cloud wind 12, fog end 5,600 m). Reopening setup retained selections.

Validation:

- `bun run build` passed, including ship/aircraft checks, TypeScript and production bundling. Vite reports the existing large game bundle warning.
- `bun test src/game/BattleEnvironment.test.ts src/game/Game.test.ts`: 8 passed. Covers all map/time/weather combinations, input validation, live Sky Pro uniforms and its real SunDriver, frozen lighting, port restoration and fleet setup propagation.
- `bun test src/simulation`: 344 passed; the existing Yamato wing-space flooding test exceeded its default 5-second limit. Running that test alone with `--timeout 30000` passed in 10.6 seconds. No simulation rules changed.
- `git diff --check` passed.

The browser logged `copyFramebufferToTexture` depth-format messages (`depth32float` / `depth24plus`) during the WebGPU review. Their origin was not isolated in this change; screenshots and scene transitions rendered, but this is not a clean renderer-console validation. Weather is visual only; Storm clouds has no rain or lightning, and these fixed lighting presets are artistic settings rather than geographic solar calculations.
