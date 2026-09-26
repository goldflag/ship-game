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
  builder-ground: "#1f2225"
  builder-sweep-centre: "#3d4145"
  builder-sweep-edge: "#191b1e"
  builder-card: "#24282bf5"
  builder-card-hover: "#2f3438"
  builder-card-selected: "#383d41"
  builder-toggle-selected: "#253a37"
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

Quick reference, verified against `src/ui/**/*.css` on 2026-09-19. Frontmatter holds token values
(CSS wins on conflict). Detail is in `docs/design/`; start at [foundations](docs/design/foundations.md).

## Overview
Full-screen ship and sea framed by compact edge-mounted naval instruments: ivory and blue-gray text,
brass commands, mint readiness, fine borders. Rules agents break most:
- **No cards.** Port and battle instruments are transparent (hairlines, text shadows, no panel or
  control fills, hover included). Fills belong only to dialogs, tooltips, the wing manifest and the
  shipbuilder's neutral cards; the port's particulars column rests on an edge shade, not a fill.
  Extend the existing instrument styling; keep ship, sea and sight clear.
- **New DOM HUD layers must join the `--hud-scale` rule** in `src/ui/styles.css`: `.hud-viewport,
  .ocean-viewport :is(.ship-label-layer, .gun-aim-layer, .torpedo-aim-layer,
  .torpedo-marker-layer), .game-shell > .hit-direction-layer`. It declares `container: hud / size`, so
  HUD breakpoints are `@container hud (...)`, not `@media`. `App.tsx` sets it on `.game-shell`.
- **`.primary-button` collision.** `styles.css` `.primary-button, .secondary-button` sets `display:flex;
  justify-content:space-between; width:100%; padding:14px 16px`, and `Button` emits `${variant}-button`,
  so shared primary/secondary Buttons render full width. Override in a scoped rule (`BattleDialog.css`
  `.battle-footer .primary-button { width:auto }`); never edit the global rule.
- **`.shipbuilder button` specificity.** `Shipbuilder.css` resets it to `background:transparent;
  border:0; padding:0` (0,1,1), beating single-class fills. Write `.shipbuilder .your-class`.
- **Use the shared controls** in `src/ui/components`: `Button` (primary/secondary/icon), `Input`,
  `Select` + `SelectOption` (every dropdown); tokens in `controls.css`, usage in its README.

## Colors
- `styles.css :root`: text `#edf1ec`, ground `#132d38` (literals); `--ink #10252e`, `--muted #bacbd0`,
  `--accent #e0c58d` (brass), `--line #cfdfdf35`. Command ink `#152b32`, brass hover `#efd5a0`.
- `components/controls.css :root`: `--control-surface #0e2530`, `-hover #233e48`, `-text #e1e9e9`,
  `-muted #bacbd0`, `-border #728b9266`, `-accent #e0c58d`, `--control-radius 3px`.
- `FleetHud.css .fleet-hud`: `--fleet-active #86e4c5` (mint), `--fleet-gold #e8c56c`, `--fleet-muted
  #c1d0d4`, `--fleet-line #c9dce04a`; text `#f0f5f3`; hostile salmon literal `#ffb5a6`.
- `Garage.css .garage`: `--port-accent #e5bf80`, `--port-ready #94d9bf`.
- `shipbuilding/Shipbuilder.css .shipbuilder` `--sb-*` (mirrored as `--hs-*` on `.hs-root`): ground
  `#1f2225`, card `#24282bf5`, hover `#2f3438`, selected `#383d41`, toggle `#253a37`.
**The Command Accent Rule.** Brass for commands and selections, mint for readiness and navigation,
always with a label or number. Inspection swatches: [foundations](docs/design/foundations.md#colors).

## Typography
Barlow 400/500/600 (body, controls) and Barlow Condensed 500/600 (identity, headings, numerals), from
`@fontsource` in `src/main.tsx`. No size tokens; common literals are 12 and 11 px, 10 px labels, 13 to
14 px dialog text, condensed headings 18 to 32 px. Changing readings use `tabular-nums`.

## Layout
No global spacing scale. Fleet insets: `--fleet-edge 24px`, `--fleet-bottom 20px`, stepping to 18 and
12/14 px at `@container hud` widths 1150, 900 and 600 px. Shared controls are 36 px high, `7px 10px`
padding; coarse-pointer targets 44 px; builder slots `--sb-slot 64px`. **The Clear Center Rule.** Keep
ship and sea visible, instruments at the edges. Every position: [layout](docs/design/layout.md).

## Elevation & Depth
Text shadows and fine outlines, no panel fills at sea; diffuse shadows only on dialogs and the primary
port action. Inspection shading: [foundations](docs/design/foundations.md#elevation--depth).

## Shapes
Radius 3 px controls, 2 px port instruments, 1 px Fleet slots; circles for bearings, reload rings and
aim marks. **The App Focus Rule.** Outlines are off globally; focus shows as a 3 px-offset underline.

## Components
- [battle-hud](docs/design/battle-hud.md): commands, aim, helm, minimap, gunnery, depth, damage, score.
- [air-and-fleet-command](docs/design/air-and-fleet-command.md): M view, wing manifest, fleet command D.
- [shipbuilder](docs/design/shipbuilder.md): Slipway rails, freeform hull, snapping, hull sections.
- [port-and-setup](docs/design/port-and-setup.md): port controls, plan chest, inspection, account gate.
- [tools-and-environment](docs/design/tools-and-environment.md): model viewer, dev console, landscapes.

## Do's and Don'ts
Overview rules first; the original lists are in [foundations](docs/design/foundations.md#dos-and-donts).
