# Stability milestone — implementation notes, not shipped behavior

The accepted step 5 remains pending. These notes prepare its physical model while gunfire and damage control are reviewed.

## Reference principles

Buoyancy follows submerged volume and its centroid. Waterplane second moments contribute to small-angle restoring moments; metacentric height combines that contribution with the separation of buoyancy and gravity centers. Large-angle stability requires a righting-arm curve rather than unrestricted extrapolation of a small-angle formula. [MIT OpenCourseWare, Design of Ocean Systems, lecture 2, slides 12–16](https://ocw.mit.edu/courses/2-019-design-of-ocean-systems-spring-2011/f0cc4e483a7d4b78760f9b0908f51c44_MIT2_019S11_HydStr1.pdf), accessed 2026-09-05.

Partially filled spaces can reduce stability as water moves during heel. That free-surface effect changes as a compartment fills to its overhead. [US Coast Guard, SS El Faro investigation, Marine Safety Center stability report](https://www.dco.uscg.mil/Portals/9/DCO%20Documents/5p/CG-5PC/INV/docs/boards/ELFAROROIfinal.pdf), accessed 2026-09-05. This is a reference for the mechanism, not a source for our warship layouts or loading conditions.

## Implementation constraints to resolve in step 5

- Derive submerged volume, center of buoyancy and waterplane properties from the versioned hull. Record the mismatch between authored hull displacement and stated ship mass; any calibration must be explicit.
- Author estimated loading/center-of-gravity data with a basis for each preset. Include water mass and its location consistently. Avoid double-counting free-surface correction if the water centroid is already recomputed under heel.
- Preserve conservation and fix portal head calculations under list/trim. Verify symmetric loading, port/starboard symmetry, fore/aft loading, drainage and partial versus full compartments.
- Evaluate finite-angle behavior before declaring capsize; a negative initial metacentric height alone is insufficient to prove immediate capsize.
- Complete hull-shell and flooding coverage, including deck, bottom and ends. Current small end pockets and coarse legacy armor boxes cannot justify retiring universal structural loss.
- Show afloat but disabled, progressive flooding and capsize distinctly. Validate alternative losses across all four presets before removing the fallback. Do not tune water thresholds or penetration merely to force a chosen duel duration.
- Bound CPU cost using deterministic cached geometry and a documented update cadence. GPU ocean data remains visual-only.

These are implementation decisions to test and review with Fable, not a claim of historical loading accuracy or regulatory compliance.
