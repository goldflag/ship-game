import type { CliCommand } from '../command';

/** Measure a cached reference mesh: plan, side and front views, deck-level histograms, hull cross sections and
 * vertical probes. Every mode reads the same `.build/references/<name>/` cache `ship:reference` writes. */
export default {
  summary:
    '<reference-name> (--plan y | --levels | --top x|z | --width | --station z | --stations z0,z1,… | --probe x,z | --section axis=value) ' +
    '[--parts hull,gun-artillery,…] [--box x0,y0,z0,x1,y1,z1] [--bin m] [--step m] [--y height] [--min-area m2] [--min-thickness m] ' +
    '[--simplify m] [--samples n] [--limit n] [--down] — measurements over a reference mesh in ship metres (+X starboard, +Y up with y=0 the waterline, −Z bow)',
  ship: false,
  positionals: 1,
  values: ['--plan', '--top', '--station', '--stations', '--probe', '--section', '--parts', '--box', '--bin', '--step', '--y', '--min-area', '--min-thickness', '--simplify', '--samples', '--limit'],
  switches: ['--levels', '--width', '--down'],
  async run(ctx) {
    const { readReference } = await import('../reference');
    const slice = await import('../slice');
    const { boxFrom, hullStation, levelHistogram, meshView, nearestDeck, planPolygons, probeColumn, referenceHeader, round, topLine, triangleCount, widthBands, chainLoops, planeSegments, pathLength } = slice;
    const name = ctx.positionals[0];
    if (!name) throw new Error('Name a cached reference. Run bun run ship:reference --list to see what is cached.');
    const number = (flag: string): number | undefined => {
      const value = ctx.option(flag);
      if (value === undefined) return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(flag + ' expects a number in metres.');
      return parsed;
    };
    const numbers = (flag: string, count?: number): number[] | undefined => {
      const value = ctx.option(flag);
      if (value === undefined) return undefined;
      const parsed = value.split(',').map((part) => (part.trim() === '' ? NaN : Number(part)));
      if (!parsed.every(Number.isFinite) || (count !== undefined && parsed.length !== count))
        throw new Error(flag + ' expects ' + (count === undefined ? 'comma-separated numbers' : count + ' comma-separated numbers') + '.');
      return parsed;
    };
    const modes = ['--plan', '--levels', '--top', '--width', '--station', '--stations', '--probe', '--section'].filter((flag) => ctx.option(flag) !== undefined || ctx.has(flag));
    if (modes.length !== 1) throw new Error('Choose exactly one measurement: --plan, --levels, --top, --width, --station, --stations, --probe or --section. Given: ' + (modes.join(', ') || 'none') + '.');
    const mesh = await readReference(ctx.root, name);
    const parts = ctx.option('--parts')?.split(',').map((part) => part.trim()).filter(Boolean);
    const view = meshView(mesh, parts);
    const box = boxFrom(numbers('--box', 6), mesh.meta.bounds);
    const limit = number('--limit') ?? 200;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20_000) throw new Error('--limit must be a whole number from 1 to 20000.');
    const header = { ...referenceHeader(mesh.meta), selection: parts ?? 'all parts', triangles: triangleCount(view) };
    const mode = modes[0];
    if (mode === '--plan') {
      const y = number('--plan')!;
      const polygons = planPolygons(view, y, { box, minArea: number('--min-area'), minThickness: number('--min-thickness'), simplify: number('--simplify') });
      return { ...header, measurement: 'plan', y, polygons: polygons.slice(0, limit), omitted: Math.max(0, polygons.length - limit) };
    }
    if (mode === '--levels') {
      const rows = levelHistogram(view, { box, binM: number('--bin'), minAreaM2: number('--min-area'), down: ctx.has('--down') });
      const ranked = [...rows].sort((a, b) => b.areaM2 - a.areaM2).slice(0, 12).map((row) => row.y);
      return { ...header, measurement: ctx.has('--down') ? 'underside-levels' : 'deck-levels', binM: number('--bin') ?? 0.1, rows: rows.slice(0, limit), strongest: ranked, omitted: Math.max(0, rows.length - limit) };
    }
    if (mode === '--top') {
      const along = ctx.option('--top');
      if (along !== 'x' && along !== 'z') throw new Error('--top takes x (front view) or z (side view).');
      const step = number('--step') ?? 1;
      if (step <= 0) throw new Error('--step must be positive.');
      const rows = topLine(view, along, step, box);
      return { ...header, measurement: 'silhouette', along, stepM: step, rows: rows.slice(0, limit), omitted: Math.max(0, rows.length - limit) };
    }
    if (mode === '--width') {
      const bin = number('--bin') ?? 1;
      if (bin <= 0) throw new Error('--bin must be positive.');
      const rows = widthBands(view, bin, box);
      return { ...header, measurement: 'half-breadth', binM: bin, rows: rows.slice(0, limit), omitted: Math.max(0, rows.length - limit) };
    }
    if (mode === '--probe') {
      const [x, z] = numbers('--probe', 2)!;
      const crossings = probeColumn(view, x, z);
      const y = number('--y') ?? mesh.meta.bounds.max[1];
      return { ...header, measurement: 'probe', at: [x, z], deck: nearestDeck(crossings, y), fromY: y, crossings: crossings.slice(0, limit), omitted: Math.max(0, crossings.length - limit) };
    }
    if (mode === '--section') {
      const value = ctx.option('--section')!;
      const match = /^([xyz])\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(value.trim());
      if (!match) throw new Error('--section expects axis=value, such as z=-40.');
      const loops = chainLoops(planeSegments(view, match[1] as 'x' | 'y' | 'z', Number(match[2]), box));
      const rings = loops.map((loop) => ({ closed: loop.closed, points: loop.points.length, lengthM: round(pathLength(loop.points, loop.closed), 2), ring: loop.points.map((p) => [round(p[0], 3), round(p[1], 3)]) }));
      rings.sort((a, b) => b.lengthM - a.lengthM);
      return { ...header, measurement: 'section', axis: match[1], value: Number(match[2]), rings: rings.slice(0, limit), omitted: Math.max(0, rings.length - limit) };
    }
    const requested = mode === '--station' ? numbers('--station', 1)! : numbers('--stations')!;
    if (requested.length > 64) throw new Error('--stations takes at most 64 values.');
    const options = { box, minRunLength: number('--min-thickness'), maxDeckY: number('--y'), samples: number('--samples') };
    const stations = requested.map((z) => ({ z, station: hullStation(view, z, options) }));
    return {
      ...header, measurement: 'hull-station', maxDeckY: options.maxDeckY,
      stations: stations.map(({ z, station }) => station ?? { z, found: false, note: 'No deck line spanning the beam was found here. Try --parts hull, a --box that excludes the superstructure, or --y to cap the deck height.' }),
    };
  },
} satisfies CliCommand;
