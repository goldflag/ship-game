import { useRef, useState } from 'react';
import './DeleteDesignButton.css';

/** Confirm beside the saved design, keeping deletion separate from opening it. */
export function DeleteDesignButton({ name, disabled, onDelete }: { name: string; disabled?: boolean; onDelete(): Promise<void> }) {
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null), pending = useRef(false);
  const cancel = () => { if (!pending.current) { setConfirming(false); setError(''); requestAnimationFrame(() => trigger.current?.focus()); } };
  const remove = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await onDelete(); setConfirming(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className="design-delete" data-confirming={confirming} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); cancel(); } }}>
    {confirming ? <>
      <p>Delete “{name}” and all its saved revisions? This cannot be undone.</p>
      <button className="design-delete-confirm" disabled={disabled || busy} aria-label={`Confirm delete ${name}`} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete design'}</button>
      <button autoFocus disabled={busy} onClick={cancel}>Cancel</button>
      {error && <p role="alert">{error}</p>}
    </> : <button ref={trigger} disabled={disabled} aria-label={`Delete ${name}`} onClick={() => setConfirming(true)}>Delete</button>}
  </div>;
}

/** Clone sits beside Delete: one press saves the latest revision as a new design. */
export function CloneDesignButton({ name, disabled, onClone }: { name: string; disabled?: boolean; onClone(): Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const clone = async () => {
    setBusy(true); setError('');
    try { await onClone(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="design-clone">
    <button disabled={disabled || busy} aria-label={`Clone ${name}`} title="Save a copy as a new design" onClick={() => void clone()}>{busy ? 'Cloning…' : 'Clone'}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
