import type { CliCommand } from '../command';

export default {
  summary:
    '[--kind kind] [--positions|--no-positions] [--compile] — one-screen overview without compiling: revisions, conventions, hull bounds, limit headroom, compact hull-piece rows and equipment grouped by catalog part (deck-fitting placements need --positions or --kind deck-fitting); --compile adds launchable, diagnostics and loading totals',
  values: ['--kind'],
  switches: ['--compile', '--positions', '--no-positions'],
  async run(ctx) {
    const { constructionSummary, CONSTRUCTION_DERIVED_LIMITS: derived } = await import('../../../src/ships/constructionQuery');
    const { readDesign, emit } = await import('../query');
    const { current, source, catalog, header } = await readDesign(ctx);
    let compiled: object = { compiled: false };
    if (ctx.has('--compile')) {
      const result = await (await import('../compiler')).compileConstruction(ctx.root, source);
      const { contributions: _omitted, ...loading } = result.loading ?? { contributions: [] };
      const count = (severity: string) => result.diagnostics.filter((d) => d.severity === severity).length;
      compiled = {
        compiled: true,
        launchable: !!result.definition,
        diagnosticCounts: { error: count('error'), warning: count('warning') },
        diagnostics: result.diagnostics,
        loading: result.loading ? loading : undefined,
        derived: { surfaces: { used: result.surfaces.length, limit: derived.surfaces }, ...(result.definition ? { floodingPortals: { used: result.definition.connections.length, limit: derived.floodingPortals } } : {}) },
      };
      if (!result.definition) process.exitCode = 1;
    }
    emit({ ...header, ...compiled, ...constructionSummary(source, catalog, { kind: ctx.option('--kind'), positions: ctx.has('--no-positions') ? 'none' : ctx.has('--positions') ? 'all' : undefined, sourceBytes: Buffer.byteLength(current.json) }) });
  },
} satisfies CliCommand;
