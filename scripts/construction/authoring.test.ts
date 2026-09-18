import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { applyConstructionBatch, constructionDiffCommands } from '../../src/ships/constructionCommands';
import { parseConstructionCatalog } from '../../src/ships/constructionEquipment';
import { compileConstruction, suggestConstruction } from './compiler';

// Exercises the actual native subprocess and the same retained catalog the CLI uses.
// Compiler scratch files stay under .build; no authored ship or publication is written.
test('agent hull patches and native layout proposals produce an editable, compilable source', async () => {
  const root = resolve(import.meta.dir, '../..');
  const catalog = parseConstructionCatalog(JSON.parse(await readFile(resolve(root, 'public/models/components/catalog.json'), 'utf8')));
  const source = createStarterSource(catalog, 'fletcher-hull');
  const changed = applyConstructionBatch(source, { version: 1, expectedRevision: source.revision, label: 'Shape', commands: [
    { op: 'primitive-patch', id: 'hull', changes: { size: [14, 10, 130], customHull: { redPaintY: -1 } } },
    { op: 'hull-sections', id: 'hull', count: 10 },
    { op: 'boundary', value: { id: 'machinery-deck', axis: 'y', offset: -1, thicknessMm: 10 } },
  ] });
  const before = JSON.stringify(changed);
  const proposal = await suggestConstruction(root, changed, ['generic-diesel-3000kw']);
  expect(proposal.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  expect(JSON.stringify(changed)).toBe(before);
  const commands = constructionDiffCommands(changed, proposal.source);
  expect(commands.some(c => c.op === 'equipment')).toBe(true);
  const applied = applyConstructionBatch(changed, { version: 1, expectedRevision: changed.revision, label: 'Suggested engine', commands });
  const result = await compileConstruction(root, applied);
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
  expect(result.definition).toBeDefined();
  expect(applied.construction.primitives[0].kind).toBe('custom-hull');
  const rejected = await suggestConstruction(root, applied, ['nonexistent-variant']);
  expect(rejected.diagnostics.some(d => d.code === 'missing-part')).toBe(true);
  expect(rejected.source).toEqual(applied);
}, 120_000);
