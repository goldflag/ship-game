# Custom battle performance harness

`scripts/diagnostics/custom-battle-performance.html` (logic in `custom-battle-performance.js`) loads
the real application, clicks through the battle setup dialog and runs a custom battle on the real
`LocalBattleSession` Rust/WASM worker. It measures frame intervals from the first battle frame, so
startup stalls count. The player does not move or fire. The page is a Vite build input, so it works
under both `bun run dev` and `bun run preview`. The roster is substituted at `prepareBattle`: the
same list on both sides (first ship is the player), 5 km spawn, `north-atlantic`, noon, 9 m/s wind.

| Query parameter | Meaning |
| --- | --- |
| `seconds` | sample length, default 60 |
| `quality` | graphics preset id, default `high`; render scale is always 100% |
| `roster` | comma-separated preset ids; default is seven ships with one carrier |
| `profile` | main-thread phase and render-pass timings; the runner also collects worker timings |
| `profileAfter` | seconds of uninstrumented battle before `profile` instrumentation starts |
| `bundles=0` | disable fleet render-bundle command caching (native instancing stays) |

Larger target roster (15 ships and two carriers per side; also the `custom` scenario in
`crates/naval-wasm/examples/pve_speed.rs`, so keep the two in step):

```text
bismarck,yamato,king-george-v,baltimore,fletcher,flower-corvette,bismarck,yamato,king-george-v,baltimore,fletcher,baltimore,fletcher,enterprise-cv6,shokaku
```

## Run

```sh
bun run build && bun run preview --port 5318   # measure production bundles; then, in another shell:
PERFORMANCE_URL='http://localhost:5318/scripts/diagnostics/custom-battle-performance.html?seconds=60' \
  node scripts/diagnostics/measure-custom-battle.mjs <label>
```

`measure-custom-battle.mjs` launches installed Chrome (`channel: 'chrome'`, headless, WebGPU
enabled, background throttling disabled) at 1280 × 720 with device scale 1.5 (1920 × 1080
framebuffer) and pins the worker seed. Without `PERFORMANCE_URL` it targets `localhost:5173`.
`PLAYWRIGHT_MODULE` may point at another `playwright-core/index.mjs`; the repo's own is the default.
Output goes to ignored `.build/custom-battle/`: `<label>.json` (result, per-frame rows, pipeline
creations, worker timings, browser version, CPU concurrency, WebGPU adapter, page errors) and
`<label>.png`. Environment switches (the `_AFTER` ones run after the FPS sample):

| Variable | Adds |
| --- | --- |
| `CPU_PROFILE=1` | CPU profile during the sample; slows the WASM worker, so not an FPS run |
| `CPU_PROFILE_AFTER=1` | eight-second CPU profile after it (`<label>.cpuprofile`); prefer this |
| `GPU_PROFILE_AFTER=1` | render/compute timestamp queries over 30 frames, where supported |
| `UPLOAD_PROFILE_AFTER=1` | `GPUQueue.writeBuffer` calls, bytes and ms per buffer label over 60 frames |
| `SUBMISSION_PROFILE_AFTER=1` | per-object draw submission cost; nested passes are inclusive, do not sum |
| `LAYOUT_PROFILE_AFTER=1`, `REFLECTION_PROFILE_AFTER=1`, `PARTICLE_CULL_PROFILE_AFTER=1` | A/B of label layout batching, the ocean's screen-space ship reflections (High and Ultra) and particle culling |
| `VISUAL_REVIEW=1` | ship, aircraft, distant and 24× captures plus maximum muzzle error |

## Read the results

`result.total` and `result.windows` (ten-second windows) give `fps`, `p50`/`p95`/`p99`/`max` frame
interval in ms, `over50`/`over100` counts and mean `work` ms. `result.tick / 60` is simulated
seconds: compare it with wall time, because a battle that falls behind is not a valid way to reach
a frame rate. Judge by the late windows, not the average; busy combat is slower than the opening.
Also check `framebuffer`, `hidden` (must be false) and `errors`.

## Caveats

- Run-to-run machine variation has been as large as the changes under test. Pair each candidate
  with an unchanged control and keep other CPU/GPU jobs idle.
- Instrumented and dev-server runs are not comparable to production runs, and a component saving
  (uploads, particle preparation) is not an FPS gain until a paired run shows it.
- Worker-only cost: `scripts/diagnostics/custom-battle-worker-bench.ts`, or the native harness in
  [simulation performance](sim-performance-plan.md).

Dated measurements and experiments: [archived log](archive/custom-battle-performance-log.md).
