import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseConstructionCatalog } from '../../src/ships/constructionEquipment';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { applyConstructionBatch } from '../../src/ships/constructionCommands';
import { placementCommands, placementItems, reseatCommands, reseatItems } from '../../src/ships/constructionPlacement';
import { resolvePlacement } from './placement';
import { compileConstruction } from './compiler';

const root = resolve(import.meta.dir, '../..');
const catalog = parseConstructionCatalog(JSON.parse(readFileSync(join(root, 'public/models/components/catalog.json'), 'utf8')));

// Native: the seats come from the compiled hull and the candidate goes through the full compiler.
test('native seats follow a sheered deck, mirror exactly, repeat in a row and survive a hull edit', async () => {
  let design = createStarterSource(catalog, 'fletcher-hull');
  const items = [
    ...placementItems(design, catalog, { partId: 'us-5in38-mk30-mod0-single', at: [0, -35], id: 'gun-a' }),
    ...placementItems(design, catalog, { partId: 'generic-twin-bitts', at: [3.2, -20], bearingDeg: 90, mirror: true, repeat: 3, step: [0, 8] }),
  ];
  const report = await resolvePlacement(root, design, items);
  expect(report.diagnostics).toEqual([]);
  const at = (id: string) => report.placements.find((p) => p.id === id)!;
  // The forecastle sheer: each seat further aft is lower, on a deck panel that is not level.
  const row = [1, 2, 3].map((n) => at('generic-twin-bitts-' + n + '-starboard'));
  expect(row[0].position[1]).toBeGreaterThan(row[1].position[1] + 0.1);
  expect(row[1].position[1]).toBeGreaterThan(row[2].position[1] + 0.1);
  expect(Math.abs(row[0].support!.normal[2])).toBeGreaterThan(0.01);
  expect(row.map((p) => [p.position[0], p.position[2], p.support!.primitiveId, p.support!.face])).toEqual([[3.2, -20, 'hull', 'top'], [3.2, -12, 'hull', 'top'], [3.2, -4, 'hull', 'top']]);
  for (const p of row) {
    const twin = at(p.id.replace('starboard', 'port'));
    expect([twin.status, twin.position, twin.bearingDeg, twin.residualM]).toEqual(['mirrored', [-p.position[0], p.position[1], p.position[2]], 270, 0]);
  }
  design = applyConstructionBatch(design, { version: 1, expectedRevision: design.revision, label: 'place', commands: placementCommands(items, report.placements) }, 'placed');
  const placed = await compileConstruction(root, design);
  expect(placed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(placed.definition).toBeTruthy();

  // Deepen the hull: the deck rises and every seat is left below it.
  design = applyConstructionBatch(design, { version: 1, expectedRevision: 'placed', label: 'deepen', commands: [{ op: 'primitive-patch', id: design.construction.primitives[0].id, changes: { size: [12.1, 11, 114.7] } }] }, 'deepened');
  const again = await resolvePlacement(root, design, reseatItems(design, catalog, 'all').items);
  expect(again.diagnostics).toEqual([]);
  expect(again.placements.every((p) => p.status === 'seated' && p.gapM! < -0.1 && p.position[0] === p.from[0] && p.position[2] === p.from[2])).toBe(true);
  const commands = reseatCommands(again.placements);
  expect(commands).toHaveLength(7);
  design = applyConstructionBatch(design, { version: 1, expectedRevision: 'deepened', label: 'reseat', commands }, 'reseated');
  expect((await compileConstruction(root, design)).definition).toBeTruthy();

  const missing = await resolvePlacement(root, design, placementItems(design, catalog, { partId: 'generic-twin-bitts', at: [30, 0] }));
  expect(missing.placements[0].status).toBe('unsupported');
  expect(missing.diagnostics.map((d) => [d.severity, d.code])).toEqual([['error', 'placement-support']]);
}, 900_000);
