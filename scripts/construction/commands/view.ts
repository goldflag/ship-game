import type { CliCommand } from '../command';
import type { ViewRequest } from '../../../tools/construction/viewOptions';

/** Exploratory pictures of the working source, valid or not. `render`/`review` remain the acceptance path. */
export default {
  summary:
    '[--view profile|plan|bow|stern|quarter[,…]] [--azimuth deg] [--elevation deg] [--mode exterior|armor|internals|ids] [--focus id,id] [--isolate] [--highlight id,id] ' +
    '[--region x0,y0,z0,x1,y1,z1] [--section x|y|z=value] [--zoom f] [--perspective] [--size WxH] [--out directory] — look at a design from any angle, including a draft that does not compile (fallback: true)',
  values: ['--view', '--azimuth', '--elevation', '--mode', '--focus', '--highlight', '--region', '--section', '--zoom', '--size', '--out'],
  switches: ['--perspective', '--isolate'],
  async run({ root, id, option, has }) {
    const started = performance.now(), ms = (from: number) => Math.round(performance.now() - from);
    const { viewRequests } = await import('../../../tools/construction/viewOptions');
    // Flags are checked before the compile and the browser start, so a typo costs nothing.
    const requests = viewRequests({
      view: option('--view'), azimuth: option('--azimuth'), elevation: option('--elevation'), mode: option('--mode'), size: option('--size'), zoom: option('--zoom'),
      focus: option('--focus'), highlight: option('--highlight'), region: option('--region'), section: option('--section'), perspective: has('--perspective'), isolate: has('--isolate'),
    });
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join, resolve } = await import('node:path');
    const { readSource } = await import('../files');
    const { compileConstruction } = await import('../compiler');
    const current = await readSource(root, id), source = current.source;
    const known = new Set([...source.construction.primitives, ...source.construction.equipment, ...source.construction.boundaries].map(item => item.id));
    const unknown = [...requests[0].focus, ...requests[0].highlight].filter(item => !known.has(item));
    if (unknown.length) throw new Error('Unknown source ID ' + unknown.map(item => JSON.stringify(item)).join(', ') + '. Use primitive, equipment or boundary IDs from ship:inspect --source.');
    const compileStarted = performance.now();
    const result = await compileConstruction(root, source);
    const compileMs = ms(compileStarted);
    const errors = result.diagnostics.filter(d => d.severity === 'error'), fallback = !result.definition || errors.length > 0;
    // Unique per call: concurrent agents and repeated looks never overwrite each other.
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + crypto.randomUUID().slice(0, 4);
    const directory = resolve(option('--out') ?? join(root, '.build/construction', id, 'view', current.hash.slice(0, 8) + '-' + stamp));
    await mkdir(directory, { recursive: true });
    const { withConstructionBrowser } = await import('../browser');
    const browserStarted = performance.now();
    let readyMs = 0;
    const views = await withConstructionBrowser(root, { source, result, draft: true }, async page => {
      readyMs = ms(browserStarted);
      const frames = [];
      for (const request of requests) {
        const from = performance.now();
        const frame = await page.evaluate((value: ViewRequest) => window.constructionReview!.view(value), request);
        const file = join(directory, request.name + '-' + request.mode + '.png');
        await writeFile(file, Buffer.from(frame.png.split(',')[1], 'base64'));
        frames.push({ file, ...frame.report, renderMs: ms(from) });
      }
      return frames;
    });
    const output = {
      id, revision: source.revision, fileRevision: current.hash, contentHash: result.contentHash, launchable: !fallback, fallback,
      ...(fallback ? { fallbackReason: 'The native compile has errors, so this is the editor\'s source preview of the saved source, not a launchable ship. Pieces and fittings named by an error are drawn salmon (#ffb5a6).' } : {}),
      diagnostics: {
        errors: errors.length, warnings: result.diagnostics.filter(d => d.severity === 'warning').length,
        invalidIds: [...new Set(errors.flatMap(d => d.sourceId ? [d.sourceId] : []))], items: result.diagnostics.slice(0, 40),
        ...(result.diagnostics.length > 40 ? { omitted: result.diagnostics.length - 40 } : {}),
      },
      directory, views, acceptance: 'Exploratory only. ship:render and ship:review remain the acceptance path.',
      timingsMs: { compile: compileMs, browserReady: readyMs, total: ms(started) },
    };
    await writeFile(join(directory, 'view.json'), JSON.stringify(output, null, 2) + '\n');
    return output;
  },
} satisfies CliCommand;
