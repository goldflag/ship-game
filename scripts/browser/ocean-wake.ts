/** `bun scripts/browser/ocean-wake.ts [--resolution 512] [--webgl] [--measure] [--tag name] [--url http://127.0.0.1:5210]`
 * Runs `scripts/diagnostics/ocean-wake.html` in a headed Chromium (headless stalls WebGPU) and saves the
 * checks, the step cost and the captures to `.build/ocean-wake/<tag>/`. Exits non-zero when a check fails. */
import type { Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import { ROOT } from './harness';

const { values } = parseArgs({ options: {
  resolution: { type: 'string', default: '512' }, webgl: { type: 'boolean', default: false }, measure: { type: 'boolean', default: false },
  tag: { type: 'string' }, url: { type: 'string' },
} });
const tag = values.tag ?? `${values.webgl ? 'webgl' : 'webgpu'}-${values.resolution}`;
const out = resolve(ROOT, '.build/ocean-wake', tag);
mkdirSync(out, { recursive: true });
const server = values.url ? undefined : await authoringServer(ROOT, 0, true);
const url = values.url ?? serverUrl(server!);
let browser: Browser | undefined;
const pageErrors: string[] = [];
let passed = false;
try {
  browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--window-position=0,0', '--window-size=1600,990'],
    ...(process.env.HARNESS_CHROME ? { executablePath: process.env.HARNESS_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.setDefaultTimeout(600_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') pageErrors.push(message.text()); });
  const query = new URLSearchParams({ resolution: values.resolution!, ...(values.webgl ? { webgl: '1' } : {}) });
  await page.goto(`${url}/scripts/diagnostics/ocean-wake.html?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { oceanWake?: unknown }).oceanWake, undefined, { polling: 500 });
  const { results, images } = await page.evaluate(() => (window as any).oceanWake as { results: Record<string, unknown>; images: Record<string, string> });
  for (const [name, image] of Object.entries(images)) writeFileSync(resolve(out, `${name}.png`), Buffer.from(image.split(',')[1], 'base64'));
  const timing = values.measure ? await page.evaluate(() => (window as any).oceanWake.measure()) : undefined;
  passed = results.passed === true;
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ results, timing, pageErrors }, null, 1));
  console.log(JSON.stringify({ results, timing }, null, 1));
  if (pageErrors.length) console.error(pageErrors.join('\n'));
} finally {
  await browser?.close().catch(() => undefined);
  (server?.httpServer as Server | null)?.closeAllConnections();
  await server?.close();
}
process.exit(passed ? 0 : 1);
