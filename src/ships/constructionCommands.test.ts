import { expect, test } from 'bun:test';
import { applyConstructionBatch, constructionDiffCommands, type ConstructionBatch } from './constructionCommands';
import { createStarterSource } from './constructionStarter';
import { customHullPanels, mirroredPanelId } from './constructionPanels';
import type { ConstructionCommand } from './constructionCommands';
import type { ConstructionCatalog, ConstructionSource } from './blueprint';
const source = (): ConstructionSource => ({ schemaVersion: 1, id: 'test', name: 'Test', revision: 'one', coordinates: 'meters-y-up-bow-negative-z', construction: { version: 1, catalogRevision: 'test', defaultThicknessMm: 10, primitives: [{ id: 'hull', kind: 'box', size: [10, 4, 20], position: [0, 0, 0], rotationDeg: 0 }], surfaces: [], equipment: [], boundaries: [], loads: [] } });
test('agent batch is atomic and rejects stale revisions and syntax failures', () => {
  const original = source(), before = JSON.stringify(original);
  const batch: ConstructionBatch = { version: 1, expectedRevision: 'one', label: 'Refit', commands: [{ op: 'name', name: 'Changed' }, { op: 'move', ids: ['absent'], delta: [1, 0, 0] }] };
  expect(() => applyConstructionBatch(original, batch)).toThrow('unknown');
  expect(JSON.stringify(original)).toBe(before);
  expect(() => applyConstructionBatch(original, { ...batch, expectedRevision: 'old' })).toThrow('revision');
});
test('batch preserves stable IDs, face assignments and equipment links through one source revision', () => {
  const s = source();
  const next = applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Fit gun', commands: [
    { op: 'equipment', value: { id: 'gun', partId: 'exact-variant', position: [0, 2, 0], bearingDeg: 0, magazineId: 'mag' } },
    { op: 'surface', value: { primitiveId: 'hull', face: 'top', thicknessMm: 20, material: 'steel', paint: 'deck-gray' } },
    { op: 'vertices', id: 'hull', selection: { mode: 'face', index: 5 }, delta: [0, 1, 0] },
  ] }, 'two');
  expect(next.revision).toBe('two');
  expect(next.construction.primitives[0].id).toBe('hull');
  expect(next.construction.primitives[0].vertices).toHaveLength(8);
  expect(next.construction.equipment[0].magazineId).toBe('mag');
  expect(next.construction.surfaces[0].primitiveId).toBe('hull');
  expect(s.construction.equipment).toHaveLength(0);
});

test('a diff between a source and its edited copy replays as one batch, upserting before removing so the last hull block is never protected by mistake', () => {
  const s = source();
  s.construction.surfaces = [{ primitiveId: 'hull', face: 'top', thicknessMm: 20, material: 'armor-steel', paint: 'deck-gray' }];
  const next = structuredClone(s);
  next.name = 'Split'; next.construction.catalogRevision = 'newer';
  next.construction.primitives = [{ id: 'a', kind: 'box', size: [10, 4, 10], position: [0, 0, -5], rotationDeg: 0 }, { id: 'b', kind: 'box', size: [10, 4, 10], position: [0, 0, 5], rotationDeg: 0 }];
  next.construction.surfaces = [{ primitiveId: 'a', face: 'top', thicknessMm: 20, material: 'armor-steel', paint: 'deck-gray' }];
  next.construction.boundaries = [{ id: 'deck', axis: 'y', offset: 1, thicknessMm: 10 }];
  const commands = constructionDiffCommands(s, next);
  expect(commands.map(command => command.op)).toEqual(['name', 'catalog', 'primitive', 'primitive', 'boundary', 'remove', 'surface']);
  const applied = applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Diff', commands }, 'two');
  expect({ ...applied, revision: s.revision }).toEqual({ ...next, revision: s.revision });
  expect(constructionDiffCommands(s, s)).toEqual([]);
  const cleared = structuredClone(s); cleared.construction.surfaces = [];
  expect(() => constructionDiffCommands(s, cleared)).toThrow('cannot be removed');
});

