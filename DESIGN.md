---
name: Bismarck Sea Trials
description: Naval instruments around a full-screen ship and sea.
colors:
  ivory: "#edf1ec"
  muted: "#bacbd0"
  accent: "#e0c58d"
  maritime: "#132d38"
  line: "#cfdfdf35"
  field: "#0e2530"
  field-text: "#e1e9e9"
  command-ink: "#152b32"
  command-hover: "#efd5a0"
  port-accent: "#e5bf80"
  port-ready: "#94d9bf"
  fleet-active: "#86e4c5"
  fleet-text: "#f0f5f3"
  fleet-muted: "#c1d0d4"
  fleet-line: "#c9dce04a"
  fleet-damage-gold: "#e8c56c"
typography:
  body:
    fontFamily: "Barlow, sans-serif"
  instrument:
    fontFamily: "Barlow Condensed, sans-serif"
    fontWeight: 500
  control:
    fontFamily: "Barlow, sans-serif"
    fontSize: "11px"
rounded:
  control: "3px"
  instrument: "2px"
  slot: "1px"
spacing:
  fleet-edge: "24px"
  fleet-bottom: "20px"
components:
  fire-button:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.command-ink}"
    rounded: "{rounded.control}"
  fire-button-hover:
    backgroundColor: "{colors.command-hover}"
  target-action:
    backgroundColor: "transparent"
    textColor: "{colors.ivory}"
    rounded: "{rounded.control}"
    padding: "8px 3px"
  select:
    backgroundColor: "{colors.field}"
    textColor: "{colors.field-text}"
    rounded: "{rounded.control}"
  port-model-view:
    backgroundColor: "transparent"
    typography: "{typography.control}"
    padding: "8px 3px"
  port-model-view-selected:
    textColor: "{colors.port-accent}"
  fleet-weapon-slot:
    backgroundColor: "#10222d80"
    textColor: "#d4e2df"
    rounded: "{rounded.slot}"
    padding: "9px 2px 3px"
    height: "64px"
  fleet-weapon-slot-selected:
    backgroundColor: "#204a486b"
---

# Design System: Bismarck Sea Trials

## Overview

**Creative North Star: "Fleet harbor / Fleet action"**

The owner-selected Fleet harbor and Fleet action studies remain the visual authority. Fleet action extends that direction with the selected World of Warships / War Thunder reference for centered mouse aiming, binocular sights and edge-mounted handling and weapon instruments. The ship and sea fill the viewport; compact naval instruments frame the scene. Port inspection extends this system with readable model views and selection details.

Navigation, gun and torpedo readiness, firing, target damage and flooding are live in the singleplayer gunnery trial. FPS uses smoothed renderer telemetry. Port freezes combat; currency, commander skills, research, orders and refits remain explicitly labeled progression previews. Inspection shows provisional combat volumes, not historically approved plate-by-plate construction.

**Key Characteristics:**

- Full-screen ship and sea, framed by compact instruments.
- Ivory and blue-gray text, brass commands, mint readiness.
- Fine borders, restrained rounding, inspectable state.
- Centered aiming with a numbered scale only in binocular view.

## Colors

Ivory and subdued blue-gray sit over dark maritime blue. Brass is the primary command accent; mint provides a distinct navigation and readiness signal.

### Primary

Brass identifies port actions and selected model views. The inherited gunnery panel uses its existing brass accent for commands and selections.

### Secondary

Mint identifies heading, hull integrity, rudder position, ready mounts and selected battery or binocular controls in Fleet action, and readiness in port. The active engine order uses an ivory fill with dark lettering and a pointing marker. Inspection swatches match their 3D volumes: armor uses a fixed thickness scale from green (0 mm) through yellow (200 mm) to red (400 mm and above), with gray teak backing; machinery is green, magazines salmon, steering lavender and compartments pale blue. A labeled thickness legend accompanies the armor list. Port armor is fully opaque, selection retains its thickness color, and hover lightens and outlines only the plate under the pointer. Blue fill represents floodwater.

### Neutral

