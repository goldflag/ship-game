import { useEffect, useRef, type ReactNode } from 'react';
import { BUILDER_LAYERS, BUILDER_RAIL } from './builderLayers';

/** Every control and key of the editor, in one place. Tool keys come from the rail
 * definitions so this list cannot drift from the buttons. */
const MOUSE: [string, string][] = [
  ['Click', 'Select a piece, fitting, wall or face; Shift-click adds to the selection'],
  ['Center action', 'Center the selected part or group on the ship using mounting centers'],
  ['Snap card', 'Toggle snapping; the adjacent arrow opens target, spacing and guide settings'],
  ['Drag a selected piece', 'Click to select first, then drag to move it along the face under the pointer, using the enabled snap targets'],
  ['Drag over faces', 'With Paint or Opening on the Armor and Paint layers: sweep the card over every face the drag crosses, as one edit'],
  ['Drag unselected piece or empty space', 'Orbit; pan in orthographic Plan, Profile and Bow views'],
  ['Drag a rotation ring', 'In Hull Rotate mode (O): pitch, yaw or roll around ship axes. Snap 15° is optional; hold Shift for 0.1° angles. Escape cancels the drag'],
  ['Right-drag', 'Rotate a fitting or its placement preview; Shift for 0.1° fine control. Elsewhere, pan'],
  ['Wheel · middle-drag', 'Zoom · dolly'],
  ['Shift-drag', 'Box select; Ctrl or ⌘ adds to the selection'],
  ['Right-click', 'Remove the piece or fitting under the pointer'],
  ['Railing · rope · chain', 'Click connected points; double-click or Enter finishes the path; Escape cancels; Backspace removes the last point'],
  ['While placing', 'Click places; a drag lays a run; Fill drags a rectangle'],
];
const EDITING: [string[], string][] = [
  [['⌘Z', '⇧⌘Z'], 'Undo, redo (⌘Y also redoes)'],
  [['⌘C', '⇧⌘C'], 'Copy 1 m to starboard, mirror-copy across the centerline'],
  [['⌘A'], 'Select every hull piece and fitting'],
  [['Del', '⌫', '⌘X'], 'Remove the selection; a wall merges its rooms'],
  [['←', '→', '↑', '↓'], 'Resize a door/window (Shift for fine steps); otherwise nudge by the Snap step'],
  [['PgUp', 'PgDn'], 'Raise or lower the selection'],
  [['X', 'Y', 'Z'], 'In Hull Rotate mode: choose pitch, yaw or roll. R turns +90°, Shift-R turns −90°'],
  [['R', '⇧R'], 'Rotate the cursor piece or selection: 90° hull, 15° fittings; Shift-R turns fittings 1°'],
  [['N'], 'Toggle snapping; remembers enabled targets and grid spacing'],
  [['S'], 'Cycle grid spacing (local move step in freeform)'],
  [['Alt / Option'], 'Hold to temporarily invert snapping; release to restore'],
  [['Esc'], 'Close a panel, cancel a gesture, then return to Select'],
];
const VIEW: [string[], string][] = [
  [['F8'], 'Toggle model memory: simulation sizes and visual breakdown by part'],
  [['Q'], 'Cycle Orbit, Plan, Profile and Bow'],
  [['P'], 'Toggle perspective / orthographic camera (perspective by default)'],
  [['W'], 'Collapse or expand the warnings'],
  [['M'], 'Mirror placements across the centerline'],
  [['C'], 'Show or hide the centers of gravity and buoyancy'],
  [['A'], 'In Fittings: show or hide gun arcs'],
  [['Home'], 'Frame the ship'],
  [['1', '…', '9'], 'Pick a palette card'],
  [['0'], 'Open or close every card of the layer'],
  [['?'], 'This list'],
  [['D'], 'In Hull: enter or finish freeform editing for one selected shape'],
  [['G'], 'In Freeform hull: cycle the move increment'],
  [['O'], 'In Freeform hull: toggle orthographic / perspective'],
];

function Rows({ rows }: { rows: [ReactNode, string][] }) {
  return <div className="sb-help-rows">{rows.map(([keys, text], index) => <div key={index}><span>{keys}</span><span>{text}</span></div>)}</div>;
}
const keycaps = (keys: string[]) => keys.map((key, index) => <kbd key={index}>{key}</kbd>);

export function HelpDialog({ onClose }: { onClose(): void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus(); }, []);
  return <div className="sb-help-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="sb-help" role="dialog" aria-modal="true" aria-labelledby="sb-help-title">
      <header><h2 id="sb-help-title">Controls and hotkeys</h2><button ref={close} className="sb-help-close" aria-label="Close" onClick={onClose}>×</button></header>
      <div className="sb-help-columns">
        <section><h3>Mouse</h3><Rows rows={MOUSE.map(([action, text]) => [<i key={action}>{action}</i>, text])}/></section>
        <section><h3>Editing</h3><Rows rows={EDITING.map(([keys, text]) => [keycaps(keys), text])}/></section>
        <section><h3>View and palette</h3><Rows rows={VIEW.map(([keys, text]) => [keycaps(keys), text])}/></section>
        <section className="sb-help-tools"><h3>Tools by layer</h3>
          <table><tbody>{BUILDER_LAYERS.map(layer => <tr key={layer.id}><th scope="row">{layer.name}</th><td>{BUILDER_RAIL[layer.id].map(entry => <span key={entry.id}><kbd>{entry.key}</kbd>{entry.name}</span>)}</td></tr>)}</tbody></table>
        </section>
      </div>
      <p>Select one editable hull shape and press D to enter Freeform; D or Escape finishes. Select a vertex, edge, face or curved-shape ring; drag it in the view plane or use an X/Y/Z handle. Arrow keys nudge a focused axis handle. Mirror axes are local to the block; select none to turn symmetry off. An edge or face spanning a mirror plane cannot move across it. Move nearby corners is opt-in; Split creates independent blocks. Reset edit restores the block’s session-entry shape.</p>
      <p>In Select, selected blocks show X/Y/Z handles and a center handle for movement in the view plane. Drag pieces and handles to position them. Snap guides appear only when a snap is engaged: mint joins aligned geometry, brass marks the ship centerline. Dots mark the aligned points and a solid edge marks the target. Turning Snap off hides these guides. Movement stops at another block’s bounds; touching faces can slide along each other. Escape cancels a drag. Keys never act inside text or number fields. Mirror also reaches the twin face when painting armor or paint.</p>
    </div>
  </div>;
}
