import type { CliCommand, CommandContext } from '../command';
import type { ConstructionLoad } from '../../../src/ships/blueprint';
import type { BallastTank } from '../ballast';

const number = (ctx: CommandContext, flag: string, fallback?: number) => {
  const value = ctx.option(flag);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(flag + ' expects a number.');
  return parsed;
};
const round = (value: number, digits = 3) => Number(value.toFixed(digits));

/** Tanks come from the design's own box loads, or from a plan file that also creates them. */
async function tanksFor(
  ctx: CommandContext,
  loads: ConstructionLoad[],
  densityKgM3: number,
): Promise<{ tanks: BallastTank[]; records: Map<string, ConstructionLoad> }> {
  const { tankCapacityKg } = await import('../ballast');
  const plan = ctx.option('--tanks');
  const records = new Map<string, ConstructionLoad>();
  let chosen: ConstructionLoad[];
  /** A plan row may cap its tank explicitly; otherwise the box volume and the working density do. */
  const explicit = new Map<string, number>();
  if (plan) {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const document = JSON.parse(await readFile(resolve(plan), 'utf8')) as unknown;
    const rows = Array.isArray(document)
      ? document
      : Array.isArray((document as { tanks?: unknown[] }).tanks)
        ? (document as { tanks: unknown[] }).tanks
        : undefined;
    if (!rows?.length) throw new Error('A tank plan is a JSON array of loads, or an object with a `tanks` array.');
    chosen = rows.map((entry, index) => {
      const row = entry as Partial<ConstructionLoad> & { capacityKg?: number };
      if (typeof row.id !== 'string' || !row.id) throw new Error('Tank ' + index + ' needs an `id`.');
      if (!Array.isArray(row.center) || row.center.length !== 3 || !Array.isArray(row.size) || row.size.length !== 3)
        throw new Error('Tank ' + row.id + ' needs `center` and `size` as [x, y, z] metres.');
      if (row.capacityKg !== undefined) {
        if (typeof row.capacityKg !== 'number' || !(row.capacityKg > 0))
          throw new Error('Tank ' + row.id + ' has a non-positive `capacityKg`.');
        explicit.set(row.id, row.capacityKg);
      }
      return {
        id: row.id,
        name: row.name ?? row.id,
        center: row.center,
        size: row.size,
        massKg: row.massKg ?? 0,
      } satisfies ConstructionLoad;
    });
  } else {
    const ids = ctx
      .option('--ids')
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const prefix = ctx.option('--prefix') ?? 'tank-';
    chosen = ids
      ? ids.map((id) => {
          const load = loads.find((candidate) => candidate.id === id);
          if (!load) throw new Error('No load named ' + id + '. List them with ship:summary, or define tanks with --tanks.');
          return load;
        })
      : loads.filter((load) => load.id.startsWith(prefix));
    if (!chosen.length)
      throw new Error(
        'No load IDs start with ' + JSON.stringify(prefix) + '. Name them with --ids, change --prefix, or define tanks with --tanks.',
      );
  }
  const tanks = chosen.map((load) => {
    records.set(load.id, load);
    return {
      id: load.id,
      name: load.name,
      center: load.center as [number, number, number],
      size: load.size as [number, number, number],
      capacityKg: explicit.get(load.id) ?? tankCapacityKg(load, densityKgM3),
    } satisfies BallastTank;
  });
  const duplicate = tanks.find((tank, index) => tanks.findIndex((other) => other.id === tank.id) !== index);
  if (duplicate) throw new Error('Tank ' + duplicate.id + ' is listed twice.');
  return { tanks, records };
}