test('adjustable hull edits preserve section IDs, equipment and panel armor; malformed patches roll back', () => {
  const s = createStarterSource({ revision: 'test' } as ConstructionCatalog, 'fletcher-hull');
  // Start below the section limit so the expansion exercises ID preservation.
  s.construction.primitives[0] = applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Eight sections', commands: [{ op: 'hull-sections', id: 'hull', count: 8 }] }).construction.primitives[0];
  const hull = s.construction.primitives[0], ids = hull.customHull!.stations.map(s => s.id);
  s.construction.equipment.push({ id: 'gun', partId: 'variant', position: [0, 5, 0], bearingDeg: 0 });
  const panel = customHullPanels(hull).find(p => p.face === 'port')!;
  s.construction.surfaces.push({ primitiveId: hull.id, ...panel, thicknessMm: 50, material: 'armor-steel', paint: 'naval-gray' });
  const run = (commands: ConstructionCommand[]) => applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Shape hull', commands });
  const next = run([
    { op: 'primitive-patch', id: 'hull', changes: { size: [14, 10, 130], customHull: { rake: .4, redPaintY: null } } },
    { op: 'hull-station', id: 'hull', stationId: ids[1], changes: { t: .09 } },
    { op: 'surface-patch', targets: [{ primitiveId: 'hull', ...panel }], changes: { paint: 'deck-gray' }, mirror: true },
  ]);
  expect(next.construction.primitives[0].customHull!.stations.map(s => s.id)).toEqual(ids);
  expect(next.construction.primitives[0].customHull!.stations[1].t).toBe(.09);
  expect(next.construction.primitives[0].customHull!.redPaintY).toBeUndefined();
  expect(next.construction.equipment).toEqual(s.construction.equipment);
  const painted = next.construction.surfaces.find(p => p.panelId === panel.panelId)!;
  expect(painted.thicknessMm).toBe(50); expect(painted.material).toBe('armor-steel');
  expect(next.construction.surfaces.find(p => p.panelId === mirroredPanelId(panel.panelId))?.paint).toBe('deck-gray');
  const expanded = run([{ op: 'hull-sections', id: 'hull', count: 12 }]);
  expect(expanded.construction.primitives[0].customHull!.stations).toHaveLength(12);
  expect(ids.every(id => expanded.construction.primitives[0].customHull!.stations.some(s => s.id === id))).toBe(true);
  expect(expanded.construction.surfaces).toEqual(s.construction.surfaces);
  const before = JSON.stringify(s);
  expect(() => run([{ op: 'name', name: 'Bad' }, { op: 'hull-sections', id: 'hull', count: 25 }])).toThrow('4 to 24');
  expect(() => run([{ op: 'primitive-patch', id: 'hull', changes: { customHull: { stations: [] } } }])).toThrow('4–24');
  expect(() => run([{ op: 'primitive-patch', id: 'hull', changes: { customHull: { typo: 1 } } } as unknown as ConstructionCommand])).toThrow('Unknown patch field');
  expect(JSON.stringify(s)).toBe(before);
});

test('targeted fittings edits preserve nested settings, linked wall partners, routes and exact variants', () => {
  const s = source();
  s.construction.equipment = [
    { id: 'gun', partId: 'variant', position: [0, 2, 0], bearingDeg: 12.5, gun: { barbetteHeightM: .5, battery: 'secondary', traverseLimitsDeg: [-60, 60] } },
    { id: 'rope', partId: 'rope-variant', position: [0, 2, 0], bearingDeg: 0, path: { points: [[0, 0, 0], [0, 0, 4]], slackM: .2 } },
    { id: 'window-p', partId: 'window', position: [-5, 0, 0], bearingDeg: -90, wall: { version: 1, widthM: 1, heightM: 1, mirrorId: 'window-s' } },
    { id: 'window-s', partId: 'window', position: [5, 0, 0], bearingDeg: 90, wall: { version: 1, widthM: 1, heightM: 1, mirrorId: 'window-p' } },
    { id: 'screw', partId: 'screw', position: [0, 0, 10], bearingDeg: 0, powerSourceId: 'manual-engine' },
  ];
  const next = applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Refit', commands: [
    { op: 'equipment-patch', id: 'gun', changes: { gun: { barbetteHeightM: 1, barbettePaint: 'naval-gray' }, bearingDeg: 13.1 } },
    { op: 'equipment-patch', id: 'rope', changes: { path: { slackM: .5 } } },
    { op: 'equipment-patch', id: 'window-p', changes: { wall: { widthM: 2 }, paint: 'deck-gray' } },
    { op: 'equipment-patch', id: 'screw', changes: { powerSourceId: null } },
  ] });
  expect(next.construction.equipment[0].gun).toEqual({ ...s.construction.equipment[0].gun, barbetteHeightM: 1, barbettePaint: 'naval-gray' });
  expect(next.construction.equipment[0].partId).toBe('variant');
  expect(next.construction.equipment[1].path).toEqual({ ...s.construction.equipment[1].path!, slackM: .5 });
  expect(next.construction.equipment[3].wall).toEqual({ ...s.construction.equipment[3].wall!, widthM: 2 });
  expect(next.construction.equipment[3].paint).toBe('deck-gray');
  expect(next.construction.equipment[4].powerSourceId).toBeUndefined();
  expect(s.construction.equipment[4].powerSourceId).toBe('manual-engine');
});

