# Model viewer, reference review, developer console, landscapes and water impacts

Moved verbatim from [DESIGN.md](../../DESIGN.md) on 2026-09-19 (rewrapped, relative links adjusted).
DESIGN.md keeps the tokens and rules; this file keeps the detail and rationale.

### Local ship overlay

The local Model library extends the aircraft inspector's naval instrument styling: Barlow controls,
Barlow Condensed headings, dark maritime surfaces, brass commands, fine borders and 3 px control
corners. Its orthographic viewport leads, with Inspect / Overlay / Side by side controls, selected
model identity and seven camera views above the model, and fit/zoom controls with navigation help
below. Inspect opens with original materials and no reference required. Comparison modes default to
cyan “Our model” / amber “Reference” geometry; Original materials restores available local GLB
materials. Direct GameModels3D references contain geometry only, so this toggle does not supply
their source paint.

Browse library separates Ships from Components. Ships use the preset selector; component search
matches nation, family, name and stable part ID, with the matching count above the bottom thumbnail
carousel. Keep the exact variant ID, nation, family, review status and limitations readable. Preview
source distinguishes a standalone shared component from a named installation isolated from a
published ship. Reusable source and Awaiting source extraction describe authoring availability,
independently of review acceptance. Missing or stale shared previews show a build instruction; a
component with no available preview shows an explicit empty state. An installed preview includes its
attached fittings and is labeled as inspection geometry, not reusable authoring source.

Component articulation provides Traverse and Elevation in degrees, Recoil as a percentage and Reset
pose, using catalog travel limits. Mounting radius and barrel count accompany the component details.
The interface explicitly leaves surrounding platforms, neighboring mounts and ship clearance to
installation review. Component inspection uses a 1 m grid at the mount datum Y = 0; ships use a 10 m
grid at waterline Y = 0. Visible model bounds report whole-model axis-aligned dimensions including
fittings, rather than an accuracy score. Until the selected model loads successfully, bounds show
dashes and Save image and articulation controls remain disabled.

Overlay uses the cyan/amber legend; Side by side gives the panels matching captions, including
hidden and missing-reference states. Both panels share camera, zoom, alignment and scale, and stack
vertically for port/starboard views or when the scene is narrower than 640 px. Front, rear, port,
starboard, top and bottom presets support silhouette comparison; 3D restores an oblique view.
Display repeats the model colors beside visibility and opacity controls; wireframe and X-ray support
inspection. Reference selection, hull/equipment configuration and translation/rotation/uniform scale
controls appear in comparison modes. Fit model serves Inspect; Fit both serves comparison. Save
image remains in the header and exports the canvas.

Desktop keeps a 330 px scrolling sidebar beside the viewport for browsing, component articulation,
display, reference controls and bounds. At widths up to 800 px, the stage and sidebar stack in one
scrolling main region; the stage is 72dvh with a 540 px minimum, and alignment fields use three
columns. The mobile model heading uses 28 px condensed type; supporting text and compact camera
controls retain the inherited instrument density. Preserve these local proportions without applying
the game's edge-mounted HUD layout to the authoring tool.

Native controls and the canvas participate in keyboard navigation, with a brass 2 px focus outline
and 3 px offset, inset on the canvas. Focused-canvas arrows pan, +/− zoom and Home fits the view;
labeled buttons expose the same view, fit and zoom actions. Drag orbits, right-drag pans and
scrolling zooms. Selected mode, category and camera buttons expose their pressed state. Loading and
empty states use status semantics; errors provide an alert and Reload viewer action, and
saved-alignment feedback uses a status message.

Component selection uses a bottom thumbnail carousel instead of a variant dropdown. Search, nation
and exact caliber filters sit above the horizontal strip; the current model stays in place when
filtered out. The strip shows actual model renders loaded lazily through one offscreen rendering
context, selected cards have a brass border, and each card labels its nation, caliber and source
type. Previous/Next controls and arrow-key focus navigation supplement touch/trackpad scrolling. On
narrow screens filters form two columns with full-width search, cards narrow, and the carousel stays
below the independently scrolling model/control area.

### Standalone reference review

The offline reference review uses bundled Barlow (body/controls) and Barlow Condensed (headings),
with original SIL OFL notices. Its long-form evidence tables use 16 px body text, 14 px captions and
25–46 px headings, so they remain readable outside the compact game HUD. Navy surfaces and brass
links extend the port styling; neutral paper behind comparison renders preserves visual evidence. On
narrow screens the comparison pair stacks and tables scroll within their own region. These report
sizes intentionally differ from the compact instrument labels.

### Developer console

Shift-D opens a 600 px command line centred under the top instruments in port and at sea (study
"Weather Desk", option B). An amber DEV badge marks it as tooling rather than a player instrument.
Results use a condensed uppercase group column, a Barlow label and a brass `current → new` value.
Weather chips below are drag-to-scrub, and a mint border marks a value that overrides the scene.
When the console is closed, live overrides leave only a small DEV tag with their count in the same
place. It never adds cards or covers the side instruments.

### Battle landscapes

Ocean regions frame original fictional landscapes: asymmetric eroded mountain ranges, recessed
volcanic cones, irregular coves and headlands. Snow gathers on gentler upper slopes while steep
faces expose rock; tropical beaches occupy low sheltered coves. Dense forest groves use grounded
trees with varied crown proportions and muted foliage, preserving the scale of the ships and
surrounding mountains. Land, water and atmospheric haze share each map's lighting, with the sea and
naval instruments remaining clearly visible.

Treat these as authored game environments, with no claim of geographic accuracy or photorealism.
Keep generation details in the terrain notes rather than player controls. The durable map recipes
and review evidence live under `assets/maps/`; `assets/maps/review/landforms.html` compares the
fixed views, and `assets/maps/terrain-notes.md` records construction and capture limitations.

Water impacts retain the first PR #80 iteration's long, directional water streaks: curved sheets,
fine filaments and a low crown that collapse into spray. This is the owner's preferred splash
appearance. Preserve its silhouette and breakup when optimizing; the later dense parcel column was
rejected. See the current streaked-water
review.
