# Custom battle performance

Use `scripts/diagnostics/custom-battle-performance.html` for the actual application
and `LocalBattleSession` Rust worker. The older fleet harnesses use the TypeScript
simulation fixture and cannot measure local worker snapshot costs.

The harness starts a symmetric mixed fleet with a carrier on each team, normal
bots, High graphics and full resolution. It records the first minute after battle
graphics are ready, including startup stalls, with ten-second windows. The player
does not move or fire; bots run normally. Query parameters: `seconds`, `quality`,
comma-separated `roster` (first ship is the player), and optional `profile` for
instrumented phase/render-pass timings. The setup dialog is automated; the actual
roster is substituted at `prepareBattle`.

## Reproduce on Windows

Build with `bun run build`, then run `bun run preview --port 5318`. Install
`playwright-core` in a temporary tools directory, or provide an existing module.
The runner uses installed Chrome with an isolated profile, a 1280 × 720 viewport,
device scale 1.5 (1920 × 1080 framebuffer), and a fixed Rust seed.

```powershell
$env:PLAYWRIGHT_MODULE = 'C:/path/to/tools/node_modules/playwright-core/index.mjs'
$env:PERFORMANCE_URL = 'http://localhost:5318/scripts/diagnostics/custom-battle-performance.html?seconds=60'
node scripts/diagnostics/measure-custom-battle.mjs sample
```

JSON frame samples and a final screenshot go to ignored `.build/custom-battle/`.
Results also record the installed Chrome version, reported CPU concurrency and
the WebGPU adapter used to create the game's device, where exposed by Chrome.
`CPU_PROFILE=1` adds a Chrome CPU profile; `VISUAL_REVIEW=1` captures ship, airborne
aircraft, distant and magnified views after measurement. `FORCE_WEBGL=1` exercises
the fallback renderer. Keep profiling and other CPU/GPU jobs off during paired FPS
measurements; instrumented development runs are not comparable to production.

Prefer `CPU_PROFILE_AFTER=1` when diagnosing main-thread work: it profiles eight
additional seconds after the FPS sample, because Chrome's CPU profiler can
substantially slow the WASM worker. `GPU_PROFILE_AFTER=1` samples render/compute
timestamps after the FPS sample when the device supports timestamp queries.
These GPU timings exclude CPU submission and presentation overhead.
The `profile` URL parameter also records worker tick execution, JSON serialization,
decoding/normalization and delta generation separately. Compare simulation time
advanced with wall time as well as FPS; a battle falling behind is not a valid
way to reach the target frame rate.

For the larger performance target, use this roster on each side (15 ships and
two carriers per team) with the same High quality and full resolution:

```text
bismarck,yamato,king-george-v,baltimore,fletcher,flower-corvette,bismarck,yamato,king-george-v,baltimore,fletcher,baltimore,fletcher,enterprise-cv6,shokaku
```

## September 8, 2026 measurement

Windows, NVIDIA RTX 5070 Ti, Chrome WebGPU, High, 1920 × 1080, default diagnostic
roster and seed. Baseline source: `5d145339`. Both runs used production Vite bundles
without CPU or phase profiling, over the first 60 seconds of the same setup.

| Metric | Before | After |
| --- | ---: | ---: |
| Average FPS | 35.4 | 50.2 |
| 95th-percentile frame interval | 34.9 ms | 27.9 ms |
| 99th-percentile frame interval | 55.4 ms | 34.7 ms |
| Longest frame interval | 944.4 ms | 90.1 ms |
| Frames over 100 ms | 8 | 0 |
| Simulation time advanced | 57.12 s | 59.92 s |

This is a 42% average FPS improvement, not a doubling or sustained 60 FPS: the
final ten-second window improved from 32.4 to 41.3 FPS. Other hardware, camera
positions, fleets and longer battles need their own measurements. Zero stalls
over 100 ms in this run does not guarantee that every future run is hitch-free.

The changes warm actual battle render passes, aircraft/effect variants and the
impact material under the loading screen while combat is held. Instance draws
use the live population while shader matrix capacity remains fixed. Local
snapshot parsing and sparse transfer move work off the render thread; offscreen
cloth skips integration, subpixel scars skip draws until resolved, and unchanged
damage labels retain their content and measured dimensions. Combat tick rate,
aircraft population, particle capacity, ocean quality and ship assets are retained.

