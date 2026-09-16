# Custom hull interaction prototype

Run `bun run hull:prototype`, or open `/?hullPrototype=1` on the development server.
The route is development-only. Switch layouts with the bottom arrows or
`&variant=A`, `B`, `C`; hull edits survive layout changes, but not page reloads.

## Question and review target

Can a player create a convincing destroyer hull in about five minutes without
stacking hull blocks, then shape a broad hull with a pointed or bulbous bow and
independently defined central armor belt? Keep explicit flat faces so a later
conversion into individual freeform pieces can preserve the completed shape.

Operate mode, extending the current shipbuilder's Barlow type, neutral studio,
brass commands, mint selection, fine borders and compact controls. The first
viewport pairs an editable section with the actual live hull; dragging a point
changes that surface immediately. No decorative animation. Review three distinct
arrangements: A section workshop with drawings below, B drawings first with a
stacked preview/section, C model between editing panels and a bottom drawing dock.

## Agreed feature requirements

- One custom hull block covers bow to stern; multiple blocks are allowed per ship.
- Start from a few generic hull presets, all with level decks. Adjust dimensions,
  then editable stations.
- Each section has simple controls plus outline points. Geometry uses flat triangles;
  points and stations connect linearly with no curve subdivision. Side-panel lighting
  is smoothed along the hull, with sharp deck, chine, keel and end-cap boundaries.
  Left/right symmetry is always enforced (latest user revision).
- Edit cross-sections beside a live 3D view. Top and side outlines are also editable.
- Multi-section edits include optional gradually fading influence on neighbors.
  “Blend edits into nearby sections” shows affected neighbors with dashed brass
  outlines and percentage labels. Selected sections receive the full edit; other
  sections receive `(1 - distance / .2)^2` within 20% of hull length from the nearest
  selection. Point drags, numeric edits, keyboard nudges and section shape controls
  honor this setting. Section positions and overall dimensions do not.
- Keep direct deck/keel edits, conventional bows and sterns, and underwater bow bulbs.
  Remove the Raised deck and Deck step controls and their procedural geometry.
  Decks remain closed. A bow or stern may meet exactly on the centerline; crossing
  it remains invalid. A zero-width end can be widened again.
- Armor and paint regions are independent of shaping sections.
- Existing equipment stays fixed during reshaping; production must highlight fit
  problems. No automatically generated bulkheads.
- Invalid geometry is shown in red with a reason, and cannot be committed. Existing
  physical warnings remain distinct from geometric invalidity.
- Preserve existing designs. No automatic conversion and no personal hull-template
  library. The next step is this prototype, before production implementation.

## Working interactions

Four presets; dimension fields; editable top widths, deck/keel heights and station
positions; cross-section point dragging and numeric entry; point keyboard nudges;
fixed symmetry; shift-select and select all; grouped width/deck/flare/bilge-inset
edits; nearby influence; a section count field (4–24), add/remove sections; bow rake and bulb; duplicate hulls with lateral offsets; one editable sample region;
orbit/plan/profile/bow cameras, fit and section lines; undo/redo and Escape cancel.

Number fields apply on blur or Enter. Shift-click a station number to add/remove it
from the selection. In the drawing views, drag a handle vertically to change the
outline, or drag a station line horizontally to reposition it. End stations remain
fixed. Top/profile drawing scales are expanded vertically for editing; the 3D and
cross-section views preserve physical proportions. All edits mirror to the other
side. Hot reload normalizes older in-memory asymmetric studies and their history
from starboard to port, retaining their other hull edits.

Increasing the section count inserts interpolated profiles into the largest gaps,
retaining existing section IDs and points. Reducing it removes interior sections
closest to the linear profiles between their neighbors, simplifying the shape.
Both ends are retained. Each count change is one undoable edit and affects only
the active hull; reducing then increasing is not a replacement for Undo.

## Deliberate prototype limits

This is display-only, in-memory study state, not a second ship blueprint format.
The model never enters account storage, native construction compilation, simulation,
equipment placement or the fleet roster. Armor is an annotation and paint preview;
there is one sample surface region, painted independently of mesh subdivision.
The closed surface uses authored stations only and a fixed nine-point outline per station (add/remove outline points is not yet shown).
The prototype allows up to 24 stations and three hull instances. Station spans
are triangulated into planar faces; degenerate triangles at pointed ends are omitted.
When a panel's four corners are not coplanar, its two triangles form a geometric
diagonal crease. Smoothed panel normals hide most diagonal lighting seams without
changing the geometry; strong twists can still distort the shading or silhouette.
Normals use whole-panel area weighting, independent of the triangle diagonal.
Matching neighboring section
edge slopes keeps panels planar when their section planes are parallel; reshaping
additional sections near transitions can reduce twist. Inserting interpolated
sections alone does not guarantee planar panels. Automatic planarity constraints
are not implemented.
Bow caps and end modifiers remain approximations for interaction review. Checks
cover section ordering, centerline, deck/keel clearance and outline intersections; they
are not production certification of a manifold hull or physical validity. Regions
use normalized height from the hull's reference depth, not a computed waterline.

Production must extend the existing versioned ConstructionSource/blueprint and
renderer-free Rust compiler, preserving stable station/region identities and using
the same derived geometry for appearance, armor, containment and buoyancy. It must
not promote this TypeScript preview generator into a parallel physics authority.
A later conversion from a finished custom hull into many editable freeform hull
pieces should preserve these explicit points and faces. That conversion is not
implemented by this interaction prototype, and will require native solid validation.

## Verdict

Initial feedback applied: remove procedural deck steps, accept sharp bows, force
symmetry and use flat geometry with smooth panel shading. Further hands-on user review remains pending. Record the chosen layout, awkward interactions and
whether the five-minute task is realistic. Absorb the validated design and remove
the prototype route/switcher when the production feature replaces it.

## Game integration

The accepted section editor now lives in `../CustomHullEditor.tsx`, with shared
source-editing helpers in `src/ships/customHullModel.ts`. The standalone route
still offers layout studies and the visual-only sample armor belt. Production
uses the section workshop and explicit Apply/Cancel, then the existing native
compiler, save owner, Armor/Paint tools and trial flow. New design offers four
bare hull presets and the original unit block. See `docs/shipbuilding.md`.
