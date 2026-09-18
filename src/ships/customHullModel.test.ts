import { expect, test } from 'bun:test';
import { addHullPointPair, canRemoveHullPointPair, clone, customHullFaces, customHullPrimitive, invalidReason, lockSymmetry, makeHull, removeHullPointPair, resizeSection, setSectionCount } from './customHullModel';
import { contourAt, MAX_HULL_POINTS } from './customHullTopology';
import { customHullPanels, mirroredPanelId } from './constructionPanels';

const arcPosition = (points: { x: number; y: number }[], p: { x: number; y: number }, beam: number, depth: number) => {
  let length = 0, nearest = { error: Infinity, distance: 0 };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = (b.x - a.x) * beam / 2, dy = (b.y - a.y) * depth;
    const px = (p.x - a.x) * beam / 2, py = (p.y - a.y) * depth;
    const edge = Math.hypot(dx, dy), t = edge ? Math.max(0, Math.min(1, (px * dx + py * dy) / edge ** 2)) : 0;
    const error = Math.hypot(px - t * dx, py - t * dy);
    if (error < nearest.error) nearest = { error, distance: length + t * edge };
    length += edge;
  }
  return { ...nearest, fraction: nearest.distance / length };
};

test('adding and removing pairs redistributes the whole outline in metres', () => {
  for (const add of [true, false]) for (const selected of add ? [0, 1, 3, 4, 5, 7, 8] : [1, 2, 3, 5, 6, 7]) {
    const h = makeHull(), before = clone(h);
    const next = add ? addHullPointPair(h, selected) : removeHullPointPair(h, selected);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(h.stations[0].points.length - 1);
    expect(invalidReason(h)).toBeUndefined();
    expect(h.stations.map(s => [s.id, s.t])).toEqual(before.stations.map(s => [s.id, s.t]));
    for (const [i, s] of h.stations.entries()) {
      const old = before.stations[i].points, last = s.points.length - 1, keel = last / 2;
      expect(s.points).toHaveLength(add ? 11 : 7);
      expect([s.points[0].x, s.points[0].y, s.points[keel].x, s.points[keel].y]).toEqual([old[0].x, old[0].y, old[4].x, old[4].y]);
      for (let j = 1; j < keel; j++) {
        const at = arcPosition(old.slice(0, 5), s.points[j], h.beam, h.depth);
        expect(at.error).toBeLessThan(1e-9);
        expect(at.fraction).toBeCloseTo(j / keel, 10);
        expect(s.points[j].x).toBeCloseTo(-s.points[last - j].x, 12);
        expect(s.points[j].y).toBe(s.points[last - j].y);
      }
    }
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
