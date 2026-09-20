# Shipbuilder and hull-section editor

Moved verbatim from [DESIGN.md](../../DESIGN.md) on 2026-09-19 (rewrapped, relative links adjusted).
DESIGN.md keeps the tokens and rules; this file keeps the detail and rationale.

Known stale (flagged 2026-09-19, text left verbatim): the layer tabs are now Hull, Machinery, Armament,
Outfit, Internals, Paint and Armor (`src/ui/shipbuilding/builderLayers.ts`), not "Hull, Armor, Internals,
Fittings, Paint".

### Shipbuilder · "Slipway rails"

The **Freeform hull** tool uses a compact bottom instrument with Vertex / Edge / Face selection,
local Mirror X/Y/Z toggles, Move step, optional Move nearby corners and a Split popover. Position
values stay off the interface; use canvas handles. Brass marks the selected component; mint and
dashed lines identify its mirrored counterparts. A local gizmo uses labeled X/Y/Z handles (salmon,
mint and blue) plus a center plane handle. Dim and disable directions locked by symmetry and explain
the lock in the toolbar. Keep the geometry visible, retain the neutral slipway palette, and hide
ordinary placement controls during freeform editing.

The builder keeps the ship alone in the dry viewport, with a fine ground grid below the hull, over a
neutral studio sweep rather than the port's maritime blue: a radial grey gradient lit at the centre
(#3d4145) and falling to #191b1e at the edges, with neutral grey cards, lines and muted text and a
neutral hemisphere ground light, so hull paint reads true and only brass and mint carry colour. It
hangs its instruments on the edges, with compact cards for tools, palette slots and object values
and no docked inspector. A 52 px top bar carries the Port link, the design name as an inline field
with the Designs menu beneath it, centered layer tabs (Hull, Armor, Internals, Fittings, Paint)
underlined in brass, undo and redo depths, and the single brass SEA TRIALS command. The upper-left
warnings line counts blocks (salmon) and warnings (gold) and expands to one row per native
diagnostic; the tool rail sits below it as 54 × 50 px maritime cards with a 20 px glyph, a condensed
9.5 px label and its key. The active tool uses a brass border and tinted fill; enabled toggles use
mint. The hotbar is nine 64 px square maritime cards keyed 1–9 with 6 px gaps, 3 px corners and a
trailing … card. Each card shows the piece itself and no text: hull shapes and catalog parts as
offscreen renders of their real geometry in the scene's light and default heading, armor and paint
as full swatches (Custom prints its millimetres in the corner), internals tools as glyphs. Hover or
focus shows the name and reading in a tooltip card 8 px above the card. Quiet blue-gray borders
define idle cards, hover brightens the fill and border, and the selected card uses a brass border
doubled by an inset ring. The … card opens a boxed panel above the bar on the card surface with a
hairline border and shadow, holding a heading, the fittings search field, a close mark and every
card in a wrapping grid. Card surfaces are nearly opaque for legibility, with no blur or drop
shadow. The ledger is a 214 px column of hairline rows on the right (label in muted 12 px, value in
15 px condensed), a 6 px mass bar and its key; a reading a diagnostic refers to takes that
diagnostic's color. The lower-right view bar reads view, slice, snap and mirror state without
keycaps; the rail's last card, Keys (?), opens a modal dialog on a dimmed backdrop that lists every
mouse control and hotkey in four columns, with each layer's tool keys drawn from the rail
definitions.

The scene carries the cursor ghost in translucent brass, hover outlines in ivory, selections in
brass and firing arcs as translucent sectors. The ghost has no tag: one line centered above the
palette dock names the active piece with its editable size fields (or a fitting's placement and
bearing) and shows contextual placement feedback. XYZ fields and numeric position readouts are
omitted throughout the editor. Object tags are the only property UI: a hairline leader from the
object to a card with a 13 px condensed title and wrapping 11.5 px muted text, its full border mint
for selections and salmon for a launch block; inline number fields and small selects live inside the
tag. Boundaries preview as translucent brass planes sized to the hull, rooms as pale blue volumes.
The Designs menu remains a transient surface. The hotbar sits above the view controls at every
width. Up to 1100 px the tabs, slots and view bar tighten; below 860 px the ledger is omitted. At
740 px and below the hotbar uses two rows of five cards and the drawer scrolls above it.
Reduced-motion preference removes card transitions.

The floor grid follows the hull bounds beneath the keel, with brass repeated chevrons toward −Z and
a BOW label. Grid density stays bounded on large ships. The split Snap control toggles automatic
snapping (N); its arrow opens grid spacing, centerline, nearby geometry and feedback settings.
Alt/Option temporarily inverts snapping, shown with a dashed control border. Grid spacing is a
button row; the size stays visible below Snap and S cycles it. Hull and fittings keep separate grid
steps. Guides appear only for acquired snaps during placement or movement, and all disappear when
snapping is off or temporarily released. Mint dotted connectors join aligned features with a filled
moving-point marker, a target ring and a solid target-edge highlight; brass shows an acquired ship
centerline over the working plane. No floating labels cover the model. Show snap guides controls all
feedback, with Include ship centerline nested beneath it. The settings panel names the current
on/off state and explains the marks with a mint/brass legend. There is no water plane or artificial
horizon. New designs begin with one centered cube. Placement previews appear only on existing hull
faces. Select, Erase and Measure give whole hull blocks an ivory hover outline; placement keeps the
support block clear and shows the pending piece or path. Armor and Paint keep face outlines.
Deletion always preserves the final hull block. Shift-drag draws a mint selection rectangle while
holding the camera still, with Ctrl/⌘ adding to the selection. In Select a primary drag on a piece,
fitting or wall moves it along the pressed face plane (a wall along its axis) with a translucent
brass copy at the destination and the camera held still; release commits one edit. Right-click
deletes the target; right-drag pans, and a drag from empty space orbits while placing. Runs and
fills show every pending piece before release, using cached original fitting models. Equipment stays
visible while native hull compilation runs.

The **Edit hull sections** editor takes over the builder as its own full-bleed viewport on the same
studio sweep, with the hull in its builder paints (naval gray sides, deck gray deck, red oxide below
the coating line) and no floor chevrons. A 52 px top bar fading into the scene holds the title and
design name, undo and redo depths, Starter, Cancel and the single brass Apply hull command. The
right ledger keeps the builder's hairline rows: Hull (length, beam, depth, a sections stepper, then
the natively measured draft in water blue and displacement), Bow (stem rake, bulb), Bilge keels (a
symmetric-pair toggle, length, center from bow, width, thickness and keel-to-deck placement) and
Paint. Bilge keels use the existing compact controls and state their visual-only scope; keyboard
focus underlines the toggle label in keeping with the App Focus Rule. The selected section's object
tag hangs beside the top of its ring on a mint leader, or docks top left in the flat views; it
carries previous/next arrows, remove, typed Width, Deck, Flare and Bilge fields, the selected
point's name and out/up readings with + Pair and − Pair, and the Blend chip. A full-width station
ruler runs along the bottom: numbered tabs (mint when selected, brass percentages on blended
neighbours), + marks between them, a blend band with drag grips and a metre scale from BOW to STERN.
The Snap split control and a captioned View strip (Orbit 1, Section 2, Plan 3, Profile 4, Focus F,
Fit) sit at its right end above it, with the hint line to their left. Unselected rings are faint
ivory, the selected ring mint (dashed where the hull hides it) and blended rings dashed brass. The
selected point shows the builder's gizmo: X, Y and Z knobs in salmon, mint and blue plus a brass
square plane handle; an arm that points at the camera is hidden. Deck, keel and width handles are
mint knobs, the stem rake and bulb handles brass diamonds (the bulb offset on a brass hairline) and
the paint line a square red-oxide grip. An acquired snap target draws a dashed mint guide and names
itself in the hint line; the waterline (water blue, WL) and paint line (dashed red oxide) cross the
Section and Profile views. Up to 1100 px the ledger and tag narrow and the View strip drops its
caption and keycaps; at 760 px and below the ledger keeps every group accessible on a scrollable
card and the hint line is hidden. The ledger also scrolls at short desktop heights to preserve
access without covering the bottom view controls.
