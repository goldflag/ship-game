/** `bun scripts/browser/ocean-screen.ts --tag <name> [--only chase,sub7] [--webgl] [--calm] [--steps 32] [--samples 0] [--measure] [--url http://127.0.0.1:5210]`
 * Renders the fixed scenes of `scripts/diagnostics/ocean-screen.html` in a headed Chromium and saves them to
 * `.build/ocean-screen/<tag>/`: above water the shaded frame, the frame without reflections and the reflection
 * confidence; under water the frame with and without the underwater pass. `results.json` records the backend,
 * reversed depth, changed/isolated reflection pixels, errors and, with --measure, frame times with each effect on and off;
 * `water.wgsl|glsl` and `output.wgsl|glsl` hold the generated fragment code. */
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
  /** Frame cost with a uniform on and off (the page alternates it every batch). */
  const timeToggle = (uniform: 'reflections.enabled' | 'cameraNearSurface') => page.evaluate(key => {
    const screen = (window as any).oceanScreen;
    return screen.measure(key === 'cameraNearSurface' ? screen.cameraNearSurface : screen.reflections.enabled);
  }, uniform);
  for (const name of wanted) {
    const { nearSurface } = await page.evaluate(scene => (window as any).oceanScreen.scene(scene), name);
    if (nearSurface) {
      // Underwater scenes: the frame with the pass and without it (as if the camera were certainly dry).
      save(name, await page.evaluate(() => (window as any).oceanScreen.capture()));
      await page.evaluate(() => { (window as any).oceanScreen.cameraNearSurface.value = false; });
      save(`${name}-dry`, await page.evaluate(() => (window as any).oceanScreen.capture()));
      await page.evaluate(() => { (window as any).oceanScreen.cameraNearSurface.value = true; });
      results[name] = { nearSurface, ...(values.measure ? { timing: await timeToggle('cameraNearSurface') } : {}) };
    } else {
      const difference = await page.evaluate(() => (window as any).oceanScreen.reflectionDifference());
      save(name, difference.on); save(`${name}-off`, difference.off);
      await page.evaluate(() => (window as any).oceanScreen.view(1));
      save(`${name}-confidence`, await page.evaluate(() => (window as any).oceanScreen.capture()));
      await page.evaluate(() => (window as any).oceanScreen.view(0));
      results[name] = { changed: difference.changed, isolated: difference.isolated, bounds: difference.bounds,
        ...(values.measure ? { timing: await timeToggle('reflections.enabled') } : {}) };
    }
    console.log(name, JSON.stringify(results[name]));
  }
  const shaders = await page.evaluate(() => (window as any).oceanScreen.shaders());
  const extension = info.backend === 'webgpu' ? 'wgsl' : 'glsl';
  writeFileSync(resolve(out, `water.${extension}`), shaders.water); writeFileSync(resolve(out, `output.${extension}`), shaders.output);
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ ...info, steps: Number(values.steps), samples: values.samples, calm: values.calm, results, pageErrors }, null, 1));
  console.log(JSON.stringify({ backend: info.backend, reversedDepth: info.reversedDepth }));
  if (pageErrors.length) console.error(pageErrors.join('\n'));
} finally {
  await browser?.close().catch(() => undefined);
  (server?.httpServer as Server | null)?.closeAllConnections();
  await server?.close();
}
