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
    backgroundColor: "transparent"
    textColor: "#d4e2df"
    rounded: "{rounded.slot}"
    padding: "9px 2px 3px"
    height: "64px"
  fleet-weapon-slot-selected:
    backgroundColor: "transparent"
---

# Design System: Bismarck Sea Trials

## Overview

**Creative North Star: "Fleet harbor / Fleet action"**

The owner-selected Fleet harbor and Fleet action studies remain the visual authority. Fleet action extends that direction with the selected World of Warships / War Thunder reference for centered mouse aiming, binocular sights and edge-mounted handling and weapon instruments. The ship and sea fill the viewport; compact naval instruments frame the scene. Port inspection extends this system with readable model views and selection details.

Navigation, gun, torpedo and depth-charge readiness, firing, target damage and flooding are live in the singleplayer gunnery trial. FPS uses smoothed renderer telemetry. Port freezes combat; currency, commander skills, research, orders and refits remain explicitly labeled progression previews. Inspection shows provisional combat volumes, not historically approved plate-by-plate construction.

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

Mint identifies heading, hull integrity, rudder position, ready mounts and selected battery or binocular controls in Fleet action, and readiness in port. The active engine order uses mint lettering and a pointing marker on a transparent surface. Inspection swatches match their 3D volumes: armor uses a fixed thickness scale from green (0 mm) through yellow (200 mm) to red (400 mm and above), with gray teak backing; machinery is green, magazines salmon, steering lavender and compartments pale blue. A labeled thickness legend accompanies the armor list. Port armor is fully opaque, selection retains its thickness color, and hover lightens and outlines only the plate under the pointer. Blue fill represents floodwater.

### Neutral

Ivory carries primary text; muted blue-gray carries supporting readings. Fleet action uses its own text, muted and line tokens directly over the game, without panel or control fills. Translucent lines separate controls from the scene while the minimap preserves the sea beneath it.

**The Command Accent Rule.** Use brass for port commands and selected model views, and mint for Fleet action readiness and navigation. Pair color with written labels or numeric readings.

## Typography

Barlow supplies controls and explanatory text; Barlow Condensed supplies ship identity, headings and numerical instruments. The hierarchy stays compact: port headings use 20 px condensed type, inspection entries use 12 px text, and supporting labels and controls use 10–11 px. Fleet action leads with speed (27 px), ship identity (20 px) and condition, bearing and ammunition readings (18–21 px); its secondary readings and control labels use compact Barlow or condensed type. Tabular numerals stabilize changing instrument readings. Preserve readable labels by reducing panel footprints and spacing.

## Layout

Fleet action keeps ship status and handling at lower left (240 px wide), armament at bottom center (340 px wide), a view-bearing tape at top center, and a fixed sight at the exact viewport center. The compact helm uses a 156 px bearing dial; armament uses 64 px weapon slots and 30 px readiness rings. The standard instrument insets use the Fleet edge and bottom spacing tokens. The upper-left scene stays clear of mission text. The quiet FPS counter sits beside pause/settings at upper right; the Damage / Frags reading sits below these controls. Gunnery details open beneath the score at 108 px from the top (100 px at widths up to 600 px, or 88 px in short landscape) and scroll within the available height.

The transparent square minimap sits flush with the bottom and right viewport edges. Its five nominal desktop sizes are 240, 280, 320, 360 and 400 px, with 320 px selected initially. Available space sets the largest size to the minimum of 400 px, 31 vw and 68 vh; every size applies its own proportional factor (60%, 70%, 80%, 90% or 100%) to that limit. This keeps all five steps distinct when the viewport constrains the map. The map has no camera toolbar above it.

At widths up to 1150 px, Fleet action narrows the handling and armament groups to 208 and 296 px and reduces side insets to 18 px. Between 601 and 900 px, they narrow to 180 and 260 px with 12 px side and 14 px bottom insets. At 600 px and below, the armament group is at most 310 px wide and moves below the top compass (150 px from the top), leaving room for the compact damage log and keeping the central sight clear; the handling group remains at lower left with a 100 px bearing dial, and map sizes step from 30 to 50 vw. Short landscape viewports (620 px high or less, wider than 600 px) hide the mount-reload row and battery heading, reduce weapon slots to 48 px high with 38 px ammunition illustrations, retain weapon keycaps and bottom clearance, and move gunnery details upward; gun marks remain in the helm compass and full mount status remains available through G.

