import type { CliCommand } from '../command';

export default {
  summary:
    '[--out scene.blend] [--replace] — compile the source and write a scratch Blender scene (default ' +
    '.build/construction-blender/<id>/scene.blend, with its scene.json): one mesh per hull piece, the custom hull and ' +
    'balconies as locked references, one empty per equipment row, loads as wire boxes, materials named by paint. ' +
    'Blender axes are +X bow, +Y port, +Z up; identity lives in custom properties. Edit it, then ship:blender-export; ' +
    'never changes the source',
  values: ['--out'],
  switches: ['--replace'],
  async run(ctx) {
    const { readSource } = await import('../files');
    const { blenderImport } = await import('../blenderFrontEnd');
    const { emit } = await import('../query');
    const current = await readSource(ctx.root, ctx.id);
    const result = await blenderImport(ctx.root, current, { out: ctx.option('--out'), replace: ctx.has('--replace') });
    emit({
      id: ctx.id,
      revision: current.source.revision,
      fileRevision: current.hash,
      saved: false,
      blend: result.blend,
      scene: result.scene,
      objects: result.objects,
      blender: result.blenderVersion,
      diagnostics: result.diagnostics.filter((d) => d.severity === 'error'),
      next: `Edit ${result.blend} in Blender, save it, then: bun run ship:blender-export ${ctx.id} ${result.blend} --out <batch.json>`,
    });
  },
} satisfies CliCommand;
