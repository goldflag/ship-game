import { NumberField } from './NumberField';

export function RailingFields({ heightM, onHeight }: { heightM: number; onHeight(value: number): void }) {
  return <NumberField label="Railing height" value={heightM} min={.3} max={3} step={.05} unit="m" onChange={onHeight}/>;
}