Relevant tests and TypeScript checks passed. At this measurement, the full build
stopped at a pre-existing `tbd-1-devastator` retained export report mismatch;
production rendering was measured using `vite build` separately. That comparison
has since been corrected as described below.

Forced WebGL on this machine fails during harbor warmup with shader validation
errors and device loss in both the baseline and changed versions. WebGL could not
be visually validated; the measurements above apply to WebGPU.

## Larger carrier battle

The larger diagnostic uses 15 ships per side, including Enterprise and Shokaku
on each side: 30 ships and four carriers in total. Graphics remain High at
1920 × 1080. CPU combat, aircraft populations and simulation tick rate are retained.

Opaque fleet surfaces coalesce identical geometry into native instanced draws on
the pinned Three r185 WebGPU backend. Render bundles retain those commands while
the renderer updates live pose textures, uniforms and camera/shadow culling.
Changed geometry ranges, pipelines or GPU resources rebuild the bundle. Sorted
and transparent materials retain their original submission path. `bundles=0`
disables command caching for comparison while retaining native instancing.

Whole-ship bounds include articulation, recoil and the sun's shadow volume.
Offscreen hull motion continues; visible joints use the current interpolated
snapshot on re-entry. Funnel smoke and aircraft gunfire retain their trajectories
while skipping offscreen instance preparation. Sight selection uses a conservative
armor index followed by the existing exact intersection test. Local WASM snapshots
stream the existing presentation projection without allocating an intermediate
JSON tree; a same-battle native test compares every field against the prior path.

Two consecutive unprofiled, 60-second production runs on the machine above:

| Metric | Command cache disabled | Command cache enabled |
| --- | ---: | ---: |
| Average FPS | 61.1 | 63.8 |
| Final ten-second FPS | 53.0 | 55.5 |
| 95th-percentile frame interval | 21.0 ms | 20.9 ms |
| Longest frame interval | 62.5 ms | 55.6 ms |
| Frames over 100 ms | 0 | 0 |
| Simulation time advanced | 59.25 s | 59.48 s |

The enabled run came first. Busy windows still fall below 60 FPS, so these
measurements establish an average over 60, not sustained 60 throughout combat.
Earlier runs varied considerably with machine load; do not attribute the full
difference from those runs to a single optimization. Ship, close aircraft,
distant and 24× views were inspected after the enabled run; maximum muzzle
alignment error was 2.75 mm. No new JavaScript or WebGPU errors were observed.

A subsequent 120-second run with the same fleet averaged 50.7 FPS, with late
windows at 35.9–50.3 FPS, one frame over 100 ms, and 117.9 seconds of simulation
progress. This longer run contradicts sustained 60 FPS and is the next profiling
case. `profile=1&profileAfter=60` starts main-thread phase instrumentation after
the first minute; worker timing remains enabled throughout that diagnostic run.

The full build's aircraft-report failure was traced to one-bit differences in
`Math.hypot` results for measured joint travel (for example, 4.183700613547448
versus 4.1837006135474475 metres). Report comparison now allows four relative
machine epsilons only for `joints[].maximumVertexTravel`, including each LOD.
Model/source hashes, geometry counts, bounds and all other fields remain exact;
retained assets and hashes were not rewritten. The normal `bun run build` passes
with every ship and aircraft validator enabled.

### GPU wake experiment

The late-combat phase profile measured about 2.3 ms/frame in wake foam. The
experimental WebGPU path retains the same CPU trail/impact samples and 20 Hz /
5 Hz refresh rates, but paints max-coverage ellipses into an R8 render target.
Footprint and vertex storage are retained and prepared for each fleet during
loading. Other backends retain the CPU rasterizer.

The dev-only `/scripts/diagnostics/wake-foam-gpu.html` compares GPU pixels against
the CPU rasterizer and exposes `window.result.passed`. It covers aging turns,
splash rings, buffer growth, a 30-ship atlas, distant refresh, zoom, pause,
teleport, tile removal/reordering and reset. Maximum observed difference is one
8-bit level; reset is exactly empty. Ship and distant in-game views were inspected.

