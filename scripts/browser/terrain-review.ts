/** `bun scripts/browser/terrain-review.ts [--tag current] [--maps a,b] [--presets coast3,aerial] [--quality high]
 * [--size 1600x900] [--bench [--bench-view spawn]] [--build] [--art] [--serve <port>]`
 *
 * Renders the fixed views of `scripts/diagnostics/terrain-review.html` (the real game over each battle map's land) in a
 * headed Chromium through the browser harness and saves `<map>-<preset>.png` per view to `.build/reviews/terrain/<tag>/`,
 * with `results.json`. `--bench` times the land on the spawn view of each map: frames with it alternating with frames
 * without, by wall clock (the only timing that holds up on Apple GPUs; see docs/browser-verification.md), for the GPU
 * and CPU. `--build` times building the land from the decoded field. Keep one tag as a baseline to compare against.
 * `--art --size 1920x1080` renders each map's `art` view and writes its picker tile and loading-screen backdrop to
 * `public/maps/<id>.webp` and `public/maps/<id>-backdrop.webp` (cwebp).
 *
 * `--serve <port>` keeps the page open for look development: `curl 'localhost:<port>/run?maps=vestfjord&presets=coast8&tag=try1'`
 * renders against the current source (Vite reloads the page after an edit; the run waits for it), `&debug=sun` draws one of
 * the land's debug views instead (see `TerrainDebug`), `/reload` loads the page afresh, `/stop` closes it. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Page } from 'playwright';
import { ROOT, withHarness, type Harness } from './harness';

const { values } = parseArgs({ options: {
  tag: { type: 'string', default: 'current' }, maps: { type: 'string' }, presets: { type: 'string' }, quality: { type: 'string', default: 'high' },
  size: { type: 'string', default: '1600x900' }, bench: { type: 'boolean', default: false }, build: { type: 'boolean', default: false },
  range: { type: 'string', default: '5000' }, pairs: { type: 'string', default: '150' }, url: { type: 'string' }, serve: { type: 'string' },
  'bench-view': { type: 'string', default: 'spawn' }, 'bench-part': { type: 'string', default: 'land' }, art: { type: 'boolean', default: false },
} });
const [width, height] = values.size!.split('x').map(Number);

interface TerrainReviewPage {
  maps: string[]; presets: string[];
  show(map: string, preset: string): Promise<Record<string, unknown>>;
  capture(): Promise<string>;
  debug(mode: string): void;
  bench(pairs: number, part?: string): Promise<Record<string, number>>;
  atlas(): Promise<string>;
  buildCost(map: string, times?: number): Promise<number[]>;
}
declare const terrainReview: TerrainReviewPage;

interface Run { maps?: string[]; presets?: string[]; tag: string; bench?: boolean; build?: boolean; debug?: string }

async function render(page: Page, run: Run): Promise<string[]> {
  const out = resolve(ROOT, '.build/reviews/terrain', run.tag);
  mkdirSync(out, { recursive: true });
  const { maps, presets } = await page.evaluate(() => ({ maps: terrainReview.maps, presets: terrainReview.presets }));
  const results: Record<string, unknown> = {}, files: string[] = [];
  await page.evaluate(mode => terrainReview.debug(mode), run.debug ?? 'off');
  for (const map of run.maps ?? maps) {
    for (const preset of run.presets ?? presets) {
      const started = Date.now();
      const info = await page.evaluate(([m, p]) => terrainReview.show(m, p), [map, preset] as const);
      const image = await page.evaluate(() => terrainReview.capture());
      const file = resolve(out, `${map}-${preset}${run.debug && run.debug !== 'off' ? `-${run.debug}` : ''}.png`);
      writeFileSync(file, Buffer.from(image.split(',')[1], 'base64'));
      files.push(file);
      results[`${map}/${preset}`] = { ...info, seconds: (Date.now() - started) / 1000 };
      console.log(map, preset, JSON.stringify(info));
    }
    if (run.bench) {
      await page.evaluate(([m, p]) => terrainReview.show(m, p), [map, values['bench-view']!] as const);
      const bench = await page.evaluate(([pairs, part]) => terrainReview.bench(pairs, part), [Number(values.pairs), values['bench-part']!] as const);
      results[`${map}/bench/${values['bench-view']}`] = bench;
      console.log(map, 'bench', JSON.stringify(bench));
    }
    if (run.build) {
      const build = await page.evaluate(m => terrainReview.buildCost(m, 3), map);
      results[`${map}/build`] = build;
      console.log(map, 'build ms', JSON.stringify(build));
    }
  }
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ quality: values.quality, size: values.size, results }, null, 1));
  console.log(`saved to ${out}`);
  return files;
}

async function serve(harness: Harness, port: number): Promise<void> {
  let queue = Promise.resolve(), stop = () => {};
  const stopped = new Promise<void>(resolveStop => { stop = resolveStop; process.on('SIGINT', resolveStop); process.on('SIGTERM', resolveStop); });
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => { const done = queue.then(work); queue = done.then(() => undefined, () => undefined); return done; };
  const list = (value: string | null) => value ? value.split(',') : undefined;
  const server = Bun.serve({ port, idleTimeout: 0, fetch(request) {
    const url = new URL(request.url), query = url.searchParams;
    if (url.pathname === '/stop') { setTimeout(stop, 50); return new Response('stopping\n'); }
    if (url.pathname === '/reload') return enqueue(() => harness.reload()).then(() => new Response('reloaded\n'), error => new Response(`${error.message}\n`, { status: 500 }));
    if (url.pathname === '/atlas') return enqueue(async () => {
      await harness.ready();
      const image = await harness.page.evaluate(() => terrainReview.atlas()), file = resolve(ROOT, '.build/reviews/terrain/tree-atlas.png');
      mkdirSync(resolve(ROOT, '.build/reviews/terrain'), { recursive: true });
      writeFileSync(file, Buffer.from(image.split(',')[1], 'base64'));
      return new Response(file + '\n');
    });
    if (url.pathname !== '/run') return new Response('GET /run?maps=a,b&presets=c,d&tag=t[&debug=mode][&bench=1]  |  /atlas  |  /reload  |  /stop\n', { status: 404 });
    return enqueue(async () => {
      // A source edit makes Vite reload the page; wait for the new one before driving it.
      await harness.ready();
      return render(harness.page, { maps: list(query.get('maps')), presets: list(query.get('presets')), tag: query.get('tag') ?? values.tag!,
        debug: query.get('debug') ?? undefined, bench: query.has('bench'), build: query.has('build') });
    }).then(files => new Response(files.join('\n') + '\n'), error => new Response(`${error.message}\n${harness.errors.join('\n')}\n`, { status: 500 }));
  } });
  console.log(`Terrain review serving on http://localhost:${port}; GET /stop to close.`);
  await stopped;
  await harness.close();
  server.stop(true);
}

/** Encode each map's `art` capture as its picker tile (640 × 360) and loading-screen backdrop (1920 × 1080) with cwebp. */
function publishArt(files: string[]): void {
  for (const file of files.filter(path => path.endsWith('-art.png'))) {
    const id = file.slice(file.lastIndexOf('/') + 1, -'-art.png'.length);
    for (const [name, width, height] of [[`${id}-backdrop`, 1920, 1080], [id, 640, 360]] as const) {
      const out = resolve(ROOT, 'public/maps', `${name}.webp`);
      const encoded = Bun.spawnSync(['cwebp', '-quiet', '-q', '86', '-resize', String(width), String(height), file, '-o', out]);
      if (encoded.exitCode) throw new Error(`cwebp failed for ${name}: ${encoded.stderr.toString()}`);
      console.log(`wrote ${out}`);
    }
  }
}

await withHarness({ page: '/scripts/diagnostics/terrain-review.html', params: { quality: values.quality!, range: values.range!, designs: 'none' },
  viewport: { width, height }, uncapped: values.bench, url: values.url, deadline: values.serve ? Infinity : 3600,
  args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] }, async harness => {
  if (values.serve) return serve(harness, Number(values.serve));
  const files = await render(harness.page, { maps: values.maps?.split(','), presets: values.art ? ['art'] : values.presets?.split(','), tag: values.tag!,
    bench: values.bench, build: values.build });
  if (values.art) publishArt(files);
});
