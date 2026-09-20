import type { CliCommand } from '../command';

/** Fit an adjustable custom hull to a cached reference and propose the `primitive-patch` that applies it. */
export default {
  summary:
    '--reference name [--primitive hull] [--points 17] [--max-stations 24] [--sample m] [--tolerance m] [--tip 0.2] [--parts hull] ' +
    '[--box x0,y0,z0,x1,y1,z1] [--y max-deck-height] [--out batch.json] — fit the named hull piece to a cached reference ' +
    'mesh: greedy station choice, arc-length outlines, the native fold check run first; proposes a revision-guarded batch, never saves',
  values: ['--reference', '--primitive', '--points', '--max-stations', '--sample', '--tolerance', '--tip', '--parts', '--box', '--y', '--out'],
  async run(ctx) {
    const { writeFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const { readReference } = await import('../reference');
    const { boxFrom, meshView, referenceHeader, round } = await import('../slice');
    const { fitHull, measureStations } = await import('../loft');
    const { readSource } = await import('../files');
    const number = (flag: string): number | undefined => {
      const value = ctx.option(flag);
      if (value === undefined) return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(flag + ' expects a number.');
      return parsed;
    };
    const name = ctx.option('--reference');
    if (!name) throw new Error('Provide --reference <cached reference name>. Run bun run ship:reference --list.');
    const current = await readSource(ctx.root, ctx.id);
    const primitiveId = ctx.option('--primitive') ?? 'hull';
    const primitive = current.source.construction.primitives.find((item) => item.id === primitiveId);
    if (!primitive) throw new Error('No primitive ' + JSON.stringify(primitiveId) + ' in this design. Use ship:get to list them.');
    if (primitive.kind !== 'custom-hull') throw new Error('Lofting replaces the sections of a custom-hull piece; ' + JSON.stringify(primitiveId) + ' is a ' + primitive.kind + '.');
    const mesh = await readReference(ctx.root, name);
    const parts = (ctx.option('--parts') ?? 'hull').split(',').map((part) => part.trim()).filter(Boolean);
    const view = meshView(mesh, parts.includes('all') ? undefined : parts);
    const box = boxFrom(ctx.option('--box')?.split(',').map(Number), mesh.meta.bounds);
    const options = {
      sampleM: number('--sample'), maxStations: number('--max-stations'), points: number('--points'),
      toleranceM: number('--tolerance'), tipFraction: number('--tip'), maxDeckY: number('--y'),
    };
    const measured = measureStations(view, box, options);
    const fit = fitHull(measured, options);
    const { errorM, folds } = fit;
    const batch = {
      version: 1, expectedRevision: current.source.revision, expectedFileHash: current.hash,
      label: 'Loft ' + primitiveId + ' to ' + name,
      commands: [{ op: 'primitive-patch', id: primitiveId, changes: { size: fit.size, position: fit.position, customHull: { ...primitive.customHull, version: 1, stations: fit.stations } } }],
    };
    if (folds.length) process.exitCode = 1;
    else if (ctx.option('--out')) await writeFile(resolve(ctx.option('--out')!), JSON.stringify(batch, null, 2) + '\n', { flag: 'wx' });
    return {
      id: ctx.id, primitive: primitiveId, ...referenceHeader(mesh.meta),
      measuredStations: measured.length, chosenStations: fit.stations.length, outlinePoints: fit.stations[0].points.length,
      size: fit.size, position: fit.position, stationsAtZ: fit.stations.map((station) => round(station.t * fit.size[2] + fit.position[2] - fit.size[2] / 2, 3)),
      fitErrorM: errorM, tips: fit.tips, clampedTips: fit.clampedTips,
      folds: folds.length ? folds : undefined,
      batch: folds.length ? null : batch,
      next: folds.length
        ? 'The fit still folds after splitting the failing spans. Raise --max-stations, lower --sample, or restrict --box with the named spans in mind. Nothing was written.'
        : 'Check it with ship:apply ' + ctx.id + ' <batch.json> --dry-run before applying; only the native compiler decides fit.',
      note: 'Rake and bulb are left as they are: the fit assumes the native mapping with both at zero, and a non-zero bow setting will shift the bow sections.',
    };
  },
} satisfies CliCommand;
