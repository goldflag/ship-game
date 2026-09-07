# Weather owns sea conditions

Follow-up to the original battle-conditions picker, reviewed September 6, 2026 with Orca’s embedded WebGPU browser. Battle setup has two selectors: Time of day and Weather. The Graphics settings tab exposes Ocean detail and Render scale. The independent Sea conditions setting and saved preference are removed.

Weather recipes retain the current small-wave tuning and each map’s water multipliers:

| Weather | Amplitude multiplier | Wind speed | Peak wavelength |
| --- | --- | --- | --- |
| Clear / Fog | 0.09 | 5 | 12 m |
| Map default / Partly cloudy | 0.18 | 9 | 20 m |
| Overcast | 0.28 | 12 | 28 m |
| Storm clouds | 0.48 | 16 | 36 m |

The harbor retains amplitude 0.12, wind 4 and wavelength 14 m. Choppiness remains 0.55. These are artistic wave parameters, not measured wave heights or geographic weather data; CPU ship motion and combat rules stay separate.

- [Desktop setup](setup-desktop.png) and [compact setup](setup-mobile.png): two labeled controls; descriptions include sea strength. No dialog overflow at desktop or the compact viewport (427 CSS px wide at the browser’s current zoom).
- [Settings](settings.png): Graphics, Keybindings and Sound tabs; no Sea conditions control.
- [Storm launch transition](storm-loading.png): the loading summary displays Map daylight / Storm clouds. The screenshot includes the fading loading overlay over the running battle.

Live diagnostics verified a North Atlantic map-default launch used amplitude 0.18, wind 9 and wavelength 20 despite a seeded obsolete `sea: "Heavy"` preference in local storage. Selecting Storm clouds on the next launch changed those live wave uniforms to 0.48 / 16 / 36. Returning to port restored 0.12 / 4 / 14. The temporary old preference was removed after review.

Validation: `bun run build` passed (asset checks, TypeScript and Vite; existing large-bundle warning), and 43 tests passed across battle setup/simulation, land validation, fleet loading, game frame transitions and battle environments. The new regression covers all map multipliers, increasing wave strength across weather presets, obsolete settings being ignored, live wave uniforms and sheltered port restoration. `git diff --check` passed.
