import type { ConstructionCommand } from '../../ships/constructionCommands';
import { resizedWallDimensions } from './wallDimensions';
import type { BuilderTool } from './builderTool';
import { FREEFORM_MODES, type BuilderChrome, type BuilderKey } from './builderToolState';

/** Which modifier state a binding accepts. `command` is Ctrl or ⌘ held; `plain` is neither Ctrl/⌘ nor Alt;
 * `no-command` is no Ctrl/⌘ with Alt allowed; `any` does not look at modifiers. Shift never decides a match:
 * bindings read it themselves (Shift-R, ⇧⌘Z). */
export type BuilderKeyMods = 'any' | 'command' | 'plain' | 'no-command';

/** One editor hotkey. `BuilderTool.key()` runs the FIRST binding of `BUILDER_KEYMAP` that matches and stops, so
 * order is precedence: path drawing, then undo/redo, the Rotate tool, the standing toggles, freeform, the
 * clipboard, and last the plain keys. */
export interface BuilderKeyBinding {
  id: string;
  /** Keycaps and a short description, for readers and for any help surface that wants them. */
  keys: string[];
  does: string;
  mods: BuilderKeyMods;
  /** `event.key` values. Single characters compare case-insensitively, names (`Escape`) exactly; `any` matches every key. */
  match: readonly string[] | 'any';
  /** The scope: the binding is skipped while this is false. */
  when?(tool: BuilderTool, event: BuilderKey): boolean;
  /** Call `preventDefault()` on a match. Bindings that decide it themselves leave this off. */
  prevent?: boolean;
  /** Ignore auto-repeat: a held key still matches (and is prevented) but runs once. */
  once?: boolean;
  /** What the key does. Without `run` the key is swallowed: nothing later in the table sees it. */
  run?(tool: BuilderTool, event: BuilderKey, chrome: BuilderChrome): void;
}

const AXES = ['x', 'y', 'z'];
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
/** The view strip stays visible while shaping, so its keys keep working; M decides whether the twin follows. */
const FREEFORM_PASSES = ['w', 'q', 's', 'c', 'm'];
const quarter = (event: BuilderKey) => (event.shiftKey ? -90 : 90);
const drawing = (tool: BuilderTool) => !!tool.pathPart;
const drawingPoints = (tool: BuilderTool) => !!tool.pathPart && tool.state.pathPoints.length > 0;
const rotating = (tool: BuilderTool) => tool.state.tool === 'rotate';
const shaping = (tool: BuilderTool) => tool.freeformMode;
const hasSelection = (tool: BuilderTool) => tool.state.selected.size > 0;
const onlyWallFittingsSelected = (tool: BuilderTool) =>
  tool.selectedEquipment.length > 0 && tool.selectedEquipment.length === tool.state.selected.size && tool.selectedEquipment.every((e) => e.wall);
const wallPiece = (tool: BuilderTool) => {
  const piece = tool.piece;
  return piece?.kind === 'equipment' && piece.wall ? piece : undefined;
};

/** Arrow keys on a wall fitting resize it: the cursor piece, else every selected wall fitting with its linked partner. */
function resizeWallFittings(tool: BuilderTool, event: BuilderKey) {
  const axis = event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? 0 : 1;
  const amount = (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) * (event.shiftKey ? 0.01 : 0.1);
  const resize = (value: number) => Math.max(0.15, Math.min(5, Math.round((value + amount) * 100) / 100));
  const piece = wallPiece(tool);
  if (piece) {
    tool.setWallSize(axis, resize(axis ? piece.wall!.heightM : piece.wall!.widthM));
    return;
  }
  const handled = new Set<string>(),
    commands: ConstructionCommand[] = [];
  for (const item of tool.selectedEquipment) {
    if (handled.has(item.id)) continue;
    handled.add(item.id);
    if (item.wall!.mirrorId) handled.add(item.wall!.mirrorId);
    const value = structuredClone(item),
      w = value.wall!,
      size = resize(axis ? w.heightM : w.widthM);
    Object.assign(w, resizedWallDimensions(tool.partOf(item)!, w, axis, size));
    commands.push({ op: 'equipment', value });
  }
  tool.run('Resize wall fittings', commands);
}

