# Propeller support playground

Run `bun run propeller:playground`, then open the printed local URL with
`/?propellerPlayground=1`. The development-only route also works on the regular
game development server. `&variant=1`, `2` or `3` selects twin shafts, staggered
shafts or a compact screw. Left/right arrows cycle when a field is not focused.

This disposable inspection interface asks: do automatic hull fairings, flared
support fins and bearing housings read like connected ship machinery when the
player moves a propeller? It uses the actual versioned `ConstructionSource`,
Rust/WASM compiler, published propeller components and production model renderer.
The three generic hulls are original adjustable hulls, not historical claims.

Placement sliders recompile the installation, displaying native fit errors.
Fixed cameras, a stern cutaway, mesh edges and propeller rotation expose the
connections. Download exports the current custom-ship source; it does not save
to an account or add a fleet preset. Reload resets in-memory placement changes.
The sources omit engines: these are installation studies, not powered trial ships.
Mass retains the compiler's provisional solid-steel assumption. The large layouts
reuse the current generic 4.2 m component on both sides; the mirrored
animation is illustrative, not a newly authored port-hand screw.

## Implementation boundary

Production changes are in `construction_propellers.rs`, the shared blueprint
result contract, and `constructionPropellerModel.ts`. Rust emits exact loft rings
for fin sections and bearing/fairing profiles, seats their ends on closed hull
planes, and uses those same rings for clearance and mass. The renderer joins the
rings and keeps every support independent of the retained `.spin` joint.
Directly attached catalog screws retain their original geometry. A hull-exit
fairing is generated only when the shaft reaches a closed hull face; suspended
installations outside forward reach remain supported by their fitted fins.

Accepted for the game on 2026-09-18. The normal ship editor, sea trials, saved
custom designs and construction-backed exports use these shared supports.
Reopening a saved design recompiles its mounts without changing the saved format.
The playground remains available for inspection; production supports do not
depend on this route.
