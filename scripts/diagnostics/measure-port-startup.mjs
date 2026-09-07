// Compare the first orbit immediately after the loading screen with a later orbit.
// Set PLAYWRIGHT_MODULE to an installed playwright-core/index.mjs when needed.
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright-core');
const label = process.argv[2] ?? 'sample';
const output = new URL('../../.build/port-startup/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => {
    const result = window.portStartup = { stages: [], pipelines: [], frames: [], ready: 0, done: false };
    for (const method of ['createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline', 'createComputePipelineAsync']) {
      if (!window.GPUDevice) break;
      const original = GPUDevice.prototype[method];
      GPUDevice.prototype[method] = function (...args) {
        const start = performance.now(), value = original.apply(this, args);
        result.pipelines.push({ method, label: args[0].label, start, work: performance.now() - start });
        return value;
      };
    }
    new MutationObserver(() => {
      const label = document.querySelector('.startup-status')?.textContent;
      if (label && result.stages.at(-1)?.label !== label) result.stages.push({ label, ms: performance.now() });
      if (result.ready || !document.querySelector('.garage')) return;
      result.ready = performance.now();
      const canvas = document.querySelector('canvas');
      const pointer = (type, x) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: 300, bubbles: true }));
      pointer('pointerdown', 640);
      let previous = result.ready;
      const frame = time => {
        result.frames.push({ ms: time - result.ready, interval: time - previous });
        previous = time;
        // Smoothly orbit both directions for 15 seconds, starting at ready.
        pointer('pointermove', 640 + Math.sin((time - result.ready) / 2200) * 500);
        if (time - result.ready < 15000) requestAnimationFrame(frame);
        else { pointer('pointerup', 640); result.done = true; }
      };
      requestAnimationFrame(frame);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.goto(process.env.STARTUP_URL ?? 'http://localhost:5301/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.portStartup?.done, undefined, { timeout: 240000 });
  const result = await page.evaluate(() => window.portStartup);
  const windows = [0, 5000, 10000].map(start => {
    const intervals = result.frames.filter(f => f.ms >= start && f.ms < start + 5000).map(f => f.interval).sort((a, b) => a - b);
    return { start, frames: intervals.length, mean: intervals.reduce((s, n) => s + n, 0) / intervals.length,
      p95: intervals[Math.floor(intervals.length * .95)], max: intervals.at(-1), over100ms: intervals.filter(n => n > 100).length };
  });
  const latePipelines = result.pipelines.filter(p => p.start >= result.ready);
  const summary = { readyMs: result.ready, windows, latePipelines: latePipelines.length, errors };
  await writeFile(new URL(`${label}.json`, output), JSON.stringify({ ...result, summary }, null, 2));
  await page.screenshot({ path: new URL(`${label}.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }
