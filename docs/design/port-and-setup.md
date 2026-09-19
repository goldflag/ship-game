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
px the top-bar actions drop their labels and the compact scores give way to the tabs alone; at 600
px and below the plate spans the width above a full-width tab row, the fleet line scrolls, the side
arrows lose their names, and the plan chest becomes one column with its search field under the top
bar.

### Custom battle conditions

The setup dialog's Conditions group contains separate Time of day, Cloud cover and Wind speed
sliders. Each uses a muted label, a brass value readout, a full-width native range control with
brass accent, endpoint labels and one short explanation. Time reads as HH:MM, cloud cover as a
percentage and wind in m/s. Reuse the deployment slider's naval styling and the settings column's
existing responsive flow. The briefing and loading screen repeat the selected values; keep cloud
cover and wind independently adjustable.

### Port inspection

Statistics, Armor, Internals and Flooding form a labeled four-button group. Statistics shows five
0-100 category scores over collapsible sections, each led by one headline figure; every row explains
its figure on hover. Fitted torpedoes lead with the tube count and identify trainable mounts and
carried reloads; fitted depth charges lead with the charge stock and expose release stations,
detonation depth and blast radius in the same row pattern. Armor lists hull and moving gunhouse
protection; Internals lists damageable guns, machinery, magazines, steering, generators and fire
control. Flooding separately exposes compartments so their outlines do not obscure equipment. Lists
and overlays derive from the same compiled definition used by combat. Thickness is uniform within
each armor volume; module HP and compartment capacity are provisional gameplay values.

Selecting a row isolates its volume against the ghost exterior. The row combines a category swatch,
name, type and thickness, HP or capacity; selection also exposes dimensions and Clear selection in a
pinned footer. Selecting the same row again or clearing restores all volumes in that mode. Rows are
at least 48 px high; mobile view controls and Clear selection provide at least 44 px height.
Statistics restores the normal ship view, and Set sail remains available. Hovering a plate, module
or compartment in the 3D view highlights it and shows a tooltip with its thickness, hit points or
flooding capacity.

Hovering a visible armor plate lightens it, adds a white outline and opens a compact maritime
tooltip with name, thickness, material, dimensions and recorded basis. The tooltip stays inside the
viewport and does not intercept the pointer. Dragging, moving onto controls, pausing or leaving
armor mode clears the highlight. Hidden layers can be isolated from the list before hovering; hover
never changes selection or combat.

### Account access

The account gate extends the harbor's navy surfaces, brass primary action, Barlow
controls and Barlow Condensed title. A single 380 px form collects email/password,
and display name on signup, before the game initializes. Its fields remain at
least 44 px high. The account menu keeps sign out, explicit legacy-library import,
and account-scoped recovery downloads together. Input fill `#193641` and error
text `#ffb9a8` retain readable contrast on the ink background; account explanatory
copy uses 14 px text. Saving feedback describes a server acknowledgement.
