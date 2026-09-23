/** `bun scripts/browser/sky-atmosphere.ts --tag <name> [--query map=pacific-islands&weather=clear] [--url http://127.0.0.1:5210]`
 * Renders `scripts/diagnostics/sky-atmosphere.html` (the atmosphere part alone: a panorama per sun elevation,
 * graded as the game displays it) in a headed Chromium and saves `.build/sky-atmosphere/<tag>.png` with the
 * page's radiance readings in `<tag>.json`. */
import type { Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import { ROOT } from './harness';

const { values } = parseArgs({ options: { tag: { type: 'string', default: 'current' }, query: { type: 'string', default: '' }, url: { type: 'string' } } });
const out = resolve(ROOT, '.build/sky-atmosphere');
mkdirSync(out, { recursive: true });
const server = values.url ? undefined : await authoringServer(ROOT, 0, true);
const url = values.url ?? serverUrl(server!);
let browser: Browser | undefined;
const pageErrors: string[] = [];
try {
  browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--window-position=0,0', '--window-size=1620,1300'],
    ...(process.env.HARNESS_CHROME ? { executablePath: process.env.HARNESS_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  page.setDefaultTimeout(300_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') pageErrors.push(message.text()); });
  await page.goto(`${url}/scripts/diagnostics/sky-atmosphere.html?${values.query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { ready?: boolean; failed?: string }).ready || (window as unknown as { failed?: string }).failed, undefined, { polling: 250 });
  const failed = await page.evaluate(() => (window as unknown as { failed?: string }).failed);
  if (failed) throw new Error(failed);
  const image: string = await page.evaluate(() => (window as unknown as { capture(): string }).capture());
  writeFileSync(resolve(out, `${values.tag}.png`), Buffer.from(image.split(',')[1], 'base64'));
  const readings = await page.evaluate(() => (window as unknown as { readings: unknown }).readings);
  writeFileSync(resolve(out, `${values.tag}.json`), JSON.stringify({ query: values.query, readings, pageErrors }, null, 1));
  console.log(await page.evaluate(() => document.querySelector('#out')?.textContent ?? ''));
  if (pageErrors.length) console.error(pageErrors.join('\n'));
} finally {
  await browser?.close().catch(() => undefined);
  (server?.httpServer as Server | null)?.closeAllConnections();
  await server?.close();
}