Ships fitted with depth charges expand the armament group to 440 px for four weapon choices plus binoculars, gunnery and the firing action. Between 601 and 900 px, this expanded group fills the space between the helm and chart: its left edge is 204 px from the viewport, with 12 px clearance from the chart. Four weapon buttons occupy the first row; binoculars, gunnery and a two-column firing action occupy the second, with a 26 px row gap preserving keycaps. This arrangement also applies in short landscape, where the release help remains visible. At 600 px and below, the expanded group retains the upper position and uses the viewport width minus 24 px, capped at 380 px, with 4 px gaps between its seven controls. Keep readiness and weapon help adjacent to the controls while preserving the central sight.

The submarine depth instrument sits above the lower-left helm on desktop, sharing its 240 px width and narrowing to 200 px between 601 and 1100 px. At 600 px and below it moves to a narrow right column, with wrapped readings and hidden keyboard hints; the mouse-capture prompt moves above it. Short landscape moves depth to the upper right. These placements keep the centered sight, hull and sea visible while depth orders remain reachable.

Fleet harbor keeps the fleet carousel below the ship, commander and orders on the left, characteristics on the right, and Set sail centered horizontally in the viewport within the transparent top bar. Its instruments are approximately 15% smaller than garage study A. The ship and illustrative 3D harbor remain visible. The comparison switcher and alternate garage layouts have been removed.

Armor and Internals reuse the right detail surface, hiding the commander/orders, fleet carousel and port location during inspection. The list scrolls independently while model-view controls and selected-volume details remain pinned. Below 600 px, the inspection surface docks below the ship with 18 px side insets and a maximum height of 295 px. Narrow and short layouts rearrange instruments without a scaled virtual canvas; coarse pointers expose steering buttons.

**The Clear Center Rule.** Keep the ship and sea visible, with instruments anchored at the viewport edges.

## Elevation & Depth

During sailing, text shadows and fine instrument outlines separate readouts from the scene. Panels, buttons, keycaps, aiming labels and the chart have transparent backgrounds, including hover and selected states; screen-edge shading is removed. Port and pause dialogs retain their own surfaces. Soft text shadows maintain contrast over water; diffuse shadows lift the pause dialog and primary port action. Inspection fades the actual exterior model. Port armor uses opaque plates with their own depth buffer, so near plates hide deeper layers while remaining visible through the hull and sea. A neutral upper-left light follows the inspection camera, with ambient fill keeping shaded faces readable. Shading preserves thickness hues and crisp plate edges without harbor exposure or glare. Internals and combat inspection retain translucent volumes so submerged spaces remain inspectable.

## Shapes

Controls use restrained corners: 2 px on port instruments and the mouse-capture prompt, 1 px on Fleet action weapon slots and chart controls, and 3 px on inherited gunnery controls. Model-view buttons and volume rows have square edges and fine dividing rules. Circular forms belong to bearings, per-mount reload progress and aiming marks.

## Components

### Local ship overlay

The local overlay inherits the aircraft inspector's naval instrument styling: Barlow controls, Barlow Condensed headings, dark maritime surfaces, brass commands, fine borders and 3 px control corners. Its orthographic viewport leads, with an Overlay / Side by side switch, ship identity and seven camera views above the models, and fit/zoom controls with navigation help below. A cyan “Our ship” / amber “Reference” legend labels overlays; separate panels have matching captions. Both panels share camera, zoom, alignment and scale, and stack vertically for port/starboard views and on narrow viewports. Front, rear, port, starboard, top and bottom presets support silhouette comparison; 3D restores an oblique view. The grid uses 10 m spacing at waterline Y = 0. Display controls repeat the model colors beside visibility and opacity controls; wireframe and X-ray support inspection.

Desktop keeps a 330 px scrolling sidebar beside the viewport for ship/reference selection, hull and equipment configuration, reference translation/rotation/uniform scale, saved alignment and model bounds. Save image stays in the header. At widths up to 800 px, the viewport and controls stack in one scrolling main region; the viewport is 60dvh with a 460 px minimum, and alignment fields use three columns. The mobile ship heading intentionally uses 28 px condensed type; 12 px supporting text, alignment labels and compact mobile controls retain the inherited instrument density. These sizes are deliberate local exceptions to generic typography detector advisories.

