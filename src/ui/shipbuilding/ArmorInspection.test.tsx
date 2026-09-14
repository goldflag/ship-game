import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConstructionSurface } from '../../ships/blueprint';
import { ArmorInspection, armorInspectionGroups } from './ArmorInspection';

test('armor coverage sums native patches without counting a split source face twice', () => {
  const face: ConstructionSurface = { id: 'hull:port', primitiveId: 'hull', face: 'port', vertices: [], normal: [-1, 0, 0], areaM2: 7,
    thicknessMm: 37, material: 'armor-steel', paint: 'sea-blue', open: false };
  const patches = [{ ...face, areaM2: 2 }, { ...face, areaM2: 5 }];
  expect(armorInspectionGroups(patches)).toEqual(armorInspectionGroups([face]));
  const opening = { ...face, id: 'hull:top', face: 'top' as const, areaM2: 3, open: true };
  const groups = armorInspectionGroups([...patches, opening]);
  expect(groups).toHaveLength(2);
  expect(groups[0].areaM2).toBe(7);
  expect(groups[0].faces.size).toBe(1);
  expect(groups[1].areaM2).toBe(3);
  const markup = renderToStaticMarkup(<ArmorInspection label="Selected armor" surfaces={[...patches, opening]}/>);
  expect(markup).toContain('37 mm · Armor steel');
  expect(markup).toContain('Sea blue');
  expect(markup).toContain('Open to sea');
});
