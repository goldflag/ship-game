# Custom battle validation

Reviewed 2026-09-05. Custom battle replaces the playable sea trial with configurable friendly and enemy fleets. Each team supports up to five ships from the four registered presets, including duplicates. One friendly ship belongs to the player; all other ships are bots. The two formation lines start 5,000 m apart.

## Automated checks

- `bun test`: 96 passed, zero failed, across 18 files (5,692 assertions).
- `bun run build`: passed, including all four ship definition checks, TypeScript and the production bundle.
- New coverage exercises fleet validation and placement; bot movement, aiming, firing, reloads and damage; friendly firing lanes; disabled modules; target switching; battle outcomes; deterministic behavior at 30/60/144 FPS; mixed model loading and recovery after a failed load.
- Existing exported-joint tests still pass. No ship geometry or blueprint assets changed.

## Browser checks

The live scene loaded player Baltimore and friendly Bismarck against Yamato and Enterprise. The initial opposing lead-ship range was 5,000 m. Rendered muzzle positions remained within 0.00275 m of CPU combat poses. Bot gunfire and impact events were observed in the scene.

[Recorded UI checks](browser-checks.json) confirm selecting Enterprise as the target, inspecting that ship's modules, returning to port with reset damage and hidden bots, retaining all four roster choices, and disabling launch when the enemy roster is empty.

| View | Evidence |
| --- | --- |
| Desktop fleet setup | [Screenshot](setup-desktop.png) |
| Mobile fleet setup | [Screenshot](setup-mobile.png) |
| Desktop battle | [Screenshot](battle-desktop.png) |
| Mobile battle | [Screenshot](battle-mobile.png) |

The desktop battle screenshot shows a frozen simulation with the pause dialog closed for scene inspection. Mobile browser captures duplicate part of the lower image; this limits visual verification of the lower scene. DOM measurements confirmed the setup dialog fits the 390 px viewport without horizontal overflow, and the battle controls leave the center sight visible.

## Design review

Independent finish review: **Pass — no material design fixes required.** The UI extends the existing naval instruments, protects the player slot, explains the 5 km deployment, and exposes fleet survival, target selection and damage inspection.

| Review area | Verdict |
| --- | --- |
| Contract and incumbent styling | Pass |
| Desktop setup and battle layout | Pass |
| Mobile setup and visible battle controls | Pass |
| Mobile lower scene | Capture-limited |
| Material findings | None |

## Current limits

Bots use provisional gun ranges, ballistic lead, broadside steering and simple fleet separation. Hull collision response and carrier aircraft are not implemented; Enterprise participates with its guns. These behaviors do not establish historical accuracy. Damage and aiming remain CPU simulation responsibilities.

## Overhead ship labels and integration with master

Added names, team/slot identity and live structural HP bars above battle ships, including the player. Label positions follow the interpolated render poses; clipping removes ships behind the camera and outside the viewport. Nearby labels use separate rows and stems; placement also excludes visible HUD instruments and the central aiming sight. Flooded ships can retain structural HP while sinking, so the label preserves that value and adds an explicit sinking state.

The branch incorporates master's newer Bismarck protection data and naval gunfire effects. Mixed fleets retain their own plate definitions and gun trains when aiming; bot shot events include the caliber and velocity required by the effects system. Existing model outputs were retained from master, with no additional geometry authoring.

- `bun test`: 116 passed, zero failed, 6,255 assertions across 21 files.
- `bun run build`: passed, including ship definition checks and TypeScript.
- Added projection, camera clipping and clustered-label tests, including a regression for subpixel coordinates at row boundaries.
- [Final desktop scene](labels-desktop-final.png): label placement in the real four-preset battle, with independent player and enemy labels. [Initial capture](labels-desktop.png) preserves the view before adding HUD exclusion bounds.
- [Controlled browser fixture](labels-browser-checks.json): the real label renderer received separate 1,000, 879 and 427 HP actors; numerical readings and bar scales followed those values. Sinking, camera culling, fleet replacement and disposal also passed. These controlled values are not claimed as observed damage from this screenshot's battle.

Final independent label review: **ship**, with no open material findings.

| Material fix | Score | Evidence |
| --- | --- | --- |
| Mobile labels overlap HUD and sight | Resolved | [The original three-label geometry](labels-mobile-regression.json) now has zero overlaps. A [separate live mobile DOM capture](labels-mobile-layout.json) also has zero overlaps. The final desktop capture confirms readable labels and stems connecting to model anchors. |

Mobile screenshot verification remains unavailable because Orca's CDP screenshot operation timed out. Mobile clearance was verified through regression geometry and DOM measurements; the later live DOM capture has a different camera angle and one visible label.
