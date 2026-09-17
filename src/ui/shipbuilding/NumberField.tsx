import { useEffect, useId, useState } from 'react';
import { finiteFieldValue } from './editorNumbers';

/** Inline number entry inside an object tag. Partial input stays local;
 * incomplete, NaN and infinite values never enter an authoring command. */
export function NumberField({ label, description, disabled, value, min = -500, max = 500, step = 1, unit, digits = 2, onChange }: {
  label?: string; description?: string; disabled?: boolean; value: number; min?: number; max?: number; step?: number; unit?: string; digits?: number; onChange(value: number): void;
}) {
  const id = useId();
  const shown = Number(value.toFixed(digits)).toString();
  const [text, setText] = useState(shown);
  const [error, setError] = useState(false);
  useEffect(() => { setText(shown); setError(false); }, [shown]);
  const commit = (candidate: string) => {
    // Focusing and leaving a rounded display must never rewrite the exact source value.
    if (candidate === shown) return;
    const number = finiteFieldValue(candidate, min, max);
    setError(number === undefined);
    if (number !== undefined) {
      if (number !== value) onChange(number);
      // A constrained/rejected edit may leave the prop unchanged. Restore the
      // accepted reading; a changed prop updates it after the parent commits.
      setText(shown);
    }
  };
  return <label className="sb-num" htmlFor={id} title={error ? `Enter ${min} to ${max}${unit ? ` ${unit}` : ''}` : description ?? label}>
    {label && <span>{label}</span>}
    <input id={id} type="number" value={text} disabled={disabled} min={min} max={max} step={step} aria-label={label} aria-description={description} aria-invalid={error} style={{ width: `${Math.max(3, text.length + 1.2)}ch` }}
      onChange={event => { setText(event.target.value); setError(false); }} onBlur={event => commit(event.currentTarget.value)}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setText(shown); setError(false); event.stopPropagation(); } }}/>
    {unit && <em>{unit}</em>}
  </label>;
}
