/** Real Chromium decode + existing local worker/WASM, using isolated routed fixtures. */
import { chromium } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import { execFileSync } from 'node:child_process';
const prefixes = process.argv.slice(2);
if (!prefixes.length || prefixes.some((p) => !p.startsWith('.build/')))
  throw Error('Pass .build/ fixture prefixes (.nsd + .manifest.json)');
const server = await authoringServer(process.cwd());
const results = [];
function rss(pid: number) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((s) => s.trim().split(/\s+/).map(Number));
  const ids = new Set([pid]);
  for (let old = 0; old !== ids.size;) {
    old = ids.size;
    for (const [p, parent] of rows) if (ids.has(parent)) ids.add(p);
  }
  return rows.reduce((sum, [p, , kb]) => sum + (ids.has(p) ? kb * 1024 : 0), 0);
}
try {
  for (const prefix of prefixes) {
    const bytes = Buffer.from(await Bun.file(prefix + '.nsd').arrayBuffer());
    const manifest = await Bun.file(prefix + '.manifest.json').json();
    const entry = manifest.ships.find((s: any) => s.id === 'resolute');
    const index = await Bun.file('.build/naval-content/index.json').json();
    index.ships = index.ships.map((s: any) => (s.id === entry.id ? { ...s, contentHash: entry.contentHash, sha256: entry.sha256 } : s));
    const browser = await chromium.launch({ headless: true, args: ['--js-flags=--expose-gc'] });
    let sampler: ReturnType<typeof setInterval> | undefined;
    try {
      const bcdp = await browser.newBrowserCDPSession();
      const info = await bcdp.send('SystemInfo.getProcessInfo');
      const pid = info.processInfo.find((p) => p.type === 'browser')!.id;
      const context = await browser.newContext();
      await context.route('**/.build/naval-content/index.json', (r) =>
        r.fulfill({ contentType: 'application/json', body: JSON.stringify(index) }),
      );
      await context.route('**/models/runtime/resolute.nsd', (r) => r.fulfill({ contentType: 'application/octet-stream', body: bytes }));
      const page = await context.newPage();
      await page.route('**/__combat_fixture__', (r) =>
        r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Combat fixture memory</title>' }),
      );
      await page.goto(serverUrl(server) + '/__combat_fixture__');
      const cdp = await context.newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const before = await cdp.send('Runtime.getHeapUsage');
      const beforeRss = rss(pid);
      const samples = [beforeRss];
      sampler = setInterval(() => samples.push(rss(pid)), 100);
      const decode = await page.evaluate(async () => {
        const codec = await import('/src/ships/runtimeEncoding.ts' as string);
        const t = performance.now();
        const b = await (await fetch('/models/runtime/resolute.nsd')).arrayBuffer();
        const fetched = performance.now();
        (window as any).__definition = codec.decodeRuntimeDefinition(new Uint8Array(b));
        return { fetchMs: fetched - t, decodeMs: performance.now() - fetched, bytes: b.byteLength };
      });
      const afterDecode = await cdp.send('Runtime.getHeapUsage');
      await cdp.send('HeapProfiler.collectGarbage');
      const retained = await cdp.send('Runtime.getHeapUsage');
      const decodeRss = rss(pid);
      const worker = await page.evaluate(async () => {
        const w = new Worker('/src/game/session/local.worker.ts', { type: 'module' });
        (window as any).__worker = w;
        const send = (m: any) =>
          new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Worker fixture timeout')), 120000);
            w.onerror = (e) => {
              clearTimeout(timer);
              reject(Error(e.message));
            };
            w.onmessage = (e) => {
              if (e.data.type === 'error') {
                clearTimeout(timer);
                reject(Error(e.data.message));
              } else if (e.data.type === 'snapshot') {
                clearTimeout(timer);
                resolve(e.data);
              }
            };
            w.postMessage(m);
          });
        const setup = {
          ships: [0, 1].map((i) => ({
            id: 'ship-' + i,
            presetId: 'resolute',
            team: i ? 'b' : 'a',
            controller: 'bot',
            aiLevel: 'hard',
            spawn: null,
          })),
          seed: 12345,
          mapId: 'north-atlantic',
          weather: 'overcast',
          spawnDistance: 5000,
          windSpeed: null,
          missionRules: null,
          airRules: null,
        };
        const start = performance.now();
        const first = await send({ type: 'init', setup, profile: true });
        const initMs = performance.now() - start;
        const frames = [];
        for (let i = 0; i < 20; i++) frames.push((await send({ type: 'advance', ticks: 6, commands: [] })).timing);
        return { initMs, initial: first.timing, frames };
      });
      clearInterval(sampler);
      sampler = undefined;
      const residentRss = rss(pid);
      samples.push(residentRss);
      const row = {
        prefix,
        browser: browser.version(),
        decode,
        before,
        afterDecode,
        retained,
        beforeRss,
        decodeRss,
        residentRss,
        peakSampledRss: Math.max(...samples),
        worker,
      };
      results.push(row);
      await Bun.write(prefix + '.browser.json', JSON.stringify(row, null, 2));
      console.log(prefix, decode, worker.initMs, worker.initial.wasmMemoryBytes, residentRss);
      await page.evaluate(() => {
        (window as any).__worker.terminate();
      });
      await context.close();
    } finally {
      if (sampler) clearInterval(sampler);
      await Promise.race([browser.close(), new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
    }
  }
  await Bun.write(
    '.build/combat-profile/browser.json',
    JSON.stringify(
      {
        conditions:
          'Fresh Chromium processes, loopback routed immutable fixtures, page retains decoded definition and real local worker/WASM. 120 ticks, two Resolutes, no GLB rendering. Summed process-tree RSS can double count shared pages; 100 ms sampling misses brief peaks. Main page heap excludes worker heap.',
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
