# Shell-follow camera review

Reviewed 2026-09-05 against the Bismarck custom battle in the local development game using Orca and the WebGPU renderer.

The **Follow shells** control below the weapons bar and its rebindable **T** shortcut enable the camera. It observes a player shell's authoritative position and velocity, holds on its recorded impact for 1.1 seconds, and restores the previous camera and binocular magnification. Aim remains unchanged during flight. The option remains armed for later salvos; toggling off returns early. Opening inspection or changing camera clears it. Port transitions reset it.

![Actual shell-follow view](flight.png)

`flight.png` is a direct 1440 × 900 capture of the game's rendered canvas during a live salvo. It includes the sea, shells and destination, but excludes the HTML instruments. No model, shell trajectory, lighting or effects were changed for the capture.

## Verification

- 85 targeted simulation, camera, input, keybinding and scene tests passed; 12 frame-loop tests passed. These include player-only selection, holding one shell through a salvo, impact/expiry, pause, early exit, preserved aim, water clearance, restored optics and port reset.
- `bun run build` passed, including all four published ship checks, TypeScript and Vite.
- Live game diagnostics recorded `flight → impact → ready`, with identical aim coordinates throughout. A binocular firing cycle restored its 4× magnification and 13.903874° field of view after impact.
- At 1440 × 900 and 390 × 844, browser measurements confirm 7.8 px between the weapon keycaps and the follow toggle. Mobile instruments end at y=321.3; the battle panel begins at y=350. No horizontal overflow, and the toggle is reachable at its visible position.
- Full-page screenshots timed out because the Orca browser surface was unavailable to the screenshot compositor; native desktop observation subsequently reported no on-screen window. Full HTML HUD contrast and composition were therefore not visually signed off. The canvas was inspected directly, and HUD geometry and controls were checked through the live DOM.

## Finish review

Verdict: pass within the reviewed scope; no material issues remain.

| Issue | Severity | Status | Evidence |
| --- | --- | --- | --- |
| Follow toggle overlapped weapon keycaps | P2 / medium | Resolved | 28 px CSS gap; 7.8 px keycap clearance at desktop and mobile, 28.7 px mobile battle-panel clearance, and no overflow. |
