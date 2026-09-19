import type { ConstructionEquipment, ConstructionEquipmentPart } from '../../ships/blueprint';
import { wallMount } from '../../ships/constructionWallFittings';
import { NumberField } from './NumberField';

/** The same controls apply to the placement preview and an installed fitting. */
export function WallSizeFields({ part, wall, onChange }: {
  part: ConstructionEquipmentPart;
  wall: NonNullable<ConstructionEquipment['wall']>;
  onChange: (axis: 0 | 1, value: number) => void;
}) {
  if (part.wallSizing === 'uniform') return <NumberField label="Scale" description="Resize the whole fitting while keeping its proportions" value={wall.widthM / part.size[0]} min={.15 / part.size[0]} max={5 / part.size[0]} step={.05} unit="×" onChange={value => onChange(0, value * part.size[0])}/>;
  const round = wallMount(part) === 'porthole';
  return <>
    <NumberField label={round ? 'Diameter' : 'Width'} value={wall.widthM} min={.15} max={5} step={.05} unit="m" onChange={value => onChange(0, value)}/>
    {!round && <NumberField label="Height" value={wall.heightM} min={.15} max={5} step={.05} unit="m" onChange={value => onChange(1, value)}/>}
  </>;
}
