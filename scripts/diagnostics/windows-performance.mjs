// Uses an isolated Chrome profile and the installed browser's real GPU backend.
// PLAYWRIGHT_MODULE can point to a separately installed playwright-core/index.mjs.
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { measureWindowsLive } from './measure-windows-live.mjs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright-core');
const label = process.argv[2] ?? 'sample';
const url = process.env.PERFORMANCE_URL ?? 'http://localhost:5299/scripts/diagnostics/live-performance.html?seconds=30&profile';
const output = new URL('../../assets/reviews/windows-carrier-performance/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
] });
console.log('Chrome started');
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => { errors.push(String(error)); console.log(String(error)); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const failedResources = [];
  page.on('response', response => { if (response.status() >= 400) failedResources.push({ url: response.url(), status: response.status() }); });
  const system = await browser.newBrowserCDPSession();
  const gpu = await system.send('SystemInfo.getInfo');
  const cdp = await context.newCDPSession(page);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.review?.ready || window.review?.error, undefined, { timeout: 240000 });
  console.log('Scene ready');
  if (process.env.CPU_PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  await page.waitForFunction(() => window.review?.result || window.review?.error, undefined, { timeout: 180000 });
  if (process.env.CARRIERS) {
    console.log('Preparing carrier-only replay');
    await page.evaluate(async team => {
      const g = window.review.game;
      const definition = g.simulation.actors.find(a => a.definition.airWing).definition;
      const sim = new g.simulation.constructor(definition, { friendlyBots: Array(team - 1).fill(definition), enemies: Array(team).fill(definition), spawnDistance: 5000, seed: 0x6e617661 });
      g.setInPort(true);
      await g.replaceFleet(sim, definition);
      g.setInPort(false);
      for (let tick = 0; tick < 3600; tick++) {
        sim.step({ throttle: .5, rudder: 0 }, { aim: [0, .5, -5000], fire: false, battery: 'main' });
        if (tick % 120 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      g.fleetViews.forEach(v => v.snap());
    }, Number(process.env.CARRIERS));
    await page.evaluate(measureWindowsLive, { seconds: 30, warmup: 10 });
  }
  if (process.env.CPU_PROFILE) {
    const { profile } = await cdp.send('Profiler.stop');
    await writeFile(new URL(`${label}.cpuprofile`, output), JSON.stringify(profile));
  }
  const result = await page.evaluate(async () => {
    const info = window.review.game.renderer.backend.device?.adapterInfo
      ?? (await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }))?.info;
    return { result: window.review.result, error: window.review.error, diagnostics: window.review.game.diagnostics(),
      adapter: info && { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } };
  });
  await writeFile(new URL(`${label}.json`, output), JSON.stringify({ ...result, gpu: gpu.gpu, errors, failedResources,
    url, buildRevision: process.env.BUILD_REVISION,
    runnerRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    capturedAt: new Date().toISOString() }, null, 2));
  await page.screenshot({ path: new URL(`${label}.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
  console.log(JSON.stringify({ ...result.result, errors }));
  if (process.env.VISUAL_REVIEW) {
    const views = {};
    for (const mode of ['distant', 'zoom', 'near']) {
      views[mode] = await page.evaluate(async mode => {
        const g = window.review.game;
        const p = g.simulation.aircraft.find(p => p.phase === 'outbound' && p.position[1] > 100)
          ?? g.simulation.aircraft.find(p => p.phase === 'attack' && p.position[1] > 100);
        if (!p) throw new Error('No airborne aircraft for visual review');
        g.rig.update = () => {}; g.camera.zoom = mode === 'zoom' ? 24 : 1;
        const distance = mode === 'near' ? 25 : 4000;
        g.camera.position.set(p.position[0] + distance * .3, p.position[1] + distance * .2, p.position[2] + distance);
        g.camera.lookAt(...p.position); g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld(true);
        for (let i = 0; i < 3; i++) await g.frame(performance.now());
        return { plane: p.id, position: p.position, aircraft: g.aircraftView.diagnostics() };
      }, mode);
      await page.screenshot({ path: new URL(`${label}-${mode}.png`, output).pathname.replace(/^\/(\w:)/, '$1') });
    }
    await writeFile(new URL(`${label}-visual.json`, output), JSON.stringify({ views, errors, failedResources }, null, 2));
  }
} finally { await browser.close(); }