Ivory carries primary text; muted blue-gray carries supporting readings. Fleet action uses its own text, muted and line tokens over maritime surfaces. Translucent lines separate controls from the scene while the minimap preserves the sea beneath it.

**The Command Accent Rule.** Use brass for port commands and selected model views, and mint for Fleet action readiness and navigation. Pair color with written labels or numeric readings.

## Typography

Barlow supplies controls and explanatory text; Barlow Condensed supplies ship identity, headings and numerical instruments. The hierarchy stays compact: port headings use 20 px condensed type, inspection entries use 12 px text, and supporting labels and controls use 10–11 px. Fleet action leads with speed (27 px), ship identity (20 px) and condition, bearing and ammunition readings (18–21 px); its secondary readings and control labels use compact Barlow or condensed type. Tabular numerals stabilize changing instrument readings. Preserve readable labels by reducing panel footprints and spacing.

## Layout

Fleet action keeps ship status and handling at lower left (240 px wide), armament at bottom center (340 px wide), a view-bearing tape at top center, and a fixed sight at the exact viewport center. The compact helm uses a 156 px bearing dial; armament uses 64 px weapon slots and 30 px readiness rings. The standard instrument insets use the Fleet edge and bottom spacing tokens. The upper-left scene stays clear of mission text. The quiet FPS counter sits beside pause/settings at upper right; the Damage / Frags reading sits below these controls. Gunnery details open beneath the score at 108 px from the top (100 px at widths up to 600 px, or 88 px in short landscape) and scroll within the available height.

The translucent square minimap sits flush with the bottom and right viewport edges. Its five nominal desktop sizes are 240, 280, 320, 360 and 400 px, with 320 px selected initially. Available space sets the largest size to the minimum of 400 px, 31 vw and 68 vh; every size applies its own proportional factor (60%, 70%, 80%, 90% or 100%) to that limit. This keeps all five steps distinct when the viewport constrains the map. The map has no camera toolbar above it.

At widths up to 1150 px, Fleet action narrows the handling and armament groups to 208 and 296 px and reduces side insets to 18 px. Between 601 and 900 px, they narrow to 180 and 260 px with 12 px side and 14 px bottom insets. At 600 px and below, the armament group is at most 310 px wide and moves below the top compass (100 px from the top), leaving the central sight clear; the handling group remains at lower left with a 100 px bearing dial, and map sizes step from 30 to 50 vw. Short landscape viewports (620 px high or less, wider than 600 px) hide the mount-reload row and battery heading, reduce weapon slots to 48 px high with 38 px ammunition illustrations, retain weapon keycaps and bottom clearance, and move gunnery details upward; gun marks remain in the helm compass and full mount status remains available through G.

Fleet harbor keeps the fleet carousel below the ship, commander and orders on the left, characteristics on the right, and Set sail centered horizontally in the viewport within the transparent top bar. Its instruments are approximately 15% smaller than garage study A. The ship and illustrative 3D harbor remain visible. The comparison switcher and alternate garage layouts have been removed.

Armor and Internals reuse the right detail surface, hiding the commander/orders, fleet carousel and port location during inspection. The list scrolls independently while model-view controls and selected-volume details remain pinned. Below 600 px, the inspection surface docks below the ship with 18 px side insets and a maximum height of 295 px. Narrow and short layouts rearrange instruments without a scaled virtual canvas; coarse pointers expose steering buttons.

**The Clear Center Rule.** Keep the ship and sea visible, with instruments anchored at the viewport edges.

## Elevation & Depth

Translucent maritime surfaces, fine borders and edge shading provide separation from the live scene. Soft text shadows maintain contrast over water; diffuse shadows lift the pause dialog and primary port action. Inspection fades the actual exterior model. Port armor uses opaque plates with their own depth buffer, so near plates hide deeper layers while remaining visible through the hull and sea. A neutral upper-left light follows the inspection camera, with ambient fill keeping shaded faces readable. Shading preserves thickness hues and crisp plate edges without harbor exposure or glare. Internals and combat inspection retain translucent volumes so submerged spaces remain inspectable.

