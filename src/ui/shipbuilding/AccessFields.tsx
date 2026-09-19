import type { AccessKind, AccessSettings, Handrails } from '../../../assets/parts/construction/access_geometry';
import { NumberField } from './NumberField';
export function AccessFields({ kind, value, onChange }: { kind: AccessKind; value: AccessSettings; onChange(value: AccessSettings): void }) {
  return <>
    <NumberField label="Width" value={value.widthM} min={.35} max={1.5} step={.05} unit="m" onChange={widthM => onChange({ ...value, widthM })}/>
    {kind === 'inclined-ladder' ? <label>Handrails <select className="sb-link" value={value.handrails} onChange={e => onChange({ ...value, handrails: e.target.value as Handrails })}>{(['both','left','right','none'] as const).map(v => <option key={v} value={v}>{v}</option>)}</select></label> : <>
      <NumberField label="Wall standoff" value={value.standOffM} min={.12} max={.4} step={.01} unit="m" onChange={standOffM => onChange({ ...value, standOffM })}/>
      <NumberField label="Grab extension" value={value.grabHeightM} min={0} max={1.2} step={.05} unit="m" onChange={grabHeightM => onChange({ ...value, grabHeightM })}/>
    </>}
  </>;
}
