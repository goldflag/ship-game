import type { CliCommand } from '../command';

export default {
  summary:
    '--ids a,b,c | --all [--slide] [--out batch.json] — after a hull edit, move existing equipment back onto its nearest support along its attachment direction (Y only for deck, internal and rudder parts; the wall normal for wall fittings); --slide also moves sideways onto the closest support when nothing lies under it; reports old and new position, gap and support per ID; proposes a guarded batch validated by a native dry-run; never saves',
  values: ['--ids', '--out'],
  switches: ['--all', '--slide'],
  async run(ctx) {
    const { reseatItems, reseatCommands } = await import('../../../src/ships/constructionPlacement');
    const { readSource, readCatalog } = await import('../files');
    const { resolvePlacement, proposeBatch } = await import('../placement');
    const { emit } = await import('../query');
    const ids = ctx.option('--ids')?.split(',').map((id) => id.trim()).filter(Boolean);
    if (!!ids === ctx.has('--all')) throw new Error('Provide either --ids a,b,c or --all.');
    const current = await readSource(ctx.root, ctx.id), { source } = current;
    const catalog = await readCatalog(ctx.root, source.construction.catalogRevision);
    const { items, skipped } = reseatItems(source, catalog, ids ?? 'all', ctx.has('--slide'));
    if (!items.length) return void emit({ id: ctx.id, revision: source.revision, fileRevision: current.hash, saved: false, placements: [], skipped, batch: null });
    const report = await resolvePlacement(ctx.root, source, items);
    // Under --all an unsupported record is reported but does not block reseating the rest.
    const blocking = ctx.has('--all') ? { ...report, diagnostics: report.diagnostics.map((d) => (d.code === 'placement-support' ? { ...d, severity: 'warning' as const } : d)) } : report;
    emit(await proposeBatch(ctx, current, 'Reseat equipment', reseatCommands(report.placements), blocking, { skipped, ...(!ctx.has('--slide') && report.placements.some((p) => p.status === 'unsupported' && !p.message?.includes('within')) ? { hint: 'Nothing lies along the attachment direction of an unsupported record. --slide moves it sideways onto the closest support; otherwise move it explicitly.' } : {}) }));
  },
} satisfies CliCommand;
