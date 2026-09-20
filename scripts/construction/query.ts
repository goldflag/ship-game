import type { CommandContext } from './command';
import type { Selector } from '../../src/ships/constructionQuery';
import type { Vec3 } from '../../src/ships/blueprint';
import { compactJson } from '../../src/ships/constructionQuery';
import { readCatalog, readSource } from './files';

/** Shared by the compile-free read commands (summary, get, bounds, near). */
export const SELECTOR_FLAGS = ['--ids', '--kind', '--part', '--prefix'];
export const list = (value: string | undefined) => value?.split(',').map((item) => item.trim()).filter(Boolean);
export const selector = (ctx: CommandContext): Selector => ({ ids: list(ctx.option('--ids')), kind: ctx.option('--kind'), part: ctx.option('--part'), prefix: ctx.option('--prefix') });
export function numbers(flag: string, value: string, count: number): number[] {
  const parsed = value.split(',').map(Number);
  if (parsed.length !== count || !parsed.every(Number.isFinite)) throw new Error(flag + ' expects ' + count + ' comma-separated numbers in metres.');
  return parsed;
}
export const point = (flag: string, value: string) => numbers(flag, value, 3) as Vec3;

export async function readDesign(ctx: CommandContext) {
  const current = await readSource(ctx.root, ctx.id), { source } = current;
  // A missing retained catalog still leaves positions and IDs readable; kinds and dimensions are then unknown.
  const catalog = await readCatalog(ctx.root, source.construction.catalogRevision).catch(() => undefined);
  const header = { id: ctx.id, revision: source.revision, fileRevision: current.hash, catalogRevision: source.construction.catalogRevision, ...(catalog ? {} : { catalogMissing: true }) };
  return { current, source, catalog, header };
}
/** Rows stay on one line; the dispatcher's two-space printer would spend most of the bytes on indentation. */
export const emit = (value: unknown) => console.log(compactJson(value));
