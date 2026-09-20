import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction } from '../../src/generated/naval-wasm/naval_wasm';
import published from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult } from '../../src/ships/blueprint';
import { publishedConstructionCatalog } from '../../src/ships/constructionCustomFittings';
import { CONSTRUCTION_LIMITS } from '../../src/ships/constructionEditor';
import { constructionSummary } from '../../src/ships/constructionQuery';
import { detailBudgetFixture } from './construction-detail-fixture';

const catalog = publishedConstructionCatalog(published as unknown as ConstructionCatalog);
beforeAll(async () => { await init(); });

const compile = (source: object) => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog))) as ConstructionResult;

test('a design filled to the equipment budget compiles and reports no headroom', () => {
  const source = detailBudgetFixture(catalog, { equipment: CONSTRUCTION_LIMITS.equipment });
  expect(source.construction.equipment).toHaveLength(CONSTRUCTION_LIMITS.equipment);
  const summary = constructionSummary(source, catalog);
  expect(summary.limits.equipment).toEqual({ used: CONSTRUCTION_LIMITS.equipment, limit: CONSTRUCTION_LIMITS.equipment, free: 0 });
  const result = compile(source);
  expect(result.diagnostics.filter((d) => d.severity !== 'warning')).toEqual([]);
  expect(result.definition).toBeTruthy();
}, 60_000);

test('one row over the budget is a complexity diagnostic, not a compiled definition', () => {
  const source = detailBudgetFixture(catalog, { equipment: CONSTRUCTION_LIMITS.equipment });
  const last = source.construction.equipment.at(-1)!;
  source.construction.equipment.push({ ...last, id: 'one-too-many', position: [last.position[0], last.position[1], last.position[2] - 2] });
  const result = compile(source);
  expect(result.definition).toBeFalsy();
  expect(result.diagnostics.some((d) => d.code === 'complexity' && d.message.includes('equipment'))).toBe(true);
}, 60_000);