The first two-minute GPU-wake run averaged 53.1 FPS versus the earlier 50.7 FPS;
late windows remained 38.6–51.5 FPS. Three frames exceeded 100 ms, with a 306 ms
maximum, so stall behavior needs further verification. That run predates the
retained footprint buffers. These results do not establish sustained 60 FPS.

With retained footprint buffers, a subsequent 120-second run averaged 55.0 FPS,
with late windows at 40.4–44.8 FPS, 118.3 seconds of simulation progress, and
one frame over 100 ms (106.9 ms maximum). Six render pipelines were created
around 78.5 seconds; the harness now records material IDs and scene object names
to identify first-use compilation. `UPLOAD_PROFILE_AFTER=1` measures GPU buffer
upload calls and bytes over 60 additional frames after the uninstrumented FPS
sample. Those additional frames are diagnostic, not part of the FPS result.

The flag solver now reuses each column's flutter value across all cloth rows,
hoists shared wind calculations and prepares fixed link weights once. It retains
the 120 Hz step, mesh resolution and six constraint iterations. A temporary
old/new comparison produced exactly equal particle arrays over 12,000 frames
covering calm, reversed, storm and changing winds/gravity. Six alternating V8
microbenchmark pairs reduced solver time by about 14%; this is an isolated
solver measurement, not an overall FPS gain. Cloth and rig behavior tests pass.

The subsequent cloth run still averaged 55.0 FPS with a 111.1 ms maximum frame.
Its material catalog identified the late pipelines as aircraft tracer tips,
envelopes and cores. A GPU reproduction found that the first overflow page's
WGSL differed only in process-wide `NodeBuffer_<id>` names. The pinned r185
adapter retains NodeBuilder's shader-local names for instanced draws, allowing
identical pages to reuse shader programs and pipelines with their own bindings.
It leaves explicit names and other backends alone.

Late upload instrumentation measured 7.13 MB/frame in matrix uniform buffers,
plus 1.47 MB/frame in attributes. Native WebGPU aircraft now use versioned
storage matrices and upload only live instances; the fallback keeps uniform
matrices. The dev-only `/scripts/diagnostics/instance-matrices-gpu.html` compares
both paths using real aircraft models, LOD changes, empty/repopulated batches,
and 801 aircraft. `?stable=1` additionally enables stable buffer names. Pixel
hashes matched exactly with and without the adapter, including 606 aircraft
tracers. Tracer pipeline creation fell from six to one, with no new pipelines
on crossing the 512-instance page boundary. Fleet growth and independent joint
pose tests exercise both matrix representations.

The final versioned-storage run averaged **57.3 FPS** over 120 seconds, with
the final 50 seconds at **46.7–49.1 FPS**. Simulation advanced 118.05 seconds.
There were no frames over 100 ms and the maximum was 55.6 ms. No render
pipelines were created after the first second; total render/compute pipeline
creation fell from 1,149 in the preceding cloth run to 404. Ship, close aircraft,
distant and 24× views were inspected, and the final normal view remained intact.

Storage matrices use explicit version updates rather than Three's unconditional
dynamic-usage uploads. The GPU diagnostic verifies that a second render needs
zero additional matrix uploads and still matches the reference pixels. Late
instrumentation measured 12.2 KB/frame for aircraft matrices and 2.43 MB/frame
for all buffer uploads, versus 8.63 MB/frame before these matrix changes.
These runs still contradict sustained 60 FPS in busy combat. Full builds and
the relevant cloth, aircraft, wake and instance behavior checks pass.

### Particle preparation and measurement variability

Particle and aircraft-tracer poses now compose matrices directly from retained
vectors and quaternions. They avoid temporary scene-object Euler synchronization
and world-matrix updates. Perspective smoke volumes prepare their final facing
pose immediately; other particle alignment, sorting, fade and motion rules remain
unchanged. Aircraft gunfire also reuses event-origin and attitude scratch values.

An old/new comparison matched every particle instance matrix, color and custom
attribute across 180 moving-camera frames for both ordinary and volume particles,
including orthographic and inside-volume views. Aircraft/tracer GPU pixel results
matched the preceding build exactly through 606 tracers. The 39 relevant effect
behavior tests pass. An isolated V8 test of 1,800 ordinary particles reduced
preparation time from 150–158 ms to 108–113 ms over 300 publications, about 28%.
This is a component measurement, not a 28% gain in game FPS.

