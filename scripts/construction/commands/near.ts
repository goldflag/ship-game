import type { CliCommand } from '../command';

export default {
  summary:
    '--point x,y,z --radius r | --box x0,y0,z0,x1,y1,z1 | --between idA,idB [--kind kind] [--limit 25] — approximate source-level spatial query: records whose box intersects, nearest first, or the per-axis gap between two records',
  values: ['--point', '--radius', '--box', '--between', '--kind', '--limit'],
  async run(ctx) {
    const { constructionNear, constructionBetween } = await import('../../../src/ships/constructionQuery');
    const { readDesign, emit, list, numbers, point } = await import('../query');
    const { source, catalog, header } = await readDesign(ctx);
    const between = list(ctx.option('--between'));
    if (between) {
      if (between.length !== 2 || ctx.option('--point') || ctx.option('--box')) throw new Error('--between expects exactly two IDs and no --point or --box.');
      return emit({ ...header, ...constructionBetween(source, catalog, between[0], between[1]) });
    }
    const corners = ctx.option('--box') ? numbers('--box', ctx.option('--box')!, 6) : undefined;
    const limit = Number(ctx.option('--limit') ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('--limit must be 1–500.');
    emit({
      ...header,
      ...constructionNear(source, catalog, {
        point: ctx.option('--point') ? point('--point', ctx.option('--point')!) : undefined,
        radius: ctx.option('--radius') === undefined ? undefined : Number(ctx.option('--radius')),
        box: corners && { min: [corners[0], corners[1], corners[2]], max: [corners[3], corners[4], corners[5]] },
        kind: ctx.option('--kind'),
        limit,
      }),
    });
  },
} satisfies CliCommand;
