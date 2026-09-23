/** `bun scripts/browser/effects-review.ts --scene muzzle,hit [--out .build/effects/<label>] [--battle "bismarck;;bismarck:static"]`
 *
 * Renders repeatable combat-effect sequences in the real game (see `effectsStage.ts`, `effectsScenes.ts`):
 * one PNG per frame plus a labelled contact sheet per scene. `--list` names the scenes. The sea is held at
 * `--sea-time` seconds (default 60, `live` to leave it) after a 30 s replay, so master and a branch draw the same water.
 *
 * `--serve <port>` keeps the browser and battle open between runs:
 *   curl -s 'localhost:<port>/run?scene=muzzle&out=.build/effects/try1'   render against the current source
 *   curl -s localhost:<port>/reload   load the page afresh and wait for its battle
 *   curl -s localhost:<port>/stop     cancel queued runs, close the browser and exit
 * Vite reloads the page after a source edit, and the next /run waits for the new battle. `--no-hmr` keeps the page and
 * its battle through edits until /reload. The server exits after `--idle` minutes without a request (default 60). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { withHarness, ROOT, type Harness } from './harness';

const { values } = parseArgs({ options: {
  scene: { type: 'string', default: 'muzzle,hit,magazine,fire,funnel' }, out: { type: 'string', default: '.build/effects/review' },
  battle: { type: 'string', default: 'bismarck;;bismarck:static' }, range: { type: 'string', default: '1500' }, bearing: { type: 'string', default: '90' },
  viewport: { type: 'string', default: '1280x720' }, columns: { type: 'string', default: '3' }, serve: { type: 'string' }, list: { type: 'boolean', default: false },
  param: { type: 'string', multiple: true, default: [] }, 'sea-time': { type: 'string', default: '60' }, 'no-hmr': { type: 'boolean', default: false },
  idle: { type: 'string', default: '60' },
} });

const [width, height] = values.viewport!.split('x').map(Number);
// A fixed seed gives every review the same combat sea around the hulls.
const params: Record<string, string> = { battle: values.battle!, range: values.range!, bearing: values.bearing!, seed: '1941',
  ...Object.fromEntries(values.param!.map(entry => entry.split(/=(.*)/s).slice(0, 2) as [string, string])) };
const seaTime = values['sea-time'] === 'live' ? null : Number(values['sea-time']);
const fleetSize = values.battle!.split(';').reduce((count, side) => count + side.split(',').filter(token => token.trim()).length, 0);

interface SceneResult { frames: { label: string; png: string }[]; sheet: string; diagnostics: unknown }

async function run(harness: Harness, names: string[], out: string, columns: number): Promise<string[]> {
  const { page } = harness;
  await harness.ready();
  // A fresh battle's first frames compile every pass; let them run before the stage freezes it.
  if (await page.evaluate(() => !(window as unknown as { effectsStage?: unknown }).effectsStage)) await page.waitForTimeout(1500);
  const written: string[] = [];
  for (const name of names) {
    const started = Date.now();
    const result = await page.evaluate(async ({ name, columns, seaTime, fleetSize }) => {
      // Served by Vite inside the page, so edits apply without restarting the browser.
      const [{ installStage, contactSheet }, { scenes }] = await Promise.all([
        import(/* @vite-ignore */ String('/scripts/browser/effectsStage.ts')) as Promise<typeof import('./effectsStage')>,
        import(/* @vite-ignore */ String('/scripts/browser/effectsScenes.ts')) as Promise<typeof import('./effectsScenes')>]);
      const w = window as unknown as { effectsStage?: ReturnType<typeof installStage> }, game = window.review.game!;
      let stage = w.effectsStage;
      if (!stage || stage.game !== game) {
        stage = w.effectsStage = installStage(game, seaTime === null ? {} : { seaTime });
        // Hulls ride to the sea time first, so the replayed wake and smoke leave them where the scenes find them.
        // The clouds and sky reflections accumulate over frames: a second of frames settles them on the held sky and sea.
        if (seaTime !== null) { stage.freeze(); await game.freezeScene(seaTime, 30); for (let i = 0; i < 60; i++) await stage.render(); }
      }
      // Frames of an empty sea would otherwise pass for a review.
      const problems = stage.problems(fleetSize);
      if (problems.length) throw new Error(`The battle is not all there: ${problems.join('; ')}.`);
      const scene = scenes[name];
      if (!scene) throw new Error(`Unknown scene "${name}". Scenes: ${Object.keys(scenes).join(', ')}`);
      const frames: { label: string; png: string }[] = [], staged = stage;
      await scene(staged as Parameters<typeof scene>[0], async (label?: string) => { frames.push(await staged.capture(label)); });
      return { frames, sheet: await contactSheet(frames, columns), diagnostics: stage.diagnostics() } satisfies SceneResult;
    }, { name, columns, seaTime, fleetSize }).catch(error => {
      throw /context was destroyed|navigat/i.test(error.message) ? new Error(`The page reloaded during ${name} (a source edit?); run it again.`) : error;
    });
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

