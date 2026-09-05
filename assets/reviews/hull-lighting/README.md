# Hull shadow banding — 2026-09-05

The reported diagonal stripes reproduce on Yamato in port at Medium quality
through the actual Three.js WebGPU game renderer. Disabling the sunlight's
shadows removes the stripes; the hull geometry and material remain the same.

The 760 m shadow frustum covers about 0.742 m per texel at 1024px. The fixed
0.1 m normal bias was insufficient for filtered self-shadowing on the hull.
`Game.ts` now uses a normal bias of 0.75 shadow texels in world meters, scaling
down with higher quality. Cast and received shadows remain enabled. The
inherited depth bias, shadow resolutions, lighting and ship assets are unchanged.

| Capture | Normal bias (m) | Hull band RMS | Result |
| --- | ---: | ---: | --- |
| [Medium, original](medium-before.png) | 0.100 | 1.646 | Reproduced / check fails |
| [Medium, fixed](medium-after.png) | 0.557 | 0.149 | Pass |
| [High, fixed](high-after.png) | 0.278 | 0.132 | Pass |
| [Ultra, fixed](ultra-after.png) | 0.139 | 0.132 | Pass |

The original setting was restored temporarily in the browser to confirm the
regression check fails. Each fixed-quality check then used a fresh page load
with the production setting. JSON alongside the images records the backend,
shadow settings, model hash and measured result. Captures were also inspected
visually for a clean hull and retained shadows beneath the deck fittings.

## Repeat the check

Run `bun run dev`, open an Orca browser page at
`/scripts/diagnostics/harbor.html?ship=yamato&quality=medium`, then run:

```sh
python3 scripts/tests/hull-shadows.py <browser-page-id>
```

Requires Pillow and the Orca CLI. Repeat with `quality=high` and `quality=ultra`.
The existing harbor diagnostic supplies the real scene and serialized canvas
capture. The test fixes the canvas to 1200 × 720 at pixel ratio 1 and camera to
`(275, 8, 6)`, looking at `(240, 3, 0)`. It measures horizontal brightness
variation on bare hull below the portholes and above the water, removing broad
gradients with a 91-pixel moving average. RMS must be below 0.6 in 8-bit RGB
units. This view-specific rendering check is separate from simulation tests;
material or model changes may require reviewing its sample region.

Validation: 101 simulation/ship/game/schematic tests pass; `bun run build` passes,
including all four preset asset checks. WebGPU was checked; WebGL fallback was
not exercised. No modeling recipe or generated ship asset changed.

After integrating master at `45392d0`, all 122 tests and `bun run build` pass.
The Medium WebGPU check was repeated with the merged renderer: RMS 0.149,
with the refreshed capture retained above.