test('copy uses requested stable IDs, mirrors hull panels and remaps copied system links', () => {
  const s = createStarterSource({ revision: 'test' } as ConstructionCatalog, 'fletcher-hull');
  s.construction.primitives[0].position[0] = -5;
  const panel = customHullPanels(s.construction.primitives[0])[0];
  s.construction.surfaces.push({ primitiveId: 'hull', ...panel, thicknessMm: 30, material: 'steel', paint: 'naval-gray' });
  s.construction.equipment.push({ id: 'engine', partId: 'engine', position: [-5, 0, 0], bearingDeg: 0 }, { id: 'screw', partId: 'screw', position: [-5, 0, 10], bearingDeg: 5, powerSourceId: 'engine' });
  const command: ConstructionCommand = { op: 'copy', copies: [{ from: 'hull', to: 'hull-s' }, { from: 'engine', to: 'engine-s' }, { from: 'screw', to: 'screw-s' }], mirror: true };
  const run = (commands: ConstructionCommand[]) => applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Twin hull', commands });
  const next = run([command, { op: 'move', ids: ['hull-s', 'engine-s', 'screw-s'], delta: [1, 0, 0] }]);
  expect(next.construction.primitives[1].position[0]).toBe(6);
  expect(next.construction.equipment.find(p => p.id === 'screw-s')).toMatchObject({ powerSourceId: 'engine-s', bearingDeg: 355 });
  expect(next.construction.surfaces.find(p => p.primitiveId === 'hull-s' && p.panelId === mirroredPanelId(panel.panelId))?.thicknessMm).toBe(30);
  expect(() => run([{ op: 'copy', copies: [{ from: 'hull', to: 'engine' }] }])).toThrow('new and unique');
  expect(() => run([{ op: 'copy', copies: [{ from: 'hull', to: 'one' }, { from: 'hull', to: 'two' }] }])).toThrow();
  expect(s.construction.primitives).toHaveLength(1);
});

test('balcony edges and freeform treatments can be patched without replacing unrelated source', () => {
  const s = source();
  s.construction.primitives.push({ id: 'platform', kind: 'balcony', size: [4, .2, 3], position: [0, 3, 0], rotationDeg: 0, balcony: { version: 1, heightM: 1, wallThicknessM: .05, points: [{ id: 'a', x: -.5, z: -.5, edge: 'wall' }, { id: 'b', x: .5, z: -.5, edge: 'railing' }, { id: 'c', x: 0, z: .5, edge: 'open' }] } });
  const next = applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Detail', commands: [
    { op: 'primitive-patch', id: 'platform', changes: { balcony: { heightM: 1.2 } } },
    { op: 'primitive-patch', id: 'hull', changes: { kind: 'vertex', shaping: { version: 1, edges: [0, 1], radius: .1, style: 'round' } } },
  ] });
  expect(next.construction.primitives[1].balcony!.points).toEqual(s.construction.primitives[1].balcony!.points);
  expect(next.construction.primitives[0].shaping?.edges).toEqual([0, 1]);
  const cleared = applyConstructionBatch(next, { version: 1, expectedRevision: next.revision, label: 'Sharp', commands: [{ op: 'primitive-patch', id: 'hull', changes: { shaping: null } }] });
  expect(cleared.construction.primitives[0].shaping).toBeUndefined();
});
