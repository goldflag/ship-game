/** `bun scripts/browser/sky-review.ts --tag <name> [--only noon,sunset] [--quality high] [--clouds medium] [--sky game|skypro]
 * [--measure] [--url http://127.0.0.1:5210]`
 * Renders the fixed scenes of `scripts/diagnostics/sky-review.html` in a headed Chromium and saves one PNG
 * per scene to `.build/sky-review/<tag>/`, with `results.json` (errors, optional frame timings). */
import type { Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import { ROOT } from './harness';

const { values } = parseArgs({ options: {
  tag: { type: 'string', default: 'current' }, only: { type: 'string' }, quality: { type: 'string', default: 'high' },
  clouds: { type: 'string' }, sky: { type: 'string' }, measure: { type: 'boolean', default: false }, url: { type: 'string' },
} });
/** Scenes whose frame cost is measured: open cumulus, a full deck, a storm and a narrow binocular view. */
const MEASURED = ['noon', 'overcast', 'storm', 'binoculars', 'sunset'];
const out = resolve(ROOT, '.build/sky-review', values.tag!);
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
  // Another window taking focus must not pause the game mid-measurement.
  await page.addInitScript(() => {
    window.addEventListener('blur', event => event.stopImmediatePropagation(), true);
    document.addEventListener('visibilitychange', event => event.stopImmediatePropagation(), true);
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()); });
  const query = new URLSearchParams({ quality: values.quality!, ...(values.clouds ? { clouds: values.clouds } : {}), ...(values.sky ? { sky: values.sky } : {}) });
  await page.goto(`${url}/scripts/diagnostics/sky-review.html?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready, undefined, { polling: 250 });
  const all = await page.evaluate(() => (window as unknown as { skyReview: { scenes: string[] } }).skyReview.scenes);
  const wanted = values.only ? values.only.split(',') : all;
  const results: Record<string, unknown> = {};
  for (const name of wanted) {
    const started = Date.now();
    const info = await page.evaluate(scene => (window as any).skyReview.scene(scene), name);
    const image: string = await page.evaluate(() => (window as any).skyReview.capture());
    writeFileSync(resolve(out, `${name}.png`), Buffer.from(image.split(',')[1], 'base64'));
    const timing = values.measure && MEASURED.includes(name)
      ? { stepping: await page.evaluate(() => (window as any).skyReview.measure(120, true)), paused: await page.evaluate(() => (window as any).skyReview.measure(60, false)) }
      : undefined;
    results[name] = { ...info, seconds: (Date.now() - started) / 1000, ...(timing ? { timing } : {}) };
    console.log(name, JSON.stringify(results[name]));
  }
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ quality: values.quality, clouds: values.clouds, sky: values.sky, results, pageErrors }, null, 1));
  if (pageErrors.length) console.error(pageErrors.join('\n'));
} finally {
  await browser?.close().catch(() => undefined);
  (server?.httpServer as Server | null)?.closeAllConnections();
  await server?.close();
}
