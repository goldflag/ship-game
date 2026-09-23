import { CONSTRUCTION_PAINTS } from '../../ships/constructionPaints';

/** `color` is the roof colour now drawn, so the automatic shade shows beside its name. */
export function RoofPaintSelect({ value, color, onChange, disabled }: {
  value: string | undefined;
  color: string;
  onChange(value?: string): void;
  disabled: boolean;
}) {
  return <label className="sb-finish-select">Roofs <i className="sb-ship-paint" style={{ background: color }}/>
    <select className="sb-link" aria-label="Roof paint" title="Horizontal steel wearing the ship paint: roofs, platforms, turret tops" value={value ?? ''}
      disabled={disabled} onChange={event => onChange(event.target.value || undefined)}>
      <option value="">Darker shade</option>
      {CONSTRUCTION_PAINTS.map(paint => <option key={paint.id} value={paint.id}>{paint.name}</option>)}
    </select></label>;
}
