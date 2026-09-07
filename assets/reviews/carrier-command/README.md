# Battlefield squadron command validation

Initial validation September 6, 2026. See [the compact-controls follow-up](compact-controls.md) for the later angled, grid-free camera and baked aircraft cards. This revision changes CPU aircraft commands, launch/recovery pacing, telemetry, the actual scene camera and the carrier instruments. It does not change ship/aircraft geometry or authored assembly IDs.

## Automated checks

- `bun test`: **550 pass, 0 fail**, 69 files. See [tests.txt](tests.txt).
- Final focused camera/UI check: **6 pass, 0 fail**, including matching water projection at 1440×900 and 390×844, zoom anchoring and camera restoration. See [focused-tests.txt](focused-tests.txt).
- `bun run build`: ship/aircraft asset checks, TypeScript and production Vite build pass. See [build.txt](build.txt).
- New command regression checks: an initially empty deck; all six bombers outbound after 10.2 simulated seconds; retained payloads at a fixed loiter station; strike retasking; role/team/range/finite-coordinate validation without partial mutation; completed intercept fallback; stable squadron membership through losses and relaunch. Existing 24-plane recovery, rearm and relaunch regression passes without endurance losses.

## In-game checks

Used the local Vite preview in Orca's embedded browser, with Enterprise against Bismarck and an enemy Enterprise. DOM keyboard/context-menu events exercised the real game handlers; the development simulation advance hook provided deterministic launch-time checks. These are not physical keyboard input measurements.

[browser-checks.json](browser-checks.json) records:

- M entered the actual high camera above the rendered sea. Six fighters, then six bombers, completed launch after 10.2 seconds each; all six bombers retained their payloads.
- Selected water orders produced fixed station markers distinct from moving squadron tags.
- Hotkey 4 and an immediately following right-click on Bismarck selected Dive 1 and changed its order to Strike Bismarck, retaining six armed survivors.
- Leaving M restored Chase at about 169 m altitude, with four visible squadron tags and zero station markers.
- At 700×900, fleet status, map header, camera tools and damage readouts occupied separate vertical rows. Hit-testing reached fleet status and the scrolling damage log.
- At 390×844, the document width stayed 390 px, the squadron row stayed within the viewport and scrolled internally, and all map camera buttons passed hit-testing.

## Visual review

[map-desktop-first-pass.png](map-desktop-first-pass.png) shows the initial rendered top-down sea, grid and squadron row. It precedes removal of duplicate ship labels and the final narrow-layout fixes; it is retained as first-pass evidence only.

Later embedded-browser captures timed out while the browser was in the background, including after a bounded attempt to restore the Orca window through Computer Use. No valid mobile screenshot was obtained. The 390 px geometry and hit checks establish layout bounds and control access, not final pixel appearance.

The independent finish review returned **ship** after fixing the map overlay's stacking over fleet/damage controls and separating the header/readouts at narrow widths. Existing Barlow type, transparent naval instruments and mint/brass/salmon team/selection colors were retained. No material fixes remained in that review; mobile pixel appearance remains unverified.

## Deliberate gameplay approximations

Overlapping launch runs, 0.8-second six-plane release cadence, 60 m final spacing and 1.2-second landing rollout are accelerated gameplay rules. Aircraft transfer directly to/from hidden hangar inventory without deck crew, elevators or a deck collision solver. Successful tests and builds do not establish historical performance. See the [runtime discrepancy register](../../ships/enterprise-cv6/reports/flight-discrepancies.md).
