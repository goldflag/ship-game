import { useEffect, useId, useState } from 'react';
import { Input } from '../components';
import { finiteFieldValue } from './editorNumbers';

/** Keep partial input local; incomplete, NaN and infinite values never enter an authoring command. */
export function NumberField({ label, value, min = -500, max = 500, step = 1, unit = 'm', onChange }: {
  label: string; value: number; min?: number; max?: number; step?: number; unit?: string; onChange(value: number): void;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [error, setError] = useState(false);
  useEffect(() => { setText(String(value)); setError(false); }, [value]);
  const commit = (candidate: string) => {
    const number = finiteFieldValue(candidate, min, max);
    setError(number === undefined);
    if (number !== undefined && number !== value) onChange(number);
  };
  return <label className="shipbuilder-number" htmlFor={id}>
    <span>{label}{unit && <small>{unit}</small>}</span>
    <Input id={id} type="number" value={text} min={min} max={max} step={step} aria-invalid={error} aria-describedby={error ? `${id}-error` : undefined}
      onChange={event => { setText(event.target.value); setError(false); }} onBlur={event => commit(event.currentTarget.value)}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setText(String(value)); setError(false); event.stopPropagation(); } }}/>
    {error && <small id={`${id}-error`} role="alert">Enter {min} to {max} {unit}.</small>}
  </label>;
}
