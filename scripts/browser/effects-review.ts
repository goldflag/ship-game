/** `bun scripts/browser/effects-review.ts --scene muzzle,hit [--out .build/effects/<label>] [--battle "bismarck;;bismarck:static"]`
 *
 * Renders repeatable combat-effect sequences in the real game (see `effectsStage.ts`, `effectsScenes.ts`):
 * one PNG per frame plus a labelled contact sheet per scene. `--list` names the scenes.
 *
 * `--serve <port>` keeps the browser and battle open between runs; then
 * `curl -s 'localhost:<port>/run?scene=muzzle&out=.build/effects/try1'` renders against the current source
 * (Vite reloads the page after an edit; the handler waits for the battle again). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Page } from 'playwright';
import { launchHarness, ROOT } from './harness';

const { values } = parseArgs({ options: {
  scene: { type: 'string', default: 'muzzle,hit,magazine,fire,funnel' }, out: { type: 'string', default: '.build/effects/review' },
  battle: { type: 'string', default: 'bismarck;;bismarck:static' }, range: { type: 'string', default: '1500' }, bearing: { type: 'string', default: '90' },
  viewport: { type: 'string', default: '1280x720' }, columns: { type: 'string', default: '3' }, serve: { type: 'string' }, list: { type: 'boolean', default: false },
  param: { type: 'string', multiple: true, default: [] },
} });

const [width, height] = values.viewport!.split('x').map(Number);
const params: Record<string, string> = { battle: values.battle!, range: values.range!, bearing: values.bearing!,
  ...Object.fromEntries(values.param!.map(entry => entry.split(/=(.*)/s).slice(0, 2) as [string, string])) };

interface SceneResult { frames: { label: string; png: string }[]; sheet: string; diagnostics: unknown }

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => { const review = window.review; if (review?.errors.length) throw new Error(review.errors.join('\n')); return review?.inBattle && review.game; }, undefined, { polling: 250, timeout: 240_000 });
  // Let the battle's first frames compile every pass before freezing it.
  await page.waitForTimeout(1500);
}

async function run(page: Page, names: string[], out: string, columns: number): Promise<string[]> {
  await ready(page);
  const written: string[] = [];
  for (const name of names) {
    const started = Date.now();
    const result = await page.evaluate(async ({ name, columns }) => {
      // Served by Vite inside the page, so edits apply without restarting the browser.
      const [{ installStage, contactSheet }, { scenes }] = await Promise.all([
        import(/* @vite-ignore */ String('/scripts/browser/effectsStage.ts')) as Promise<typeof import('./effectsStage')>,
        import(/* @vite-ignore */ String('/scripts/browser/effectsScenes.ts')) as Promise<typeof import('./effectsScenes')>]);
      const w = window as unknown as { effectsStage?: ReturnType<typeof installStage> };
      let stage = w.effectsStage;
      if (!stage || stage.game !== window.review.game) stage = w.effectsStage = installStage(window.review.game!);
      const scene = scenes[name];
      if (!scene) throw new Error(`Unknown scene "${name}". Scenes: ${Object.keys(scenes).join(', ')}`);
      const frames: { label: string; png: string }[] = [], staged = stage;
      await scene(staged as Parameters<typeof scene>[0], async (label?: string) => { frames.push(await staged.capture(label)); });
      return { frames, sheet: await contactSheet(frames, columns), diagnostics: stage.diagnostics() } satisfies SceneResult;
    }, { name, columns });
    const directory = resolve(ROOT, out, name); mkdirSync(directory, { recursive: true });
    const write = (file: string, png: string) => { writeFileSync(file, Buffer.from(png.split(',')[1], 'base64')); return file; };
    result.frames.forEach((frame, i) => write(join(directory, `${String(i).padStart(2, '0')}-${frame.label.replace(/[^\w.-]+/g, '_')}.png`), frame.png));
    written.push(write(resolve(ROOT, out, `${name}.png`), result.sheet));
    writeFileSync(join(directory, 'diagnostics.json'), JSON.stringify(result.diagnostics, null, 1) + '\n');
    const notes = (result.diagnostics as { notes?: Record<string, unknown> }).notes;
    if (notes && Object.keys(notes).length) console.log(`${name} notes: ${JSON.stringify(notes)}`);
    console.log(`${name}: ${result.frames.length} frames in ${((Date.now() - started) / 1000).toFixed(1)} s → ${resolve(ROOT, out, `${name}.png`)}`);
  }
  return written;
}

if (values.list) {
  const { scenes } = await import('./effectsScenes');
  console.log(Object.keys(scenes).join('\n'));
  process.exit(0);
}

const harness = await launchHarness({ params, viewport: { width, height } });
const columns = Number(values.columns);
try {
  if (!values.serve) {
    await run(harness.page, values.scene!.split(','), values.out!, columns);
  } else {
    const port = Number(values.serve);
    let queue = Promise.resolve(), stop = () => {};
    const stopped = new Promise<void>(resolveStop => { stop = resolveStop; process.on('SIGINT', resolveStop); process.on('SIGTERM', resolveStop); });
    const server = Bun.serve({ port, idleTimeout: 0, fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/stop') { setTimeout(stop, 50); return new Response('stopping\n'); }
      if (url.pathname === '/reload') {
        const done = queue.then(async () => { await harness.page.reload({ waitUntil: 'domcontentloaded' }); await ready(harness.page); });
        queue = done.catch(() => undefined);
        return done.then(() => new Response('reloaded\n'), error => new Response(`${error.message}\n`, { status: 500 }));
      }
      if (url.pathname !== '/run') return new Response('GET /run?scene=a,b&out=dir  |  /reload  |  /stop\n', { status: 404 });
      const scenes = (url.searchParams.get('scene') ?? 'muzzle').split(','), out = url.searchParams.get('out') ?? values.out!;
      const done = queue.then(() => run(harness.page, scenes, out, Number(url.searchParams.get('columns') ?? columns)));
      queue = done.then(() => undefined, () => undefined);
      return done.then(files => new Response(files.join('\n') + '\n'),
        error => new Response(`${error.message}\n${harness.errors.join('\n')}\n`, { status: 500 }));
    } });
    console.log(`Effects review serving on http://localhost:${port} (battle ${params.battle}); GET /stop to close.`);
    await stopped; server.stop(true);
  }
  if (harness.errors.length) { console.error(harness.errors.join('\n')); process.exitCode = 1; }
  const warnings = harness.console.filter(line => /WGSL|shader|error/i.test(line));
  if (warnings.length) console.error(warnings.slice(0, 20).join('\n'));
} finally { await harness.close(); }
