import type { ConstructionEquipment, ConstructionEquipmentPart } from '../../ships/blueprint';
import { wallMount } from '../../ships/constructionWallFittings';

/** Keep circular/proportional fittings intact in preview, fields and keyboard edits. */
export function resizedWallDimensions(part: ConstructionEquipmentPart, wall: NonNullable<ConstructionEquipment['wall']>, axis: 0 | 1, value: number): Pick<NonNullable<ConstructionEquipment['wall']>, 'widthM' | 'heightM'> {
  if (part.wallSizing === 'uniform') {
    const scale = value / part.size[axis];
    return { widthM: part.size[0] * scale, heightM: part.size[1] * scale };
  }
  if (wallMount(part) === 'porthole') return { widthM: value, heightM: value };
  return { widthM: axis === 0 ? value : wall.widthM, heightM: axis === 1 ? value : wall.heightM };
}

