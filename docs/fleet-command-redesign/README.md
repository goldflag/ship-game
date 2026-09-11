# Fleet command redesign study

Self-contained HTML study of four visual treatments for the in-battle PvE fleet command screen (`src/ui/FleetCommand.tsx`). The workflow from the selected study D is unchanged; only the chrome changes. Open `index.html` in a browser; the URL hash selects a view (`#a/ship`, `#b/air`, `#c/contact`, `#cur/ship`). Keys 1–5 switch variation, arrow keys switch state.

| Key | Variation | Idea |
| --- | --- | --- |
| A | Bridge glass | Same instruments as the helm HUD: text and hairlines over the sea, no panel fills |
| B | Plotting room | Chart first: range rings, compass rose, scale bar; watch list; contacts and receipts merged into one signal log |
| C | Command rail | One right-hand rail with Selection, Aircraft and Contacts tabs; orders grouped by kind; chart centre never covered |
| D | At the cursor | Minimal chrome: order wheel on the selected ship, floating order bar on selected air groups, popover on a report |

D shows four states (ship, aircraft, contact, follow); A–C show three with the same example data: ship (Bismarck selected, Move armed, Yukikaze straggling), aircraft (Fighters 1–3 selected) and contact (an estimated large-warship report selected). The Current tab holds acceptance-pass screenshots of master for comparison.

Bill chose D on 2026-09-09 and asked for refinements, now in the page: every ship of every formation always visible with damage dealt, formations replacing task groups (bracket on the chart, numbered, selectable), individual aircraft with type silhouettes and HP for both sides, HP and speed on chart labels, an enemy-fleet panel with a team comparison, hover-to-highlight, hotkeys on every order, middle-drag orbit, marker fade when zoomed in, and a Follow state that keeps the helm HUD while the captain steers. A–C remain for comparison. The mock chart is flat, and the ship thumbnails are the game's own model thumbnails at reduced size. Nothing here is production code.

Implemented on 2026-09-09 in `src/ui/FleetCommand.tsx` and companions; see the status note in [pve-implementation-status.md](../pve-implementation-status.md). Move is G rather than M in the shipped build because M remains the chart toggle.

Author: Claude Fable 5.1, 2026-09-09, on branch `goldflag/turbot` from master `24412824`.

## Round two

`round2.html` holds the second-round explorations after the owner reviewed the shipped screen: air-groups panel variations, mirrored fleet panels with an aircraft overview, menu placement options, one menu for ships and planes, the line and icon vocabulary, and the checklist of what shipped in that round (see the status note).