Later unrestricted production measurements slowed substantially even on the
unchanged main build. The particle candidate averaged 37.8 FPS over 120 seconds,
with two frames over 100 ms and only 62.55 seconds of simulation progress. These
were followed by an unchanged-main control at 36.7 FPS, also with two frames over
100 ms and 63.12 seconds of simulation progress. The candidate was about 3% faster
in this pair, with average frame work falling from 23.71 to 22.96 ms. These
results cannot establish sustained 60 FPS or be compared directly with the earlier
57.3 FPS result. The measured device remains NVIDIA Blackwell, using Chrome
151.0.7922.170 and a 1920 × 1080 framebuffer at High quality.

CPU counters during the slow run showed the four efficiency-core threads at
80–88% utilization while most performance-core threads were lightly used; GPU
utilization was about 12% at that sample. A separate cloth microbenchmark recovered
its earlier speed when its own temporary Node process was restricted to the
performance cores (644–672 ms versus the recent unrestricted 955–1,097 ms).
This supports a scheduling contribution but does not prove the cause of every
frame stall. No system power settings or user processes were changed. Battle FPS
results above use ordinary scheduling; a proposed affinity-controlled battle
diagnostic was rejected by automatic approval review and was not run.

### Versioned effect uploads

Native WebGPU effects now use storage matrices and aligned storage colors, with
explicit versions and live upload ranges. This includes funnel/aircraft smoke,
combat particles, shell/tracer pages and aircraft ordnance. Newly allocated pages
inherit the same representation. Empty pages still publish cleared matrices for
loading-screen shader warmup; normal draw counts remain zero. Other backends keep
their original matrix/color representation. Particle colors use component setters
because storage RGB has a four-float stride.

The GPU comparison at `instance-matrices-gpu.html?stable=1&effects=1` now also
checks ordinary particles in a 6,144-slot pool, volumetric smoke, growth, shrink,
empty/reset and inside-volume views. All twelve particle images matched the
reference exactly, and the new path matched on its first draw with zero repeated
matrix/color/custom-attribute uploads on a second draw. The original copied
interleaved attributes synchronize their versions after vertex uploads, so the
reference is sampled after its capture/final pair. Tracer images through 606 live
instances also match, including empty-page warmup followed by repopulation.

The first production run averaged 38.1 FPS over 120 seconds, with two frames over
100 ms, a 104.3 ms maximum, and 63.72 seconds of simulation progress. Post-sample
instrumentation measured 1.13 MB/frame of buffer uploads. Ship, close aircraft,
distant and 24× views were inspected; maximum muzzle error remained 2.75 mm.
The following unchanged-main control averaged 38.0 FPS with two frames over
100 ms and 63.18 seconds of simulation progress. It uploaded 2.01 MB/frame in
531 calls versus 425 calls for the candidate: about 44% fewer bytes and 20% fewer
calls. Upload instrumentation measured 1.51 versus 1.25 ms/frame. Overall frame
rate was effectively unchanged in this pair, so this establishes reduced upload
work and corrected first-pass particle updates, not an additional FPS gain.
The final empty-page warmup safeguard was added after this FPS sample and passed
the GPU reset/repopulation check. These measurements still contradict sustained
60 FPS; the broader scheduling slowdown described above remains unresolved.

### Anti-aircraft simulation work

A V8 profile of the actual WASM runtime identified aircraft distance checks and
repeated weapon-group JSON construction as substantial simulation costs. Compiled
ships now retain their immutable weapon-group IDs. AA scans iterate aircraft
without allocating a temporary list and clone only the selected target. A squared
distance prefilter rejects clearly farther aircraft; a conservative rounding margin
keeps boundary cases on the original hypot calculation and strict comparison.
Friendly-fire lane and hit-distance checks use the same prefilter.

A seeded old/new WASM replay of the thirty-ship, four-carrier battle matched all
1,200 presentation snapshots exactly through 7,200 ticks. Alternating execution
order, the last 600 six-tick batches averaged 87.57 ms before and 59.16 ms after,
about 32% less simulation stepping time. This standalone V8 measurement excludes
rendering and is not an FPS result.

