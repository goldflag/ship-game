# Shipbuilding

For repository-backed ship construction, agent commands and publication, see
[construction authoring](construction-authoring.md). Blender remains the permanent
authoring tool for reusable components.

An account is required. Source revisions save to PostgreSQL; IndexedDB retains account-scoped recovery drafts. Saved valid designs can join online fleets alongside historical presets, within the [online construction limits](accounts.md#online-construction). Campaign missions still use historical presets.

Choose **New design** in port to select a Bismarck or King George V battleship hull,
Admiral Hipper or Baltimore cruiser hull, or Fletcher or Yukikaze destroyer hull.
Generic Patrol boat, Destroyer, Battleship and Barge shapes are also available.
**No hull preset** starts with the original centered 1 × 1 × 1 m block.
Cancel leaves the library unchanged. Ship-based presets derive their dimensions and
sections from the existing in-game ships, including their deck profiles, with at most
16 sections spaced at least 4% of the length apart. Bismarck and King George V have
broader end caps; generic presets have eight sections. Each starts with no equipment and remains
one editable custom hull. Fletcher is selected by default. The same chooser is available
under **Designs → New design…**. Choose **Edit design** to reopen a saved source.
The port berths only your saved designs. Ready ships line up in the fleet line beneath
the berthed ship (side arrows and ← / → step through them); **All designs** opens the
plan chest with ready ships and drafts together. Click a draft to edit it, or a ready
ship to bring it alongside. **Edit design**, **Clone** and deletion for the berthed ship sit under
its name and on every plan-chest card; a clone saves the latest revision as a new design named
“… copy” with its own history and comes alongside once compiled. **New design** is in the top bar and the plan chest, and an empty port offers
the generic and historical starting hulls directly. Designs can also be cloned or deleted from the editor's **Designs** list. Returning from the editor
saves and shows a valid design without requiring a sea trial. The separate
**Armed patrol** starter includes a gun, ammunition
integral gun ammunition, diesel machinery, funnel, propeller, rudder and mast. The twin-hull
starter preserves an exterior water channel and deliberately shows an asymmetric
machinery layout. Both are generic sandbox designs, not historical vessels.

The machinery package includes auxiliary electricity, a fixed bilge pump and an
automatic work party within its declared mass and service allowance. Damage,
immersion and exhaust loss affect those services. See
[machinery services](construction-services.md) for the reserved power, pumping
rates and repair limits.

Funnels provide shared exhaust capacity for all engines; no funnel connections
are needed. If total capacity is below total rated engine power, propulsion is
limited and the warning shows available and required kW. Spare funnel capacity
absorbs damage before power drops; destroyed or submerged funnels lose capacity.
Existing saved funnel links are ignored.

Running gear uses generic four-blade screws (1.2, 2.4, 4.2 and 6 m diameter)
and balanced rudders (1, 2, 4 and 6 m blade depth). Each is a fixed-size part
with its own mass and attachment datum.

Propellers connect to engines automatically. Select a propeller to see its
resolved **Engine** assignment; choosing an engine manually overrides it, and
choosing **Automatic** restores layout-based assignment. Existing saved engine
links remain manual overrides. New fittings, starters and suggested placements
use Automatic.

Automatic assignment covers powered engines first, accounting for manual links,
then distributes additional propellers in proportion to rated engine power.
Within that allocation it prefers the same side, an engine ahead of the
propeller, and shorter connections. Ties are deterministic, independent of source
array order. When there are more engines than automatic propellers, extra engines
share those propellers, favoring the same layout preferences and lower assigned
power. One engine can drive several propellers, and several engines can drive
one propeller. The editor lists every engine on a shared propeller. Manual
overrides remain exclusive to the chosen engine; switch a propeller to Automatic
to let it accept extra engines. Engines without a connection still provide
auxiliary services, with a warning that they supply no thrust.

Assignments update after adding, removing or moving equipment in the editor.
The compiler freezes them into the launched definition: damage never reconnects
a propeller to a different engine. Losing one engine on a shared propeller removes
only its contribution; losing the propeller stops thrust from every connected
engine. The routing is a gameplay abstraction; it does not trace physical shafts
through the interior.

Propulsion warnings identify missing engines, funnels or propellers. Click an
engine's warning to select it. Incomplete propulsion remains a warning, so you
can still launch a sea trial.

Use Hull for pieces, Machinery, Armament and Outfit for equipment, Internals for
rooms and machinery, Paint for finishes, and Armor for plating and openings. The **Surface finish**
selector in Paint applies **Matte**, **Satin**, **Semi-gloss** or **Gloss** to the
whole ship's painted hull, fittings and supports. **Original** restores authored
roughness. Colors, bare timber, glass, cloth and exposed component metals retain
their own materials. The choice saves with the design, supports undo/redo, and
carries through previews, sea trials and GLB exports; newly added parts inherit it.
Hover a face in Armor
to see its nominal plate thickness in millimetres and material. This includes
the minimum structural skin; openings show no protective plate. Pending armor
edits use the same thickness rules and color scale as the compiled preview.

Propellers automatically grow an external shaft to the hull and support arms to
nearby closed hull surfaces. Place a screw on the underside near the stern to leave
room for its blades, or move an existing screw outward; the connection follows
each edit, copy and rotation. No small hull blocks are needed. A shaft reaches
the first hull surface along its forward axis with no distance cap; braces can
reach upward up to four propeller diameters (2–10 m). Directly attached screws
keep their original support.
The compiler rejects unreachable connections, openings, blade/hull overlaps in
these suspended installations and supports crossing other fittings. Generated
steel members add weight and clearance geometry, without adding buoyancy or
power. These generic supports are an engineering approximation, not an internal
shaft-line or bearing simulation.

Generated connections use exposed metal shafts, tapered bearing housings, broad
streamlined fins with flared feet, and a tapered hull-exit fairing where the shaft
reaches the hull. An exposed shaft needs a closed hull face along the screw's
forward axis. If that line misses the hull, fins can still support the screw but
the shaft ends inside the bearing housing. Move the screw upward or inward to
meet the hull ahead, then aft to leave a visible shaft run with blade clearance.
Rust emits the same loft sections for preview/export, clearance
and provisional solid-steel loading. Fins and fairings seat against the closed
hull surface; they stay fixed while the original propeller joint spins. Shapes
refit automatically on placement changes. Directly attached catalog parts retain
their original support. The normal editor, sea trials and custom ships in battle
use the same generated mounts. Reopening an existing saved design regenerates
them automatically; no source migration or mount setting is required.
Inspect three disposable installations with
`bun run propeller:playground` (see the [playground notes](../src/ui/shipbuilding/propeller-playground/NOTES.md)).

**Snap** starts on. **N** toggles it; holding **Alt/Option** temporarily inverts it,
including during a drag. Releasing the key or leaving the window restores the saved state.
The adjacent arrow opens independent Grid, Ship centerline and Nearby edges/corners/centers
choices. Grid spacing uses a button row: 0.25, 0.5, 1, 2 or 5 m. The rail shows the
current size; click it or press **S** to cycle. Hull and fittings remember separate
session choices, starting at 1 m and 0.25 m. Freeform uses its local Move step.
Off removes grid rounding, magnetic alignment and all snap guides;
keyboard nudges still use the chosen step. Physical seating and hull overlap checks remain active.

Hull placement and movement permit intersection, provided every affected block keeps
at least **10% of its actual volume outside the union of the other blocks**. This
uses native curved, hollow and edited solids, including protection for smaller
stationary blocks. Drags stop at the limit even across a fast pointer jump; existing
excessive overlaps can be reduced. Mirrored placement, runs, Fill and copies are
checked as a complete batch. Rejected placement shows a salmon preview and the
10% rule in the placement feedback, without adding undo history. Ballast-to-ballast
overlap restrictions remain. Decorative fittings, including directors and connected paths, never collide with any other fitting. Fixed deck fittings still need physical hull support and at least 10% of their volume outside the hull. Guns, torpedo launchers and machinery retain their mutual fit restrictions, including the existing partial-overlap allowance for fixed masts and funnels. Paths retain hull and anchor checks. Placement previews suppress hover outlines on both supporting hull blocks and fittings. This is an editor placement/movement
policy; imported and freeform drafts remain recoverable through the existing compiler.
Mass, plating and buoyancy still derive from the physical union, so shared hull
volume is counted once.

Nearby source edges, corners and fitting attachment centers acquire within eight screen pixels
and release at fourteen; they override grid rounding on the same movement axis. Guides
appear only for an engaged snap, during placement or movement. Mint dotted lines join
the aligned points, with a filled dot on the moving feature, a ring on the target and
a solid highlight on a target edge. Brass marks an acquired ship centerline at the
working height (vertically in Bow view). Nearby, unaligned candidates have no guides.
**Show snap guides** hides all feedback without changing snapping; **Include ship
centerline** controls its brass feedback within those guides. Turning Snap off or
temporarily releasing it hides every snap guide immediately. These guides are independent of
Mirror and center-of-gravity markers. **Center** in the selection actions centers the selected
part or group using mounting centers while retaining relative positions, subject to collision
constraints. In freeform, snapping respects local axes and symmetry; Move nearby corners
remains a separate option for carrying neighboring vertices with an edit.

Orbit, Plan, Profile and Bow views and a deck
slice share source selections. The camera starts in perspective; **Camera** in
the view bar or **P** toggles orthographic projection while retaining the framing.
The choice is shared across layers and freeform editing for the current editor
session. Copy, mirror, bulk surface changes and undo/redo operate on stable source
identities.

Place shows a snapped preview only on existing hull faces. Empty space has no placement target. Click to place, or drag to
lay a run; Fill drags a rectangle. Every piece appears during the drag, including
mirrored pieces and loaded equipment models. Release commits one undoable edit;
Escape cancels. While placing, a drag from empty space orbits, right-drag pans and scrolling zooms. R
rotates the next piece. Shift-drag selects enclosed blocks and visible fittings in any
tool; Ctrl/⌘ adds to the selection. Right-click removes the targeted block or
fitting, and its deletion can be undone. The last hull block is protected; deleting a whole selection leaves one block and its surface assignments. The hull overlay draws creases over 20° and open boundaries, omitting coplanar seams between blocks. Hover outlines the block under the pointer when selecting, erasing or measuring. Placement shows the pending piece or path without outlining its support block.

Flat mating faces snap exactly. Curved or pointed contacts seat into the support
by at most 5 cm, creating a physical attachment instead of a single-point touch.

A floor grid sits below the hull, with brass direction markers
pointing toward the labeled bow (−Z). It resizes with the hull and uses multiples
of the snap step for larger ships. It is a visual guide, with no placement target
or simulated water plane. If placement cannot
compile, hull pieces remain visible as source envelopes while the diagnostics
explain what needs fixing. Loaded funnels, turrets and other equipment retain
their real models through edits and failed validation.

Delete beside a saved design in port or the editor’s Designs menu asks for inline confirmation, then removes the design and all its saved revisions. Deleting the open design starts a fresh one-block design. Deleted ships leave the local fleet and battle selections.

The right-hand instruments show the native compiler's mass contributions, CG,
waterline, roll stability, installed power, speed estimate and diagnostics.
Errors block launch while leaving the draft editable and saveable. Overloading,
instability and missing propulsion are warnings: the sea trial demonstrates the
consequences. Suggestions propose new placements as one undoable edit and do not
rearrange existing installations.

**Sea trial** freezes a compiled revision alongside a stationary target. Normal
helm and gun controls apply. The Sea trial panel provides controlled compartment
flooding, module/hull damage, reset, and return to the shipbuilder. Reset creates
a clean native session from the same source. Battle damage is never saved into a
design. HP/integrity defeat, flooding and capsize retain the existing rules.

Saved, valid designs also appear in **Custom battle**, where they can be the
player, friendly bots or enemies, including repeated copies. Online and campaign
modes continue to accept their historical content only.

## Doors, portholes and windows

In **Outfit → Doors & windows**, choose a ship door, round porthole,
rectangular window or rounded-rectangle window. Doors have rounded frames and
raised closure hardware; plain windows are flush silhouettes. Glazing stays opaque; fittings
do not cut holes or change flooding. Click a hull side or superstructure wall,
including sloped and faceted hull panels. The original component silhouette
follows the supporting panels. Decks and open faces are not placement targets.

Width/height (or porthole diameter) range from 0.15–5 m. **Left/Right** decreases
or increases width; **Down/Up** decreases or increases height in 0.1 m steps.
Hold **Shift** for 0.01 m steps. These keys resize the placement preview or the
selected fittings. Portholes stay circular. Linked pairs resize once together;
each step is undoable. Keys inside a text/number field retain their normal input
behavior. Position objects with the mouse and movement handles; XYZ fields and
readouts are omitted throughout the editor, including the ledger and shaping tools.

**Single** places individual windows. With nearby snapping enabled, guides align
centers and silhouette edges, including tops and sills of different sizes.
**Row** adds a center-to-center **Spacing** control. Drag along a hull side to
preview an evenly spaced row; release commits the row as one undo step. Spacing
leaves at least 5 cm between silhouettes. Escape cancels an unfinished row.
Changing spacing affects the next row.

With **Mirror** enabled, each fitting gets a persistent linked partner across
the ship centerline. Both sides must provide matching closed hull support across
the fitting's footprint. Turn Mirror off to place on just one side. **Mirror
copy** on an unpaired fitting creates the same relationship. Moving, resizing,
painting and deleting either partner updates both, even with Mirror placement
switched off. Copies form independent pairs. Saving, reopening, undo and redo
retain links. Fittings slide along their hull side and face it automatically.
Changing supporting geometry can invalidate a fitting; native diagnostics block
trials until corrected.

The existing versioned equipment record carries optional `wall` installation
settings (`version: 1`, `widthM`, `heightM`, `mirrorId`). Retained catalogs and
older designs remain loadable. The Rust compiler validates support, linked-pair
symmetry, clearance and scaled mass; the editor, trial models and portable GLBs
scale the same original component geometry.

## Bilge keels

In **Hull → Edit hull**, the **Bilge keels** section controls a symmetric pair of
tapered fins following the section surface. New hull presets start enabled;
existing saved hulls without these settings keep their original shape. Toggle
**Symmetric pair** to remove or restore the pair without losing its settings.

Set **Length** and **Center from bow** as percentages of hull length, **Width**
in metres, **Thickness** in millimetres, and **Keel → deck** as placement along
the section outline (0% at the center keel, 100% at the deck edge). Ends stay
between 2% and 98% of hull length. Each end tapers over 12% of keel length.
Section edits keep the roots seated against the hull. Settings support undo,
copy, save/reopen, sea-trial models and GLB export, with the hull's lower red coating.

These are visual fittings: they add no mass, buoyancy, armor, drag or roll damping.
The existing `customHull` record carries optional version-1 `bilgeKeels` settings;
the native compiler validates and emits their geometry separately from physical
hull surfaces. No separate ship format or equipment catalog entry is required.

## Deck fittings and connected paths

On a fitting tab (Machinery, Armament or Outfit), open the **…** drawer (or press
**0**) and search the parts by name; the search reaches all three tabs. The deck collection includes bitts, a roller fairlead, capstan, anchor
windlass, stowed anchor, lifeboat with davits, cowl and mushroom vents, watertight
door, deck hatch, vertical ladder, inclined stairs, compact optical rangefinder
and **Searchlight (unlit)**. They are generic naval parts with estimated
dimensions and masses. The rangefinder uses the existing director behavior.
Other fixed deck fittings add mass without adding buoyancy or a combat bonus.
Doors and hatches stay closed and do not cut hull openings; the boat and davits
stay stowed. The searchlight is a static model with no beam, light source, power
demand or detection effect.

Mooring rope lives under **Outfit → Mooring**. Select a completed rope and use
**Rope color** to choose a named color, or **Original rope** to restore its natural
finish. Color saves with the route, supports undo/redo and carries into sea trials
and GLB exports; ship surface sheen leaves the rope's material unchanged.

Railing, rope and chain use connected routes. Click each point on the ship, then
choose **Finish**, press **Enter** or double-click. **Backspace** or **Ctrl/⌘Z**
removes the last pending point; **Escape** or **Cancel** discards the route.
The brass route is a preview until finished, when the entire route and any
mirrored copy become one undoable edit. Finish or cancel before returning to
port, opening Designs or starting a sea trial. Railings need deck support at
every post. Choose **Two-rail railing** or **Three-rail railing** from **Outfit → Access**.
Set **Railing height** (0.3–3 m) before drawing or in the completed railing’s
object tag. Older routes retain their saved rail count and height. Routes may cross or overlap other fittings freely. Rope, chain and ladder members still need hull clearance; railings may intersect the hull. Rope and chain can attach wherever you click on hull surfaces or fixed deck fittings,
including mast poles and yardarms. Fitting clicks keep the exact surface position
without grid rounding. Native checks use the published fitting geometry for support, so empty space between mast members cannot anchor a rope. Existing designs
need **Update parts library** to use surface attachment; retained older libraries
continue to support their declared tie sockets. Moving weapons and scalable wall
details do not provide rope attachment surfaces.

Select a completed route to edit its position, bearing or individual points in
the object tag. **Insert
point** divides a span at its midpoint; **Remove point** keeps at least two
points. **Rope slack** sets the downward midpoint sag of each segment in metres,
both while drawing and after placement. Slack is limited to half the shortest
segment and 20 m. A route supports 2–64 points and at most 500 m, including its
sag. Copying, moving, rotating and mirroring retain the connected route.

On narrow screens, the drawing prompt scrolls in a compact card beside the tool
rail, with Finish and Cancel above the palette. The view controls remain below
the palette and the compass moves above the prompt.

Saved designs keep their original parts catalog. **Designs → Update parts
library** opts into the latest catalog as one undoable edit while preserving
authored hull pieces, placements and routes. If fitted variants have changed,
review the listed variants and choose **Apply parts update**. Missing fitted
variants block the update. The design recompiles against the new catalog; Undo
restores the previous catalog, and older saved revisions remain recoverable.

## Fine fitting rotation

Right-drag horizontally on a fitting to rotate it in place. If it is selected,
the selected fittings rotate together around their own mounting points. While
placing a fitting, right-drag over the hull to turn the placement preview;
mirrored previews turn in the opposite direction. Hold Shift for 0.1° per pixel
instead of 0.5°. The live angle appears above the palette. Release commits an installed fitting
change as one undoable edit; Escape, lost pointer capture or window blur cancels it.
Right-drag elsewhere still pans, and a plain right-click still removes a piece.

R rotates fittings 15°; Shift-R rotates them 1°. The bearing field accepts 0.1°
increments. Rotation reuses the visible meshes and keeps a stationary placement
preview visible; native compilation runs after an installed fitting edit commits.

## Custom hull sections

Select a custom hull and choose **Edit hull sections**. The editor covers the
builder with the hull in a full-screen 3D view: the **Hull**, **Bow** and
**Paint** ledger sits on the right, the selected section's tag floats beside its
ring and the station ruler runs along the bottom. Left/right symmetry is fixed;
every point edit also moves its mirror.

**Views.** **1** Orbit shows the hull in 3D with its section rings. **2**
Section looks forward from astern at the selected section, with the hull cut
away behind it and the sections ahead drawn as outlines inside it. **3** Plan
and **4** Profile are flat top and side views. The bow is on the left in every
view. **F** moves in on the selected section in Orbit and **Home** fits the
hull. Drag empty space to orbit (Orbit) or pan (the flat views); scrolling
zooms toward the pointer.

**Sections.** Click a ring or a ruler tab to select a section; Shift adds to the
selection, ⌘A selects every section and **[** / **]** step through them. Drag a
ruler tab to slide a section between its neighbors; the bow and stern sections
stay at the ends. The ruler's **+** between two tabs inserts an interpolated
section there. The ledger's **Sections** stepper supports 4–24 sections;
increasing retains existing sections and inserts interpolated profiles, while
reducing simplifies the shape. The tag's bin removes the selected sections,
keeping the bow, the stern and at least four sections. The tag also accepts typed
**Width**, **Deck** height, **Flare** and **Bilge** values for the selection.

**Points and gizmo.** Click a point on the selected section. Its gizmo's **X**
arm moves the point out from the centerline, **Y** changes its height and **Z**
slides the whole section along the hull; an arm pointing at the camera, such as
Z in Section view, is hidden. Drag the square plane handle to move the point
freely in the section's plane. The keel point stays on the centerline. Arrow keys
nudge a focused point by the snap step (0.1 m with snapping off). In Plan, drag
a deck edge to widen or narrow its section. In Profile, drag deck and keel
points for the sheer and keel line; the brass diamonds rake the stem and grow a
bow bulb, and the square grips move the paint-band boundaries. Escape, a right-click or
leaving the window cancels a drag.

**+ Pair** increases cross-section detail and **− Pair** reduces it. Each action
adds or removes two points in every section, then redistributes the controls at
equal distances along each side's current outline, measured in metres. Existing
points move too, while the deck edges and center keel stay fixed. Connecting the
new points approximates the previous outline; sharp corners can soften, especially
at lower detail. The focused point chooses which panel interval is split or
merged, preserving the other panel identities. Delete or Backspace also reduces
detail. Sections support 5–33 points; the deck edges and center keel cannot be
removed. Each action is one undo step.

**Blend nearby sections** fades shape edits into the neighboring sections, 35%
of the hull length either side by default. Drag the grips on the ruler's blend
band to set the reach (8–60%). Dashed brass rings on the hull and percentages on
the ruler identify affected neighbors. Drags, keyboard nudges and typed values
share this behavior.

**Snapping** is on by default. **N** or the **Snap** button toggles it, **S**
cycles its step (0.05, 0.1, 0.25, 0.5 or 1 m) and holding Alt/Option inverts it
for the current drag. Points, widths, heights and section positions round to the
step, with heights counted from the hull's base. Geometry within 10 px of the
pointer wins over the grid: the same point on the neighboring sections, the
adjacent points of the edited section, the waterline, the deck height and the
base. Widths also align with the neighbors' deck edges and the full beam, and a
sliding section also snaps halfway between its neighbors. A dashed mint guide
leads to the acquired target and the hint line names it. The Snap menu turns the
grid, section and point targets, level targets and alignment guides on or off
separately. Stem rake and bulb snap to 5%.

In a design, the ledger floats the draft hull with the design's current loading
and shows its **Draft** and **Displacement**. The native compiler measures it
in a separate worker a moment after each edit, without interrupting the
builder's own compilation. The waterline is drawn on the hull in Orbit and
across the Section and Profile views.

⌘Z and ⇧⌘Z undo and redo inside the editor. **Starter** replaces the shape with
a preset hull; Undo restores the previous shape. **Apply hull** commits the
complete shape as one undoable source edit; **Cancel** discards the editing
session. Equipment positions and existing surface assignments remain fixed, and
native diagnostics report any resulting fit errors. Armor and paint use the
shipbuilder's existing face tools.

Hull geometry consists of planar triangles. Lighting blends along panels while
preserving deck, chine, keel and end-cap boundaries. The Hull drawer also offers
a **Custom hull** block; copies retain independent editable section data.
Converting a completed custom hull into independent freeform pieces remains future
work.

## Source and compilation

The shared contract is [blueprint.ts](../src/ships/blueprint.ts).
`ConstructionSource` uses the same schema version, identity and coordinate family
as historical authoring, with a separately versioned `construction.version: 1`.
Historical hulls retain `authored-stations-v1`; constructed definitions use
`constructed-volume-v1` and contain immutable convex cells and attributed exterior
polygons. The Rust generator reads this contract; generated structs are not
maintained by hand.

The source stores primitive parameters and transforms, surface assignments,
equipment instances, boundaries, loads and an exact equipment-catalog revision.
Custom hulls use `kind: "custom-hull"` and `customHull.version: 1` in that same
primitive list. Stable section IDs, normalized outline points, bow parameters and
the primitive's beam/depth/length frame survive saving and reopening. The compiler
accepts matching odd point counts across sections. Optional point `contour`
positions retain the original 0–8 outline coordinates (keel 4), bow shaping and
unchanged panel IDs when inserting or removing pairs; legacy nine-point hulls
need no migration. Split or merged panels inherit their named side's defaults.
Rust validates symmetry, section ordering, folds and overlap, then derives closed
convex cells and attributed exterior panels for the existing compiler. Both
port and starboard use mirrored triangulation. Preview envelopes are display-only;
saved, trial and battle physics use the native compiled volume.
The grid is a placement aid, not the physical discretization. Box, wedge, corner
and inverse-corner pieces use continuous dimensions and arbitrary hull orientation.
Sizes produce slabs and long/shallow slopes without rounding away partial volume.
The Hull drawer also includes a square pyramid (⅓ hull), cylinders and partial
cylinders, spheres and domes, open dome shells, a cone, round hollow cube,
concave corner, six windowed bridge blocks/panels (straight, diagonal and rounded
in each form), and a generic supported breakwater. Closed shapes and their
open-shell counterparts remain separate entries. Both Hull and fitting drawers
have search; Hull searches shape names and notes. Size controls cover the
reference images' duplicate block dimensions; curved pieces use one smooth
visual treatment.

**100 t ballast** is a Hull block with a fixed 100,000 kg payload plus its
structural casing and any assigned armor. Resizing changes its occupied volume,
not the payload mass. It excludes its fill from floodable space and contributes
mass, CG and inertia at the placed position. Overlapping ballast blocks are
rejected. The ballast remains visible, selectable, copyable and undoable like
other hull blocks.

Coordinates remain metres, +Y up, -Z bow and +X starboard. Compilation does not
recenter a design or move the hull separately from its contents. Equipment yaw
uses the existing clockwise bearing convention. Published parts retain their
original datum and sockets; bounds centers are not replacement pivots.

Connected fittings store `path.points` in equipment-local coordinates and an
optional `path.slackM` in the same versioned construction source. The catalog
supplies the railing, rope or chain profile; the equipment position and bearing
transform the whole route. Native compilation owns support, hull clearance, length,
mass, center of gravity and inertia. Procedural route meshes in
[constructionPathModel.ts](../src/game/constructionPathModel.ts) display those
source points and catalog profiles without adding a second physics solver.

[construction.rs](../crates/naval-sim/src/construction.rs) and
[construction_geometry.rs](../crates/naval-sim/src/construction_geometry.rs)
perform the authoritative derivation. WASM exports `compile_construction` and
`suggest_construction`; the native `compile_construction` example accepts the
same source/catalog JSON. TypeScript owns commands, storage and rendering, and
does not provide a second construction-physics implementation.

Original reusable block recipes live in
[`hull_shapes.rs`](../assets/parts/construction/hull_shapes.rs). They emit convex
cells for Rust and the display-only shape library during `multiplayer:prepare`.
Thumbnails, cursor ghosts and invalid drafts use those emitted exterior polygons;
compiled previews and battles use the final native union. Open windows, shell
interiors and the hollow cube's bore remain actual exterior gaps. Curves use
16 circumferential segments and smooth lighting; buoyancy and contact use the
bounded polygons. Wall, rim and mullion proportions scale with the block's size.
These are generic construction shapes, without a historical vessel claim.

Compilation unions convex polyhedra, clips shared exterior faces, unions inward
material occupancy and subtracts material/equipment from room volume. Duplicate
envelopes do not add displacement or material twice. A connected rigid hull may
have concave sections, asymmetry or multiple immersed hulls. Final containment,
shell/torpedo contact, grounding and ship-contact checks preserve exterior gaps.

Surface assignments reference primitive IDs and canonical face names. Clipped
patches of a face share that identity; transient triangle numbers are never
source references. Zero assigned armor retains the default structural skin.
An explicit open face omits its skin and supplies a downflooding opening. Internal
boundaries are independent material planes; removing one merges its spaces.

Catalog-declared gun/funnel installation wells may cross their supporting deck.
The compiler reserves their interior intersection and removes crossed support
skin without changing displacement or cutting side armor. The fitted enclosure
seals the opening until its damage owner fails. Other impossible material or
functional overlaps remain errors.

New and edited custom designs use construction version 2. Magazines are no longer
placeable or manually linked: turret wells have an integral magazine at their
lower end, deck-mounted guns carry local ready ammunition, and each torpedo bank
carries its own ready torpedoes. The Internals layer shows the derived ammunition
volumes; selecting one selects its weapon.
Opening an older design converts its separate magazines and links in one undoable
edit. Original saved revisions and version-1 repository presets remain readable.

**Turret rise** in a selected gun's tag (or Page Up / Page Down with only guns selected)
raises the mount by 0–30 m while keeping its deck attachment fixed. Turret wells
retain their catalog working depth; omitted wells on larger guns use the existing
radius-based depth estimate. Neither extends automatically to the hull bottom.
Raising a turret extends its support above deck while its lower magazine stays fixed.

Deck mounts use the component's original pedestal and local ready ammunition,
without a below-deck shaft or deck opening. An explicit empty catalog occupancy
selects a deck mount; for older catalog entries with no occupancy, guns below
100 mm default to this treatment. An explicit working well takes precedence at
any caliber. Raising a deck mount adds a support entirely above deck, and its
ready ammunition moves with the mount. These fallback classifications, ammunition
sizes, structural skin and rise limits are gameplay approximations. Moving the
whole fitting moves the entire installation.

The complete internal support must fit the hull. Side or bottom protrusions,
intersections with other equipment, loads or internal walls, and missing support
block Sea Trials while leaving the draft editable and saveable. Raised supports
contribute structural weight, CG, protection and native articulation clearance;
they add no buoyancy. Torpedo package masses already include their ready rounds.

Turret working wells contain a fixed steel trunk and deck collar supporting the
original roller rim. Their material mass, CG and protection are included once;
they do not create displaced volume. They use the design's default structural
thickness, without inferring historical barbette armor. These derived equipment
supports remain visible in inspection and follow their fitting rather than
becoming editable hull-face assignments.

Loading uses steel at 7,850 kg/m³, seawater at 1,025 kg/m³, real material positions,
fixed equipment/service allowances and initial ammunition. An explicit **Internal
allowance** adds 150 kg per cubic metre of the complete union envelope for
unmodeled framing, decks and general outfitting. Overlapping hull pieces count
once. This provisional game load is distributed uniformly within the envelope's
lower half by height; its clipped volume supplies its CG and rotational inertia.
It gives otherwise empty shells low internal weight without requiring every
interior fitting to be placed. Fitted equipment and authored steel still add their
full weights. The allowance does not create machinery, armor or occupied solids,
and does not reduce floodable capacity; detailed internal packing is not modeled.
It applies when either supported construction version is compiled, including
reopened custom designs. Heavy or top-heavy designs can still sink or capsize;
there is no forced stability target or per-design buoyancy multiplier. Exact clipped volumes
supply buoyancy and usable room water capacity. Floodwater, machinery immersion
and loss use native simulation state. Resistance, wave effects, package masses
and handling remain documented engineering/game approximations rather than
certified naval performance. [Maneuvering](maneuvering.md) now uses forces at each
propeller and rudder, including signed leverage, fitting bearing, immersion and
local propeller wash. Hull resistance uses wetted skin, bluntness, fullness and
length; loaded mass and yaw inertia govern acceleration and turning response.
Floodwater updates those loading properties. Port handling readings are estimates;
sea trials measure the complete coupled motion.

## Identity, storage and local authority

The compiler digest includes source, compiler version and catalog content.
Constructed IDs include a source identity and digest prefix; the complete digest
and source revision accompany the definition and model. A dedicated bounded
worker compiles editor revisions with a bounded cache of exact geometry operations.
Unchanged local clipping results are reused across block edits; fit, loading and
stability are still validated for the current source. The cache retains at most
32 MiB of estimated geometry storage and 8,192 entries, and expires operations unused in the previous
revision. It never substitutes a previous revision's physical result.

Block and fitting edits appear immediately. Background checks wait until one
second after the last committed edit, then compile only that latest revision.
Opening a design and explicitly retrying a failed check start immediately.
The ledger keeps the last checked readings, marked **last check**, during edits;
**Checks pending** changes to **Checking design…** when work is submitted.
Sea Trials remains unavailable until the current revision passes its checks.

If editing resumes during compilation, the obsolete caller is cancelled and the
idle delay starts again. At most one compilation runs with a single queued revision.
Superseded callers are cancelled immediately, while the worker finishes reusable
work and then compiles only the newest source. Switching designs or catalogs during compilation,
closing the editor, worker failures and the compilation deadline release the
worker. Stale messages cannot replace the active preview or enable Sea Trials.
While waiting, deletion or movement immediately restores source faces on touching
hull pieces, so the old clipped join does not leave a temporary hole. Source paint
and intentional openings remain visible; native union geometry replaces this
display approximation when ready.

PostgreSQL stores account-owned immutable revisions and a transactional current
revision pointer. Compare-and-swap rejects stale devices; idempotency keys make
network retries safe. Invalid physical drafts may be saved. Missing catalogs,
corrupt data, newer schemas and quota failures show recovery guidance without
overwriting originals. IndexedDB holds account-scoped unsaved recovery drafts;
“Saved” requires a server acknowledgement. The old `fleet-command-construction`
database is available only through explicit import into the account library.
Catalog versions load exactly, including retained historical versions. Source
export remains a local backup. See [account storage](accounts.md#source-storage-and-recovery).

[localShips.ts](../src/ships/localShips.ts) is a port presentation registry.
Each battle freezes its own selected revisions. `LocalRuntime.with_construction`
recompiles these sources against their exact catalogs and installs them in a
cloned native catalog alongside trusted historical content. It does not accept
arbitrary supplied physical definitions or mutate the online manifest.
Unknown local IDs are errors, never a historical fallback. Trial controls are a
guarded local API and are absent from the multiplayer command protocol.

## Production models and bounds

[constructionModel.ts](../src/game/constructionModel.ts) composes native exterior
polygons with immutable component GLBs under `models/components/`. It verifies
component/definition identity, prefixes instance joint/socket IDs and preserves
independent articulation. Armor and compartment inspection renders native
polygons/voids. Named paints use shared naval finish values and metric UVs across
neighboring pieces. Obsolete previews dispose geometry, materials and textures.

See [shared components](shared-components.md) and the
[construction catalog notes](../assets/parts/construction/README.md) for original
builders, publication commands, retained revisions and provisional package data.
Player save/compile/launch needs the production browser assets and WASM only;
Blender and the model-viewer server are authoring/review tools.

The compiler bounds source JSON to 16 MB and an individual catalog to 4 MB. A design
allows 10,000 primitives, 65,536 face assignments, 128 equipment instances, 128 loads
and 24 boundaries, with 131,072 disjoint cells, 128 faces per cell, 4,194,304
face vertices per checked geometry collection, 131,072 skin patches and 16,384
flooding portals as derivation
bounds. Intermediate clipping collections share these limits; their counts need
not equal the final hull's runtime cell count. Piece dimensions
are 0.01–500 m and finite positions lie within ±1,000 m. Complexity-limit failures
preserve the source and require simplifying the offending geometry. These are
technical bounds, not a promise that every maximal arrangement compiles quickly.

Analytic box/wedge checks use 1e-7 tolerances for small-fixture volume/centroids;
material overlap tests use 1e-6 kg. The implementation plan's execution record
tracks actual native/WASM, browser, asset and performance validation. A standalone
component check does not certify the movement envelope of every installation.

## Measured scenarios and approximations

The September 2026 checks used an Apple M5 Pro with 48 GiB memory and 18 logical
CPUs. The synthetic large source in
[construction-editor-performance.ts](../scripts/tests/construction-editor-performance.ts)
has two hull primitives, seven equipment instances and three internal boundaries.
It is a 106,433.267 t volume/loading fixture with 513 native surface patches,
including fixed equipment supports. Its simple geometry does not establish
maximum-complexity performance. Final browser measurements used the production
compiler, auxiliary services and retained catalog `383c61d7…`:

| Source | Mass | Native patches | Worker compile | Recompile | Mean edit/history | IndexedDB save / reload |
| --- | --- | --- | --- | --- | --- | --- |
| Armed patrol | 266.380 t | 457 | 62.9 ms | 13.9 ms | 0.012 ms | 0.5 / 0.2 ms |
| Synthetic large hull | 106,433.267 t | 513 | 12.5 ms | 12.3 ms | 0.012 ms | 1.5 / 0.4 ms |

Assets were cached. The patrol sample starts a new worker/WASM instance and the
large sample reuses it. These measurements exclude rendering and launching.
Separate native/WASM compilation of the same large source agreed on the complete
derived result; median compilation was 3.327 ms native and 14.218 ms in WASM,
including JSON parsing in the latter.

A renderer-free large-ship trial against stationary Liberty advanced 600 ticks
in a median 15.332 ms in WASM. A three-actor fixture with a 60%-flooded patrol
compartment, its dry sister and stationary Fletcher took 1.459–1.497 s for 600
ticks over three runs, including automatic pumping. The worst measured tick was
6.19 ms. These bounded scenarios exclude rendering and snapshot serialization;
they do not establish a frame-rate or fleet-size guarantee.

Actual static production trials loaded the armed patrol starter in 12.65 s, an
armor refit in 12.72 s, and the large fixture in 12.29 s. These timings run from
the Sea trial button to the trial controls becoming available, including model
composition and renderer preparation. They used the initial reviewed compiler
and current 15-part catalog while other development checks were running. They
are individual observations, not latency guarantees.

The patrol trial demonstrated propulsion, steering, ammunition use, compartment
flooding, changed attitude, machinery loss, HP damage and reset. The large trial
spawned with its derived mass and HP, operated its rudder and gun, and accelerated
slowly with the same small machinery package. A separate two-versus-two custom
battle used three copies of one saved revision alongside a historical preset.
The final production patrol, including physical supports and auxiliary services,
weighs 266.380 t with 854 HP. It reached 11.4 kn, steered to starboard and fired
three rounds. Injecting 1% water into its actual machinery room assigned the
automatic party and reduced water from 6.5 to 6.1 m³. Disabling the engine stopped
pumping and propulsion; reset restored zero water, 360 rounds, full condition and
neutral controls. Return reopened the undamaged source with its original loading.
Browser background throttling prevented a useful sustained frame-rate sample;
these results do not establish a frame-rate or fleet-size guarantee.

Material and displacement integrals use the actual authored polyhedra. Equipment
inertia uses fixed envelopes and the simulation consumes diagonal inertia,
rather than a fully coupled tensor. Openings operate on whole exposed source
faces; internal decks and bulkheads are full axis-aligned planes. Flow uses
lumped opening area/pressure, terrain contact samples downward-facing vertices,
and collision response retains the existing planar impulse model after testing
actual cell intersection. Suggestions are bounded searches and can explain a
fit failure without finding every feasible arrangement. Initial service and
ammunition loading is fixed; expenditure does not recalculate dry mass.

### Balconies

Choose **Hull → Balcony** (palette slot 2) for a 2 × 1 m platform with solid walls.
Place it against a hull or superstructure, then use the normal move
handles or Page Up / Page Down to position it at any height. A detached platform
can be saved, but needs physical contact before Sea Trials.

Select the block and choose **Edit balcony outline**. Drag numbered points or whole
edges in the plan drawing, or use arrow keys on a focused point or edge. A dragged
edge moves both of its points together. Right-click an edge to add a point there.
Deselecting the balcony closes the editor. The outline grid defaults to
**0.25 m**, with **No grid**, **0.125 m**, **0.25 m**, **0.5 m** and **1 m** choices.
Dragging and arrow keys use the chosen step; without a grid, dragging is free
and arrow keys move 0.1 m. **Add point** splits the selected outgoing edge; **Remove point**
joins its neighbors. Outlines allow 3–32 points, including concave shapes.
Crossed outlines remain editable drafts and block launch until corrected.

Click an edge and choose **Open**, **Railing**, **Triple railing** or **Solid wall**. All edges start
as solid walls; edge height and wall thickness are shared within the block. The middle
block dimension is **Deck thickness**. Railings have posts and two rails; triple railings have three.
Every completed edit supports Undo/Redo; Escape, right-click or losing pointer
capture cancels an active point or edge drag. Copy/mirror and source save/reopen preserve
the points and edge choices. Native compilation accounts for solid platform and
edge steel without creating an enclosed room between the rails.

### Freeform hulls

Hull type chips filter the palette and expanded picker by Boxes, Slopes & corners, Curves, Shells, Bridges, Hulls & decks, or Ballast. **All** restores every type. Search combines with the filter, and **1–9** select the first nine visible cards.

The freeform panel shows **width × height × length** in local block axes, including live changes during dragging. Cancel restores the committed reading; undo and redo follow the source. The selected block’s size fields measure its edited shape, and typing a dimension scales that shape to the requested measurement. Placement-card tooltips and corner labels follow the chosen placement size.

Select an editable block in the Hull layer and press **D** or choose **Freeform**. The unfiltered palette starts with a standard **Block**, 4 × 4 × 4 m, with the same thumbnail style as other boxes. This mode edits individual eight-corner pieces. For a whole main hull, prefer the separate [custom hull section editor](#custom-hull-sections).

Choose **Vertex**, **Edge** or **Face** (keys **1**, **2**, **3**; **4** selects rings on curved shapes) to move one corner, an edge's two corners or a face's four corners. A session opens on **Face**, and the editor remembers the last mode for the next block. The eight corners, twelve edges and six named faces keep fixed topology. Click a handle, edge or face to select it; the selection menu also reaches obscured components. Edge and face movement preserves the selected component's shape. Use the canvas handles to position the selection.

**Mirror X/Y/Z** reflects movement across the selected block's local planes. X starts on; no axes selected means symmetry off. Both sides remain selectable. Brass marks the selection and mint marks mirrored corners/components. An edge or face spanning a mirror plane cannot translate across it: the corresponding gizmo axis is disabled. For example, a top face can rise with X symmetry enabled but cannot slide sideways. Mirroring preserves existing asymmetry rather than forcing the shape to become symmetric. This is separate from whole-ship **Mirror**: when another block mirrors the one being shaped across the centerline, the panel shows a **Twin** control (also **M**), and while it is on every reshape is applied to that twin too, in the live preview (mint) and in the same undo step. Whole-block mirror copies retain deformed geometry and face assignments.

**Move step** cycles through 0.05 → 0.1 → 0.2 → 0.5 → 1 → 2 m, also with G. It starts at 0.2 m and quantizes displacement from the start of an edit. Drag an **X/Y/Z** gizmo handle to move along that explicit local axis; arrow keys nudge a focused axis handle. Drag the selected component or center handle in the local coordinate plane most directly facing the camera. Axes pointing directly toward the camera have no usable screen direction: change view to reach that axis.

**Move nearby corners** starts off. Enabling it also moves matching corners within 0.025 m on neighboring cube or freeform hulls, including matches at mirrored corners. Matches use the unchanged source at drag start; no persistent seam or block relationship is created. Equipment stays at its source placement. Native support/fit diagnostics identify equipment that loses support.

Side, Top and Bow are orthographic camera presets. P and the projection button switch between orthographic and perspective cameras while retaining framing; O also works in freeform mode. One drag commits one undo step, including mirrored and nearby corners. Escape, right-click, lost pointer capture, window blur, changing editing options or projection, and returning to the drag origin cancel without writing source/history. **Reset edit** restores the selected block's shape at session entry; **Done** keeps edits and leaves freeform mode.

**Round / chamfer** treats any combination of the twelve cage edges while retaining one source block and ID. Select edges by number (hover to identify the edge in the viewport), use **Toggle selected edge**, or choose **All edges**. Local mirror axes select the reflected edges too. **Round** creates a curved transition; **Chamfer** cuts a flat strip. One metric radius/cut width applies to the treated edges. Zero restores sharp edges. The limit is 45% of the smallest local frame dimension. Fillets intersect at shared seams; three treated edges meet in a faceted spherical corner patch. Radius is measured in the undeformed block frame, then follows its corner deformation.

Round/chamfer uses the same undo/redo and saved-source path. **Remove edge treatment** restores sharp edges while keeping the edited corner cage; **Reset edit** restores the complete session-entry block. Remove the edge treatment before using the independent-piece Split command. Invalid or overlapping solids remain recoverable drafts but cannot launch. Rust compiles the faceted geometry used for collision, armor, support and buoyancy; the browser preview is checked against it. The optional version-1 `shaping` record contains edge indexes, radius and style. Older eight-corner sources remain compatible.

**Split…** opens local axis and count controls. It cuts the block into 2–16 independent eight-corner children, preserves the trilinear corner-defined shape and outer face assignments, gives children new stable IDs, and starts new cut faces with structural skin. Escape closes the popover first. The split is one undo step and obeys the existing 512-piece split limit. On a warped block, these parameter cuts need not be world-aligned planes. Corners remain editable after undo, save and reopening.

The same versioned construction source supports `kind: "vertex"` with optional `vertices: Vec3[]` (exactly eight finite normalized local coordinates). The order is the four bow corners `(-X,-Y), (+X,-Y), (+X,+Y), (-X,+Y)`, followed by the equivalent stern corners. Missing coordinates denote the cube; `size` scales the local edit frame and `rotationDeg` applies yaw; optional `tilt: {version: 1, pitchDeg, rollDeg}` adds pitch and roll in YXZ order. Historical primitives remain compatible. Corner edits turn a box into a vertex hull without changing its ID.

Rust owns the physical solid and exterior. Planar convex shapes use one convex cell. Warped faces use an unbiased fan through each bilinear face's center; this is a faceted approximation of the curved surface whose signed volume is exact. Convex neighboring cells and coplanar patches are combined without filling concavities. Render, collision, armor and buoyancy use the same compiled geometry. Split children may refine surface faceting, but preserve the underlying corner-defined surface and enclosed volume. Self-overlapping, folded, collapsed, out-of-bounds or overly complex drafts remain editable and saveable; they cannot launch until corrected. This eight-corner version supports dents whose faces remain oriented outward from the block center. It does not add arbitrary mesh topology, tunnels or smooth subdivision surfaces; round/chamfer generates bounded surface detail.

### Armor on custom hull panels

Armor view shows the boundaries of each panel between neighboring hull sections,
without triangulation diagonals. Set the thickness on the Armor card, then click
or sweep panels with **Paint**; **Fill** covers a whole named side at once.
Bow and stern caps are individual faces. Mirror mode also changes the matching
opposite panel; turn it off to armor the two sides independently.

Panel assignments are saved in the existing surface records using an optional
`panelId`. Whole-side records remain defaults; panel records override them and
inherit the current paint, material and opening state when first created.
Panel identity follows the bounding section IDs and outline edge, so moving or
resizing sections preserves armor. Adding or removing sections creates new
adjacencies whose panels use the side default; unchanged panels retain their
settings. Source undo restores the preceding hull and assignments.

### Custom hull paint bands

In **Edit hull sections**, **Paint bands** adds up to eight horizontal color
bands. Each row chooses a named paint and an **Up to** height in meters above
the hull's base. Band 1 covers the lower hull; later bands cover the interval
from the preceding boundary to their own. Existing ship and per-panel paint
stays above the highest band. Use a narrow black band above red oxide for boot
topping, or choose any of the shared paint colors.

**Add band** adds an upper boundary (or splits an existing interval when there
is no space above). Remove a row to extend the next band downward; removing
all rows restores the original face paint. Heights remain ordered. Profile
and Section views show one draggable handle per boundary, with the existing
snap controls and a **Use waterline** action when the measured waterline fits
between its neighbours. Apply, Cancel and Undo work as for hull geometry.
Heights move with the hull and remain in meters when its depth changes.

The versioned optional `customHull.paintBands` contains `version: 1` and an
ordered `bands` array of `{ id, upperY, paint }`. `upperY` is hull-local Y in
meters; IDs survive height/color edits. An explicit empty list disables bands.
Old `customHull.redPaintY` sources still render as one red-oxide band and are
upgraded only when paint is edited. New settings take precedence when both
fields are present. Import and native compilation reject unsupported versions,
repeated IDs, unordered/nonfinite heights, heights outside ±500 m and more than
eight bands.

With bands enabled, older whole-bottom red-oxide defaults use the ship paint
above the highest boundary, including on rising bow and stern panels. Explicit
panel colors remain intact above the bands. The two-tone scheme also respects
the height coatings. Source assignments, armor, mass and buoyancy stay unchanged.
The hull editor previews the same coatings and existing base paints as the
main editor; game models and GLB exports clip faces at each boundary with
interpolated lighting normals.

### Inspection and placement controls

Click the active bottom-toolbar card again to return to Select and stop placing;
click a card to resume. The floor grid hides when the camera moves below it.
Internals fades the hull and exterior fittings while keeping internal machinery
visible. Armor fades structural steel and fittings to emphasize armor-steel faces.
Equipment bounding boxes are hidden; internal magazine volumes remain visible.

The Armor toolbar exposes **Skin**, the minimum structural plating thickness
for the whole design (0.1–1,000 mm). Effective face thickness is the greater of
the face assignment and Skin. A design with 16 mm skin therefore cannot produce
an 8 mm face until Skin is lowered to 8 mm or less. Lowering Skin also changes
unassigned hull plating, mass and displacement; it is an undoable source edit.

The editor opens in Select with no hull or placement card selected. Click a block,
fitting or wall to select it, then start a separate drag to move it. A drag starting
on an unselected item controls the camera. Palette tooltips stay within the
visible editor bounds.

### Freeform prisms, curved shapes and wedges

Select one box, freeform hull, prism, wedge, corner, inverse corner, pyramid,
cylinder, half/quarter cylinder, cone, dome, half/quarter dome or eighth sphere
and press **D** to enter Freeform. **D** or **Escape** finishes. The shortcut ignores
text fields and held-key repeats. Conversion preserves the original solid and is
one undoable edit; older eight-corner blocks keep their original controls.

The Hull drawer includes **Freeform prism**, **Half dome** and **Quarter dome**.
The existing cylinder, cone, dome and wedge cards also support freeform editing.
Each shape exposes its actual vertices, edges and faces. The Selected menu reaches
hidden elements. Local symmetry, snapping, nearby corners, copy/mirror and saved
revisions use the same editor behavior as the original freeform hull.

Prisms start with an eight-point outline. **Add outline point** inserts a point
on both caps; **Remove outline point** keeps at least three. Select the base or
top ring to move it with the gizmo, or change its width/depth to taper or flatten
it. Disable the relevant mirror axis to offset an outline across that plane.

Curved shapes expose **Ring** selection, width/depth, **Add ring above** and
**Remove ring**. New rings interpolate the existing surface; removing an interior
ring joins its neighboring strips. End rings and singleton crowns remain editable
but cannot be removed. Cones and domes retain real single-point crowns. Half and
quarter shapes retain their flat cut surfaces. Open a cap through the existing
Armor layer's Opening card; plate thickness uses the same Armor cards.

The optional `mesh.version: 1` record on a `vertex` primitive retains source
vertices, mirror references, stable face IDs, canonical surface names and control
rings. It replaces neither the blueprint nor the construction version. Rust
validates closed oriented topology, finite coordinates, folds and self-overlap,
and derives the same faceted surface for rendering, collision, armor and buoyancy.
Curved lighting stays smooth while caps and cut edges remain sharp. Limits are
256 vertices, 256 faces, 24 rings, and 3–32 prism outline points. Edited solids
must remain visible from their internal center; folds beyond it remain saveable
invalid drafts. Arbitrary topology, tunnels and subdivision surfaces are not
provided. Round/chamfer and independent-piece Split remain eight-corner tools.


New balconies are 1 m deep × 2 m wide and turn their wide open edge toward the
clicked supporting surface. The steel deck extends to the
full edge footprint even when an edge is open; changing a wall to open retains
that attachment. Placement seats the whole inner deck edge, including across
sloped or tapered hull panels. Resizing or editing an existing balcony reseats it
against its nearby supporting wall in the same undo step. Adjacent solid walls
meet at mitred corners.
New rope routes start with 0.15 m of midpoint sag, limited for short segments;
Rope slack still accepts zero for a taut line. Selected external fittings use the
same XYZ movement handles as hull pieces, including while placing fittings.

### Doors, vents and surface ladders

**Doors & windows** includes utility, watertight and windowed doors. The door
panel follows the wall, with rounded frames, inset leaves and strap hinges. The
utility variant has a lever, watertight has a wheel, and windowed has a circular
porthole and dog levers. **Deck gear** includes louvered and round
wall vents plus **Surface rung ladder**. Doors and vents use the existing wall
snapping, size controls, arrow-key resizing and linked mirror workflow. Vent
height changes add or remove fins at a fixed metric pitch, retaining each fin’s
section and depth. Round vents use a simple 24-sided flange.

To draw a ladder, click its first rung on a closed hull side, move the pointer
to preview its length, then click its last rung to place. The preview shows the
complete ladder and optional opposite-side copy. Backspace removes the pending
start; Escape or Cancel discards it. Every
U-shaped rung has two wall attachments, without continuous side rails. Rungs
are evenly spaced at no more than the catalog's spacing. Placement is one undo step. Welded six-sided tubing keeps the corners closed;
the attachment ends follow the supporting wall, including sloping panels. Flat and sloping sides
are supported, while endpoints near missing support or open panels are rejected.
The old fixed bulkhead ladder is removed from the current shelf. Existing saved
designs retain their original catalogs; update the parts library to use the new
fittings. These fittings leave the closed hull and room volumes unchanged.


Installed wall vents use `vent_geometry.ts` and
`src/game/constructionVentModel.ts` to keep fin sections and pitch constant when
resized. The original Blender samples remain the retained standalone models.
Railing fittings use the balcony’s plain square bars, without footplates or bolts.
Surface ladders use six-sided tubing with shared miter rings; ladder end rings
project onto their closed hull support. Railing path
instances may override `heightM` (0.3–3 m). Two-rail and three-rail profiles are
separate palette fittings. Saved `railCount` overrides (2 or 3) remain supported;
absent settings preserve the catalog height and rail count. Native loading scales rail
mass by count and post mass by height. These remain generic engineering estimates.


### Block rotation

Select one hull block and choose **Rotate (O)**. Three colored rings turn the block around ship axes: **X** pitch, **Y** yaw and **Z** roll. Each key aims the gizmo at its axis and turns the block +90° (Shift reverses); **R** turns +90° and **Shift-R** turns −90° about the aimed axis. Outside Rotate mode the same **X**, **Y** and **Z** keys quarter-turn the block about to be placed (with its mirrored twin) or every selected block in place, and **R**/**Shift-R** remain yaw. Balconies about to be placed turn in yaw only. Yaw is the initial axis. Outside Rotate mode, existing placement and fitting rotation keys retain their behavior.

Drag a ring to preview the turn with a live angle. **Snap 15°** toggles angular snapping; hold Shift for 0.1° control. Release commits one undoable edit. Escape, right-click, a cancelled pointer, losing focus or changing the view discards the preview. Escape again leaves Rotate mode and retains the selection. Ring buttons also accept arrow keys (15°, or 1° with Shift). Pitch, yaw and roll fields set exact orientation; **Reset** restores a level, forward orientation without changing shape, dimensions or position.

Orientation is stored on the shared construction primitive, so presets, editable topology, chamfers, custom hull sections and balconies retain their original shape data. Local dimensions stay width × height × length; world bounds change as the block turns. Native compilation, overlap queries, previews, snapping, mirrors and local freeform handles use the same orientation convention. Armor and paint retain source face identities. Optional version-1 tilt extends the existing source format; legacy blocks omit it and remain level.
