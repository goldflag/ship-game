import type { CliCommand } from '../command';

export default {
  summary:
    '--part catalog-id --at x,z [--y height | --on primitive-or-deck-id] [--bearing deg] [--id new-id] [--mirror] [--repeat n --step dx,dz] [--out batch.json] — seat new equipment on the native hull under (x,z): topmost support by default, the one nearest --y, or the named piece; wall fittings need --y and seat along the wall normal; proposes a revision-guarded batch validated by a native dry-run; never saves',
  values: ['--part', '--at', '--y', '--on', '--bearing', '--id', '--repeat', '--step', '--out'],
  switches: ['--mirror'],
  async run(ctx) {
    const { placementItems, placementCommands } = await import('../../../src/ships/constructionPlacement');
    const { readSource, readCatalog } = await import('../files');
    const { resolvePlacement, proposeBatch } = await import('../placement');
    const { emit } = await import('../query');
    const numbers = (flag: string, count: number) => {
      const value = ctx.option(flag);
      if (value === undefined) return undefined;
      const parsed = value.split(',').map((v) => (v.trim() === '' ? NaN : Number(v)));
      if (parsed.length !== count || !parsed.every(Number.isFinite)) throw new Error(flag + ' expects ' + count + ' comma-separated number' + (count > 1 ? 's' : '') + ' in metres or degrees.');
      return parsed;
    };
    const partId = ctx.option('--part'), at = numbers('--at', 2);
    if (!partId || !at) throw new Error('Provide --part <catalog id> and --at x,z (metres; +X starboard, −Z bow).');
    const current = await readSource(ctx.root, ctx.id), { source } = current;
    const catalog = await readCatalog(ctx.root, source.construction.catalogRevision);
    const items = placementItems(source, catalog, {
      partId, at: at as [number, number], y: numbers('--y', 1)?.[0], on: ctx.option('--on'), bearingDeg: numbers('--bearing', 1)?.[0],
      id: ctx.option('--id'), mirror: ctx.has('--mirror'), repeat: numbers('--repeat', 1)?.[0], step: numbers('--step', 2) as [number, number] | undefined,
    });
    const report = await resolvePlacement(ctx.root, source, items);
    const failed = report.diagnostics.some((d) => d.severity === 'error');
    emit(await proposeBatch(ctx, current, 'Place ' + partId, failed ? [] : placementCommands(items, report.placements), report, {}, ctx.option('--y') !== undefined));
  },
} satisfies CliCommand;
