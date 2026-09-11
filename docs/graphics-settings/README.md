# Graphics settings study

Design study for a configurable Graphics tab in the pause-menu settings dialog, prepared on September 8, 2026 after the custom-battle rendering optimizations, and implemented on September 10, 2026. The catalog below records what the renderer can expose; the [implementation](#implementation) section records what shipped and where it differs.

## Implementation

- `src/game/graphicsSettings.ts` owns the `GraphicsSettings` shape, the Low/Medium/High/Ultra presets, sanitizing, the `fleet-graphics-settings` storage key and a one-time migration of the legacy `bismarck-settings` tier and render scale. Diagnostics that still construct `Game` with `{ quality, resolution }` are migrated the same way.
- `Game.applyGraphics()` diffs the changed rows and touches only their subsystems: pixel ratio and `resize()`, the frame interval honored by `scheduleFrame()`, the display pipeline (none, FXAA or three's SMAA node over the same composited frame), `water.ssr.enabled`, `sky.setQualityLevel()` with the game's smaller reflection bake budget and god rays kept off, the sun shadow map size and normal bias (or `castShadow` off), the meshopt pixel budget passed to `FleetShipDraws.update()`, the wingspan thresholds in `AircraftView`, and an emission density on every `EffectParticlePool` plus the funnel smoke rate.
- The ocean tier and terrain density are read when the port loads (`Game.launchedGraphics` records them). In port the footer offers "Reload port to apply now"; after a battle, returning to port rebuilds the port automatically when either row changed.
- Telemetry carries a `performance` readout (mode, FPS, frame time, framebuffer size, backend and, in Detailed mode, ship draw, particle and aircraft counts) rendered by `PerformanceCounter` in the HUD and the port and by the dialog's head strip.
- Differences from the study: Clouds Ultra does not enable sun shafts, because the game keeps Sky Pro's god rays off for its exposure; the Combat effects row thins particle emission evenly through a fixed-stride sequence instead of per-effect counts, and leaves the impact-mark cap alone.

Open [index.html](index.html) in a browser for the interactive prototype. It draws the proposed dialog over a captured port frame, with all four tabs laid out in the wide format. Hash states select review captures: `#port` (default), `#custom`, `#battle,pending`, `#low`, `#ultra`, `#menu`, `#hud`, `#keys`, `#sound`. The frame-rate readout in the prototype is an illustrative model of relative cost; the real dialog reads renderer telemetry.

Review captures: [Graphics in port, High preset](desktop.png), [in battle with a pending ocean change](battle-pending.png), [Keybindings](keybindings.png), [HUD](hud.png) and [390 px wide](narrow.png).

## What the game exposed before

| Control | What it changes | Apply |
| --- | --- | --- |
| Ocean detail (Medium / High / Ultra) | Water Pro tier (surface segments 32/64/128, wave cascades 2/3/3, ripple grid 256/256/512, wake solver 256/512/1024, foam field 512/1024/2048, screen-space reflections off/on/on with 8/16/32 march steps), Sky Pro tier (Medium, or High at Ultra), sun shadow map 1024/2048/4096, harbor terrain 44/64 segments, harbor and island tree spacing, island terrain 320/512 segments | Recreates the whole `Game`, ending any battle |
| Render scale (65 / 80 / 100%) | `renderer.setPixelRatio(min(devicePixelRatio, 1.5) × scale)` | Same reload, although every consumer already handles `resize()` |

One tier drives seven unrelated subsystems, and both controls end the battle to apply. The HUD, Sound and Keybindings tabs already apply immediately, so the Graphics tab is the odd one out.

## Settings the renderer can support

Cost notes come from `docs/custom-battle-performance.md` and the subsystem code. "Live" means the value can change while a battle runs; "next launch" means the subsystem is built once per `Game` or per battle.

### Display

| Setting | Options | Code | Cost | Apply |
| --- | --- | --- | --- | --- |
| Render scale | 50–100% in 5% steps, showing the resulting framebuffer size | `Game.resize()` already threads pixel ratio into the renderer, Water Pro, Sky Pro and overlays | Largest single lever: water shading, cloud march and FXAA are per-pixel | Live (debounced while dragging) |
| Frame rate limit | Display refresh, 120, 60, 30 | `scheduleFrame()` skips `requestAnimationFrame` callbacks until the interval elapses; `frame()` already tolerates any `dt` up to 100 ms | Power and thermals rather than quality | Live |
| Anti-aliasing | Off, FXAA (current), SMAA | `RenderPipeline(renderer, fxaa(finalFrame))` in `Game.initialize()`; three r185 ships `SMAANode` and `TRAANode` beside `FXAANode` | FXAA is one full-screen pass; SMAA adds two more. TRAA conflicts with Sky Pro's temporal cloud reconstruction and is not proposed | Live: rebuild the final pipeline node and run one warmup frame |
| Upscaling | Off, FSR 1.0 | `FSR1Node` in three r185 could sharpen a reduced render scale to native size | Only worth it once render scale is live | Later |

### Sea and sky

| Setting | Options | Code | Cost | Apply |
| --- | --- | --- | --- | --- |
| Ocean simulation | Low, Medium, High, Ultra | Water Pro `QUALITY_LEVELS`; `WaterSystem.setQualityLevel()` exists but rebuilds the wave simulation, material, clipmap and wake, so `ShipWake`, `UnderwaterPassVisibility` and the buoyancy sampler must rebind | Cascade FFTs, clipmap vertices and wake dispatches scale with the tier | Next launch first; live later once the rebind path is proven. Low is a new tier (one cascade, 16 segments) for integrated GPUs |
| Water reflections | Sky only, Ships and sky | `water.ssr.enabled` is a live uniform; `stepCount` 16/32 follows the tier | Screen-space reflections march 16–32 steps per water pixel; the heaviest optional effect in a large fleet | Live |
| Clouds | Low, Medium, High, Ultra | `sky.setQualityLevel(level)`: history divisor 4/2/2/2, cloud shadow map 128–1024, environment bake 256–1024 px with 24–64 march steps. `cloudPass.sourceDiv` is also runtime-tunable | Volumetric cloud march is the other large per-pixel cost; the environment bake re-marches clouds every ninth frame | Live, with a short stall while weather and base-shape noise refill on the CPU (acceptable from a paused menu) |
| Sun shafts | Off, On | Construct `SkySystem` with `godRays: true` and drive `sky.godRays.enabled` | 16–24 march steps per pixel toward the sun | Live; folded into Clouds Ultra in the proposal |
| Shadows | Off, Low 1024, Medium 2048, High 4096 | `sunlight.shadow.mapSize`, `normalBias` (already proportional to texel size), `sunlight.castShadow`; dispose `shadow.map` to resize. `FleetVisibility` already checks `light.castShadow` | Every ship, harbor structure and tree draws again into the map; 4096² is costly on integrated GPUs | Live |
| Wave spray | Off, On | `water.spray` (WebGPU only; 32k/64k particles at High/Ultra); the sailing build disables it deliberately | GPU compute plus overdraw | Live; not proposed for the first version |

### Detail and effects

| Setting | Options | Code | Cost | Apply |
| --- | --- | --- | --- | --- |
| Ship and aircraft detail | Low, Medium, High, Full | `FleetShipDraws` selects meshopt levels by projected error against a 1.25/1.75 px budget; scale that budget (about 3 / 2 / 1.25 / 0.5 px). `AircraftView` switches LOD at 90 and 28 px wingspan; scale the same way | Triangle counts on the instanced fleet; the diagnostics already report reduced instances | Live |
| Terrain and vegetation | Medium, High | `createBattleLandscape` (320/512 segments, 20/13 m tree spacing) and `createHarborBackdrop` (44/64 segments, 23/16 m spacing) read the tier | Small; vegetation casts no shadows | Next launch (islands at battle start, harbor at port load) |
| Combat effects | Low, Medium, High | Add one emission multiplier read by `CombatEffects`, `ShipFunnelSmoke` and `LocalizedFireEffects` spawn sites (21 in `CombatEffects`), and scale `MAX_SHIP_IMPACT_MARKS` | CPU particle preparation and transparent overdraw; offscreen culling already exists | Live |
| Animated flags | Off, On | `FlagCloth` integrates visible flags at 60 Hz | Small CPU cost after the fleet flag simplification | Live; not proposed as a separate row |
| Texture filtering | 1×–16× anisotropy | Only the harbor meadow textures would benefit; ship surfaces use vertex colors | Negligible | Not proposed |

### Readouts

| Setting | Options | Code | Apply |
| --- | --- | --- | --- |
| Performance readout | Hidden, FPS, Detailed | The quiet FPS counter already sits beside the pause control. Detailed adds frame time, render size and the batch, instance, particle and aircraft counts that `Game.diagnostics()` already returns | Live |

## Proposed design

The prototype keeps the existing select, slider, keycap and button vocabulary but turns the 580 px portrait dialog into a landscape one: 1120 × 640 px on desktop, wider than it is tall, so every tab fits a 720p window without the dialog itself growing. The section tabs move onto the title row beside "Settings"; the footer carries the live status, the section's reset and Back to menu on one line. Graphics lays its groups out in three columns (Display; Sea and sky; Detail and effects with Readouts), each row a label with its control beside it and a one-line hint beneath. Keybindings puts Helm, Gunnery and View side by side and only the Gunnery column scrolls. HUD and Sound use two columns: controls on the left, guidance on the right, with a small preview of the instrument footprint at the chosen HUD scale. Below 1000 px wide the columns collapse to two, below 680 px to one, and the dialog returns to a scrolling portrait.

The reload button is replaced by three ideas.

1. **Live apply with a readout.** Every row saves and applies on change, like the other tabs. The head strip holds the quality preset rail on the left and an instrument-style readout (FPS, frame time, render size, backend) on the right so the player tunes by watching the number respond. Frames keep rendering while paused, so the readout is live in port and in battle.
2. **A preset rail with an honest Custom state.** Low, Medium, High and Ultra fill every row. Changing any row shows "Custom · from High" rather than silently keeping the preset lit. High reproduces today's High exactly, so existing saved settings migrate without a visible change.
3. **Next-launch rows are tagged, not modal.** Ocean simulation and Terrain carry a "Next battle" tag (in battle: "After battle"). When one is pending, the footer status names it and, in port, offers "Reload port to apply now" as a plain link. Nothing ends a battle without the player choosing it.

Each row shows a three-bar GPU cost meter so the heaviest levers (render scale, water reflections, clouds) are recognizable before touching them.

### Presets

| Row | Low | Medium | High (current High) | Ultra |
| --- | --- | --- | --- | --- |
| Render scale | 75% | 100% | 100% | 100% |
| Frame rate limit | Display | Display | Display | Display |
| Anti-aliasing | FXAA | FXAA | FXAA | SMAA |
| Ocean simulation | Low | Medium | High | Ultra |
| Water reflections | Sky only | Sky only | Ships and sky | Ships and sky |
| Clouds | Low | Medium | Medium | High |
| Shadows | Off | Low | Medium | High |
| Ship and aircraft detail | Low | Medium | High | Full |
| Terrain and vegetation | Medium | Medium | High | High |
| Combat effects | Low | Medium | High | High |
| Performance readout | FPS | FPS | FPS | FPS |

Medium matches today's Medium (ocean medium, sky medium, 1024 shadows, reflections off) and Ultra matches today's Ultra (ocean ultra, sky high, 4096 shadows) apart from the new SMAA and Full detail choices.

## Implementation notes

- Add `src/game/graphicsSettings.ts` following `hudSettings.ts`: a `GraphicsSettings` interface with the eleven fields above, `sanitizeGraphicsSettings`, `loadGraphicsSettings` and `PRESETS`. Migrate the saved `bismarck-settings` object: `quality` selects the matching preset and `resolution` becomes `renderScale`.
- Replace `GameSettings` with the new interface. `Game` keeps a `applyGraphics(next)` method that diffs against the current settings and touches only the changed subsystems: pixel ratio and `resize()`, frame interval, the final pipeline node, `water.ssr.enabled`, `sky.setQualityLevel`, the shadow map, the detail budgets and the effects multiplier. Ocean tier and terrain are stored and read at the next `Game` or battle construction.
- `App.tsx` stops recreating `Game` on settings changes and calls `applyGraphics` instead; the settings effect keys on the ocean and terrain fields only, and only in port.
- The dialog reads `fps` from telemetry and the render size and backend from the game, exactly as the port FPS counter does today.
- Warm the new anti-aliasing pipeline with one frame under the paused menu before swapping, following `warmupRendering()`.
- Keep `scripts/diagnostics/custom-battle-performance.html` reading the same settings so measurements can name a preset.
