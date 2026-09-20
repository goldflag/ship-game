import { chromium } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import { mkdir } from 'node:fs/promises';
const out = '.build/runtime-size/browser';
await mkdir(out, { recursive: true });
const server = await authoringServer(process.cwd()),
  browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/__runtime_worker__', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Worker benchmark</title>' }),
  );
  await page.goto(serverUrl(server) + '/__runtime_worker__');
  const results = [];
  for (const presetId of ['bismarck', 'resolute']) {
    const requests: string[] = [];
    const listener = (request: any) => requests.push(new URL(request.url()).pathname);
    page.on('request', listener);
    const result = await page.evaluate(async (presetId) => {
      const worker = new Worker('/src/game/session/local.worker.ts', { type: 'module' });
      const samples: any[] = [];
      try {
        const send = (message: any) =>
          new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Worker timeout')), 120000);
            worker.onerror = (e) => {
              clearTimeout(timeout);
              reject(new Error(e.message));
            };
            worker.onmessage = (e) => {
              if (e.data.type === 'error') {
                clearTimeout(timeout);
                reject(new Error(e.data.message));
              } else if (e.data.type === 'snapshot') {
                clearTimeout(timeout);
                resolve(e.data);
              }
            };
            worker.postMessage(message);
          });
        const setup = {
          ships: [0, 1].map((i) => ({ id: 'ship-' + i, presetId, team: i ? 'b' : 'a', controller: 'bot', aiLevel: 'hard', spawn: null })),
          seed: 12345,
          mapId: 'north-atlantic',
          weather: 'overcast',
          spawnDistance: 5000,
          windSpeed: null,
          missionRules: null,
          airRules: null,
        };
        const start = performance.now(),
          initial = await send({ type: 'init', setup, profile: true }),
          initMs = performance.now() - start;
        for (let i = 0; i < 20; i++) {
          const frame = await send({ type: 'advance', ticks: 6, commands: [] });
          samples.push(frame.timing);
        }
        return { presetId, initMs, initial: initial.timing, samples };
      } finally {
        worker.terminate();
      }
    }, presetId);
    page.off('request', listener);
    if (requests.some((r) => r.endsWith('/resolute.nsd')) && presetId === 'bismarck') throw new Error('Worker loaded unused Resolute');
    results.push({ ...result, requests });
    console.log(presetId, result.initMs, result.initial);
  }
  await Bun.write(`${out}/workers.json`, JSON.stringify({ browser: browser.version(), results }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
