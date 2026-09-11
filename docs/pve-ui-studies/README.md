# Selected PvE interface: variation D

Bill selected **variation D** after reviewing Claude Fable's interactive study. Open [the selected briefing](index.html#d/briefing). This directory preserves the approved HTML byte-for-byte so the implementation plan and its visual reference can travel together.

| Workflow | Selected structure |
| --- | --- |
| Briefing and fleet selection | B: task-group columns, fleet budgets and ship catalog |
| Deployment and opening orders | B: task groups beside the circular deployment chart |
| Fleet command and contact response | C: compact roster and selection-based command card |
| Aircraft and carrier operations | C: aircraft controls within fleet command, across all owned carriers |
| Follow / optional helm | C: distinct selection, camera-follow and helm states; return to fleet command in one action |
| Results and restart | C: elimination outcome and explicit same-battle restart versus new battle |

While following a ship, hide carrier aircraft information, the Air toggle, aircraft row and deck counts. Return to fleet command to manage aircraft. Selecting a surface ship within fleet command must still allow access to aircraft from every owned carrier. This supersedes the original handoff's requirement to keep aircraft control available in the follow view.

Use D as the visual and interaction reference for the [implementation plan](../pve-fleet-command-plan.md). Keep the existing sea/ship rendering, naval instrument styling and real simulation state. The prototype's drafting-paper frame, variation/screen selectors, demo-state controls, guided study overlay, preview-result controls and accelerated mock clock are presentation aids for the study, not approved production UI or gameplay rules. A, B and C remain inside the file as comparison history.

The design-selection prerequisite is complete. [Gameplay implementation is underway](../pve-implementation-status.md). Exact keybindings need the planned conflict audit; dense-map label handling and compact layouts still need validation against the real game. The mock combat/deck timers and illustrative target data do not replace the Rust contracts or agreed game rules.

## Provenance

- Author: Claude Fable 5.1; study baseline `1ac77b02827f3cdd1dc43749836ff083e9c296bc`.
- Original: `/Users/bill/orca/workspaces/ship-game/pve-ui-fable/docs/pve-ui-studies/index.html#d/briefing`.
- Approved HTML SHA-256: `795058423336b4450380eb205934ebf546a82ab36bc180e3ab46481a4634bfae`.
- The author recorded visual and interaction checks in its worktree's companion README. This decision update inspected the D briefing, command and follow captures and verified that the retained HTML matches the selected source. It does not claim new simulation, browser or model validation.
