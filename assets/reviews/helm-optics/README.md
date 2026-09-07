# Helm, optics and combat feedback

Captured in the actual Game WebGPU renderer through Orca's embedded browser. Desktop views use 1600 × 900; the compact view uses 600 × 900. The review page is `/scripts/diagnostics/helm-optics.html`. Run `python3 assets/reviews/helm-optics/capture.py` with that page open after `window.reviewReady` becomes true.

- [Smaller steering control](smaller-steering.png): final compact five-notch rudder, 180 px wide with 26 px desktop buttons. Touch devices retain 44 px targets.
- [Persistent rudder controls and torpedo sectors](torpedo-sectors.png): earlier larger five-notch rudder, actual rudder marker, launch sectors, straight-course line and gold arming arc.
- [Overhead orbit](overhead.png): downward tilt brings the camera above the selected hull. Close and distant zoom also have regression coverage.
- [Periscope at 5 km](periscope-5km.png): Type VIIC at 7 m depth, raised eye at 2.85 m above the water, 12× optics.
- [Bismarck at 20 km](visibility-20km.png): the model remains distinguishable through the scope at the maximum battle setup distance.
- [Impact feedback](impact.png): a real CPU shell penetrates the funnel uptake plating, losing 10.5 hull HP. The label displays that part, outcome and actual HP above the impact. The existing nameplate continues to report aggregate hull loss.
- [Compact helm](compact-helm.png): the five steering notches remain available beside the minimap.

The diagnostic pins poses and uses the real HUD, camera, models, ocean and combat events. Its injected shell is a controlled test fixture, independent of the Type VIIC's fitted deck gun. The damage fixture intentionally leaves a damaged target in subsequent captures. The player depth pose is pinned directly for viewing; the depth order remains Surface in these diagnostic screenshots.

Wave probe: 128 positions on an 8 m grid around the origin at ticks 1200, 2400, 3600 and 4800, with a positive ocean step to rebuild each spectrum. In this fixed sample, previous Moderate settings (amplitude .45, peak wavelength 28 m, choppiness .8) produced a height RMS of .154 m and extrema −.423 / +.408 m. Updated settings (.18, 20 m, .55) produced .050 m RMS and extrema −.132 / +.156 m. This is a bounded visual sample, not a measured significant wave height or a historical sea-state claim. GPU samples never feed CPU combat poses.

Fog previously reached complete opacity at 16 km in the Atlantic and 17.5 km in the Arctic. The map-specific fade ends now span 45–55 km, preserving hull contrast through 20 km starts. The camera far plane remains 60 km.

Regression coverage includes persistent/rebound steering, no auto-repeat, pause and remapping; fractional scroll, magnification easing, aim retention, rapid optics reversal and mouse input during transitions; ship translation and submarine framing; impact grouping, HP accounting, battle reset and pause; and torpedo sector/course agreement without mutation of tube state. The full game/simulation run and production build are recorded in `validation.txt`.

The Impeccable mechanical scan found existing throttle pointer triangles and compact instrument typography outside its generic rules. Those established naval instrument conventions are retained. The first visual pass caught the enlarged helm crowding the depth instrument. The final CSS moves Depth above the helm and reduces the helm to 180 × 53.5 px at 1600 × 900. The smaller-steering screenshot records this final layout; the other images retain the earlier larger helm while demonstrating the camera, sea and combat changes.
