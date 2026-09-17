import { chromium } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), out = '.build/runtime-size/browser'; await mkdir(out, { recursive: true });
const server = await authoringServer(root);
// macOS process-tree RSS includes browser, renderer and utility/GPU processes.
// Summed RSS may count shared pages more than once; sampling can miss brief peaks.
function residentBytes(pid: number): number {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const descendants = new Set([pid]);
  for (let previous = 0; previous !== descendants.size;) {
    previous = descendants.size;
    for (const [child, parent] of rows) if (descendants.has(parent)) descendants.add(child);
  }
  return rows.reduce((sum, [child, , rss]) => sum + (descendants.has(child) ? rss * 1024 : 0), 0);
}
const results = [];
try {
  for (const mode of ['json', 'runtime', 'startup']) {
    const browser = await chromium.launch({ headless: true, args: ['--js-flags=--expose-gc'] });
    let sampler: ReturnType<typeof setInterval> | undefined;
    try {
    const browserCdp = await browser.newBrowserCDPSession();
    const processes = await browserCdp.send('SystemInfo.getProcessInfo');
    const browserPid = processes.processInfo.find(process => process.type === 'browser')!.id;
    const context = await browser.newContext(), page = await context.newPage();
    const requests: string[] = []; page.on('request', r => requests.push(new URL(r.url()).pathname));
    await page.route('**/__runtime_bench_empty__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Runtime load benchmark</title>' }));
    await page.goto(serverUrl(server) + '/__runtime_bench_empty__');
    const cdp = await context.newCDPSession(page); await cdp.send('HeapProfiler.collectGarbage');
    const before = await cdp.send('Runtime.getHeapUsage');
    const beforeRssBytes = residentBytes(browserPid), rssSamples = [beforeRssBytes];
    sampler = setInterval(() => rssSamples.push(residentBytes(browserPid)), 50);
    const timing = await page.evaluate(async mode => {
      const start = performance.now(); let parseMs = 0, bytes = 0;
      if (mode === 'startup') {
        const presets = await import('/src/ships/presets.ts' as string);
        (window as any).__retained = presets;
        return { totalMs: performance.now() - start, selected: presets.selectedShip.id, count: Object.keys(presets.shipPresets).length };
      }
      const codec = mode === 'runtime' ? await import('/src/ships/runtimeEncoding.ts' as string) : undefined;
      const response = await fetch(mode === 'json' ? '/models/resolute.json' : '/models/runtime/resolute.nsd');
      const body = await response.arrayBuffer(); bytes = body.byteLength;
      const parse = performance.now();
      (window as any).__retained = codec ? codec.decodeRuntimeDefinition(new Uint8Array(body)) : JSON.parse(new TextDecoder().decode(body));
      parseMs = performance.now() - parse;
      return { totalMs: performance.now() - start, parseMs, bytes };
    }, mode);
    const high = await cdp.send('Runtime.getHeapUsage'); await cdp.send('HeapProfiler.collectGarbage'); const retained = await cdp.send('Runtime.getHeapUsage');
    clearInterval(sampler); sampler = undefined;
    const retainedRssBytes = residentBytes(browserPid); rssSamples.push(retainedRssBytes);
    if (mode === 'startup' && requests.some(r => r.endsWith('/resolute.nsd'))) throw new Error('Startup eagerly loaded Resolute');
    const result = { mode, browser: browser.version(), timing, before, high, retained, beforeRssBytes, retainedRssBytes, peakSampledRssBytes: Math.max(...rssSamples), requests }; results.push(result); console.log(mode, timing, retained);
    await context.close();
    } finally { if (sampler) clearInterval(sampler); await browser.close(); }
  }
  await Bun.write(`${out}/loads.json`, JSON.stringify({ conditions: 'Fresh headless Chromium processes, loopback HTTP; high is post-decode JS heap, RSS sums the process tree sampled every 50 ms (shared pages may be counted twice)', results }, null, 2));
} finally { await server.close(); }