## Shapes

Controls use restrained corners: 2 px on port instruments and the mouse-capture prompt, 1 px on Fleet action weapon slots and chart controls, and 3 px on inherited gunnery controls. Model-view buttons and volume rows have square edges and fine dividing rules. Circular forms belong to bearings, per-mount reload progress and aiming marks.

## Components

### Commands and navigation

Set sail is a solid brass command. Secondary actions use transparent or maritime fills and fine borders. Selected model views use a brass underline; selected Fleet action battery controls use mint borders and keycaps. Buttons expose visible focus rings; Fleet action uses a mint 2 px outline with 3 px offset. Engine orders, camera, chart range, pause, fullscreen and HUD visibility remain functional. The native pause dialog contains focus; hidden instruments are inert. Reduced-motion preference removes interface transitions and the port entrance animation.

### Sailing aim and binoculars

Mouse movement aims through the centered sailing sight while the cursor is captured. Shift or right mouse toggles binocular view. The numbered horizontal aiming scale appears only in binocular view, alongside range and magnification. Scrolling in binoculars selects 2×, 4×, 6×, 8× or 12× magnification; ordinary scrolling changes camera distance. Hold Ctrl to release the cursor for HUD controls, then release it to resume captured aim. A visible prompt offers capture when the cursor is free. Esc pauses or resumes through the pause dialog. Camera cycling and recentering remain keyboard actions (C and R).

### Ship condition and helm

The lower-left group combines the ship silhouette and name, live structure HP out of 1,000 and its integrity bar, a circular compass with ship heading, camera bearing and selected-battery gun marks, speed in knots, a vertical engine telegraph and the rudder indicator. Structure HP is derived from simulation integrity; it is not a historical durability claim. The selected engine order has an ivory pointer and fill; W/S step the order, Space stops, and A/D steer. Flooding appears with its measured volume when present. Coarse pointers expose hold-to-steer controls.

### Navigation minimap

The north-up chart follows the ship and shows its heading, camera view cone, course trail, trial target and marker buoys. NORTH UP is a static orientation label. The kilometer readout cycles the radius through 1, 2, 4 and 8 km, starting at 2 km. Separate −/+ buttons and keyboard shortcuts adjust the five map sizes; endpoint buttons disable at the smallest and largest sizes. Range and physical map size remain independent.

### Port inspection

Statistics, Armor and Internals form a labeled three-button group. Statistics shows five 0-100 category scores over collapsible sections, each led by one headline figure; every row explains its figure on hover. Armor lists hull and moving gunhouse protection; Internals lists machinery, magazines, steering and flooding compartments. Lists and overlays derive from the same compiled definition used by combat. Thickness is uniform within each armor volume; module HP and compartment capacity are provisional gameplay values.

Selecting a row isolates its volume against the ghost exterior. The row combines a category swatch, name, type and thickness, HP or capacity; selection also exposes dimensions and Clear selection in a pinned footer. Selecting the same row again or clearing restores all volumes in that mode. Rows are at least 48 px high; mobile view controls and Clear selection provide at least 44 px height. Statistics restores the normal ship view, and Set sail remains available. Hovering a plate, module or compartment in the 3D view highlights it and shows a tooltip with its thickness, hit points or flooding capacity.

Hovering a visible armor plate lightens it, adds a white outline and opens a compact maritime tooltip with name, thickness, material, dimensions and recorded basis. The tooltip stays inside the viewport and does not intercept the pointer. Dragging, moving onto controls, pausing or leaving armor mode clears the highlight. Hidden layers can be isolated from the list before hovering; hover never changes selection or combat.

### Live gunnery

