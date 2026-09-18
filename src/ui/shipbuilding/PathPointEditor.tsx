import { useState } from 'react';
import type { ConstructionEquipment, ConstructionEquipmentPart, Vec3 } from '../../ships/blueprint';
import { pathSlackLimit } from '../../ships/constructionPaths';
import { NumberField } from './NumberField';
import { RailingFields } from './RailingFields';
import { railingSettings } from '../../ships/constructionPaths';

export function PathPointEditor({ item, part, onChange }: { item: ConstructionEquipment; part: ConstructionEquipmentPart; onChange(path: NonNullable<ConstructionEquipment['path']>): void }) {
  const [chosen, setChosen] = useState(0), path = item.path;
  if (!path || !part.path) return null;
  const index = Math.min(chosen, path.points.length - 1);
  const insert = () => {
    const after = Math.min(index, path.points.length - 2), a = path.points[after], b = path.points[after + 1];
    const points = path.points.slice(); points.splice(after + 1, 0, a.map((v, k) => (v + b[k]) / 2) as Vec3);
    onChange({ ...path, points }); setChosen(after + 1);
  };
  return <div className="sb-path-editor">
    {part.path.kind === 'railing' && <RailingFields {...railingSettings(part, path)} onHeight={heightM => onChange({ ...path, heightM })}/>}
    <label>Point <select aria-label="Path point" className="sb-link" value={index} onChange={event => setChosen(Number(event.target.value))}>{path.points.map((_, i) => <option key={i} value={i}>{i + 1} of {path.points.length}</option>)}</select></label>
    <span><button disabled={path.points.length >= 64} onClick={insert}>Insert point</button><button disabled={path.points.length <= 2} onClick={() => onChange({ ...path, points: path.points.filter((_, i) => i !== index) })}>Remove point</button></span>
    {part.path.kind === 'rope' && <NumberField label="Rope slack" value={path.slackM ?? 0} min={0} max={pathSlackLimit(path.points)} step={.05} unit="m" onChange={slackM => onChange({ ...path, slackM })}/>}
  </div>;
}