Native controls and the canvas participate in keyboard navigation, with a brass 2 px focus outline and 3 px offset. Focused-canvas arrows pan, +/− zoom and Home fits both models; labeled buttons expose the same view, fit and zoom actions. Drag orbits, right-drag pans and scrolling zooms. Selected camera buttons expose their pressed state; errors and saved-alignment feedback use alert/status semantics.

### Custom battle conditions

The setup dialog's Conditions group contains separate Time of day, Cloud cover and Wind speed sliders. Each uses a muted label, a brass value readout, a full-width native range control with brass accent and a visible focus outline, endpoint labels and one short explanation. Time reads as HH:MM, cloud cover as a percentage and wind in m/s. Reuse the deployment slider's naval styling and the settings column's existing responsive flow. The briefing and loading screen repeat the selected values; keep cloud cover and wind independently adjustable.

### Battle landscapes

Ocean regions frame original fictional landscapes: asymmetric eroded mountain ranges, recessed volcanic cones, irregular coves and headlands. Snow gathers on gentler upper slopes while steep faces expose rock; tropical beaches occupy low sheltered coves. Dense forest groves use grounded trees with varied crown proportions and muted foliage, preserving the scale of the ships and surrounding mountains. Land, water and atmospheric haze share each map's lighting, with the sea and naval instruments remaining clearly visible.

Treat these as authored game environments, with no claim of geographic accuracy or photorealism. Keep generation details in the terrain notes rather than player controls. The durable map recipes and review evidence live under `assets/maps/`; `assets/maps/review/landforms.html` compares the fixed views, and `assets/maps/terrain-notes.md` records construction and capture limitations.

### Commands and navigation

Set sail is a solid brass command. Secondary actions use transparent or maritime fills and fine borders. Selected model views use a brass underline; selected Fleet action battery controls use mint borders and keycaps. Buttons expose visible focus rings; Fleet action uses a mint 2 px outline with 3 px offset. Engine orders, camera, chart range, pause, fullscreen and HUD visibility remain functional. The native pause dialog contains focus; hidden instruments are inert. Reduced-motion preference removes interface transitions and the port entrance animation.

### Sailing aim and binoculars

Mouse movement aims through the centered sailing sight while the cursor is captured. Shift or right mouse toggles binocular view. The numbered horizontal aiming scale appears only in binocular view, alongside range and magnification. Scrolling continuously adjusts 2×–32× binocular magnification; ordinary scrolling eases camera distance. Optics transitions preserve the aimed point over 0.42 seconds and respect reduced motion. Downward chase tilt orbits toward a near-vertical view above the hull. Hold Ctrl to release the cursor for HUD controls, then release it to resume captured aim. A visible prompt offers capture when the cursor is free. Esc pauses or resumes through the pause dialog. Camera cycling and recentering remain keyboard actions (C and R).

### Ship condition and helm

The lower-left group combines the ship silhouette and name, live current / maximum HP and its proportional bar, a circular compass with ship heading, camera bearing and selected-battery gun marks, speed in knots, a vertical engine telegraph and the rudder indicator. HP represents gameplay hull durability; exhausting it starts sinking. Gunnery shows equipment condition separately, and flooding and stability can also sink a ship with HP remaining. The selected engine order has mint lettering and a pointer on a transparent surface; W/S step the order, Space stops, and A/D steer. Flooding appears with its measured volume when present. The compact rudder instrument is at most 180 px wide with 26 px-high notch buttons on desktop and has five persistent orders, from full port through amidships to full starboard. A/D step one notch per press. Click or tap a labeled notch to set it directly; mint marks the order and a gold marker shows actual rudder position. Remove the steering keycaps. Coarse-pointer notch targets remain at least 44 px high, with the instrument allowed up to 220 px width.

### Navigation minimap

The north-up chart follows the ship and shows its heading, camera view cone, course trail, trial target and marker buoys. NORTH UP is a static orientation label. The kilometer readout cycles the radius through 1, 2, 4 and 8 km, starting at 2 km. Separate −/+ buttons and keyboard shortcuts adjust the five map sizes; endpoint buttons disable at the smallest and largest sizes. Range and physical map size remain independent.

