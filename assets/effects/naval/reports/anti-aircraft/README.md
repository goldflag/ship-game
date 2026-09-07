# AA tracer travel and airburst smoke

Reviewed 2026-09-07 on the production Game WebGPU renderer through Orca's embedded browser. Source base: `ae9e700b`; this report accompanies the AA effects changes. Bismarck definition hash: `25429e7ad048aada681f0dc250d25f0a07bd93d7cc93f34c1e94692f2150052b`. Ship assets were unchanged and passed the build's checks.

## Behavior

Light AA keeps its captured launch direction, inherited ship velocity and gravity. Tracers last at least three seconds and one second beyond the sampled target flight time, unless they meet the flat visual sea. They fade over the last 0.65 seconds. Heavy AA uses the CPU's recorded flight time, then ends at its ballistic endpoint in three overlapping charcoal smoke volumes. These expand, drift with the existing wind and dissipate over roughly six seconds. Flak remains visible through binoculars, including player-fired bursts.

The renderer now retains observed firing events until their effects finish. Regressions reproduced a visible shot disappearing when 128 subsequent events evicted its combat-log entry, and a separate 512-tracer rendering ceiling. Event retention and expandable instance pages remove those cutoffs. This does not change the simulation event transport: a shot evicted before any renderer update sees it is still unavailable to the visual adapter.

The smoke is visual feedback for the existing approximate heavy-AA burst. Aircraft damage still resolves when firing; no physical timed-fuze or delayed aircraft damage was added. Light-AA visual continuation does not add new hits.

## Visual evidence

Open `/scripts/diagnostics/anti-aircraft-effects.html` with the development server. The fixture uses registered muzzles, speeds and calibers with controlled firing snapshots and the shared ballistic endpoint. It clears event history 0.25 seconds after firing to exercise retention. The fixture's rows of bursts are a controlled arrangement, not a combat accuracy claim.

- [Light AA at 2 seconds](light-2s.png): 20 tracers remain visible beyond the nearby aim points; no flak smoke.
- [Heavy AA in flight at 1.25 seconds](heavy-flight.png): eight visible tracers inside the frame; no smoke before the burst.
- [Heavy AA at 2.1 seconds](heavy-burst.png): eight bursts, 24 smoke volumes, no remaining heavy tracers.
- [Heavy AA at 4 seconds](heavy-drift.png): expanded, softer smoke with wind drift.

Additional runtime samples: heavy AA at 1.25 seconds has eight tracers and no smoke; at nine seconds it has neither tracers nor smoke. Light AA has no remaining tracers at 3.1 seconds. Captures are unedited canvas PNGs from WebGPU; browser console contained only Vite connection messages.

The initial in-flight preview incorrectly reused the burst close-up camera. All eight active tracers were outside the frame at 1.25 seconds; the original count-only check missed the error. The corrected preview uses the rear camera before the burst, and reports `visibleTracers` from projected positions as well as the active count. Clicking **Heavy AA · in flight** now shows eight visible streaks in the WebGPU capture above. The production build passed again after this preview correction.

## Validation

- `bun test src/game/AircraftGunfire.test.ts src/game/CombatEffects.test.ts src/simulation/antiAircraft.test.ts`: 39 pass, including all registered AA mounts, CPU endpoint agreement, history eviction, instance overflow, flight/burst timing, pause, optics, wind drift, expiry and reset.
- `bun run build`: passed ship checks, aircraft checks, TypeScript and production bundling. Existing large-bundle warning remains.
- `git diff --check`: passed.

Smoke uses its own fixed 256-volume pool; active tracer instance pages grow in allocations of 512. This review establishes behavior and appearance, not a worst-case fleet GPU performance bound.

## Validation after updating the PR branch

Rebased onto master `4a04c118`, preserving its water-plume and mist lifecycle alongside AA smoke. The four focused suites (including `WaterPlumes.test.ts`) pass all 46 tests; `bun run build` passes. The [integrated WebGPU samples](integrated-runtime.json) confirm eight visible heavy tracers at 1.25 seconds, 20 visible light tracers at two seconds, and 24 smoke volumes with no heavy tracers at 2.1 seconds. The captures above retain their original pre-rebase evidence.
