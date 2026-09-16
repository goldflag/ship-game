import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HULL_PRESETS, type HullPresetChoice } from '../../ships/constructionHullPresets';
import './NewDesignDialog.css';

/** Shared by port and Designs. A source is created only after an explicit choice. */
export function NewDesignDialog({ onCreate, onClose }: {
  onCreate(choice: HullPresetChoice): Promise<void>; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), title = useId();
  const [choice, setChoice] = useState<HullPresetChoice>('destroyer-hull');
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  const create = async () => {
    if (pending) return;
    setPending(true); setError('');
    try { await onCreate(choice); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setPending(false); }
  };
  return createPortal(<dialog ref={dialog} className="new-design-dialog" aria-labelledby={title} onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <header><h2 id={title}>Choose a starting hull</h2><p>Start with a hull shape, or build from a single block. Add fittings and equipment in the shipbuilder.</p></header>
    <fieldset disabled={pending}><legend>Hull presets</legend><div className="new-design-presets">
      {HULL_PRESETS.map(preset => {
        const points = [...preset.widths.map((width, i) => `${16 + i / 7 * 248},${52 - width * 27}`), ...[...preset.widths].reverse().map((width, i) => `${264 - i / 7 * 248},${52 + width * 27}`)].join(' ');
        return <label key={preset.id} className="new-design-choice" data-selected={choice === preset.id}>
          <span className="new-design-name"><input type="radio" aria-label={preset.name} name="hull-preset" value={preset.id} checked={choice === preset.id} onChange={() => setChoice(preset.id)} /><strong>{preset.name}</strong></span>
          <svg viewBox="0 0 280 104" aria-hidden="true"><polygon points={points}/><line x1="16" x2="264" y1="52" y2="52"/></svg>
          <span>{preset.note}</span><small>{preset.length} m long · {preset.beam} m wide · {preset.depth} m deep</small>
        </label>;
      })}
    </div><label className="new-design-choice new-design-blank" data-selected={choice === 'blank'}><span className="new-design-name"><input type="radio" aria-label="No hull preset" name="hull-preset" value="blank" checked={choice === 'blank'} onChange={() => setChoice('blank')}/><strong>No hull preset</strong></span><span>One 1 × 1 × 1 m block, ready to build from.</span></label></fieldset>
    {error && <p className="new-design-error" role="alert">{error}</p>}
    <footer><button disabled={pending} onClick={onClose}>Cancel</button><button className="new-design-create" disabled={pending} onClick={() => void create()}>{pending ? 'Creating design…' : 'Create design'}</button></footer>
  </dialog>, document.body);
}