export default {
  summary:
    '--waterline y [--trim metres] [--tanks plan.json | --ids a,b | --prefix tank-] [--density kg/m3] ' +
    '[--iterations n] [--tolerance m] [--label text] [--out batch.json] [--apply] — fill the ship’s box loads ' +
    'bottom-first until the native compiler floats it at that waterline with its centre of gravity over its ' +
    'centre of buoyancy (--trim offsets LCG from LCB; negative trims by the bow); reports every compile it ' +
    'took, the per-tank fill and the resulting flotation; proposes a guarded batch and saves only with --apply',
  values: ['--waterline', '--trim', '--tanks', '--ids', '--prefix', '--density', '--iterations', '--tolerance', '--label', '--out'],
  switches: ['--apply'],
  writes: true,
  async run(ctx) {
    const { readSource } = await import('../files');
    const { emit } = await import('../query');
    const { solveBallast } = await import('../ballast');
    const { proposeCommands } = await import('../transaction');
    const { applyConstructionBatch } = await import('../../../src/ships/constructionCommands');
    const { compileConstruction } = await import('../compiler');
    if (ctx.option('--tanks') && (ctx.option('--ids') || ctx.option('--prefix')))
      throw new Error('--tanks carries its own tank list; do not combine it with --ids or --prefix.');
    const waterlineY = number(ctx, '--waterline');
    if (waterlineY === undefined)
      throw new Error('Provide --waterline <y>, the ship-space height the sea should reach (ship:inspect reports loading.waterlineY).');
    const densityKgM3 = number(ctx, '--density', 1025)!;
    if (densityKgM3 <= 0) throw new Error('--density is the working density of the tank contents in kg/m³.');
    const iterations = Math.max(1, Math.round(number(ctx, '--iterations', 12)!));
    const tolerance = Math.abs(number(ctx, '--tolerance', 0.02)!);

    const current = await readSource(ctx.root, ctx.id);
    const loads = current.source.construction.loads ?? [];
    const { tanks, records } = await tanksFor(ctx, loads, densityKgM3);
    const present = new Set(loads.map((load) => load.id));
    // The compiler rejects a massless load, so an empty tank is left out — or removed if it is already there.
    const commandsFor = (fills: { id: string; massKg: number }[]) => {
      const empty = fills.filter((fill) => fill.massKg < 1 && present.has(fill.id)).map((fill) => fill.id);
      return [
        ...fills
          .filter((fill) => fill.massKg >= 1)
          .map((fill) => {
            const tank = tanks.find((candidate) => candidate.id === fill.id)!;
            const existing = records.get(fill.id);
            return {
              op: 'load' as const,
              value: {
                id: tank.id,
                name: existing?.name ?? tank.name,
                center: tank.center,
                size: tank.size,
                massKg: round(fill.massKg, 1),
              } satisfies ConstructionLoad,
            };
          }),
        ...(empty.length ? [{ op: 'remove' as const, ids: empty }] : []),
      ];
    };
    let compiles = 0;
    const solution = await solveBallast(
      tanks,
      {
        waterlineY,
        lcgOffsetM: number(ctx, '--trim', 0)!,
        waterlineToleranceM: tolerance,
        lcgToleranceM: Math.max(tolerance * 5, 0.1),
        iterations,
      },
      async (distribution) => {
        compiles++;
        const batch = {
          version: 1 as const,
          expectedRevision: current.source.revision,
          label: 'Ballast probe',
          commands: commandsFor(distribution.fills),
        };
        const result = await compileConstruction(ctx.root, applyConstructionBatch(current.source, batch));
        const loading = result.loading;
        if (!loading)
          throw new Error(
            'The candidate does not float. ' +
              (result.diagnostics.find((d) => d.severity === 'error')?.message ?? 'The compiler returned no loading') +
              ' — fix the design, or move the tanks inside the hull, before ballasting it.',
          );
        return {
          waterlineY: loading.waterlineY,
          lcgOffsetM: loading.centerOfGravity[2] - loading.buoyancyCenter[2],
          massKg: loading.massKg,
        };
      },
      // Start from what the tanks already hold; with nothing in them the solver picks half capacity.
      present.size ? { totalKg: tanks.reduce((sum, tank) => sum + (records.get(tank.id)?.massKg ?? 0), 0) } : undefined,
    );
    if (!solution.converged) process.exitCode = 1;
    emit(
      await proposeCommands(
        ctx,
        current,
        ctx.option('--label') ?? 'Ballast to waterline ' + waterlineY + ' m',
        commandsFor(solution.distribution.fills),
        {
          target: { waterlineY, lcgOffsetM: number(ctx, '--trim', 0)!, waterlineToleranceM: tolerance },
          converged: solution.converged,
          ...(solution.note ? { note: solution.note } : {}),
          compiles,
          result: {
            waterlineY: round(solution.flotation.waterlineY),
            lcgOffsetM: round(solution.flotation.lcgOffsetM),
            massKg: round(solution.flotation.massKg, 0),
            ballastKg: round(solution.distribution.totalKg, 0),
            ...(solution.distribution.centerZ === undefined ? {} : { ballastCenterZ: round(solution.distribution.centerZ) }),
            ...(solution.distribution.centerY === undefined ? {} : { ballastCenterY: round(solution.distribution.centerY) }),
            ...(solution.distribution.shortfallKg > 1 ? { shortfallKg: round(solution.distribution.shortfallKg, 0) } : {}),
          },
          tanks: solution.distribution.fills.map((fill) => ({
            id: fill.id,
            massKg: round(fill.massKg, 0),
            capacityKg: round(fill.capacityKg, 0),
            fill: round(fill.fill, 3),
          })),
          steps: solution.steps.map((step) => ({
            ...step,
            totalKg: round(step.totalKg, 0),
            centerZ: round(step.centerZ),
            waterlineY: round(step.waterlineY),
            lcgOffsetM: round(step.lcgOffsetM),
          })),
        },
      ),
    );
  },
} satisfies CliCommand;
