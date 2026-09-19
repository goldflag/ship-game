import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CONSTRUCTION_PAINTS } from '../../ships/constructionPaints';
import { DEFAULT_HULL_PRESET, HULL_PRESETS, type HullPresetChoice } from '../../ships/constructionHullPresets';
import './NewDesignDialog.css';

/** Deck outline of a starting hull, drawn from its stations. */
export function HullPresetPlan({ preset }: { preset: typeof HULL_PRESETS[number] }) {
  const scale = Math.min(248 / preset.length, 70 / preset.beam);
  const edge = preset.customHull.stations.map(s => [16 + s.t * preset.length * scale, s.points.at(-1)!.x * preset.beam / 2 * scale]);
  const points = [...edge.map(([x, y]) => `${x},${52 - y}`), ...edge.reverse().map(([x, y]) => `${x},${52 + y}`)].join(' ');
  return <svg viewBox="0 0 280 104" aria-hidden="true"><polygon points={points}/><line x1="16" x2={16 + preset.length * scale} y1="52" y2="52"/></svg>;
}

/** Shared by port and Designs. A source is created only after an explicit choice. */
export function NewDesignDialog({ onCreate, onClose, initialChoice = DEFAULT_HULL_PRESET }: {
  onCreate(choice: HullPresetChoice, paint: string): Promise<void>; onClose(): void;
  /** The hull the port's first-run cards preselect. */
  initialChoice?: HullPresetChoice;
}) {
  const dialog = useRef<HTMLDialogElement>(null), title = useId();
  const [choice, setChoice] = useState<HullPresetChoice>(initialChoice);
  const [paint, setPaint] = useState<string>('naval-gray');
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  const create = async () => {
    if (pending) return;
    setPending(true); setError('');
    try { await onCreate(choice, paint); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setPending(false); }
  };
  return createPortal(<dialog ref={dialog} className="new-design-dialog" aria-labelledby={title} onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <header><h2 id={title}>Choose a starting hull</h2><p>Choose a ship hull or a generic shape, or build from a single block. Add fittings and equipment in the shipbuilder.</p></header>
    <fieldset disabled={pending}><legend>Hull presets</legend><div className="new-design-presets">
      {HULL_PRESETS.map(preset => {
        return <label key={preset.id} className="new-design-choice" data-selected={choice === preset.id}>
          <span className="new-design-name"><input type="radio" aria-label={preset.name} name="hull-preset" value={preset.id} checked={choice === preset.id} onChange={() => setChoice(preset.id)} /><strong>{preset.name}</strong></span>
          <HullPresetPlan preset={preset}/>
          <span>{preset.note}</span><small>{Number(preset.length.toFixed(2))} m long · {Number(preset.beam.toFixed(2))} m wide · {Number(preset.depth.toFixed(2))} m deep</small>
        </label>;
      })}
    </div><label className="new-design-choice new-design-blank" data-selected={choice === 'blank'}><span className="new-design-name"><input type="radio" aria-label="No hull preset" name="hull-preset" value="blank" checked={choice === 'blank'} onChange={() => setChoice('blank')}/><strong>No hull preset</strong></span><span>One 1 × 1 × 1 m block, ready to build from.</span></label></fieldset>
    <fieldset disabled={pending} className="new-design-paint"><legend>Ship paint</legend><p>Coats the hull and every fitting you add. Change it any time in the Paint tab; decks and accents are painted there too.</p><div className="new-design-paints">
      {CONSTRUCTION_PAINTS.map(entry => <label key={entry.id} className="new-design-swatch" data-selected={paint === entry.id} title={entry.name}>
        <input type="radio" name="ship-paint" aria-label={entry.name} value={entry.id} checked={paint === entry.id} onChange={() => setPaint(entry.id)}/><i style={{ background: entry.color }}/><span>{entry.name}</span></label>)}
    </div></fieldset>
    {error && <p className="new-design-error" role="alert">{error}</p>}
    <footer><button disabled={pending} onClick={onClose}>Cancel</button><button className="new-design-create" disabled={pending} onClick={() => void create()}>{pending ? 'Creating design…' : 'Create design'}</button></footer>
  </dialog>, document.body);
}