The armament group shows circular reload progress and readiness for each selected gun mount or torpedo tube, with mount numbers, remaining seconds or a ready mark. Its heading pairs caliber or tube diameter and battery name with a can-fire/total count. Only eligible, loaded weapons count; unavailable mounts show a cross. Gun-aim circles distinguish Turning, Out of arc, Out of range and Blocked, and any visible seconds are labeled Reload. The circles and firing use the same eligibility state. The baseline five slots contain main AP, secondary AP, binoculars, gunnery and fire. Fitted torpedoes add a sixth slot between secondary AP and binoculars, using the same mint selection state, keycap and live ammunition count. Ammunition illustrations are independently authored SVG assets, and shell and torpedo totals come from live simulation telemetry. Keyboard 1/2 selects main or secondary AP; 3 selects fitted torpedoes. Q or left mouse fires the selected weapon group. Fire is disabled when no selected weapons are ready.

For the surfaced Type VIIC, selecting torpedoes shows five tube-readiness rings and the remaining ammunition from its initial 14 rounds. A compact muted line beneath the battery heading gives the bow/stern arcs, range and arming distance. The port characteristics show five 533 mm tubes and 14 rounds, with surface operation stated in the ship details. Gunnery labels its action Launch and explains that each press launches one eligible loaded tube, holding launches tubes in sequence, and Target waterline supplies lead for the selected target. Keep straight-course behavior explicit in that help.

G opens gunnery and releases the cursor for aim selection, trial-target condition, flooding, inspection and reset. Keep inspection exit controls reachable when details collapse. Only implemented combat features appear as live telemetry. Do not fill spare weapon slots with unsupported ammunition or consumables.

### Hull damage feedback and score

Incoming shell hits add a salmon arc and outward tip around the sight, pointing toward the source relative to the active camera. Bearings stay attached to the incoming direction as the camera turns, including binocular and shell-follow views. Armor stops and ricochets count even without hull HP loss. Nearby directions combine; at most six cues remain visible. Each holds for 1.2 seconds and fades over one second of simulation time, so pause freezes it. Keep the sight center clear, use a dark stroke for contrast over sky and sea, and follow H and port visibility.

Damage gold marks actual hull HP lost beside overhead ship labels and in the vacated section of their bars. Hits within 0.35 seconds combine into one salvo number; the segment holds for one second after the latest hit and fades over 0.6 seconds. Simulation time freezes these cues during pause. The player's lower-left hull instrument uses the same gold segment and a numeric “Hull hit” notice above it, accompanied by a translucent red perimeter cue with a clear center. Feedback uses opacity only, without camera shake or movement.

The compact Damage / Frags reading sits below the upper-right pause control. Damage counts enemy hull HP actually removed; frags count enemy sinkings credited to the last hostile hull or breach damage, including delayed flooding. Both reset with the battle. The bottom armament ends with its weapon keycaps: the Follow shells row and Ctrl/Shift/Esc hint strip are removed. T remains the configurable shell-follow shortcut. Binocular mode hides smoke emitted at the player's ship, including already active smoke, while it continues aging; other ships' smoke remains visible.

## Do's and Don'ts

### Do:

- **Do** preserve the ship and sea as the primary view.
- **Do** pair readiness and damage colors with labels or numeric readings.
- **Do** keep inspection modes, selected details and exit controls reachable while lists scroll.
- **Do** label provisional inspection geometry and progression previews honestly.
- **Do** keep the sailing sight centered and reserve the numbered aiming scale for binoculars.
- **Do** preserve five distinct minimap size steps at every responsive breakpoint, independently of chart range.

### Don't:

- **Don't** surround the scene with a dashboard page.
- **Don't** replace fine borders and restrained rounding with an unrelated component style.
- **Don't** present uniform combat volumes as historically verified armor plates or hull subdivisions.
- **Don't** invent live ammunition, consumables or combat telemetry to fill the weapon bar.

### Standalone reference review

The offline reference review uses bundled Barlow (body/controls) and Barlow Condensed (headings), with original SIL OFL notices. Its long-form evidence tables use 16 px body text, 14 px captions and 25–46 px headings, so they remain readable outside the compact game HUD. Navy surfaces and brass links extend the port styling; neutral paper behind comparison renders preserves visual evidence. On narrow screens the comparison pair stacks and tables scroll within their own region. These report sizes intentionally differ from the compact instrument labels.
