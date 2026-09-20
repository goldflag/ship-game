import { expect, test } from 'bun:test';
import valiantJson from '../../assets/ships/valiant/blueprint.json';
import resoluteJson from '../../assets/ships/resolute/blueprint.json';
import type { ConstructionCatalog, ConstructionSource } from './blueprint';
import { catalogParts, closestIds, compactJson, constructionBetween, constructionBounds, constructionGet, constructionNear, constructionSummary, equipmentBounds, primitiveBounds } from './constructionQuery';

const valiant = valiantJson as unknown as ConstructionSource, resolute = resoluteJson as unknown as ConstructionSource;
const catalogOf = async (source: ConstructionSource) =>
  (await Bun.file(new URL(`../../public/models/components/catalogs/${source.construction.catalogRevision}/catalog.json`, import.meta.url)).json()) as ConstructionCatalog;
const valiantCatalog = await catalogOf(valiant), resoluteCatalog = await catalogOf(resolute);
const before = JSON.stringify(valiant);

test('the summary of a finished battleship fits one screen and reports real headroom', () => {
  for (const [source, catalog] of [[valiant, valiantCatalog], [resolute, resoluteCatalog]] as const) {
    const summary = constructionSummary(source, catalog);
    expect(compactJson(summary).length).toBeLessThan(10_000);
    expect(JSON.stringify(summary).length).toBeLessThan(9_000);
    const c = source.construction;
    expect(summary.limits.equipment).toEqual({ used: c.equipment.length, limit: 1_000, free: 1_000 - c.equipment.length });
    expect(summary.limits.primitives.limit).toBe(10_000);
    expect(summary.limits.boundaries.limit).toBe(24);
    expect(summary.primitives.length).toBe(c.primitives.length);
    expect(Object.values(summary.equipmentCounts).reduce((sum, n) => sum + n, 0)).toBe(c.equipment.length);
  }
  const summary = constructionSummary(valiant, valiantCatalog);
  expect(summary.limits.equipment.free).toBe(880);
  expect(summary.primitives[0]).toEqual(['hull', 'custom-hull', [0, 0, 0], [35, 16, 252], 0, 6]);
  expect((summary.equipment.gun['us-16in50-mk7-iowa'] as Record<string, number[]>)['main-charlie']).toEqual([0, 7.8, 78, 180]);
  // Outfit lists IDs only by default; asking for the kind or every position restores placements.
  expect(summary.equipment['deck-fitting']['generic-capstan']).toEqual(['bow-capstan', 'aft-capstan']);
  expect(constructionSummary(valiant, valiantCatalog, { kind: 'deck-fitting' }).equipment['deck-fitting']['generic-capstan']).toEqual({ 'bow-capstan': [0, 7.2, -113, 0], 'aft-capstan': [0, 7.2, 113, 0] });
  expect(Object.keys(constructionSummary(valiant, valiantCatalog, { kind: 'gun' }).equipment)).toEqual(['gun']);
  expect(summary.conventions.axes).toContain('-Z bow');
});

