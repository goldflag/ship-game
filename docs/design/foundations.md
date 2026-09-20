# Foundations: overview, colour, typography, elevation and shapes

Moved verbatim from [DESIGN.md](../../DESIGN.md) on 2026-09-19 (rewrapped, relative links adjusted).
DESIGN.md keeps the tokens and rules; this file keeps the detail and rationale.

## Overview

**Creative North Star: "Fleet harbor / Fleet action"**

The owner-selected Fleet harbor and Fleet action studies remain the visual authority. Fleet action
extends that direction with the selected World of Warships / War Thunder reference for centered
mouse aiming, binocular sights and edge-mounted handling and weapon instruments. The ship and sea
fill the viewport; compact naval instruments frame the scene. Port inspection extends this system
with readable model views and selection details.

Navigation, gun, torpedo and depth-charge readiness, firing, target damage and flooding are live in
the singleplayer gunnery trial. FPS uses smoothed renderer telemetry. Port freezes combat; currency,
commander skills, research, orders and refits remain explicitly labeled progression previews.
Inspection shows provisional combat volumes, not historically approved plate-by-plate construction.

**Key Characteristics:**

- Full-screen ship and sea, framed by compact instruments.
- Ivory and blue-gray text, brass commands, mint readiness.
- Fine borders, restrained rounding, inspectable state.
- Centered aiming with a numbered scale only in binocular view.

## Colors

Ivory and subdued blue-gray sit over dark maritime blue. Brass is the primary command accent; mint
provides a distinct navigation and readiness signal.

### Primary

Brass identifies port actions and selected model views. The inherited gunnery panel uses its
existing brass accent for commands and selections.

### Secondary

Mint identifies heading, hull integrity, rudder position, ready mounts and selected battery or
binocular controls in Fleet action, and readiness in port. The active engine order uses mint
lettering and a pointing marker on a transparent surface. Inspection swatches match their 3D
volumes: armor uses a fixed thickness scale from green (0 mm) through yellow (200 mm) to red (400 mm
and above), with gray teak backing; machinery is green, magazines salmon, steering lavender and
compartments pale blue. A labeled thickness legend accompanies the armor list. Port armor is fully
opaque, selection retains its thickness color, and hover lightens and outlines only the plate under
the pointer. Blue fill represents floodwater.

### Neutral

Ivory carries primary text; muted blue-gray carries supporting readings. Fleet action uses its own
text, muted and line tokens directly over the game, without panel or control fills. Translucent
lines separate controls from the scene while the minimap preserves the sea beneath it.

**The Command Accent Rule.** Use brass for port commands and selected model views, and mint for
Fleet action readiness and navigation. Pair color with written labels or numeric readings.

## Typography

Barlow supplies controls and explanatory text; Barlow Condensed supplies ship identity, headings and
numerical instruments. The hierarchy stays compact: port headings use 20 px condensed type,
inspection entries use 12 px text, and supporting labels and controls use 10–11 px. Fleet action
leads with speed (27 px), ship identity (20 px) and condition, bearing and ammunition readings
(18–21 px); its secondary readings and control labels use compact Barlow or condensed type. Tabular
numerals stabilize changing instrument readings. Preserve readable labels by reducing panel
footprints and spacing.

## Elevation & Depth

During sailing, text shadows and fine instrument outlines separate readouts from the scene. Panels,
buttons, keycaps, aiming labels and the chart have transparent backgrounds, including hover and
selected states; screen-edge shading is removed. Port and pause dialogs retain their own surfaces.
Soft text shadows maintain contrast over water; diffuse shadows lift the pause dialog and primary
port action. Inspection fades the actual exterior model. Port armor uses opaque plates with their
own depth buffer, so near plates hide deeper layers while remaining visible through the hull and
sea. A neutral upper-left light follows the inspection camera, with ambient fill keeping shaded
faces readable. Shading preserves thickness hues and crisp plate edges without harbor exposure or
glare. Internals and combat inspection retain translucent volumes so submerged spaces remain
inspectable.

## Shapes

Controls use restrained corners: 2 px on port instruments and the mouse-capture prompt, 1 px on
Fleet action weapon slots and chart controls, and 3 px on inherited gunnery controls. Model-view
buttons and volume rows have square edges and fine dividing rules. Circular forms belong to
bearings, per-mount reload progress and aiming marks.

## Do's and Don'ts

### Do:

- **Do** preserve the ship and sea as the primary view.
- **Do** pair readiness and damage colors with labels or numeric readings.
- **Do** keep inspection modes, selected details and exit controls reachable while lists scroll.
- **Do** label provisional inspection geometry and progression previews honestly.
- **Do** keep the sailing sight centered and reserve the numbered aiming scale for binoculars.
- **Do** preserve five distinct minimap size steps at every responsive breakpoint, independently of
  chart range.

### Don't:

- **Don't** surround the scene with a dashboard page.
- **Don't** replace fine borders and restrained rounding with an unrelated component style.
- **Don't** present uniform combat volumes as historically verified armor plates or hull
  subdivisions.
- **Don't** invent live ammunition, consumables or combat telemetry to fill the weapon bar.