All 27 native simulation tests pass, including existing battle/carrier references,
cached group identities against the authored reference, and presentation/authority
equivalence. The distance prefilter additionally checks 200,000 seeded vectors,
strict one-ULP selection boundaries and extreme magnitudes. The full production
build passes with ship and aircraft checks.

Production measurements remain sensitive to the previously observed machine-speed
variation. The first candidate sample averaged 50.71 FPS, advanced 106.55 seconds
of simulation in 120 seconds, and had 13 frames over 100 ms (maximum 493.1 ms).
Ten of those stalls occurred between 24 and 29 seconds. The following unchanged
control recovered to 62.23 FPS with 118.85 seconds of simulation, no frames over
100 ms and a 62.5 ms maximum. A repeat candidate then averaged 60.33 FPS with
119.80 seconds of simulation, no frames over 100 ms and a 62.5 ms maximum. All
used normal scheduling, High quality and a 1920 x 1080 framebuffer.

The repeated candidate's final five ten-second windows were 47.6-50.4 FPS; the
control's corresponding windows were 49.4-53.1 FPS. This does not establish an FPS
gain from the AA changes or sustained 60 FPS. It establishes reduced isolated
simulation cost with unchanged replay outcomes; late-combat rendering still needs
work. The first sample's long stalls did not repeat, but their cause is unresolved.

### Late-combat rendering experiments

With the AA changes present and normal machine speed recovered, an instrumented
late-combat run measured 4.42 ms/frame in water updates, 2.88 ms in final rendering,
1.56 ms in combat effects, 1.12 ms in fleet draws and 1.11 ms in rigging. Ocean
capture and the final scene each render the fleet; the final diagnostic counted
1,162 native draws across the frame. Flag cloth remained the largest individual
JavaScript function in the subsequent eight-second CPU profile.

A scar-batching experiment retained exact transparent ordering, receiver matrices,
subpixel/frustum culling and warmup. Eighteen relevant tests passed, twelve GPU
fixture images matched exactly, and actual battle ship/zoom/distant views matched
pixel-for-pixel with 47/87/43 visible scar receivers. Nevertheless its production
average was 60.98 FPS versus 61.04 for the following unchanged control. Final
fifty-second averages were about 51 versus 50 FPS; both had no frames over 100 ms
and advanced about 119.8 seconds of simulation in 120 seconds. This did not show
a convincing overall gain, so the experiment was removed.

A separate WASM cloth-constraint prototype matched all positions over 12,000
frames but improved isolated total cloth time by only about 1-4%, including its
JS/WASM buffer copies. A JavaScript unrolling/common-product variant also matched
exactly but was slightly slower. Neither was retained. Temporary code, profiles
and comparisons remain under ignored `.build/`. These experiments do not establish
sustained 60 FPS; the shipped rendering path remains unchanged by them.

### Local snapshot transfer and overlay layout

The owned worker's lossless delta uses scalar leaves and keyed object patches.
This removes wrappers/tuples from structured cloning. Applying changed fields uses
ordinary assignment except for `__proto__`, which remains an own data property;
explicit undefined values, deletions and unchanged subtree identities are retained.
A 7,200-tick thirty-ship replay matched all 1,200 transferred snapshots exactly.
Alternating old/new execution over the final 600 snapshots measured average delta
creation at 5.92/6.04 ms, cloning at 4.97/3.62 ms, and application at 1.36/0.52 ms.
These are isolated V8 transport measurements, not frame-rate gains.

Squadron labels and air-map overlays now complete projection/viewport reads before
writing element positions. An alternating comparison on twelve real battle
markers reduced layout/style recalculations from 357 to 90 over ninety frames.
Label-update CPU time fell from 0.277-0.286 to 0.102-0.107 ms/frame. Camera movement,
HUD scaling and map path projection retain their existing calculations. All 41
relevant session, projection and frame-loop tests pass; the frame test fixture now
includes the real fleet visibility component and a directional light.

