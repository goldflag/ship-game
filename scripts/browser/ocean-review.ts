/** `bun scripts/browser/ocean-review.ts --tag <name> [--only near,wide] [--quality high] [--measure] [--param realism=off] [--param renderer=waterpro] [--url http://127.0.0.1:5210]`
 * Renders the fixed scenes of `scripts/diagnostics/ocean-review.html` in a headed Chromium and saves one PNG
 * per scene to `.build/ocean-review/<tag>/`, with `results.json` (errors, optional frame timings).
 * `renderer=waterpro` draws them with the vendored Water Pro library the game's ocean replaced. */
import type { Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import { ROOT } from './harness';

const { values } = parseArgs({ options: {
  tag: { type: 'string', default: 'current' }, only: { type: 'string' }, quality: { type: 'string', default: 'high' },
  measure: { type: 'boolean', default: false }, url: { type: 'string' }, param: { type: 'string', multiple: true, default: [] },
} });
const out = resolve(ROOT, '.build/ocean-review', values.tag!);
mkdirSync(out, { recursive: true });
const server = values.url ? undefined : await authoringServer(ROOT, 0, true);
const url = values.url ?? serverUrl(server!);
let browser: Browser | undefined;
const pageErrors: string[] = [];
try {
  browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--window-position=0,0', '--window-size=1600,990'],
    ...(process.env.HARNESS_CHROME ? { executablePath: process.env.HARNESS_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.setDefaultTimeout(600_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
  const query = new URLSearchParams({ quality: values.quality!, ...Object.fromEntries(values.param!.map(entry => entry.split(/=(.*)/s).slice(0, 2))) });
  await page.goto(`${url}/scripts/diagnostics/ocean-review.html?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready, undefined, { polling: 250 });
  const all = await page.evaluate(() => (window as unknown as { oceanReview: { scenes: string[] } }).oceanReview.scenes);
  const wanted = values.only ? values.only.split(',') : all.filter(name => name !== 'submerged');
  const results: Record<string, unknown> = {};
  for (const name of wanted) {
    const started = Date.now();
    const info = await page.evaluate(scene => (window as any).oceanReview.scene(scene), name);
    const image: string = await page.evaluate(() => (window as any).oceanReview.capture());
    writeFileSync(resolve(out, `${name}.png`), Buffer.from(image.split(',')[1], 'base64'));
    const timing = values.measure && ['near', 'wide', 'grazing'].includes(name)
      ? { stepping: await page.evaluate(() => (window as any).oceanReview.measure(120, true)), paused: await page.evaluate(() => (window as any).oceanReview.measure(60, false)) }
      : undefined;
    results[name] = { ...info, seconds: (Date.now() - started) / 1000, ...(timing ? { timing } : {}) };
    console.log(name, JSON.stringify(results[name]));
  }
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ quality: values.quality, results, pageErrors }, null, 1));
  if (pageErrors.length) console.error(pageErrors.join('\n'));
} finally {
  await browser?.close().catch(() => undefined);
  (server?.httpServer as Server | null)?.closeAllConnections();
  await server?.close();
}
