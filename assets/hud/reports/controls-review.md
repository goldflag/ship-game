# Sailing HUD and controls review

Reviewed September 5, 2026 against the user's three supplied HUD references. Runtime illustrations are independently authored; reference crops are not shipped into the game UI.

## Behavior checked

| Check | Result |
| --- | --- |
| Pointer capture on Set sail | A native Orca browser run reported the canvas as `document.pointerLockElement` with sailing unpaused. |
| Centered sight | Center measured at (800, 450), (422, 195) and (195, 422) in the three review viewports. |
| Binoculars | Shift entered 4× with a 13.9039° field of view and preserved the aimed target point. A wheel step selected 6×. |
| Shift with + | Increased the desktop map to 360 px without entering binoculars. The input regression test also covers this modifier interaction. |
| Battery selection | Keyboard 2 selected secondary; 1 restored main. Counts come from each battery's simulation state. |
| Firing | Holding Q launched four main-battery shells; ammunition fell from 960 to 956, with firing events for Anton and Bruno. |
| Gunnery | G opened the damage and mount details and released the cursor. |
| Helm and pause | W advanced the engine order, Space selected Stop, Esc paused and Resume sailing unpaused. |
| Minimap | Flush to bottom/right, `rgba(11, 32, 44, 0.4)` background; five visibly distinct sizes at every tested viewport; increase disabled at the largest size. |
| Map labels | NORTH UP is static. Clicking the kilometer button changed the range from 2 km to 4 km. |
| Scene clutter | No upper-left mission block or map camera toolbar; no numbered aiming scale in third person. |

The final desktop map sizes measured 240, 280, 320, 360 and 400 px. Small landscape sizes measured approximately 157, 183, 209, 235 and 262 px. Portrait sizes measured 117, 136.5, 156, 175.5 and 195 px. Exact geometry and final browser diagnostics are recorded in [browser-checks.txt](browser-checks.txt).

## Verification

- `bun test`: **51 passed, 0 failed**, including simulation, center-ray aim, scope transition, world-bearing and input modifier checks.
- `bun run build`: passed ship asset checks, TypeScript and Vite production build.
- Final browser capture run: no runtime exceptions and no horizontal overflow at 1600 × 900, 844 × 390 or 390 × 844.

## Capture environment

The final [review images](../review/) were captured in an isolated headless Chrome session using the local development app. Native Orca screenshots timed out, so the screenshot pass used that separate browser. Headless Chrome declined pointer lock; its visible “Click sea to aim” prompt records this fallback state. Headless mouse-fire and recapture results are therefore not counted as successful native pointer-lock checks. The successful native Set sail capture was observed separately, and the Q firing path was verified in headless Chrome.

The small portrait layout places armament above the center sight; the short landscape layout uses a compact weapon row. The ship, center sight and sea remain visible in each capture. These screenshots validate HUD layout and behavior, not historical model accuracy or a rendering-performance benchmark.

## Finish verdict

**disposition: ship**

| Review finding | Final verdict |
| --- | --- |
| Responsive clearance | Resolved: portrait armament is above the sight; compact landscape controls leave the ship readable and clear the capture guidance. |
| Minimap sizing | Resolved: all five steps have distinct measured widths at every tested viewport. |
| Chart labels | Resolved: static orientation and a separate functional range button. |
| Design documentation | Resolved: DESIGN.md records the implemented layout and controls. |

No material regressions remained in the reviewer's final pass.
