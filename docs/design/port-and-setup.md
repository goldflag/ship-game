# Port, battle setup conditions, port inspection and account access

Moved verbatim from [DESIGN.md](../../DESIGN.md) on 2026-09-19 (rewrapped, relative links adjusted).
DESIGN.md keeps the tokens and rules; this file keeps the detail and rationale.

### Port design controls

Historical presets do not berth in port; they remain in Battle setup and as hull shapes in the New
design chooser, and a `?ship=` link keeps one alongside for review without edit controls. The port
reopens on the design last viewed in this browser, else the most recently edited ready design. Each
saved source shows Ready for sea (mint), Preparing preview or Draft (gold), or Needs recovery
(salmon), always with its label. Delete opens the shared inline confirmation naming the design and
its retained revisions, on a maritime surface beside Edit design; the editor’s Designs menu uses the
same control. Confirmation removes the design from storage and the local fleet; deleting the open
design starts a new one-block design.

All designs opens the plan chest over the quay, which dims and blurs behind it while the top bar and
Battle stay in place and the search field takes the right end of the bar. A back button named after
the berthed ship, the Your designs heading with its count, Ready for sea / Drafts filter chips with
counts and Recent / Name / Size sort chips lead a grid of plates at least 340 px wide and 336 px
high: a dashed-brass New design plate first, then one per design with a 160 px render, the name in
24 px condensed type, one line of length, displacement, main guns and speed, five labelled mini
score bars, and a footer of status and edit time. The berthed design keeps a brass border and a mint
Alongside now tag. Hover or keyboard focus swaps the footer for View in port (outlined brass), Edit
and Delete; drafts lead with Edit design and fade their render. Esc or the back button returns to
the quay.

With no ready design the quay stands empty rather than showing a preset. A first visit reads “Lay
down your first ship” over the sea with four generic hull cards drawn as deck plans, chips for the
six historical hull shapes and a blank block, each opening the New design chooser on that hull; when
only drafts exist the heading asks the player to finish one and links to the plan chest. Up to 980
px the top-bar actions drop their labels; at 600 px and below the plate spans the width above the
particulars sheet, the fleet line scrolls and replaces the side arrows, and the plan chest becomes
one column with its search field under the top bar.

### Custom battle conditions

The setup dialog's Conditions group contains separate Time of day, Cloud cover and Wind speed
sliders. Each uses a muted label, a brass value readout, a full-width native range control with
brass accent, endpoint labels and one short explanation. Time reads as HH:MM, cloud cover as a
percentage and wind in m/s. Reuse the deployment slider's naval styling and the settings column's
existing responsive flow. The briefing and loading screen repeat the selected values; keep cloud
cover and wind independently adjustable.

### Port inspection

The particulars column (`PortPanel.tsx`) holds Overview, Armor, Equipment and Flooding tabs; the
last three carry their counts. Overview rates the ship on five 0–100 scores, each track ticked with
every historical warship (battleships, cruisers, destroyers and escorts from the roster) and read as
a rank such as “5th of 14”; a score at 100 says capped. Historical scores come from the preset
catalog's menu summaries (`armorMaxMm` stands in for the plates), so no definition loads for them.
Eight particulars follow (hull integrity, main belt, armored deck, main battery, gun range, top
speed, turning circle, flooding reserve), then the full sheet with one section open at a time. Guns
are grouped by calibre, whatever battery a design assigns them: the heaviest calibre is the main
battery, lighter guns are secondary or dual-purpose, and guns of 40 mm or less share one Light AA
section. Fitted torpedoes lead with the tube count and identify trainable mounts and carried
reloads; fitted depth charges lead with the charge stock and expose release stations, detonation
depth and blast radius in the same row pattern. Hovering any figure writes its meaning into the
explanation line at the foot of the column instead of a title tooltip.

Armor lists zones, not plates (`src/ships/particulars.ts`). On built ships a zone follows from
structure: hull port and starboard faces are side armor, the hull top is deck, boundaries are
bulkheads, `equipment:` plates are fitting shields and other blocks are superstructure. Historical
ships name their plates, so belt, deck, barbette, conning tower and bulkhead come from the name. The
heaviest side plating (80 % of the thickest, 50 mm or more) is the main belt, and the heaviest deck
plating (25 mm or more) the armored deck. Zones run thickest first, each with a swatch on the port's
fixed green-to-red scale, a count, materials and a thickness range; selecting one isolates all its
plates and opens its thicknesses, each isolating its own plates. A search finds single plates by
name. Equipment groups the main battery (lettered bow to stern when mounts share a name), magazines
named for what they feed, machinery, electrical supply, fire control, steering, launchers and
lighter guns by calibre; groups expand into items with their position from the bow. Flooding lists
spaces bow to stern with span, contents and fixed pumps, folding spaces under 100 m³ into one row. A
side profile, drawn from every plate projected onto the centreline, heads each list: coloured by
thickness in Armor with the isolated zone bracketed, dots for equipment, boxes filled by capacity
for spaces. Lists and overlays derive from the same compiled definition used by combat. Thickness is
uniform within each armor volume; module HP and compartment capacity are provisional gameplay
values.

Selecting a row isolates its volumes against the ghost exterior (`Game.setPortInspection` takes a
list of ids); “Showing only …” with Show all is pinned above the explanation line. Selecting the
same row again, Show all or Esc restores all volumes in that mode; a second Esc returns to Overview.
Group rows are at least 44 px high. Overview restores the normal ship view, and Set sail remains
available. Hovering a plate, module or compartment in the 3D view highlights it and shows a tooltip
with its thickness, hit points or flooding capacity.

Hovering a visible armor plate lightens it, adds a white outline and opens a compact maritime
tooltip with name, thickness, material, dimensions and recorded basis. The tooltip stays inside the
viewport and does not intercept the pointer. Dragging, moving onto controls, pausing or leaving
armor mode clears the highlight. Hidden layers can be isolated from the list before hovering; hover
never changes selection or combat.

### Startup loader

One loader runs from the static markup in `index.html` through the game's own startup
(`StartupScreen.tsx`, `startup.css`; `AccountGate` keeps it mounted). It is Scharnhorst's
outboard profile as a line drawing on the harbor navy: pencil at 16 % ivory, ink revealed
from stern to bow by the `--p` progress property (registered with `@property` so it eases),
and a brass pen line at the ink's edge whose glow breathes through long stages. One 14 px
muted stage line sits below; there is no other text or decoration. A finished load holds
"Ready to get underway" for 450 ms and fades out over 600 ms into the port; a load that
ends in an error leaves at once. The line art (`src/ui/startup-scharnhorst.png`) is a mask
traced from `bun run ship:view scharnhorst --view profile --mode ids`.

### Account access

The account gate extends the harbor's navy surfaces, brass primary action, Barlow
controls and Barlow Condensed title. A single 380 px form collects email/password,
and display name on signup, before the game initializes. Its fields remain at
least 44 px high. The account menu keeps sign out, explicit legacy-library import,
and account-scoped recovery downloads together. Input fill `#193641` and error
text `#ffb9a8` retain readable contrast on the ink background; account explanatory
copy uses 14 px text. Saving feedback describes a server acknowledgement.
