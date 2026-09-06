# Carrier merge validation

Includes visible deck operations and individual aircraft follow cameras, integrated with committed local master convoy/impact/tracer work and remote master's smoke/horizon correction.

Claude's required deck review follow-ups: the long aircraft integration test has an explicit 30-second timeout; Enterprise's launch/recovery lane is now X=0 m and parking row X=-4 m to clear the island and reduce overhang; README and air-operations docs give actual taxi-limited launch/recovery cadence. A taxi aircraft also clears the lane and returns to parking if service or global airborne capacity is lost. Its regression test passes. Physical deck collisions, wing folding and a more sophisticated deck scheduler remain out of scope.

Enterprise was rebuilt through local Blender with the corrected authored datums. `centerline-deck.png` and `runtime.json` use that export in the WebGPU flight-cycle diagnostic: three launched/recalled aircraft recovered and all 18 ended ready, without a captured GPU error. The earlier deck images retain their original hash/context; they do not certify these corrected datums.

The full normal test command ran 488 tests: 484 passed and four existing simulation tests exceeded the default five-second timeout during asset builds. All four passed when rerun with a longer timeout (`timeout-rechecks.txt` and `submarine-recheck.txt`). Separately, 53 focused aircraft/camera/frame tests and 33 combined game/effects tests passed. No assertion failure remained.

Master's inherited Yamato/Baltimore/VIIC comparison reports were stale and were regenerated. The four newly merged convoy exports also had stale recipe hashes (compiled definition fields were unchanged); they were rebuilt through their retained original recipes. No historical-accuracy conclusion is implied by export checks. Local master has other uncommitted generated assets; these were not used or overwritten.

The combined production build passed all nine registered ship checks, all thirteen aircraft checks, TypeScript and Vite. The local master export refresh subsequently completed and its working tree became clean, allowing a normal fast-forward after integration.