### Air operations

M switches the actual scene to a high, north-up battlefield camera tilted 20° from vertical. No grid, panel or dialog covers the sea. Ship targets, aircraft routes, loiter stations and pointer commands share the tilted perspective projection. Compact Barlow instruments keep the naval palette: mint friendlies, brass selection and salmon hostiles. Fit, Center and zoom controls remain small and near the upper center; fleet status and damage stay at the edges.

The bottom row contains stable 90 px squadron cards with a baked transparent render of each group's actual aircraft model, name, remaining count, activity and a fine surviving-aircraft indicator. Enterprise has eight six-plane cards. Click or use 1–8 in M view; ship numeric weapon bindings resume outside it. Cards scroll horizontally at narrow widths. The map row is centered and only as wide as its contents; normal carrier controls sit between the helm and minimap or above the helm when compact.

In M view, Shift-drag draws a brass selection box around owned airborne squadrons at their projected scene positions. Command/Ctrl+Shift-drag adds the enclosed squadrons to the selection. Command/Ctrl-click on cards, airborne labels or manifest rows toggles individual membership. A normal click replaces a multiple selection; clicking the sole selected squadron deselects it. Selected cards, labels and manifest rows share brass outlines. Keep the selection and rotation hint small in the map header, adding the selected count when more than one squadron is selected. Command/Ctrl-drag, middle drag and Shift+arrow keys rotate the view.

One compact action strip sits above the cards. L Loiter, A Strike, D Defend, I Intercept and E Escort arm a compatible target click, with role-specific actions shown. R Return, X Recall all and V Aircraft act immediately. Show the key on each control and the target instruction in its tooltip. A selected action is outlined in brass; Esc cancels it before exiting the map. Right-click remains contextual. Do not repeat the squadron title, wing inventory totals, broad instructions or ready/launch explanations above the row; those totals belong to the wing manifest at the right edge. Per-aircraft numbers and follow controls stay in expandable aircraft inspection. Commands and R Return apply to every selected squadron, with the CPU validating each squadron independently. Small, temporary feedback distinguishes accepted, rejected and partially accepted group orders.

The wing manifest docks at the right edge below the combat report, 344 px wide on desktop, and lists every squadron under Fighters, Dive bombers and Torpedo bombers headings with per-role ready, airborne, armed and lost totals. Its header carries the surviving aircraft count, active flights, deck, hangar and recovery totals, a deck-suspended warning and a Hide/Show control. Each squadron row shows its map hotkey, name, activity with mission and endurance or rearm timer, six 12 px aircraft cells and survivors; rows select squadrons using the shared selection gestures, and every selected row is outlined in brass. A cell fills upward with condition in the aircraft's status color (mint ready, ivory airborne, muted returning, brass servicing), turns brass below 50 HP and salmon below 25 HP, is crossed out when lost, and carries a brass underline for remaining payload or gun ammunition. Hover titles give each aircraft's number, condition, armament and phase. This is the one filled instrument in the map view: a translucent maritime surface keeps 48 condition bars legible over cloud and wake. The manifest narrows to 300 px at widths up to 1150 px, moves below the combat report at 800 px, scrolls within short viewports and is omitted at 600 px and below, where the card row remains.

Airborne name tags show activity in both modes, at a smaller instrument scale. Cards and airborne tags share distinct role icons from the existing 24 px naval icon family: a propeller fighter, a finned bomb for dive bombers and a horizontal torpedo for torpedo bombers. Icons inherit team/selection color; the cards retain their baked aircraft images and accessible role labels. Only M shows the fixed cross and projected loiter radius on the water. Every selected active squadron shows its route starting at its actual airborne position. The sea remains visible through transparent instruments. M, Esc when no target action is pending, and Return to ship restore the previous camera.

Following aircraft and shells allows mouse orbit (drag when the cursor is released) and wheel distance adjustment. Keep the target tracked and ship aim/optics saved; mouse clicks control this camera instead of firing or toggling optics. Use a tooltip on the existing follow status for these controls, without adding another persistent instruction row.

### Port inspection