// Several reviews may share one desktop; an occluded window must not have its frame loop throttled.
await withHarness({ params, viewport: { width, height }, hmr: !values['no-hmr'], deadline: values.serve ? Infinity : 1800,
  args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] }, async harness => {
  const columns = Number(values.columns);
  if (!values.serve) await run(harness, values.scene!.split(','), values.out!, columns);
  else {
    const port = Number(values.serve), idleMs = Number(values.idle) * 60_000;
    let queue = Promise.resolve(), stopping = false, pending = 0, lastRequest = Date.now(), stop = () => {};
    const stopped = new Promise<void>(resolveStop => { stop = resolveStop; process.on('SIGINT', resolveStop); process.on('SIGTERM', resolveStop); });
    // One page, one run at a time; `/stop` turns away whatever is still queued.
    const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
      pending++;
      const done = queue.then(() => { if (stopping) throw new Error('The review is stopping.'); return work(); }).finally(() => { pending--; lastRequest = Date.now(); });
      queue = done.then(() => undefined, () => undefined);
      return done;
    };
    const idle = setInterval(() => { if (!pending && Date.now() - lastRequest > idleMs) { console.log(`Idle for ${values.idle} min; stopping.`); stopping = true; stop(); } }, 30_000);
    const server = Bun.serve({ port, idleTimeout: 0, fetch(request) {
      const url = new URL(request.url);
      lastRequest = Date.now();
      if (url.pathname === '/stop') { stopping = true; setTimeout(stop, 50); return new Response('stopping\n'); }
      if (url.pathname === '/reload') {
        return enqueue(() => harness.reload()).then(() => new Response('reloaded\n'), error => new Response(`${error.message}\n`, { status: 500 }));
      }
      if (url.pathname !== '/run') return new Response('GET /run?scene=a,b&out=dir  |  /reload  |  /stop\n', { status: 404 });
      const scenes = (url.searchParams.get('scene') ?? 'muzzle').split(','), out = url.searchParams.get('out') ?? values.out!;
      return enqueue(() => run(harness, scenes, out, Number(url.searchParams.get('columns') ?? columns))).then(files => new Response(files.join('\n') + '\n'),
        error => new Response(`${error.message}\n${harness.errors.join('\n')}\n`, { status: 500 }));
    } });
    console.log(`Effects review serving on http://localhost:${port} (battle ${params.battle}); GET /stop to close.`);
    await stopped;
    // Closing the browser ends a run in flight; queued ones are turned away, and every caller gets its answer before the socket goes.
    stopping = true; clearInterval(idle);
    await harness.close();
    await Promise.race([queue, new Promise(resolve => setTimeout(resolve, 5000))]);
    server.stop(true);
  }
  const warnings = harness.console.filter(line => /WGSL|shader|error/i.test(line) && !line.includes('Failed to load resource'));
  if (warnings.length) console.error(warnings.slice(0, 20).join('\n'));
});
