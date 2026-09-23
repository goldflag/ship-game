/** `bun scripts/browser/ocean-waves.ts --tag <name> [--quality high] [--views near,wide] [--seas moderate,storm,15]
 *   [--show shaded|height|slope|foam|variance|jacobian] [--validate] [--timing]`
 * Drives `scripts/diagnostics/ocean-waves.html` in a headed Chromium (headless stalls WebGPU): saves one PNG per
 * view and sea to `.build/ocean-waves/<tag>/`, and with --validate / --timing checks every tier and writes `results.json`. */
import type { Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import { ROOT } from './harness';

const { values } = parseArgs({ options: {
  tag: { type: 'string', default: 'current' }, quality: { type: 'string', default: 'high' },
  views: { type: 'string', default: '' }, seas: { type: 'string', default: 'moderate' }, show: { type: 'string', default: 'shaded' },
  validate: { type: 'boolean', default: false }, timing: { type: 'boolean', default: false }, url: { type: 'string' },
} });
const out = resolve(ROOT, '.build/ocean-waves', values.tag!);
mkdirSync(out, { recursive: true });
const server = values.url ? undefined : await authoringServer(ROOT, 0, true);
const url = values.url ?? serverUrl(server!);
let browser: Browser | undefined;
const pageErrors: string[] = [];
const results: Record<string, unknown> = {};
try {
  browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--window-position=0,0', '--window-size=1600,990'],
    ...(process.env.HARNESS_CHROME ? { executablePath: process.env.HARNESS_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.setDefaultTimeout(600_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') pageErrors.push(message.text()); });
  // A blurred window pauses requestAnimationFrame-driven timing; the page renders on demand instead.
  const query = new URLSearchParams({ quality: values.quality!, show: values.show! });
  await page.goto(`${url}/scripts/diagnostics/ocean-waves.html?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready, undefined, { polling: 250 });
  results.backend = await page.evaluate(() => (window as any).oceanWaves.backend);
  const views = values.views ? values.views.split(',') : [];
  for (const sea of views.length ? values.seas!.split(',') : []) for (const view of views) {
    const info = await page.evaluate(([v, s]) => (window as any).oceanWaves.view(v, s), [view, sea]);
    const image: string = await page.evaluate(() => (window as any).oceanWaves.capture());
    const name = `${view}-${sea}${values.show === 'shaded' ? '' : `-${values.show}`}`;
    writeFileSync(resolve(out, `${name}.png`), Buffer.from(image.split(',')[1], 'base64'));
    console.log(name, JSON.stringify(info));
  }
  for (const quality of values.validate || values.timing ? ['low', 'medium', 'high', 'ultra'] : []) {
    await page.evaluate(q => (window as any).oceanWaves.setQuality(q), quality);
    const entry: Record<string, unknown> = {};
    if (values.validate) {
      for (const sea of ['calm', 'moderate', 'storm']) {
        await page.evaluate(s => (window as any).oceanWaves.view('near', s, .1), sea);
        entry[sea] = { transform: await page.evaluate(() => (window as any).oceanWaves.validate()), heights: await page.evaluate(() => (window as any).oceanWaves.heights()) };
      }
      entry.foam = await page.evaluate(() => (window as any).oceanWaves.foamCheck());
    }
    if (values.timing) {
      await page.evaluate(() => (window as any).oceanWaves.view('near', 'moderate', .5));
      entry.timing = [];
      for (let run = 0; run < 3; run++) (entry.timing as unknown[]).push(await page.evaluate(() => (window as any).oceanWaves.timing()));
    }
    results[quality] = entry;
    console.log(quality, JSON.stringify(entry));
  }
  results.pageErrors = pageErrors;
  writeFileSync(resolve(out, 'results.json'), JSON.stringify(results, null, 1));
  if (pageErrors.length) console.error(pageErrors.join('\n'));
} finally {
  await browser?.close().catch(() => undefined);
  (server?.httpServer as Server | null)?.closeAllConnections();
  await server?.close();
}
