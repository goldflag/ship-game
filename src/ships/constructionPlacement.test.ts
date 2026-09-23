import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConstructionCatalog } from './constructionEquipment';
import { createStarterSource } from './constructionStarter';
import { applyConstructionBatch } from './constructionCommands';
import { effectiveConstructionCatalog } from './constructionCustomFittings';
import { floatingAbove, PLACEMENT_LIMIT, placementCommands, placementItems, reseatCommands, reseatItems, type Placement } from './constructionPlacement';

const catalog = parseConstructionCatalog(JSON.parse(readFileSync(join(import.meta.dir, '../../public/models/components/catalog.json'), 'utf8')));
const source = () => createStarterSource(catalog, 'fletcher-hull');
const seat = (id: string, position: [number, number, number], bearingDeg = 0, from = position): Placement =>
  ({ id, partId: 'x', status: 'seated', from, position, bearingDeg, attachment: position, direction: [0, -1, 0] });

describe('construction placement requests', () => {
  test('a mirrored repeat row names both sides and reflects bearings', () => {
    const items = placementItems(source(), catalog, { partId: 'generic-twin-bitts', at: [3, -20], bearingDeg: 80, mirror: true, repeat: 2, step: [0, 8] });
    expect(items.map((i) => [i.equipment.id, i.equipment.position, i.equipment.bearingDeg, i.mirrorOf, i.select])).toEqual([
      ['generic-twin-bitts-1-starboard', [3, 0, -20], 80, undefined, 'first'],
      ['generic-twin-bitts-1-port', [-3, 0, -20], 280, 'generic-twin-bitts-1-starboard', undefined],
      ['generic-twin-bitts-2-starboard', [3, 0, -12], 80, undefined, 'first'],
      ['generic-twin-bitts-2-port', [-3, 0, -12], 280, 'generic-twin-bitts-2-starboard', undefined],
    ]);
  });
  test('a design-local part gets a valid default ID without its design: prefix', () => {
    const design = source();
    design.construction.fittings = [
      { id: 'fit-post', name: 'Post', version: 1, attach: 'deck', solids: [{ id: 'post', kind: 'cylinder', size: [0.3, 0.6, 0.3], position: [0, 0.3, 0], rotationDeg: 0 }], tubes: [] },
    ];
    const items = placementItems(design, effectiveConstructionCatalog(design.construction, catalog), { partId: 'design:fit-post', at: [2, -10], mirror: true });
    expect(items.map((i) => i.equipment.id)).toEqual(['fit-post-starboard', 'fit-post-port']);
  });
  test('centerline mirrors stay single, internal parts seat low, a height hint picks the nearest support', () => {
    expect(placementItems(source(), catalog, { partId: 'generic-twin-bitts', at: [0, 0], mirror: true })).toHaveLength(1);
    expect(placementItems(source(), catalog, { partId: 'generic-diesel-3000kw', at: [0, 10] })[0].select).toBe('last');
    expect(placementItems(source(), catalog, { partId: 'generic-twin-bitts', at: [0, 0], y: 2 })[0]).toMatchObject({ select: 'nearest', equipment: { position: [0, 2, 0] } });
  });
  test('wall fittings carry installation dimensions, face the wall by default and link their twin', () => {
    const [door, twin] = placementItems(source(), catalog, { partId: 'generic-watertight-door', at: [3.2, 10], y: 3, mirror: true, id: 'door' });
    expect(door).toMatchObject({ autoBearing: true, select: 'nearest', equipment: { id: 'door', wall: { version: 1, widthM: 0.94, heightM: 2.12, mirrorId: 'door-port' } } });
    expect(twin).toMatchObject({ mirrorOf: 'door', equipment: { id: 'door-port', wall: { mirrorId: 'door' } } });
    const design = source();
    const next = applyConstructionBatch(design, { version: 1, expectedRevision: design.revision, label: 'doors',
      commands: placementCommands([door, twin], [seat('door', [3, 3, 10], 90), seat('door-port', [-3, 3, 10], 270)]) }, 'next');
    expect(next.construction.equipment.map((e) => [e.id, e.position, e.bearingDeg, e.wall?.mirrorId])).toEqual([['door', [3, 3, 10], 90, 'door-port'], ['door-port', [-3, 3, 10], 270, 'door']]);
  });
  test('malformed requests are rejected before any native work', () => {
    const bad = (options: Partial<Parameters<typeof placementItems>[2]>, message: RegExp) =>
      expect(() => placementItems(source(), catalog, { partId: 'generic-twin-bitts', at: [0, 0], ...options })).toThrow(message);
    bad({ partId: 'absent' }, /Unknown catalog part/);
    bad({ partId: 'generic-railing' }, /connected fitting/);
    bad({ partId: 'generic-watertight-door' }, /--y/);
    bad({ partId: 'generic-stowed-anchor', y: 2 }, /--bearing/);
    bad({ repeat: 3 }, /--step/);
    bad({ step: [1, 0] }, /--repeat only/);
    bad({ repeat: PLACEMENT_LIMIT + 1, step: [1, 0] }, new RegExp(`1–${PLACEMENT_LIMIT}`));
    bad({ id: 'bad id' }, /--id accepts/);
    bad({ id: 'hull' }, /already exists/);
    bad({ at: [Number.NaN, 0] }, /finite/);
  });
  test('reseat selects records, skips what has no seat and patches only what moved', () => {
    const design = source();
    design.construction.equipment.push(
      { id: 'a', partId: 'generic-twin-bitts', position: [1, 3, 0], bearingDeg: 0 },
      { id: 'screw', partId: 'generic-propeller-2400', position: [2, -3, 48], bearingDeg: 0 },
      { id: 'door', partId: 'generic-watertight-door', position: [3, 3, 10], bearingDeg: 90, wall: { version: 1, widthM: 0.94, heightM: 2.12, mirrorId: 'door-port' } },
      { id: 'door-port', partId: 'generic-watertight-door', position: [-3, 3, 10], bearingDeg: 270, wall: { version: 1, widthM: 0.94, heightM: 2.12, mirrorId: 'door' } },
    );
    const all = reseatItems(design, catalog, 'all', true);
    // Bitts may float, so --all never slides them sideways; the wall door keeps its wall rules.
    expect(all.items.map((i) => [i.equipment.id, i.slide, i.maxTravelM])).toEqual([['a', undefined, undefined], ['door', undefined, 2.12 * 0.75]]);
    expect(all.skipped.map((s) => s.id)).toEqual(['screw', 'door-port']);
    expect(all.floating).toEqual(['a']);
    expect(reseatItems(design, catalog, ['a'], true).items[0].slide).toBe(true);
    // A floating record is lifted out of a support that rose into it, but left where it floats above one.
    expect([...floatingAbove([{ ...seat('a', [1, 3, 0], 0, [1, 3.4, 0]), gapM: 0.4 }], all.floating)]).toEqual(['a']);
    expect([...floatingAbove([{ ...seat('a', [1, 3.4, 0], 0, [1, 3, 0]), gapM: -0.4 }], all.floating)]).toEqual([]);
    expect(() => reseatItems(design, catalog, ['a', 'missing'])).toThrow(/Unknown equipment ID missing/);
    expect(() => reseatItems(design, catalog, [])).toThrow(/--ids/);
    const commands = reseatCommands([seat('a', [1, 3.4, 0], 0, [1, 3, 0]), seat('door', [3, 3, 10], 90), { ...seat('b', [0, 0, 0]), status: 'unsupported' }]);
    expect(commands).toEqual([{ op: 'equipment-patch', id: 'a', changes: { position: [1, 3.4, 0] } }]);
  });
});
