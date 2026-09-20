import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { applyConstructionBatch } from '../../src/ships/constructionCommands';
import type { Placement } from '../../src/ships/constructionPlacement';
import { parsePlacementTable, planPlacementTable, tableCommands, tableConflicts, tableReport } from './table';
import { guardedBatch, unguardedCommands } from './transaction';
import { resolvePlacement } from './placement';
import { compileConstruction } from './compiler';

const root = resolve(import.meta.dir, '../..');
const catalog = parseConstructionCatalog(JSON.parse(readFileSync(join(root, 'public/models/components/catalog.json'), 'utf8')));
const design = () => createStarterSource(catalog, 'fletcher-hull');

test('a placement table is checked whole before anything is placed', () => {
  expect(() => parsePlacementTable([])).toThrow('empty');
  expect(() => parsePlacementTable({})).toThrow('array of rows');
  expect(() => parsePlacementTable([{ part: 'x', x: 0, z: 0, bearingDeg: 90 }])).toThrow('unknown field bearingDeg');
  expect(() => parsePlacementTable([{ part: 'x', x: 0, z: null }])).toThrow('`z` must be a finite number');
  expect(() => parsePlacementTable([{ x: 0, z: 0 }])).toThrow('catalog part ID');
  expect(() => parsePlacementTable([{ part: 'x', x: 0, z: 0, extra: { position: [0, 0, 0] } }])).toThrow('may not set position');
  expect(() => parsePlacementTable([{ part: 'x', x: 0, z: 0, step: [1] }])).toThrow('[dx, dz]');
  expect(parsePlacementTable({ rows: [{ part: 'x', x: 1, z: 2 }] })).toEqual([{ part: 'x', x: 1, z: 2 }]);
});

test('rows are planned against each other: unique IDs, honest limits, and a bad row does not stop the rest', () => {
  const source = design();
  const rows = parsePlacementTable([
    { id: 'gun', part: 'us-5in38-mk30-mod0-single', x: 0, z: -35 },
    { id: 'gun', part: 'us-5in38-mk30-mod0-single', x: 0, z: -20 },
    { part: 'not-a-real-part', x: 0, z: 0 },
    { id: 'bitts', part: 'generic-twin-bitts', x: 3.2, z: -10, bearing: 90, mirror: true, repeat: 2, step: [0, 4] },
  ]);
  const { plans, items } = planPlacementTable(source, catalog, rows);
  expect(plans.map((plan) => plan.items.map((item) => item.equipment.id))).toEqual([
    ['gun'],
    [],
    [],
    ['bitts-1-starboard', 'bitts-1-port', 'bitts-2-starboard', 'bitts-2-port'],
  ]);
  // The second row asks for an ID the first already took; the table still plans the rows after it.
  expect(plans[1].error).toContain('already exists');
  expect(plans[2].error).toContain('not-a-real-part');
  expect(items).toHaveLength(5);
});

test('only seated rows become commands, `extra` is merged last, and overlapping rows are named', () => {
  const source = design();
  const rows = parsePlacementTable([
    { id: 'gun-a', part: 'us-5in38-mk30-mod0-single', x: 0, z: -35, extra: { gun: { battery: 'main' } } },
    { id: 'gun-b', part: 'us-5in38-mk30-mod0-single', x: 0, z: -34 },
    { id: 'lost', part: 'generic-twin-bitts', x: 40, z: 0 },
  ]);
  const { plans } = planPlacementTable(source, catalog, rows);
  const placement = (id: string, position: [number, number, number], status: Placement['status'] = 'seated'): Placement => ({
    id, partId: 'x', status, from: position, position, bearingDeg: 0, attachment: position, direction: [0, -1, 0],
  });
  const placements = [placement('gun-a', [0, 5, -35]), placement('gun-b', [0, 5, -34]), placement('lost', [40, 0, 0], 'unsupported')];
  const commands = tableCommands(plans, placements);
  expect(commands.map((c) => (c.op === 'equipment' ? c.value.id : ''))).toEqual(['gun-a', 'gun-b']);
  expect(commands[0].op === 'equipment' && commands[0].value.gun).toEqual({ battery: 'main' });
  const report = tableReport(plans, placements, [
    { severity: 'error', code: 'equipment-overlap', message: 'overlap', sourceId: 'gun-b', relatedSourceIds: ['gun-a'] },
  ]);
  expect(report.map((row) => [row.row, row.status, row.errors.map((e) => e.code)])).toEqual([
    [0, 'placed', ['equipment-overlap']],
    [1, 'placed', ['equipment-overlap']],
    [2, 'unsupported', ['placement-support']],
  ]);
  const conflicts = tableConflicts(source, catalog, plans, placements);
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].ids).toEqual(['gun-a', 'gun-b']);
  expect(conflicts[0].overlapM[2]).toBeGreaterThan(0);
});

test('an unguarded command list becomes a batch guarded by the revisions just read', () => {
  const source = design();
  expect(unguardedCommands([{ op: 'name', name: 'x' }]).commands).toHaveLength(1);
  expect(unguardedCommands({ label: 'Refit', commands: [] })).toEqual({ label: 'Refit', commands: [] });
  expect(() => unguardedCommands({ expectedRevision: 'a', commands: [] })).toThrow('already guarded batch');
  expect(() => unguardedCommands('nope')).toThrow('JSON array of commands');
  const batch = guardedBatch({ source, hash: 'file-hash' }, 'Refit', [{ op: 'name', name: 'Renamed' }]);
  expect([batch.expectedRevision, batch.expectedFileHash]).toEqual([source.revision, 'file-hash']);
  expect(applyConstructionBatch(source, batch).name).toBe('Renamed');
});

// Native: one resolver call seats the whole table and the merged batch compiles.
test('a whole table seats in one native call and the rows that seated compile together', async () => {
  const source = design();
  const rows = parsePlacementTable([
    { id: 'gun-a', part: 'us-5in38-mk30-mod0-single', x: 0, z: -35, extra: { gun: { battery: 'main' } } },
    { id: 'bitts', part: 'generic-twin-bitts', x: 3.2, z: -20, bearing: 90, mirror: true, repeat: 3, step: [0, 8] },
    { id: 'lost', part: 'generic-twin-bitts', x: 40, z: 0 },
  ]);
  const { plans, items } = planPlacementTable(source, catalog, rows);
  const report = await resolvePlacement(root, source, items);
  const rowReport = tableReport(plans, report.placements, report.diagnostics);
  expect(rowReport.map((row) => row.status)).toEqual(['placed', 'placed', 'unsupported']);
  expect(rowReport[0].support?.id).toBe('hull');
  expect(rowReport[1].ids).toHaveLength(6);
  expect(tableConflicts(source, catalog, plans, report.placements)).toEqual([]);
  const commands = tableCommands(plans, report.placements);
  expect(commands).toHaveLength(7);
  const batch = guardedBatch({ source, hash: 'hash' }, 'Place rows', commands);
  const result = await compileConstruction(root, applyConstructionBatch(source, batch));
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(result.definition).toBeTruthy();
}, 900_000);