/** PageUp and PageDown raise selected turrets on their barbettes; any other selection moves vertically. */
function raiseOrLower(tool: BuilderTool, event: BuilderKey) {
  const s = tool.state,
    direction = event.key === 'PageUp' ? 1 : -1;
  if (s.selected.size && tool.selectedEquipment.length === s.selected.size && tool.selectedEquipment.every((item) => tool.partOf(item)?.kind === 'gun'))
    tool.raiseTurrets([...s.selected], (current) => Math.max(0, Math.min(30, current + direction * tool.gridStep)));
  else if (s.selected.size) tool.nudge([0, direction * tool.gridStep, 0]);
}

function escape(tool: BuilderTool, _event: BuilderKey, chrome: BuilderChrome) {
  const s = tool.state;
  if (chrome.dismiss()) return;
  if (s.suggestion) tool.dismissSuggestion();
  else if (s.measure) tool.update({ measure: undefined });
  else if (s.tool !== tool.restTool) {
    tool.setTool(tool.restTool);
    tool.clearSelection();
  } else tool.clearSelection();
}

export const BUILDER_KEYMAP: readonly BuilderKeyBinding[] = [
  // ---- drawing a connected path: the route owns Escape, Enter and its own undo
  { id: 'path-cancel', keys: ['Esc'], does: 'Cancel the path being drawn', mods: 'any', match: ['Escape'], when: drawing, prevent: true, run: (tool) => tool.cancelPath() },
  { id: 'path-finish', keys: ['Enter'], does: 'Finish the path being drawn', mods: 'any', match: ['Enter'], when: drawing, prevent: true, run: (tool) => tool.finishPath() },
  { id: 'path-pop', keys: ['⌫'], does: 'Remove the last pending path point', mods: 'any', match: ['Backspace'], when: drawingPoints, prevent: true, run: (tool) => tool.popPathPoint() },
  { id: 'path-pop-undo', keys: ['⌘Z'], does: 'Remove the last pending path point', mods: 'command', match: ['z'], when: drawingPoints, prevent: true, run: (tool) => tool.popPathPoint() },
  { id: 'path-hold', keys: ['R', 'Del'], does: 'Ignored while a path has pending points', mods: 'any', match: ['r', 'Delete'], when: drawingPoints },

  // ---- history
  { id: 'undo-redo', keys: ['⌘Z', '⇧⌘Z'], does: 'Undo, redo', mods: 'command', match: ['z'], prevent: true, run: (tool, event) => (event.shiftKey ? tool.door.redo() : tool.door.undo()) },
  { id: 'redo', keys: ['⌘Y'], does: 'Redo', mods: 'command', match: ['y'], prevent: true, run: (tool) => tool.door.redo() },

  // ---- the Hull Rotate tool: the axis keys mean the same quarter turn in every hull tool; here they also aim the gizmo
  {
    id: 'rotate-tool-axis', keys: ['X', 'Y', 'Z'], does: 'Rotate tool: aim the gizmo and turn the block 90° (Shift reverses)', mods: 'plain', match: AXES, when: rotating, prevent: true, once: true,
    run: (tool, event) => {
      const axis = AXES.indexOf(event.key.toLowerCase());
      tool.setRotationAxis(axis);
      tool.rotateBlock(axis, quarter(event));
    },
  },
  { id: 'rotate-tool-turn', keys: ['R', '⇧R'], does: 'Rotate tool: turn the block 90° about the chosen axis', mods: 'plain', match: ['r'], when: rotating, prevent: true, once: true, run: (tool, event) => tool.rotateBlock(tool.state.rotationAxis, quarter(event)) },
  { id: 'rotate-tool-leave', keys: ['Esc'], does: 'Rotate tool: return to Select', mods: 'plain', match: ['Escape'], when: rotating, prevent: true, run: (tool) => tool.setTool('select') },

  // ---- standing toggles, in every layer and tool
  { id: 'snap', keys: ['N'], does: 'Toggle snapping', mods: 'plain', match: ['n'], prevent: true, once: true, run: (tool) => tool.toggleSnapping() },
  { id: 'grid', keys: ['S'], does: 'Cycle grid spacing (the move step in freeform)', mods: 'plain', match: ['s'], prevent: true, once: true, run: (tool) => tool.cycleGrid() },
  { id: 'projection', keys: ['P'], does: 'Toggle perspective / orthographic camera', mods: 'plain', match: ['p'], prevent: true, once: true, run: (tool) => tool.toggleProjection() },
  {
    id: 'freeform', keys: ['D'], does: 'Hull: enter or finish freeform editing for one selected shape', mods: 'plain', match: ['d'], when: (tool) => tool.state.layer === 'hull' && !tool.pathPart, prevent: true, once: true,
    run: (tool, _event, chrome) => {
      if (tool.freeformMode) tool.exitFreeform();
      else if (tool.enterFreeform()) chrome.slotChosen();
    },
  },

  // ---- freeform shaping: its own keys, then everything but the view strip and Mirror is held back
  { id: 'freeform-leave', keys: ['Esc'], does: 'Freeform: finish shaping', mods: 'no-command', match: ['Escape'], when: shaping, prevent: true, run: (tool) => tool.exitFreeform() },
  { id: 'freeform-step', keys: ['G'], does: 'Freeform: cycle the move increment', mods: 'no-command', match: ['g'], when: shaping, prevent: true, run: (tool) => tool.cycleUnit() },
  { id: 'freeform-projection', keys: ['O'], does: 'Freeform: toggle orthographic / perspective', mods: 'no-command', match: ['o'], when: shaping, prevent: true, run: (tool) => tool.toggleProjection() },
  { id: 'freeform-mode', keys: ['1', '2', '3', '4'], does: 'Freeform: select vertices, edges, faces or rings', mods: 'plain', match: ['1', '2', '3', '4'], when: shaping, prevent: true, once: true, run: (tool, event) => tool.setFreeformMode(FREEFORM_MODES[Number(event.key) - 1]) },
  { id: 'freeform-hold', keys: [], does: 'Freeform: other keys wait until shaping ends', mods: 'no-command', match: 'any', when: (tool, event) => shaping(tool) && !FREEFORM_PASSES.includes(event.key.toLowerCase()) && event.key !== 'Home' },

  // ---- clipboard and select all. Without a selection, ⌘C and ⌘X stay with the browser so selected text still copies.
  { id: 'copy', keys: ['⌘C', '⇧⌘C'], does: 'Copy 1 m to starboard, mirror-copy across the centerline', mods: 'command', match: ['c'], when: hasSelection, prevent: true, run: (tool, event) => tool.copy(event.shiftKey) },
  { id: 'cut', keys: ['⌘X'], does: 'Remove the selection', mods: 'command', match: ['x'], when: hasSelection, prevent: true, run: (tool) => tool.remove() },
  { id: 'select-all', keys: ['⌘A'], does: 'Select every hull piece and fitting', mods: 'command', match: ['a'], prevent: true, run: (tool) => tool.selectAll() },
  { id: 'command-hold', keys: [], does: 'Other Ctrl/⌘ combinations stay with the browser', mods: 'command', match: 'any' },

  // ---- plain keys
  { id: 'escape', keys: ['Esc'], does: 'Close a panel, dismiss a proposal, end a measurement, then return to Select and clear', mods: 'no-command', match: ['Escape'], run: escape },
  { id: 'remove', keys: ['Del', '⌫'], does: 'Remove the selection; a wall merges its rooms', mods: 'no-command', match: ['Delete', 'Backspace'], prevent: true, run: (tool) => tool.remove() },
  { id: 'fit', keys: ['Home'], does: 'Frame the ship', mods: 'no-command', match: ['Home'], prevent: true, run: (tool) => tool.fit() },
  { id: 'raise-lower', keys: ['PgUp', 'PgDn'], does: 'Raise or lower the selection; selected turrets rise on their barbettes', mods: 'no-command', match: ['PageUp', 'PageDown'], prevent: true, run: raiseOrLower },
  { id: 'resize-wall-fitting', keys: ['←', '→', '↑', '↓'], does: 'Resize a door, window or porthole (Shift for fine steps)', mods: 'no-command', match: ARROWS, when: (tool) => !!wallPiece(tool) || onlyWallFittingsSelected(tool), prevent: true, run: resizeWallFittings },
  {
    id: 'nudge', keys: ['←', '→', '↑', '↓'], does: 'Nudge the selection by the snap step', mods: 'no-command', match: ARROWS, when: hasSelection, prevent: true,
    run: (tool, event) => {
      const step = tool.gridStep;
      tool.nudge(event.key === 'ArrowLeft' ? [-step, 0, 0] : event.key === 'ArrowRight' ? [step, 0, 0] : event.key === 'ArrowUp' ? [0, 0, -step] : [0, 0, step]);
    },
  },
  {
    id: 'card', keys: ['1', '…', '9'], does: 'Pick a palette card', mods: 'no-command', match: DIGITS,
    run: (tool, event, chrome) => {
      const item = tool.palette.bar[Number(event.key) - 1];
      if (item && tool.selectSlot(item)) chrome.slotChosen();
    },
  },
  {
    id: 'drawer', keys: ['0'], does: 'Open or close every card of the layer', mods: 'no-command', match: ['0'],
    run: (tool, event, chrome) => {
      if (!tool.hasDrawer) return;
      event.preventDefault();
      chrome.toggleDrawer();
    },
  },
  { id: 'turn-block', keys: ['X', 'Y', 'Z'], does: 'Hull: turn the cursor block or selected blocks 90° in pitch, yaw or roll (Shift reverses)', mods: 'no-command', match: AXES, when: (tool) => tool.state.layer === 'hull', prevent: true, once: true, run: (tool, event) => tool.turn(AXES.indexOf(event.key.toLowerCase()), quarter(event)) },
  { id: 'view', keys: ['Q'], does: 'Cycle Orbit, Plan, Profile and Bow', mods: 'no-command', match: ['q'], run: (tool) => tool.cycleView() },
  { id: 'warnings', keys: ['W'], does: 'Open or close the checks list', mods: 'no-command', match: ['w'], run: (_tool, _event, chrome) => chrome.toggleWarnings() },
  { id: 'rotate', keys: ['R', '⇧R'], does: 'Rotate the cursor piece or selection: ±90° hull, 15° fittings (Shift-R 1°)', mods: 'no-command', match: ['r'], run: (tool, event) => tool.rotate(event.shiftKey) },
  { id: 'mirror', keys: ['M'], does: 'Toggle Mirror', mods: 'no-command', match: ['m'], run: (tool) => tool.toggleMirror() },
  { id: 'centers', keys: ['C'], does: 'Show or hide the centers of gravity and buoyancy', mods: 'no-command', match: ['c'], run: (tool) => tool.toggleCenters() },
  { id: 'arcs', keys: ['A'], does: 'Machinery, Armament and Outfit: show or hide gun arcs', mods: 'no-command', match: ['a'], when: (tool) => tool.state.layer === 'fittings', run: (tool) => tool.toggleArcs() },
  {
    id: 'rail', keys: [], does: "The layer's rail: each tool and action prints its own key (see BUILDER_RAIL)", mods: 'no-command', match: 'any',
    run: (tool, event) => {
      const lower = event.key.toLowerCase(),
        entry = tool.rail.find((entry) => entry.key.toLowerCase() === lower);
      if (entry) tool.activateRail(entry);
    },
  },
];

function bindingMatches(binding: BuilderKeyBinding, tool: BuilderTool, event: BuilderKey): boolean {
  const command = event.ctrlKey || event.metaKey;
  if (binding.mods === 'command' ? !command : binding.mods === 'plain' ? command || event.altKey : binding.mods === 'no-command' ? command : false) return false;
  if (binding.match !== 'any' && !binding.match.some((key) => (key.length === 1 ? key === event.key.toLowerCase() : key === event.key))) return false;
  return !binding.when || binding.when(tool, event);
}

/** `BuilderTool.key()`: the first matching binding decides the key; the caller has already excluded text fields,
 * the help dialog and a locked door. */
export function dispatchBuilderKey(tool: BuilderTool, event: BuilderKey, chrome: BuilderChrome): void {
  const binding = BUILDER_KEYMAP.find((entry) => bindingMatches(entry, tool, event));
  if (!binding) return;
  if (binding.prevent) event.preventDefault();
  if (binding.run && !(binding.once && event.repeat)) binding.run(tool, event, chrome);
}
