import type { ConstructionWear } from '../../ships/blueprint';
import { CONSTRUCTION_WEAR, DEFAULT_CONSTRUCTION_WEAR } from '../../ships/constructionPaints';

/** The editor viewport draws clean paint; wear shows only in the game's renderer. */
export function WearSelect({ value, onChange, disabled }: {
  value: ConstructionWear | undefined;
  onChange(value: ConstructionWear): void;
  disabled: boolean;
}) {
  return <label className="sb-finish-select">Wear <select className="sb-link" aria-label="Ship wear" value={value ?? DEFAULT_CONSTRUCTION_WEAR} disabled={disabled}
    title="Weathering, runoff streaks and funnel soot shown in port and battle; the editor draws clean paint"
    onChange={event => onChange(event.target.value as ConstructionWear)}>
    {CONSTRUCTION_WEAR.map(wear => <option key={wear.id} value={wear.id}>{wear.name}</option>)}
  </select></label>;
}
