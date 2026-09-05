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
---

# Design System: Bismarck Sea Trials

## Overview

**Creative North Star: "Fleet harbor / Fleet action"**

The owner-selected Fleet harbor and Fleet action studies remain the visual authority. The ship and sea fill the viewport; compact naval instruments frame the scene. Port inspection extends this system with readable model views and selection details.

Navigation, battery readiness, firing, target damage and flooding are live in the singleplayer gunnery trial. FPS uses smoothed renderer telemetry. Port freezes combat; currency, commander skills, research, orders and refits remain explicitly labeled progression previews. Inspection shows provisional combat volumes, not historically approved plate-by-plate construction.

**Key Characteristics:**

- Full-screen ship and sea, framed by compact instruments.
- Ivory and blue-gray text, brass commands, mint readiness.
- Fine borders, restrained rounding, inspectable state.

## Colors

Ivory and subdued blue-gray sit over dark maritime blue. Brass is the primary command accent; mint provides a distinct navigation and readiness signal.

### Primary

Brass identifies port actions and selected model views. The inherited gunnery panel uses its existing brass accent for commands and selections.

### Secondary

Mint identifies heading, active engine orders and ready mounts in Fleet action, and readiness in port. Inspection category swatches match their 3D volumes: brass armor, green machinery, salmon magazines, lavender steering and pale blue compartments. Blue fill represents floodwater.

### Neutral

Ivory carries primary text; muted blue-gray carries supporting readings. Maritime surfaces and translucent lines separate controls from the scene.

**The Command Accent Rule.** Use brass for port commands and selected model views, and mint for Fleet action readiness and navigation. Pair color with written labels or numeric readings.

## Typography

Barlow supplies controls and explanatory text; Barlow Condensed supplies ship identity, headings and numerical instruments. The hierarchy stays compact: port headings use 20 px condensed type, inspection entries use 12 px text, and supporting labels and controls use 10–11 px. Tabular numerals stabilize changing instrument readings. Preserve readable labels by reducing panel footprints and spacing.

## Layout

Fleet action keeps ship status and handling at lower left, armament at bottom center, the local chart at lower right, and a fine central sight. The main instruments are about 15% smaller than HUD study A, with 28 px side margins and 36 px bottom clearance on desktop. Gunnery details open at upper right and scroll within their available space; the FPS counter stays quiet beside pause/settings.

Fleet harbor keeps the fleet carousel below the ship, commander and orders on the left, characteristics on the right, and Set sail centered horizontally in the viewport within the transparent top bar. Its instruments are approximately 15% smaller than garage study A. The ship and illustrative 3D harbor remain visible. The comparison switcher and alternate garage layouts have been removed.

Armor and Internals reuse the right detail surface, hiding the commander/orders, fleet carousel and port location during inspection. The list scrolls independently while model-view controls and selected-volume details remain pinned. Below 600 px, the inspection surface docks below the ship with 18 px side insets and a maximum height of 295 px. Narrow and short layouts rearrange instruments without a scaled virtual canvas; coarse pointers expose steering buttons.

**The Clear Center Rule.** Keep the ship and sea visible, with instruments anchored at the viewport edges.

## Elevation & Depth

Translucent maritime surfaces, fine borders and edge shading provide separation from the live scene. Soft text shadows maintain contrast over water; diffuse shadows lift the pause dialog and primary port action. Inspection ghosts the exterior and draws translucent outlined volumes through the hull and sea so submerged spaces remain inspectable.

## Shapes

Controls use restrained corners: 2 px on port and Fleet action instruments, 3 px on inherited gunnery controls. Model-view buttons and volume rows have square edges and fine dividing rules. Circular forms belong to bearings and status marks.

## Components

### Commands and navigation

Set sail is a solid brass command. Secondary actions use transparent or maritime fills and fine borders. Selected model views use a brass underline; selected Fleet action battery controls use mint borders and labels. Buttons expose visible focus rings. Engine orders, camera, chart zoom, pause, fullscreen and HUD visibility remain functional. The native pause dialog contains focus; hidden instruments are inert. Reduced-motion preference removes interface transitions and the port entrance animation.

### Port inspection

Exterior, Armor and Internals form a labeled three-button group. Armor lists hull and moving gunhouse protection; Internals lists machinery, magazines, steering and flooding compartments. Lists and overlays derive from the same compiled definition used by combat. Thickness is uniform within each armor volume; module HP and compartment capacity are provisional gameplay values.

Selecting a row isolates its volume against the ghost exterior. The row combines a category swatch, name, type and thickness, HP or capacity; selection also exposes dimensions and Clear selection in a pinned footer. Selecting the same row again or clearing restores all volumes in that mode. Rows are at least 48 px high; mobile view controls and Clear selection provide at least 44 px height. Exterior restores the normal ship view, and Set sail remains available.

### Live gunnery

Main and secondary batteries, mount readiness and Fire salvo are live controls. Fire is disabled when no selected guns are ready. Gunnery exposes aim selection, trial-target condition, flooding, inspection and reset. Keep inspection exit controls reachable when details collapse. Future match scores and other unimplemented combat features may reference the archived study A screenshots in `docs/hud-mockups`, but must not appear as live telemetry.

## Do's and Don'ts

### Do:

- **Do** preserve the ship and sea as the primary view.
- **Do** pair readiness and damage colors with labels or numeric readings.
- **Do** keep inspection modes, selected details and exit controls reachable while lists scroll.
- **Do** label provisional inspection geometry and progression previews honestly.

### Don't:

- **Don't** surround the scene with a dashboard page.
- **Don't** replace fine borders and restrained rounding with an unrelated component style.
- **Don't** present uniform combat volumes as historically verified armor plates or hull subdivisions.
