import type { CliCommand } from '../command';

export default {
  summary:
    'scene.blend [--out batch.json] [--max-planes n] [--max-parts n] [--materials map.json] — read an edited ' +
    'ship:blender-import scene and propose a revision-guarded batch: changed blocks become eight-corner or compound-solid ' +
    'hull pieces, equipment empties become rows (reseated natively when their seat property is true), load boxes become ' +
    'loads, deleted objects are removed; unchanged objects are skipped. Validated by a native dry-run; never saves',
  values: ['--out', '--max-planes', '--max-parts', '--materials'],
  positionals: 1,
  async run(ctx) {
    const { resolve } = await import('node:path');
    const { readFile, writeFile } = await import('node:fs/promises');
    const { readSource } = await import('../files');
    const { blenderExport } = await import('../blenderFrontEnd');
    const { emit } = await import('../query');
    const blend = ctx.positionals[0];
    if (!blend) throw new Error('Provide the .blend to export, usually .build/construction-blender/<id>/scene.blend.');
    const count = (flag: string) => {
      const value = ctx.option(flag);
      if (value === undefined) return undefined;
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} expects a positive integer.`);
      return n;
    };
    const mapFile = ctx.option('--materials');
    const materials = mapFile ? (JSON.parse(await readFile(resolve(mapFile), 'utf8')) as Record<string, string>) : undefined;
    if (materials && (typeof materials !== 'object' || Object.values(materials).some((v) => typeof v !== 'string')))
      throw new Error('--materials expects a JSON object mapping Blender material names to construction paint IDs.');
    const current = await readSource(ctx.root, ctx.id);
    const result = await blenderExport(ctx.root, current, blend, { maxPlanes: count('--max-planes'), maxParts: count('--max-parts'), materials });
    const launchable = !result.batch || !!result.candidate?.definition;
    const failed = result.report.failures.length > 0;
    if (failed || !launchable) process.exitCode = 1;
    const out = ctx.option('--out');
    const written = out && result.batch && launchable && !failed;
    if (written) await writeFile(resolve(out), JSON.stringify(result.batch, null, 2) + '\n', { flag: 'wx' });
    const { report } = result;
    emit({
      id: ctx.id,
      revision: current.source.revision,
      fileRevision: current.hash,
      saved: false,
      blend: resolve(blend),
      changes: {
        unchanged: report.unchanged.length,
        moved: report.moved,
        reshaped: report.reshaped,
        added: report.added,
        removed: report.removed,
        equipment: report.equipment,
        loads: report.loads,
        painted: report.painted,
        reassigned: report.reassigned,
      },
      ...(result.seating.length ? { seating: result.seating } : {}),
      ...(report.ignored.length ? { ignored: report.ignored } : {}),
      ...(report.warnings.length ? { warnings: report.warnings } : {}),
      ...(failed ? { failures: report.failures } : {}),
      candidate: result.candidate
        ? { launchable: !!result.candidate.definition, diagnostics: result.candidate.diagnostics }
        : { compiled: false, reason: failed ? 'No candidate: the objects above could not be converted.' : 'Nothing to change.' },
      batch: launchable && !failed ? (result.batch ?? null) : null,
      ...(written ? { out: resolve(out), next: `bun run ship:apply ${ctx.id} ${out} --dry-run` } : {}),
    });
  },
} satisfies CliCommand;