test('get returns exact records, projections and referencing surfaces', () => {
  const gun = valiant.construction.equipment.find((item) => item.id === 'main-alpha')!;
  expect(constructionGet(valiant, valiantCatalog, { ids: ['main-alpha'] }).records.equipment).toEqual([gun]);
  expect(constructionGet(valiant, valiantCatalog, { ids: ['main-alpha', 'bulkhead-5'] }, { fields: ['position', 'offset'] }).records).toEqual({
    equipment: [{ id: 'main-alpha', position: [0, 7.8, -76] }],
    boundaries: [{ id: 'bulkhead-5', offset: 0 }],
  });
  expect(constructionGet(valiant, valiantCatalog, { kind: 'gun' }).count).toBe(21);
  expect(constructionGet(valiant, valiantCatalog, { part: 'us-16in50-mk7-iowa', prefix: 'main-b' }, { fields: ['bearingDeg'] }).records.equipment).toEqual([{ id: 'main-bravo', bearingDeg: 0 }]);
  const house = constructionGet(valiant, valiantCatalog, { ids: ['citadel-deckhouse'] }, { surfaces: true });
  expect(house.surfaces).toHaveLength(5);
  expect(house.surfaces!.every((surface) => surface.primitiveId === 'citadel-deckhouse')).toBe(true);
  expect(() => constructionGet(valiant, valiantCatalog, { ids: ['main-alfa'] })).toThrow(/main-alfa \(closest: main-alpha/);
  expect(() => constructionGet(valiant, valiantCatalog, { ids: ['main-alpha'] }, { fields: ['bearing'] })).toThrow(/bearingDeg/);
  expect(() => constructionGet(valiant, valiantCatalog, {})).toThrow(/Select records/);
  expect(closestIds('door', valiant.construction.equipment.map((item) => item.id))).toContain('companionway-door');
});

test('bounds follow size, rotation, the part datum and bearing', () => {
  const box = primitiveBounds({ id: 'b', kind: 'box', size: [2, 4, 10], position: [1, 2, 3], rotationDeg: 90 });
  expect(box).toMatchObject({ min: [-4, 0, 2], max: [6, 4, 4], approximate: false });
  expect(primitiveBounds({ id: 'c', kind: 'cylinder', size: [2, 2, 2], position: [0, 0, 0], rotationDeg: 0 }).approximate).toBe(true);
  const hull = primitiveBounds(valiant.construction.primitives[0]);
  expect(hull.approximate).toBe(true);
  expect(hull.max).toEqual([17.5, 7.2, 126]);
  expect(hull.min[2]).toBeGreaterThan(-127);

  const part = valiantCatalog.equipment.find((entry) => entry.id === 'us-16in50-mk7-iowa')!;
  const ahead = equipmentBounds({ id: 'g', partId: part.id, position: [0, 10, 0], bearingDeg: 0 }, part);
  expect(ahead.min).toEqual([round(part.boundsCenter[0] - part.size[0] / 2), round(10 + part.boundsCenter[1] - part.size[1] / 2), round(part.boundsCenter[2] - part.size[2] / 2)]);
  expect(ahead.datum).toEqual([0, 10, 0]);
  // Bearing 90 swings the barrels, which point at the bow (−Z), to starboard (+X).
  const abeam = equipmentBounds({ id: 'g', partId: part.id, position: [0, 10, 0], bearingDeg: 90 }, part);
  expect(abeam.max[0]).toBeCloseTo(-ahead.min[2], 3);
  expect(abeam.why).toEqual(['stowed; training sweeps outside']);
  expect(equipmentBounds({ id: 'g', partId: part.id, position: [0, 10, 0], bearingDeg: 45 }, part).why).toContain('box around a part turned off the ship axes');
  expect(equipmentBounds({ id: 'g', partId: part.id, position: [0, 10, 0], bearingDeg: 0, gun: { barbetteHeightM: 0.6 } }, part).min[1]).toBeCloseTo(ahead.min[1] - 0.6, 3);

  const result = constructionBounds(valiant, valiantCatalog);
  expect(result.bounds).toHaveLength(38);
  expect(result.omitted).toContain('120 equipment');
  expect(compactJson(result).length).toBeLessThan(8_000);
  const chosen = constructionBounds(valiant, valiantCatalog, { ids: ['main-alpha', 'bulkhead-5', 'weatherdeck-rail-port'] });
  expect(chosen.bounds.map((row) => row.id)).toEqual(['main-alpha', 'weatherdeck-rail-port']);
  expect(chosen.planes).toEqual([{ id: 'bulkhead-5', table: 'boundaries', plane: { axis: 'z', offset: 0 } }]);
  // A railing's datum is the ship origin; its box comes from the path points.
  expect(chosen.bounds[1].max[2]).toBeLessThan(-100);
  expect(constructionBounds(resolute, resoluteCatalog, { kind: 'gun' }).bounds.every((row) => row.kind === 'gun' && row.approximate)).toBe(true);
});
const round = (n: number) => Number(n.toFixed(3));

test('spatial queries sort by distance and report per-axis gaps', () => {
  const near = constructionNear(valiant, valiantCatalog, { point: [0, 8, -76], radius: 5 });
  expect(near.hits.map((hit) => [hit.id, hit.distance])).toEqual([['main-alpha', 0], ['hull', 0.8]]);
  expect(near.note).toContain('Source-level');
  const bridge = constructionNear(valiant, valiantCatalog, { box: { min: [-5, 13, -20], max: [5, 25, -10] }, limit: 5 });
  expect(bridge.total).toBeGreaterThan(5);
  expect(bridge.truncatedTo).toBe(5);
  expect(bridge.hits.every((hit) => hit.distance === 0)).toBe(true);
  expect(constructionNear(valiant, valiantCatalog, { point: [0, 8, -76], radius: 5, kind: 'gun' }).hits).toHaveLength(1);
  expect(() => constructionNear(valiant, valiantCatalog, { point: [0, 0, 0] })).toThrow(/radius/);
  expect(() => constructionNear(valiant, valiantCatalog, {})).toThrow(/exactly one/);

  const between = constructionBetween(valiant, valiantCatalog, 'main-alpha', 'main-bravo');
  expect(between.gap[2]).toBeCloseTo(5.137, 3);
  expect(between.gap[0]).toBeLessThan(0);
  expect(between).toMatchObject({ boxesIntersect: false, distance: between.gap[2], approximate: true });
  expect(() => constructionBetween(valiant, valiantCatalog, 'main-alpha', 'bulkhead-5')).toThrow(/planes/);
});

test('catalog filters keep the default listing and shrink the brief one', () => {
  expect(catalogParts(valiantCatalog)).toEqual(valiantCatalog.equipment);
  const guns = catalogParts(valiantCatalog, { kind: 'gun', brief: true });
  expect(guns.length).toBeGreaterThan(3);
  expect(guns.every((part) => part.kind === 'gun' && !('sockets' in part) && !('modelUrl' in part))).toBe(true);
  expect(compactJson(catalogParts(valiantCatalog, { brief: true })).length).toBeLessThan(JSON.stringify(valiantCatalog.equipment).length / 3);
  expect(catalogParts(valiantCatalog, { ids: ['generic-watertight-door'] })).toEqual([valiantCatalog.equipment.find((part) => part.id === 'generic-watertight-door')!]);
  expect(() => catalogParts(valiantCatalog, { ids: ['us-16in50'] })).toThrow(/closest: us-16in50-mk7-iowa/);
  expect(() => catalogParts(valiantCatalog, { kind: 'cannon' })).toThrow(/Kinds: /);
});

test('compact JSON round-trips and queries never touch the source', () => {
  const summary = constructionSummary(valiant, valiantCatalog, { positions: 'all' });
  expect(JSON.parse(compactJson(summary))).toEqual(JSON.parse(JSON.stringify(summary)));
  expect(compactJson({ a: undefined, b: [1, 2] })).toBe('{"b":[1,2]}');
  expect(JSON.stringify(valiant)).toBe(before);
});