The production candidate averaged 62.95 FPS over 120 seconds, with final
ten-second windows at 50.2-53.5 FPS, zero frames over 100 ms and a 61.5 ms maximum.
It advanced 119.83 seconds of simulation at High quality and 1920 x 1080. Ship,
aircraft, distant and zoom captures were reviewed; muzzle error stayed below
2.75 mm. The following unchanged control averaged 49.77 FPS, advanced 98.73 seconds
of simulation and had nine frames over 100 ms, including a 407 ms maximum. Its
final forty seconds fell to 25.5-28.0 FPS despite earlier unchanged runs remaining
near 50 FPS there. That instability prevents attributing the full paired FPS
difference to these changes. The isolated transfer/layout savings are established;
sustained 60 FPS is still not established.

## Offscreen combat particles

Combat gas, falling-aircraft smoke, flashes and foam now use conservative
per-particle visibility checks before sorting and writing instance buffers.
Particles continue aging and drifting outside the viewport. Volume checks use
only the four side planes: the shader can render gas between the camera and
its near plane, so ordinary near-plane rejection would remove visible smoke.
Water droplet/mist thresholds and effect quality settings are unchanged.

The development diagnostic `scripts/diagnostics/particle-culling-gpu.html`
compares unculled and culled rendering for billboards, velocity-aligned sprites,
water sprites, additive effects and volumes. All 70 comparisons were pixel-exact,
covering viewport edges, rear views, zoom, camera-inside and near-plane gas,
orthographic cameras, and normal/reversed depth. The production ship, aircraft,
distant and zoom captures were inspected; muzzle error remained below 2.75 mm.

`PARTICLE_CULL_PROFILE_AFTER=1` alternates the old and new publication settings
on the same frozen battle after its FPS sample. At tick 7185, the affected pools
fell from 737 to 433 published instances. Their combined publication time fell
from 0.154-0.157 to 0.115-0.117 ms per frame, about 25%; the absolute CPU saving
is only about 0.04 ms. This does not establish a substantial FPS increase.

The 120-second High/1080p candidate averaged 58.07 FPS, with late windows at
47.1-49.7 FPS, no frames over 100 ms and a 55.6 ms maximum. It advanced 119.75
seconds of simulation. The following unchanged control averaged 58.92 FPS,
advanced 119.70 seconds of simulation and also had no frames over 100 ms. This
pair does not demonstrate an FPS gain from culling; its isolated preparation and
instance-count savings are established. The build and 62 effect, frame-loop and battle tests
passed; the display-rate determinism test required a retry with a longer timeout
after exceeding its default five-second limit. Sustained 60 FPS remains unproven.

## Tracer and splash launch caches

Aircraft gunfire now prepares each event's muzzle offsets, inherited velocity,
fixed dispersion, lifetime and caliber scaling once. Expiration and battle resets
discard the cached bursts; frame updates still use the shared ballistic solution
at the current interpolated simulation time. The cache also removes temporary
launch-position/velocity arrays from each frame.

Against `57ce706e`, all tracer matrices, opacity buffers, counts and visibility
matched exactly over 960 replay frames. Coverage includes delayed fighter rounds,
varied attitudes and drag, future events, history eviction, battle resets,
perspective/orthographic cameras, zoom and offscreen culling. The replay peaked at
1,152 tracers. With 600 retained firing events, 400 dense tracer updates fell from
193-201 ms to 124-129 ms with culling enabled, about 35%. Existing WebGPU checks
also passed for 6/600/0/606 tracers, including forced empty warmup and repopulation.

Water sheets retain their seeded folds and width profiles in double precision.
Their common row coordinates and color profiles are calculated once; each frame
still computes the original gravity, travel, opening, breakup and lighting.
All position, color and opacity buffers matched exactly over 1,200 frames with
changing cameras, sun directions, scales, impact directions, emissions and resets.
For 384 sheets, 500 publications fell from 244-254 ms to 84-86 ms in the first four
alternating samples. Later samples slowed on both implementations but retained
61-66% savings. WebGPU and WebGL checks passed with normal and reversed depth,
including occlusion, pause, reset, repopulation and night lighting. The existing
water-plume diagnostic now presents its captured images for visual inspection.

The tracer-only production candidate averaged 62.12 FPS over 120 seconds, with
late windows at 50.1-53.6 FPS, no frames over 100 ms and a 55.6 ms maximum. It
advanced 119.83 seconds of simulation. The unchanged control averaged 47.64 FPS
but advanced only 82.75 seconds of simulation, with late windows at 25.1-33.3 FPS
and two frames over 100 ms. That large control slowdown prevents attributing the
full paired difference to the cache. Component savings are established;
sustained 60 FPS remains unproven.

