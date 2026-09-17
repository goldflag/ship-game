import { expect, test } from 'bun:test';
import { integrateConstructionMagazines, setBarbetteHeight } from './constructionArmament';
import { createStarterSource } from './constructionStarter';
import { createConstructionHistory, editConstruction, undoConstruction } from './constructionHistory';
import { paletteFor } from '../ui/shipbuilding/builderLayers';
import { decodeConstructionSource } from './constructionEditor';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog } from './blueprint';
const catalog = catalogJson as ConstructionCatalog;

test('new ships have integral ammunition, no separate magazines or links', () => {
  const source = createStarterSource(catalog, 'patrol');
  expect(source.construction.version).toBe(2);
  expect(source.construction.equipment.some(e => e.magazineId || catalog.equipment.find(p => p.id === e.partId)?.kind === 'magazine')).toBe(false);
  expect(paletteFor('internals', catalog).drawer.some(s => s.kind === 'part' && s.part.kind === 'magazine')).toBe(false);
  expect(decodeConstructionSource(source)).toEqual(source);
});
test('old designs convert in one undo step without moving weapons or changing stable IDs', () => {
  const source = createStarterSource(catalog, 'patrol'); source.construction.version = 1;
  source.construction.equipment.push({ id: 'old-mag', partId: 'generic-magazine-1000', position: [0, -2, 0], bearingDeg: 0 });
  source.construction.equipment.find(e => e.id === 'gun-forward')!.magazineId = 'old-mag';
  const changed = editConstruction(createConstructionHistory(source), 'Integrate ammunition', draft => integrateConstructionMagazines(draft, catalog));
  expect(changed.source.construction.version).toBe(2);
  expect(changed.source.construction.equipment.some(e => e.id === 'old-mag' || e.magazineId)).toBe(false);
  expect(undoConstruction(changed).source).toEqual(source);
});
test('raising, copying, lowering and saving preserve the fixed attachment datum', () => {
  const source = createStarterSource(catalog, 'patrol');
  const gun = source.construction.equipment.find(e => e.id === 'gun-forward')!;
  const deckDatum = gun.position[1];
  setBarbetteHeight(gun, 3);
  expect(gun.position[1] - gun.gun!.barbetteHeightM!).toBe(deckDatum);
  const copy = structuredClone(gun); setBarbetteHeight(copy, 1.5);
  expect(copy.position[1] - copy.gun!.barbetteHeightM!).toBe(deckDatum);
  expect(decodeConstructionSource(JSON.parse(JSON.stringify(source))).construction.equipment.find(e => e.id === gun.id)).toEqual(gun);
  setBarbetteHeight(gun, 0); expect(gun.position[1]).toBe(deckDatum);
  expect(() => setBarbetteHeight(gun, NaN)).toThrow();
});
