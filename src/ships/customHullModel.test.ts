import { expect, test } from 'bun:test';
import { addHullPointPair, canRemoveHullPointPair, clone, customHullFaces, customHullPrimitive, displayPoints, invalidReason, lockSymmetry, makeHull, removeHullPointPair, resizeSection, setSectionCount } from './customHullModel';
import { contourAt, MAX_HULL_POINTS } from './customHullTopology';
import { customHullPanels, mirroredPanelId } from './constructionPanels';

test('adding from either side or the keel splits mirrored edges in every section', () => {
  for (const selected of [0, 1, 3, 4, 5, 7, 8]) {
    const h = makeHull(); h.bulb = .5;
    const before = clone(h), next = addHullPointPair(h, selected);
    expect(invalidReason(h)).toBeUndefined();
    expect(h.stations.map(s => s.id)).toEqual(before.stations.map(s => s.id));
    for (const [i, s] of h.stations.entries()) {
      expect(s.points).toHaveLength(11);
      expect(s.points[5].x).toBe(0);
      for (let j = 0; j < 5; j++) {
        expect(s.points[j].x).toBeCloseTo(-s.points[10 - j].x, 12);
        expect(s.points[j].y).toBe(s.points[10 - j].y);
      }
      // Inserting detail does not relocate the original controls or their bulb weights.
      const shown = displayPoints(h, s);
      const old = displayPoints(before, before.stations[i]);
      for (let j = 0; j < 9; j++) {
        const point = shown.find(p => p.contour === j)!;
        expect([point.x, point.y]).toEqual([old[j].x, old[j].y]);
      }
    }
    removeHullPointPair(h, next);
    expect(h.stations.map(s => s.points.map(({ x, y }) => ({ x, y })))).toEqual(before.stations.map(s => s.points));
  }
});

test('point counts are bounded and deck edges and the center keel cannot be removed', () => {
  const h = makeHull();
  for (const point of [0, 4, 8]) {
    expect(canRemoveHullPointPair(h.stations[0].points, point)).toBe(false);
    expect(() => removeHullPointPair(h, point)).toThrow();
  }
  removeHullPointPair(h, 1); removeHullPointPair(h, 1);
  expect(h.stations[0].points).toHaveLength(5);
  expect(() => removeHullPointPair(h, 1)).toThrow();
  while (h.stations[0].points.length < MAX_HULL_POINTS) addHullPointPair(h, 0);
  expect(invalidReason(h)).toBeUndefined();
  expect(() => addHullPointPair(h, 0)).toThrow();
});

test('variable outlines survive section interpolation, symmetry locking and pointed-end resizing', () => {
  const h = makeHull(); addHullPointPair(h, 7); removeHullPointPair(h, 3);
  setSectionCount(h, 24); setSectionCount(h, 4);
  expect(invalidReason(h)).toBeUndefined();
  expect(lockSymmetry(h)).toEqual(h);
  const s = h.stations[0]; resizeSection(s, 0); resizeSection(s, .5);
  expect(s.points[0].x).toBe(-.5); expect(s.points.at(-1)!.x).toBe(.5);
  expect(s.points[(s.points.length - 1) / 2].x).toBe(0);
  expect(invalidReason(h)).toBeUndefined();
});

test('unchanged panel IDs and mirrored split panels remain stable through point edits', () => {
  const h = makeHull(), original = customHullPanels(customHullPrimitive(h));
  const added = addHullPointPair(h, 1), panels = customHullPanels(customHullPrimitive(h));
  for (const panel of original.filter(p => !p.panelId!.startsWith('1@') && !p.panelId!.startsWith('6@'))) expect(panels).toContainEqual(panel);
  for (const panel of panels) expect(panels.some(p => p.panelId === mirroredPanelId(panel.panelId))).toBe(true);
  expect(customHullFaces(customHullPrimitive(h)).every(face => face.vertices.flat().every(Number.isFinite))).toBe(true);
  removeHullPointPair(h, added);
  expect(customHullPanels(customHullPrimitive(h))).toEqual(original);
});

test('mismatched counts and contour positions cannot enter the loft', () => {
  const h = makeHull(); addHullPointPair(h, 1);
  h.stations[1].points[1].contour = .5;
  expect(invalidReason(h)).toContain('matching');
  h.stations[1].points.pop();
  expect(invalidReason(h)).toContain('odd number');
  expect(contourAt(makeHull().stations[0].points, 4)).toBe(4);
});