With both caches, the next production run averaged 60.81 FPS, advanced 119.73
seconds of simulation, and recorded no frames over 100 ms (55.6 ms maximum).
Late windows remained at 49.5-52.5 FPS. Ship, aircraft, distant and zoom captures
were inspected at High/1080p; muzzle error remained below 2.75 mm. This still
does not establish sustained 60 FPS or a reliable overall FPS gain from the
component changes.

## Approved flag, ship-detail and refraction reductions

The user approved these visual tradeoffs. Flag cloth now uses a 6 x 3 cell grid
(28 vertices, 36 triangles), a 60 Hz solver and four constraint iterations;
previously it used 12 x 6 cells, 120 Hz and six iterations. Wind, apparent ship
motion, gravity, pinned hoists, pause and reset remain supported. Alternating
isolated tests of thirty moving flags measured 3.07-3.11 ms per fleet frame before
and 0.264-0.266 ms after, about 91% less solver time. Actual battle savings depend
on how many flags are visible.

Ship simplification permits 1.25 pixels of projected error on entry and 1.75
pixels while retaining a level, replacing the 0.45/0.65 pixel limits. Parts below
1.5 pixels across are omitted instead of 0.5 pixels. Zoom and framebuffer size
still govern detail; inspection restores the original surfaces. Original model
assets, joints and CPU hit geometry remain intact.

The ocean is created without surface refraction and underwater distortion.
Opaque scene depth/color remain for shoreline contact and ship reflections.
Above-water refraction no longer duplicates transparent effects or needs the
separate water-depth pass. Submerged views retain their complete fog captures
and use an unwarped interface. The choice is made before material construction:
switching the full graph back on after rendering caused WebGL context loss in a
diagnostic, so there is no public runtime setter. See the vendor patch record.

`REFRACTION_PROFILE_AFTER=1` compares private WebGPU graph variants on the same
frozen battle after the FPS sample. Two pairs measured 7.58-7.75 ms per unpaced
frame with refraction and 6.76-6.94 ms without it, about 0.8 ms saved. Draws fell
from 383 to 316. This is an isolated paused rendering measurement, not live FPS.
`SUBMISSION_PROFILE_AFTER=1` records per-object submission costs after the sample;
nested pass timings are inclusive and must not simply be summed.

The first production candidate averaged 44.12 FPS but advanced only 63.5 seconds
of simulation in 120 seconds. It recorded three frames over 100 ms, with a
111.1 ms maximum. The following unchanged control returned to 60.40 FPS and
119.73 simulation seconds, with no frames over 100 ms and a 55.6 ms maximum.
This pair cannot isolate the changes from the recurring machine-speed variation.

The repeat candidate averaged 66.22 FPS with 119.75 simulation seconds, no frames
over 100 ms and a 69.4 ms maximum. Its final fifty seconds ran at 53.8-57.1 FPS,
versus 49.1-51.8 for the control. That comparable pair shows about a 10% overall
gain; sustained 60 FPS is still unproven. Both use the same thirty-ship roster,
four carriers, normal scheduling, High quality and a 1920 x 1080 framebuffer.
Ship, aircraft, distant and binocular captures were inspected; muzzle error
remained below 2.75 mm.

All 64 relevant capture, cloth, rig, detail, fleet, frame, environment and combat
tests pass. The display-rate combat determinism test needed a longer timeout on
retry. The full production build passes. The submarine diagnostic now publishes
its hidden-hull override to fleet render batches and initializes the changed
ocean spectrum before pausing, so its comparisons exercise the current renderer.
The final construction option passes WebGPU and WebGL visibility checks at
7, 50 and 150 m, including periscope/surface restoration, without shader errors.
WebGPU captures retain readable hull detail. WebGL captures show a much darker
hull silhouette; its lighting fidelity is not certified by the contrast test.
An unchanged production WebGL control lost its context while loading, so that
lighting difference could not be isolated. The measured FPS results use WebGPU.

An earlier aircraft part-grouping prototype had image mismatches and was removed
from runtime before these measurements. Its temporary source and diagnostics
remain under ignored `.build/`; no aircraft batching gain is included here.
