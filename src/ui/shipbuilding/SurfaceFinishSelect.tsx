import type { ConstructionSurfaceFinish } from '../../ships/blueprint';
import { CONSTRUCTION_SURFACE_FINISHES } from '../../ships/constructionPaints';

export function SurfaceFinishSelect({ value, onChange, disabled }: {
  value: ConstructionSurfaceFinish | undefined;
  onChange(value?: ConstructionSurfaceFinish): void;
  disabled: boolean;
}) {
  return <label className="sb-finish-select">Surface finish <select className="sb-link" aria-label="Ship surface finish" value={value ?? ''} disabled={disabled}
    onChange={event => onChange((event.target.value || undefined) as ConstructionSurfaceFinish | undefined)}>
    <option value="">Original</option>
    {CONSTRUCTION_SURFACE_FINISHES.map(finish => <option key={finish.id} value={finish.id}>{finish.name}</option>)}
  </select></label>;
}
