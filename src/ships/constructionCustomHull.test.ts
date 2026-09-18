import { expect, test } from 'bun:test';
import type { ConstructionCatalog } from './blueprint';
import { createStarterSource } from './constructionStarter';
import { HULL_PRESETS } from './constructionHullPresets';
import { addHullPointPair, removeHullPointPair, customHullPrimitive, editableCustomHull, setSectionCount } from './customHullModel';
import { copyConstructionSelection, decodeConstructionSource, moveConstructionSelection, rotateConstructionSelection } from './constructionEditor';
const catalog = { revision: 'test-catalog' } as ConstructionCatalog;

test('new hull presets are one versioned editable primitive; blank retains the unit block', () => {
  for (const preset of HULL_PRESETS) {
    const source = createStarterSource(catalog, preset.id), [hull] = source.construction.primitives;
    expect(source.construction.primitives).toHaveLength(1);
    expect(hull.kind).toBe('custom-hull'); expect(hull.customHull?.version).toBe(1);
    expect(hull.size).toEqual([preset.beam, preset.depth, preset.length]);
    expect(hull.customHull).toEqual({ ...preset.customHull, version: 1 });
    expect(source.construction.equipment).toEqual([]);
    expect(decodeConstructionSource(JSON.parse(JSON.stringify(source)))).toEqual(source);
  }
  expect(createStarterSource(catalog, 'blank').construction.primitives).toEqual([{ id: 'hull', kind: 'box', size: [1, 1, 1], position: [0, 0, 0], rotationDeg: 0 }]);
});

test('section editing retains placement, face assignments and unrelated equipment', () => {
  const source = createStarterSource(catalog, 'fletcher-hull');
  moveConstructionSelection(source, new Set(['hull']), [6, 2, -3]); rotateConstructionSelection(source, new Set(['hull']), 90);
  const old = source.construction.primitives[0], draft = editableCustomHull(old), original = structuredClone(source);
  setSectionCount(draft, 24); draft.beam = 15;
  source.construction.primitives[0] = customHullPrimitive(draft, old);
  expect(source.construction.primitives[0].position).toEqual([6, 2, -3]);
  expect(source.construction.primitives[0].rotationDeg).toBe(90);
  expect(source.construction.primitives[0].customHull?.stations).toHaveLength(24);
  expect(source.construction.surfaces).toEqual(original.construction.surfaces);
  expect(source.construction.equipment).toEqual(original.construction.equipment);
  const [id] = copyConstructionSelection(source, new Set(['hull']), { mirror: true });
  const copy = source.construction.primitives.find(p => p.id === id)!;
  copy.customHull!.stations[1].points[0].x -= .1;
  expect(copy.customHull!.stations[1].points[0].x).not.toBe(source.construction.primitives[0].customHull!.stations[1].points[0].x);
});

test('malformed or newer hull data cannot silently replace saved source', () => {
  const source = createStarterSource(catalog, 'fletcher-hull');
  const newer = structuredClone(source); (newer.construction.primitives[0].customHull as { version: number }).version = 2;
  expect(() => decodeConstructionSource(newer)).toThrow('Unsupported custom hull version');
  source.construction.primitives[0].customHull!.stations[0].points.pop();
  expect(() => decodeConstructionSource(source)).toThrow('odd number of outline points');
});

test('paired point edits round-trip through the versioned source and reopen exactly', () => {
  const source = createStarterSource(catalog, 'fletcher-hull'), primitive = source.construction.primitives[0];
  const h = editableCustomHull(primitive);
  addHullPointPair(h, 7); addHullPointPair(h, 4); removeHullPointPair(h, 1);
  source.construction.primitives[0] = customHullPrimitive(h, primitive);
  const reopened = decodeConstructionSource(JSON.parse(JSON.stringify(source)));
  expect(reopened).toEqual(source);
  expect(editableCustomHull(reopened.construction.primitives[0])).toEqual(h);
});
