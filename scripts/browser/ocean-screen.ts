/** `bun scripts/browser/ocean-screen.ts --tag <name> [--only chase,zoom5km] [--webgl] [--calm] [--steps 32] [--samples 0] [--measure] [--url http://127.0.0.1:5210]`
 * Renders the fixed scenes of `scripts/diagnostics/ocean-screen.html` in a headed Chromium and saves, per scene,
 * the shaded frame, the frame without reflections and the reflection confidence to `.build/ocean-screen/<tag>/`,
 * with `results.json` (backend, reversed depth, changed/isolated reflection pixels, errors, optional frame timings). */
import type { Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import { ROOT } from './harness';

const { values } = parseArgs({ options: {
  tag: { type: 'string', default: 'current' }, only: { type: 'string' }, steps: { type: 'string', default: '16' }, samples: { type: 'string' },
  webgl: { type: 'boolean', default: false }, calm: { type: 'boolean', default: false }, measure: { type: 'boolean', default: false }, url: { type: 'string' },
} });
const out = resolve(ROOT, '.build/ocean-screen', values.tag!);
mkdirSync(out, { recursive: true });
const server = values.url ? undefined : await authoringServer(ROOT, 0, true);
const url = values.url ?? serverUrl(server!);
const save = (name: string, image: string) => writeFileSync(resolve(out, `${name}.png`), Buffer.from(image.split(',')[1], 'base64'));
let browser: Browser | undefined;
const pageErrors: string[] = [];
try {
  browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--window-position=0,0', '--window-size=1600,990'],
    ...(process.env.HARNESS_CHROME ? { executablePath: process.env.HARNESS_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.setDefaultTimeout(600_000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if ((message.type() === 'error' || message.type() === 'warning') && !message.text().includes('favicon')) pageErrors.push(message.text()); });
  const query = new URLSearchParams({ steps: values.steps!, ...(values.samples ? { samples: values.samples } : {}), ...(values.webgl ? { webgl: '1' } : {}), ...(values.calm ? { calm: '1' } : {}) });
  await page.goto(`${url}/scripts/diagnostics/ocean-screen.html?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready, undefined, { polling: 250 });
  const info = await page.evaluate(() => { const s = (window as any).oceanScreen; return { backend: s.backend, reversedDepth: s.reversedDepth, scenes: s.scenes as string[] }; });
  const wanted = values.only ? values.only.split(',') : info.scenes;
  const results: Record<string, unknown> = {};
  for (const name of wanted) {
    await page.evaluate(scene => (window as any).oceanScreen.scene(scene), name);
    const difference = await page.evaluate(() => (window as any).oceanScreen.reflectionDifference());
    save(name, difference.on); save(`${name}-off`, difference.off);
    await page.evaluate(() => (window as any).oceanScreen.view(1));
    save(`${name}-confidence`, await page.evaluate(() => (window as any).oceanScreen.capture()));
    await page.evaluate(() => (window as any).oceanScreen.view(0));
    // Interleave on and off so drifting GPU load from other processes hits both alike.
    const timing = values.measure ? await page.evaluate(async () => {
      const screen = (window as any).oceanScreen, on: { frame: number; submit: number }[] = [], off: typeof on = [];
      for (let round = 0; round < 4; round++) {
        screen.reflections.enabled.value = true; on.push(await screen.measure());
        screen.reflections.enabled.value = false; off.push(await screen.measure());
      }
      screen.reflections.enabled.value = true;
      const median = (list: typeof on) => ({ frame: list.map(entry => entry.frame).sort((a, b) => a - b)[list.length >> 1], submit: list.map(entry => entry.submit).sort((a, b) => a - b)[list.length >> 1] });
      return { on: median(on), off: median(off) };
    }) : undefined;
    results[name] = { changed: difference.changed, isolated: difference.isolated, bounds: difference.bounds, ...(timing ? { timing } : {}) };
    console.log(name, JSON.stringify(results[name]));
  }
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ ...info, steps: Number(values.steps), samples: values.samples, calm: values.calm, results, pageErrors }, null, 1));
  console.log(JSON.stringify({ backend: info.backend, reversedDepth: info.reversedDepth }));
  if (pageErrors.length) console.error(pageErrors.join('\n'));
} finally {
  await browser?.close().catch(() => undefined);
  (server?.httpServer as Server | null)?.closeAllConnections();
  await server?.close();
}
