# Selective firing and aiming review

## Diagnosis

With Bismarck aiming straight ahead at 5 km, Cäsar and Dora stopped at their ±145° traverse limits but still reported `ready`. A click fired all eight main-battery shells. The firing solver returned alignment separately from readiness, and the player path ignored that result. The HUD then interpreted every unaligned loaded gun as still turning. The existing obstruction check correctly reported blocked barrels when pointed through the superstructure; the clear barrel paths at the legal traverse stops were instead outside the requested target's arc.

The binocular offset came from different reference points: the solver trained barrel 0 at the target, while the circle displayed the average barrel position. For a Bismarck broadside at 1,800 m this produced a 0.96 px horizontal error at 1× and 11.52 px at 12× on a 1,440 × 900 viewport.

## Changes

- Player and bot fire share per-mount alignment, reachability, obstruction and reload checks. A click is consumed on the next tick; holding fire admits each eligible mount; releasing never leaves a pending salvo.
- Ready means aligned, loaded and unobstructed. Turning, Out of arc, Out of range and Blocked remain distinct. Unreachable mounts keep their ammunition; any visible countdown is explicitly a reload timer. The weapons heading counts mounts that can fire.
- Solver, bot lead and aiming circles share the average muzzle center. Shells retain their individual muzzle positions and actual trajectories.
- The simulation owns eligibility; green circles read the same state. Ship sources, model outputs and obstruction geometry are unchanged.

## Verification

`bun run test`: **186 passed, 0 failed**. Coverage includes the bow-on rear-turret regression, click consumption, staggered held fire and release, physical superstructure obstruction, opposite-side Enterprise ammunition conservation, and centered trained gun circles across 1×/2×/4×/6×/8×/12× magnification for all four ship presets. Existing simulation determinism, bots, damage, articulation and camera tests pass.

`bun run build`: **passed**, including all four ship checks and TypeScript. The existing large bundle warning remains.

Live WebGPU evidence:

- [chase.json](chase.json): 2/4 can fire; forward circle and white sight both center on (720, 450). Rear mounts show Out of arc with 240 rounds each and no reload.
- [optics.json](optics.json): at 12× on 1,440 × 900, both centers remain (720, 450), and unavailable rear markers remain readable.
- [fired.json](fired.json): a real Fire-button click emits four forward shells. Anton/Bruno ammunition changes from 240 to 238; Cäsar/Dora stay at 240 with zero reload. Labels distinguish Reload from Out of arc.
- [mobile.json](mobile.json): at 12× on 390 × 844, both centers are (195, 422); reload and out-of-arc labels are contained and separate.

Current screenshot capture failed with Orca's `Page.captureScreenshot` timeout. Live verification is limited to rendered DOM geometry and diagnostics; no current screenshot is claimed. The detector found advisory references to inherited HUD colors and 10 px supporting typography only.

Independent finish disposition: **ship**. No material fixes identified within this scoped behavior/copy refinement. The reviewer confirmed the state labels, retained instrument layout in source, ammunition evidence and measured desktop/mobile alignment; current appearance and contrast could not be certified without screenshots.

| Review contract | Verdict |
| --- | --- |
| Unreachable aim distinguished from turning | Match |
| Firing availability and reload explained | Match |
| Circle/reticle centers agree through zoom | Match in measured captures |
| Eligible mounts fire independently | Match in live capture |
| Mobile labels contained | Match in measured capture |
