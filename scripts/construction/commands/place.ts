import type { CliCommand, CommandContext } from '../command';
import type { ConstructionCatalog } from '../../../src/ships/blueprint';
import type { CurrentSource } from '../transaction';

const numbers = (ctx: CommandContext, flag: string, count: number) => {
  const value = ctx.option(flag);
  if (value === undefined) return undefined;
  const parsed = value.split(',').map((v) => (v.trim() === '' ? NaN : Number(v)));
  if (parsed.length !== count || !parsed.every(Number.isFinite))
    throw new Error(flag + ' expects ' + count + ' comma-separated number' + (count > 1 ? 's' : '') + ' in metres or degrees.');
  return parsed;
};

/** One request, as before: the batch is proposed and compiled, never saved unless --apply. */
async function single(ctx: CommandContext, current: CurrentSource, catalog: ConstructionCatalog) {
  const { placementItems, placementCommands } = await import('../../../src/ships/constructionPlacement');
  const { resolvePlacement, proposeBatch } = await import('../placement');
  const partId = ctx.option('--part'),
    at = numbers(ctx, '--at', 2);
  if (!partId || !at) throw new Error('Provide --part <catalog id> and --at x,z (metres; +X starboard, −Z bow), or --table rows.json.');
  const items = placementItems(current.source, catalog, {
    partId,
    at: at as [number, number],
    y: numbers(ctx, '--y', 1)?.[0],
    on: ctx.option('--on'),
    bearingDeg: numbers(ctx, '--bearing', 1)?.[0],
    id: ctx.option('--id'),
    mirror: ctx.has('--mirror'),
    repeat: numbers(ctx, '--repeat', 1)?.[0],
    step: numbers(ctx, '--step', 2) as [number, number] | undefined,
    parent: ctx.option('--parent'),
  });
  const report = await resolvePlacement(ctx.root, current.source, items);
  const failed = report.diagnostics.some((d) => d.severity === 'error');
  return await proposeBatch(ctx, current, ctx.option('--label') ?? 'Place ' + partId, failed ? [] : placementCommands(items, report.placements), report, {}, ctx.option('--y') !== undefined);
}

/** Every row in one process and one compile session: a row that fails is reported, the rest still seat. */
async function batch(ctx: CommandContext, current: CurrentSource, catalog: ConstructionCatalog, file: string) {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const { resolvePlacement, proposeBatch } = await import('../placement');
  const { parsePlacementTable, planPlacementTable, tableCommands, tableConflicts, tableReport } = await import('../table');
  const rows = parsePlacementTable(JSON.parse(await readFile(resolve(file), 'utf8')));
  const { plans, items } = planPlacementTable(current.source, catalog, rows);
  if (!items.length) throw new Error('No row could be expressed: ' + plans.map((plan) => 'row ' + plan.row + ' — ' + plan.error).join('; '));
  const report = await resolvePlacement(ctx.root, current.source, items);
  // A row with no seat must not block the rest, so its diagnostic is a warning here.
  const blocking = { ...report, diagnostics: report.diagnostics.map((d) => (d.code === 'placement-support' ? { ...d, severity: 'warning' as const } : d)) };
  const proposed = await proposeBatch(ctx, current, ctx.option('--label') ?? 'Place ' + rows.length + ' rows', tableCommands(plans, report.placements), blocking, {}, true);
  const diagnostics = [...report.diagnostics, ...(proposed.candidate && 'diagnostics' in proposed.candidate ? proposed.candidate.diagnostics : [])];
  const table = tableReport(plans, report.placements, diagnostics);
  const failed = table.filter((row) => row.status !== 'placed');
  if (failed.length) process.exitCode = 1;
  return {
    ...proposed,
    placements: undefined,
    rows: table,
    counts: { rows: table.length, placed: table.length - failed.length, failed: failed.length, commands: proposed.batch?.commands.length ?? 0 },
    conflicts: tableConflicts(current.source, catalog, plans, report.placements),
  };
}

export default {
  summary:
    '--part catalog-id --at x,z [--y height | --on primitive-or-deck-id] [--bearing deg] [--id new-id] [--mirror] ' +
    '[--repeat n --step dx,dz] [--parent hull-or-equipment-id] | --table rows.json — seat new equipment on the native hull under (x,z): topmost ' +
    'support by default, the one nearest --y, or the named piece; wall fittings need --y and seat along the wall ' +
    'normal; --parent makes a floating-capable record ride that piece, fitting or gun (a gun trains it); --table seats every row in one compile session, continues past a failed row, reports each row and ' +
    'lists overlapping rows; [--label text] [--out batch.json] [--apply] — proposes a revision-guarded batch ' +
    'validated by a native dry-run and saves it only with --apply',
  values: ['--part', '--at', '--y', '--on', '--bearing', '--id', '--repeat', '--step', '--parent', '--out', '--table', '--label'],
  switches: ['--mirror', '--apply'],
  // --apply saves the proposed batch, so the MCP tool is announced as a repository write.
  writes: true,
  async run(ctx) {
    const { readSource, readCatalog } = await import('../files');
    const { emit } = await import('../query');
    const file = ctx.option('--table');
    if (file && ['--part', '--at', '--y', '--on', '--bearing', '--id', '--repeat', '--step', '--parent'].some((flag) => ctx.option(flag) !== undefined))
      throw new Error('--table carries every row’s own fields; do not combine it with the single-placement flags.');
    if (file && ctx.has('--mirror')) throw new Error('--table carries `mirror` per row; do not pass --mirror.');
    const current = await readSource(ctx.root, ctx.id);
    const catalog = await readCatalog(ctx.root, current.source.construction.catalogRevision);
    const proposed = file ? await batch(ctx, current, catalog, file) : await single(ctx, current, catalog);
    const applied = !ctx.has('--apply')
      ? {}
      : proposed.batch
        ? await (await import('../transaction')).saveBatch(ctx.root, ctx.id, current, proposed.batch)
        : { saved: false, reason: 'No valid batch to apply; nothing was written.' };
    emit({ ...proposed, ...applied });
  },
} satisfies CliCommand;
