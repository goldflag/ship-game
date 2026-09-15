import { useEffect, useRef, type ReactNode } from 'react';
import { BUILDER_LAYERS, BUILDER_RAIL } from './builderLayers';

/** Every control and key of the editor, in one place. Tool keys come from the rail
 * definitions so this list cannot drift from the buttons. */
const MOUSE: [string, string][] = [
  ['Click', 'Select a piece, fitting, wall or face; Shift-click adds to the selection'],
  ['Drag a piece', 'Move it along the face under the pointer, snapped to the grid (1 m hull, ¼ m fittings)'],
  ['Drag empty space', 'Orbit; pan in the Plan, Profile and Bow views'],
  ['Right-drag', 'Pan'],
  ['Wheel · middle-drag', 'Zoom · dolly'],
  ['Shift-drag', 'Box select; Ctrl or ⌘ adds to the selection'],
  ['Right-click', 'Remove the piece or fitting under the pointer'],
  ['While placing', 'Click places; a drag lays a run; Fill drags a rectangle'],
];
const EDITING: [string[], string][] = [
  [['⌘Z', '⇧⌘Z'], 'Undo, redo (⌘Y also redoes)'],
  [['⌘C', '⇧⌘C'], 'Copy 1 m to starboard, mirror-copy across the centerline'],
  [['⌘A'], 'Select every hull piece and fitting'],
  [['Del', '⌫', '⌘X'], 'Remove the selection; a wall merges its rooms'],
  [['←', '→', '↑', '↓'], 'Nudge the selection (1 m hull, ¼ m fittings)'],
  [['PgUp', 'PgDn'], 'Raise or lower the selection; with Shift, move the slice'],
  [['R'], 'Rotate the cursor piece or the selection (90° hull, 15° fittings)'],
  [['Esc'], 'Close a panel, cancel a gesture, then return to Select'],
];
const VIEW: [string[], string][] = [
  [['Q'], 'Cycle Orbit, Plan, Profile and Bow'],
  [['S'], 'Slice the ship above a height'],
  [['W'], 'Collapse or expand the warnings'],
  [['M'], 'Mirror placements across the centerline'],
  [['Home'], 'Frame the ship'],
  [['1', '…', '9'], 'Pick a palette card'],
  [['0'], 'Open or close every card of the layer'],
  [['?'], 'This list'],
  [['G'], 'In vertex mode: cycle the move increment'],
  [['O'], 'In vertex mode: toggle orthographic / perspective'],
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
      <p>Select one cube or vertex hull, then choose Vertices. Combine local symmetry axes, drag corners or enter coordinates. SNAP is opt-in; Split creates independent blocks. Reset edit restores the session-entry shape.</p>
      <p>Keys never act inside text or number fields. Mirror also reaches the twin face when painting armor or paint.</p>
    </div>
  </div>;
}
