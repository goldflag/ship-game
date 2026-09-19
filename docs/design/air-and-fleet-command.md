# Air operations and fleet command

Moved verbatim from [DESIGN.md](../../DESIGN.md) on 2026-09-19 (rewrapped, relative links adjusted).
DESIGN.md keeps the tokens and rules; this file keeps the detail and rationale.

### Air operations

M switches the actual scene to a high, north-up battlefield camera tilted 20° from vertical. No
grid, panel or dialog covers the sea. Ship targets, aircraft routes, loiter stations and pointer
commands share the tilted perspective projection. Compact Barlow instruments keep the naval palette:
mint friendlies, brass selection and salmon hostiles. Fit, Center and zoom controls remain small and
near the upper center; fleet status and damage stay at the edges.

The bottom row contains stable 90 px squadron cards with a baked transparent render of each group's
actual aircraft model, name, remaining count, activity and a fine surviving-aircraft indicator.
Enterprise has eight six-plane cards. Click or use 1–8 in M view; ship numeric weapon bindings
resume outside it. Cards scroll horizontally at narrow widths. The map row is centered and only as
wide as its contents; normal carrier controls sit between the helm and minimap or above the helm
when compact.

In M view, Shift-drag draws a brass selection box around owned airborne squadrons at their projected
scene positions. Command/Ctrl+Shift-drag adds the enclosed squadrons to the selection.
Command/Ctrl-click on cards, airborne labels or manifest rows toggles individual membership. A
normal click replaces a multiple selection; clicking the sole selected squadron deselects it.
Selected cards, labels and manifest rows share brass outlines. Keep the selection and rotation hint
small in the map header, adding the selected count when more than one squadron is selected.
Command/Ctrl-drag, middle drag and Shift+arrow keys rotate the view.

One compact action strip sits above the cards. L Loiter, A Strike, D Defend, I Intercept and E
Escort arm a compatible target click, with role-specific actions shown. R Return, X Recall all and V
Aircraft act immediately. Show the key on each control and the target instruction in its tooltip. A
selected action is outlined in brass; Esc cancels it before exiting the map. Right-click remains
contextual. Do not repeat the squadron title, wing inventory totals, broad instructions or
ready/launch explanations above the row; those totals belong to the wing manifest at the right edge.
Per-aircraft numbers and follow controls stay in expandable aircraft inspection. Commands and R
Return apply to every selected squadron, with the CPU validating each squadron independently. Small,
temporary feedback distinguishes accepted, rejected and partially accepted group orders.

The wing manifest docks at the right edge below the combat report, 344 px wide on desktop, and lists
every squadron under Fighters, Dive bombers and Torpedo bombers headings with per-role ready,
airborne, armed and lost totals. Its header carries the surviving aircraft count, active flights,
deck, hangar and recovery totals, a deck-suspended warning and a Hide/Show control. Each squadron
row shows its map hotkey, name, activity with mission and endurance or rearm timer, six 12 px
aircraft cells and survivors; rows select squadrons using the shared selection gestures, and every
selected row is outlined in brass. A cell fills upward with condition in the aircraft's status color
(mint ready, ivory airborne, muted returning, brass servicing), turns brass below 50 HP and salmon
below 25 HP, is crossed out when lost, and carries a brass underline for remaining payload or gun
ammunition. Hover titles give each aircraft's number, condition, armament and phase. This is the one
filled instrument in the map view: a translucent maritime surface keeps 48 condition bars legible
over cloud and wake. The manifest narrows to 300 px at widths up to 1150 px, moves below the combat
report at 800 px, scrolls within short viewports and is omitted at 600 px and below, where the card
row remains.

Airborne name tags show activity in both modes, at a smaller instrument scale. Cards and airborne
tags share distinct role icons from the existing 24 px naval icon family: a propeller fighter, a
finned bomb for dive bombers and a horizontal torpedo for torpedo bombers. Icons inherit
team/selection color; the cards retain their baked aircraft images and accessible role labels. Only
M shows the fixed cross and projected loiter radius on the water. Every selected active squadron
shows its route starting at its actual airborne position. The sea remains visible through
transparent instruments. M, Esc when no target action is pending, and Return to ship restore the
previous camera.

Following aircraft and shells allows mouse orbit (drag when the cursor is released) and wheel
distance adjustment. Keep the target tracked and ship aim/optics saved; mouse clicks control this
camera instead of firing or toggling optics. Use a tooltip on the existing follow status for these
controls, without adding another persistent instruction row.

### Fleet command · selected variation D

The [approved D study](../pve-ui-studies/README.md) keeps the sea visible beneath a compact
upper-left fleet roster and a bottom selection card. The card has a ship thumbnail, condition,
separate Follow and Take helm actions, standing orders and acknowledgement feedback. Mint identifies
friendly selections/readiness, existing salmon identifies hostile contacts and rejection, and brass
identifies an armed action or tactical pause. Keep Barlow for controls and Barlow Condensed for
headings, with 13 px body text, 11–12 px status/control annotations and 18–22 px headings. The
command UI uses responsive panels and an automatic scale floor of one times the user scale; manual
HUD scaling still applies.

A formation rail (Column, Double column, Triple column, Screen, Line abreast; C cycles) applies to
exactly one whole selected group and persists on that group; escort stations come from the
role-ordered, hull-scaled tables the deployment chart also uses, so the shape placed before the
battle is the shape that sails. Selection never changes helm ownership or camera follow. The Air
drawer spans all friendly carriers even when a surface ship is selected. Ship-follow and manual-helm
views hide aircraft information, the Air toggle, the air row and deck counts; Fleet command returns
in one action. Queue feedback must distinguish queued, accepted, rejected and superseded orders.
Local tactical pause leaves orders available. Visible keyboard focus is retained inside the command
interface because roster selection and map orders are primary interactions. Briefing/deployment
task-group columns and contact/logistics workflows remain governed by the [implementation
tracker](../pve-implementation-status.md).
