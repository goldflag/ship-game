import { NumberField } from './NumberField';

export function RailingFields({ heightM, railCount, onHeight, onRails }: { heightM: number; railCount: number; onHeight(value: number): void; onRails(value: 2 | 3): void }) {
  return <>
    <NumberField label="Railing height" value={heightM} min={.3} max={3} step={.05} unit="m" onChange={onHeight}/>
    <label>Rails <select className="sb-link" aria-label="Rail count" value={railCount} onChange={event => onRails(Number(event.target.value) as 2 | 3)}>
      <option value={2}>2 rails</option><option value={3}>3 rails</option>
    </select></label>
  </>;
}
