/** Scaling measurements for the editor's fitting detail budget.
 *
 * `bun scripts/tests/construction-detail-budget.ts [--sizes 128,1000] [--custom 0,1000] [--json]`
 *
 * Builds the synthetic designs from `construction-detail-fixture.ts` and reports, per size,
 * native and WASM compile time, definition and source bytes, and the latency of the agent
 * read commands (`ship:summary`, `ship:get`, `ship:bounds`, `ship:near`) plus `ship:place
 * --repeat`. Nothing here is committed as a design; the sources live only in memory.
 */
import { resolve } from 'node:path';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource } from '../../src/ships/blueprint';
import { publishedConstructionCatalog } from '../../src/ships/constructionCustomFittings';
import { constructionBounds, constructionGet, constructionNear, constructionSummary } from '../../src/ships/constructionQuery';
import { placementItems } from '../../src/ships/constructionPlacement';
import { compileConstructionJson } from '../construction/compiler';
import { detailBudgetFixture } from './construction-detail-fixture';
import published from '../../public/models/components/catalog.json';

const ROOT = resolve(import.meta.dir, '../..');
const flag = (name: string, fallback: string) => {
  const at = process.argv.indexOf('--' + name);
  return at < 0 ? fallback : (process.argv[at + 1] ?? fallback);
};
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
const ms = (value: number) => Number(value.toFixed(1));

/** Median wall time of `runs` calls, after one warm-up call. */
async function timed<T>(runs: number, call: () => T | Promise<T>): Promise<{ ms: number; value: T }> {
  let value = await call();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const at = performance.now();
    value = await call();
    samples.push(performance.now() - at);
  }
  return { ms: ms(median(samples)), value };
}

async function wasmCompiler() {
  const wasm = await import('../../src/generated/naval-wasm/naval_wasm');
  await wasm.default();
  return (source: ConstructionSource, catalog: ConstructionCatalog) =>
    wasm.compile_construction(JSON.stringify(source), JSON.stringify(catalog));
}

async function row(catalog: ConstructionCatalog, compileWasm: Awaited<ReturnType<typeof wasmCompiler>>, equipment: number, customInstances: number) {
  const source = detailBudgetFixture(catalog, { equipment, customInstances });
  const sourceBytes = JSON.stringify(source).length;
  const native = await timed(3, () => compileConstructionJson(ROOT, source, undefined, { paths: ['binary', 'cargo'] }));
  const wasm = await timed(3, () => compileWasm(source, catalog));
  const result = JSON.parse(native.value) as ConstructionResult;
  const errors = result.diagnostics.filter((d) => d.severity !== 'warning');
  if (errors.length) throw new Error(`${equipment} rows did not compile: ${errors.slice(0, 3).map((d) => d.message).join('; ')}`);
  // The dev WASM build may lag the native compiler; report a mismatch instead of failing the run.
  const agree = native.value === wasm.value;
  const summary = await timed(20, () => constructionSummary(source, catalog));
  const get = await timed(20, () => constructionGet(source, catalog, { kind: 'equipment' }));
  const bounds = await timed(20, () => constructionBounds(source, catalog, { kind: 'equipment' }));
  const near = await timed(20, () => constructionNear(source, catalog, { point: [0, 7, 0], radius: 20 }));
  // Measured against a design 32 rows short of the budget, so the run itself is not refused.
  const room = { ...source, construction: { ...source.construction, equipment: source.construction.equipment.slice(0, -32) } };
  const place = await timed(5, () =>
    placementItems(room, catalog, { partId: 'generic-deck-hatch', at: [0, -100], bearingDeg: 0, id: 'bench', repeat: 32, step: [0, 1.5] }),
  );
  return {
    equipment, customInstances,
    equipmentRows: source.construction.equipment.length,
    sourceKb: Math.round(sourceBytes / 102.4) / 10,
    definitionKb: Math.round(JSON.stringify(result.definition).length / 102.4) / 10,
    nativeCompileMs: native.ms, wasmCompileMs: wasm.ms,
    summaryMs: summary.ms, getMs: get.ms, boundsMs: bounds.ms, nearMs: near.ms, placeRepeat32Ms: place.ms,
    nativeMatchesWasm: agree,
    massTonnes: Math.round((result.loading?.massKg ?? 0) / 100) / 10,
  };
}

const catalog = publishedConstructionCatalog(published as unknown as ConstructionCatalog);
const compileWasm = await wasmCompiler();
const sizes = flag('sizes', '128,1000').split(',').map(Number);
const customs = flag('custom', '0').split(',').map(Number);
const rows = [];
for (const size of sizes)
  for (const custom of customs) {
    const measured = await row(catalog, compileWasm, size, custom);
    rows.push(measured);
    if (!process.argv.includes('--json')) console.log(JSON.stringify(measured));
  }
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else console.table(rows);