Statistics, Armor, Internals and Flooding form a labeled four-button group. Statistics shows five 0-100 category scores over collapsible sections, each led by one headline figure; every row explains its figure on hover. Fitted torpedoes lead with the tube count and identify trainable mounts and carried reloads; fitted depth charges lead with the charge stock and expose release stations, detonation depth and blast radius in the same row pattern. Armor lists hull and moving gunhouse protection; Internals lists damageable guns, machinery, magazines, steering, generators and fire control. Flooding separately exposes compartments so their outlines do not obscure equipment. Lists and overlays derive from the same compiled definition used by combat. Thickness is uniform within each armor volume; module HP and compartment capacity are provisional gameplay values.

Selecting a row isolates its volume against the ghost exterior. The row combines a category swatch, name, type and thickness, HP or capacity; selection also exposes dimensions and Clear selection in a pinned footer. Selecting the same row again or clearing restores all volumes in that mode. Rows are at least 48 px high; mobile view controls and Clear selection provide at least 44 px height. Statistics restores the normal ship view, and Set sail remains available. Hovering a plate, module or compartment in the 3D view highlights it and shows a tooltip with its thickness, hit points or flooding capacity.

Hovering a visible armor plate lightens it, adds a white outline and opens a compact maritime tooltip with name, thickness, material, dimensions and recorded basis. The tooltip stays inside the viewport and does not intercept the pointer. Dragging, moving onto controls, pausing or leaving armor mode clears the highlight. Hidden layers can be isolated from the list before hovering; hover never changes selection or combat.

### Live gunnery

The armament group shows circular reload progress and readiness for each selected gun mount, torpedo tube or depth-charge station, with mount numbers, remaining seconds or a ready mark. Its heading pairs the battery name with a can-fire/total count and includes caliber or tube diameter for guns and torpedoes. Only eligible, loaded weapons count; unavailable mounts show a cross. Gun-aim circles distinguish Turning, Out of arc, Out of range and Blocked, and any visible seconds are labeled Reload. The circles and firing use the same eligibility state. The baseline five slots contain main AP, secondary AP, binoculars, gunnery and fire. Fitted torpedoes add a sixth slot between secondary AP and binoculars; fitted depth charges add a seventh after torpedoes. Both use the same mint selection state, keycap and live ammunition count. Ammunition illustrations, including the depth-charge drum, are independently authored SVG assets; all ammunition totals come from live simulation telemetry. Keyboard 1/2 selects main or secondary AP, 3 selects fitted torpedoes and 4 selects fitted depth charges. Q or left mouse fires the selected weapon group. The firing action is disabled when no selected weapons are ready.

For Type VIIC, selecting torpedoes shows five tube-readiness rings and the remaining ammunition from its initial 14 rounds; readiness also respects the submarine's current depth. A compact muted line beneath the battery heading gives the bow/stern arcs, range and arming distance. Translucent mint sectors follow the water surface, with a gold arming arc and a straight-course line; a brighter narrow cone marks a ready launch. Hide this preview outside torpedo selection, during inspection or shell follow, on loss of the player ship, and with H. The port characteristics show five 533 mm tubes and 14 rounds. Gunnery labels its action Launch and explains that each press launches one eligible loaded tube, holding launches tubes in sequence, and Target waterline supplies lead for the selected target. Keep straight-course behavior explicit in that help. The target-condition readings include depth when available.

Fletcher's torpedo selection shows ten tube-readiness rings and its remaining stock from ten rounds. The same muted help line gives the trainable broadside sectors, range and arming distance; readiness distinguishes a loaded tube from one still turning toward aim. Depth-charge selection shows eight station-readiness rings and the remaining stock from 28 charges. Its fourth weapon button is labeled DEPTH with keycap 4; the firing action becomes Drop. The two-line help identifies stern racks and side throwers, the 10 m burst depth, and the need to make a close pass and keep moving clear. Gunnery labels ready stations “Ready to release,” omits the aim selector for this weapon, and explains one press versus a held pattern and possible damage to the player's ship and allies. Use the inherited maritime surfaces, mint readiness, brass gunnery command and Barlow instruments for these added states.

G opens gunnery and releases the cursor for aim selection, trial-target condition, flooding, inspection and reset. Keep inspection exit controls reachable when details collapse. Only implemented combat features appear as live telemetry. Do not fill spare weapon slots with unsupported ammunition or consumables.

