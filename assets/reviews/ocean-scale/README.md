# Ocean scale comparison

Open [the comparison](index.html) for matching port and Atlantic views, side by side or with a draggable divider.

Captured September 5, 2026 in Orca's embedded browser using the actual Game WebGPU renderer at 1600 × 900, High quality, Bismarck, seed 1. The original tuning comes from revision `43662adaeaf924337eb9a8ded487644883557596`. Unedited canvas captures omit game instruments.

| Condition | Amplitude before → after | Peak wavelength before → after | Wind |
| --- | --- | --- | --- |
| Port | 0.18 → 0.12 | 65 → 14 m | 4 |
| Fair | 0.35 → 0.22 | 65 → 20 m | 5 |
| Atlantic | 0.75 → 0.45 | 65 → 28 m | 9 |
| Heavy | 1.4 → 0.95 | 100 → 50 m | 16 |

Choppiness changes from 1.05 to 0.8. Amplitude is a multiplier, not meters. Fair and Heavy are parameter checks; the image pairs show Port and Atlantic.

`capture.py` runs against the existing `/scripts/diagnostics/harbor.html` page in the current Orca browser tab after it reports Ready. Run it from the repository root. It pauses the game, stops automatic frame scheduling, snaps the normal port/chase camera and applies each tuning in turn. Each variant explicitly rebuilds the spectrum at ocean tick 3600, then renders 32 paused frames to settle temporal reflections before capturing a complete Game frame. Both images in each pair share their camera, ship pose, seed and animation time. Temporal sky/reflection reconstruction can retain small differences. The original settings are explicitly refreshed too, so the comparison isolates the intended wave tuning rather than a stale port spectrum after departure.

Source changes also mark the spectrum dirty on sea transitions: Water Pro requires this to apply wind and wavelength changes. GPU waves remain visual only; CPU combat poses and ship assets are unchanged.

Validation: 333 existing simulation/game tests passed; production build passed. Port/Fair/Atlantic/Heavy and return-to-port parameter restoration were checked in the actual renderer.
