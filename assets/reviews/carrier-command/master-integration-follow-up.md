# Follow-up master integration

Integrated `origin/master` at `a9f528f6` into the carrier branch after its
previous merge. Follow-camera orbit/zoom constants and the new pointer-capture
retry logic are both retained. The wind test fixture checks speed and direction
for both combat effects and funnel smoke. Incoming submarine controls, wide
optics and the compact shell-cycle control remain intact.

Regenerated the five stale comparison packs identified by `ship:check all`:
Bismarck, Yamato, Baltimore, Enterprise and Type VIIC. The incoming pipeline
keeps served review pages under ignored `public/ship-reference/` and links to
the runtime GLB without duplicating models or ZIPs. No ship geometry or
blueprint changes were needed.

Validation: 686 tests passed in the initial full run across 95 files. Its one
review-link test ran before comparison rebuilding finished; that test passed
when rerun after all five packs completed, bringing the passing total to 687.
Final `bun run build` passed every ship/aircraft check, TypeScript and Vite;
the existing bundle-size warning remains. `git diff --check` passed.

Earlier in-game captures retain their original version scope. This integration
adds automated validation without claiming a new live-game review.
