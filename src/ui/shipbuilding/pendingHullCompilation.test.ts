import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction } from '../../generated/naval-wasm/naval_wasm';
import catalogJson from '../../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource } from '../../ships/blueprint';
import { createStarterSource } from '../../ships/constructionStarter';
import { setBarbetteHeight } from '../../ships/constructionArmament';
import { pendingHullSurfaces } from './pendingHull';

beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL('../../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() });
});
const compile = (source: ConstructionSource): ConstructionResult => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalogJson)));

test('native barbettes survive deleting a block through the pending preview and completed compile', () => {
  const before = createStarterSource(catalogJson as ConstructionCatalog);
  const gun = before.construction.equipment.find(e => e.id === 'gun-forward')!;
  setBarbetteHeight(gun, 2);
  before.construction.primitives.push({ id: 'block', kind: 'box', size: [1, 1, 1], position: [2, 3, 0], rotationDeg: 0 });
  const original = compile(before);
  expect(original.definition, JSON.stringify(original.diagnostics)).toBeDefined();
  const supports = original.surfaces.filter(s => s.primitiveId === `equipment:${gun.id}`);
  expect(supports.length).toBeGreaterThan(0);

  const after = structuredClone(before);
  after.revision = 'block-deleted';
  after.construction.primitives.pop();
  const pending = pendingHullSurfaces(after, before, original.surfaces);
  expect(pending.filter(s => s.primitiveId === `equipment:${gun.id}`)).toEqual(supports);
  expect(pending.some(s => s.primitiveId === 'block')).toBe(false);
  const completed = compile(after);
  expect(completed.definition, JSON.stringify(completed.diagnostics)).toBeDefined();
  expect(completed.surfaces.filter(s => s.primitiveId === `equipment:${gun.id}`)).toEqual(supports);
});
