import type { CliCommand } from '../command';

export default {
  summary:
    '--rules scheme.json [--targets] [--label text] [--out batch.json] [--apply] — turn a protection scheme (rules selecting ' +
    'faces and custom-hull panels by primitive, face, panel ID and z/y window) into `surface-patch` commands, ' +
    'mirrored unless a rule says otherwise; reports each rule’s targets and the mass the native compiler says the ' +
    'scheme adds; proposes a guarded batch and saves only with --apply',
  values: ['--rules', '--label', '--out'],
  switches: ['--apply', '--targets'],
  writes: true,
  async run(ctx) {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const { readSource } = await import('../files');
    const { emit } = await import('../query');
    const { parseArmorRules, applyArmorRules } = await import('../armor');
    const { proposeCommands } = await import('../transaction');
    const { compileConstruction } = await import('../compiler');
    const file = ctx.option('--rules');
    if (!file) throw new Error('Provide --rules <scheme.json>: an array of rules, each with a selector and a `changes` object.');
    const current = await readSource(ctx.root, ctx.id);
    const rules = parseArmorRules(JSON.parse(await readFile(resolve(file), 'utf8')));
    const { reports, commands } = applyArmorRules(current.source, rules);
    // The estimate is the compiler's own answer, before and after, so it needs no second mass model.
    const before = await compileConstruction(ctx.root, current.source);
    const proposed = await proposeCommands(
      ctx,
      current,
      ctx.option('--label') ?? 'Armor scheme: ' + rules.length + ' rule' + (rules.length === 1 ? '' : 's'),
      commands,
      {
        rules: reports.map((report) => ({
          rule: report.rule,
          name: report.name,
          targets: report.targets.length,
          ...(report.unmatched ? { unmatched: report.unmatched } : {}),
          ...(ctx.has('--targets')
            ? {
                faces: report.targets.map((target) => ({
                  primitiveId: target.primitiveId,
                  face: target.face,
                  panelId: target.panelId,
                  z: target.z,
                  y: target.y,
                })),
              }
            : {}),
        })),
        // --targets lists every face a rule reached; a whole-hull rule can name hundreds.
        counts: {
          rules: rules.length,
          commands: commands.length,
          targets: reports.reduce((sum, report) => sum + report.targets.length, 0),
        },
      },
    );
    const after = (proposed.candidate as { loading?: { massKg: number } } | undefined)?.loading;
    if (reports.some((report) => report.unmatched)) process.exitCode = 1;
    emit({
      ...proposed,
      mass:
        before.loading && after
          ? {
              beforeKg: Math.round(before.loading.massKg),
              afterKg: Math.round(after.massKg),
              deltaKg: Math.round(after.massKg - before.loading.massKg),
            }
          : { estimated: false, reason: 'One of the two compiles produced no loading.' },
    });
  },
} satisfies CliCommand;