### Depth and ballast

Submarines add a compact transparent instrument. Barlow Condensed leads with actual depth in meters; compact Barlow text carries the ordered depth, movement state, ballast percentage, propulsion mode and vertical speed. Tabular numerals stabilize the changing readings. Mint identifies the depth meter, movement state and selected preset; a gold marker shows the ordered depth.

Surface, Periscope and Dive 50 m form the preset row, followed by paired Rise 10 m / Dive 10 m adjustments. Emergency blow occupies its own full-width row with gold lettering. Selected commands expose their pressed state, unavailable adjustments disable at the order limits, and sinking disables depth commands. Keyboard hints follow the configured bindings. Depth-limit and weapon-depth warnings state the corrective action beside the controls.

**The Actual and Ordered Depth Rule.** Keep achieved depth and commanded depth separately labeled, with actual depth filling the meter and the order marked independently. Show ballast, propulsion and movement state from live telemetry so the player can inspect the response to an order.

### Hull damage feedback and score

Incoming shell hits add a salmon arc and outward tip around the sight, pointing toward the source relative to the active camera. Bearings stay attached to the incoming direction as the camera turns, including binocular and shell-follow views. Armor stops and ricochets count even without equipment damage. Nearby directions combine; at most six cues remain visible. Each holds for 1.2 seconds and fades over one second of simulation time, so pause freezes it. Keep the sight center clear, use a dark stroke for contrast over sky and sea, and follow H and port visibility.

Damage gold marks actual hull damage beside overhead ship labels and in the vacated section of their bars. Hits within 0.35 seconds combine into one salvo number; the segment holds for one second after the latest hit and fades over 0.6 seconds. Simulation time freezes these cues during pause. The player's lower-left hull instrument uses the same gold segment and a numeric damage notice above it, with no screen-covering tint. Feedback uses opacity only, without camera shake or movement.

The compact Damage / Frags reading sits below the upper-right pause control. Its damage log is three single-line entries high (two on compact screens), with a fixed scrollable footprint and no heading, frame, surface fill or empty-state message. Each entry shows weapon, other ship and signed damage; hover text retains time and hit details. Two compact Friendly / Enemy rows occupy the upper-left edge. Opening a team shows a short inline roster, without a target dropdown, floating panel or extra health bars. Damage counts actual hostile hull HP removed on the displacement-based scale; frags count permanent combat losses or sinkings credited to the last hostile damage or breach, including delayed flooding. Both reset with the battle. The bottom armament ends with its weapon keycaps: the Follow shells row and Ctrl/Shift/Esc hint strip are removed. T remains the configurable shell-follow shortcut. Binocular mode hides smoke emitted at the player's ship, including already active smoke, while it continues aging; other ships' smoke remains visible.

Local structural damage appears in Gunnery's Damaged sections list and beside the affected shell impact. Labels explain reduced hull damage and intact equipment reached through wreckage. Combat inspection adds amber outlines for damaged structural regions and grey outlines for depleted regions; orange compartment fill marks active fires. These overlays are separate from equipment condition and blue floodwater.

Own damage control puts active fires first, showing the affected space, growing/contained/being-fought/cooling status, remaining fuel and threatened equipment. Each row offers Focus crews. Target fires have the same readings without crew commands. Electrical supply and fire-control availability appear beside existing condition readings. Keep these additions within the scrolling naval instrument; room smoke exits above the deck and stays bounded with the existing gunhouse fire effects.

## Do's and Don'ts

Water impacts retain the first PR #80 iteration's long, directional water streaks: curved sheets, fine filaments and a low crown that collapse into spray. This is the owner's preferred splash appearance. Preserve its silhouette and breakup when optimizing; the later dense parcel column was rejected. See the [current streaked-water review](assets/reviews/water-impact/streaks/README.md).

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

Enemy impact labels sit just above their recorded hit positions, following the displayed hull. Damage gold leads with actual hull HP lost; the part name and impact outcome sit below. Zero-HP armor rejection uses muted text. Combine shell layers and nearby hits on one part, prioritize equipment damage, avoid overlapping labels, and cap the group at twelve. Labels hold for 2.4 seconds and fade over 0.8 seconds of simulation time; pause freezes them.
