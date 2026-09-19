# Ladder playground

Run `bun run ladder:playground`; open the printed local URL with
`/?ladderPlayground=1`. `&variant=both`, `stairs`, or `framed` selects the
installation. The same development-only route works on the regular dev server.

This disposable UI asks whether adjustable inclined stairs and framed ladders
cover deck-to-deck and bulkhead access. It inherits the propeller workshop's
naval instrument styling (Barlow, navy panels, brass controls) and uses the
production renderer, real versioned custom-ship source and native compiler.
Geometry and catalog additions are durable; the inspection UI can be absorbed
or removed after user review. No layout alternatives or new visual identity
are being proposed.

Sliders change rise, run, width, handrails, wall standoff and grab extension.
The live native diagnostic distinguishes unsupported/intersecting installations.
Quarter, side, front and top views, attachment markers, context visibility and
wireframe expose the actual geometry. Source download exports the current
fixture in the shared custom-ship format; reload resets in-memory changes.
These box fixtures are installation studies, not seagoing or historical ships.

Review decision: awaiting the user's inspection of the two adjustable families.
