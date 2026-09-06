/** Isolated, real WebGPU browser integration test; no desktop focus or user profile. */
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = process.argv[2] ?? 'http://127.0.0.1:5297';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Pass the local Vite origin');
const chrome = process.env.CONVOY_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'convoy-headless-'));
const portOnly = process.argv.includes('--port-only');
const folder = new URL(`./reports/${portOnly ? 'browser-port' : 'browser'}/`, import.meta.url);
const ids = ['flower-corvette', 'liberty-cargo', 'liberty-collier', 'victory-cargo'];
const publishedHash = async (id: string) => (await Bun.file(new URL(`../../../public/models/${id}.json`, import.meta.url)).json()).contentHash as string;
const presetHashes = Object.fromEntries(await Promise.all(ids.map(async id => [id, await publishedHash(id)])));
const startedAt = new Date().toISOString();
await mkdir(folder, { recursive: true });
const streamedCaptures = new Set<string>();
async function saveCapture(capture: { label: string; data: string }) {
  if (!/^[a-z0-9-]+$/.test(capture.label) || !capture.data.startsWith('data:image/jpeg;base64,')) throw new Error('Invalid review capture');
  await Bun.write(new URL(capture.label + '.jpg', folder), Buffer.from(capture.data.split(',')[1], 'base64'));
  streamedCaptures.add(capture.label);
}
const token = crypto.randomUUID();
let finish!: (value: any) => void;
const completed = new Promise<any>(resolve => { finish = resolve; });
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, maxRequestBodySize: 50 * 1024 * 1024,
  async fetch(request) {
    if (request.headers.get('origin') !== origin || new URL(request.url).searchParams.get('token') !== token) return new Response('Forbidden', { status: 403 });
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers });
    const payload = await request.json();
    if (new URL(request.url).pathname === '/capture') await saveCapture(payload);
    else if (new URL(request.url).pathname === '/progress') console.log(payload.label);
    else finish(payload);
    return new Response('Recorded', { headers });
  },
});
const resultUrl = `http://127.0.0.1:${server.port}/result?token=${token}`;
const url = `${origin}/assets/ships/convoy/review-browser.html?ship=flower-corvette&result=${encodeURIComponent(resultUrl)}${portOnly ? '&portOnly=1' : ''}`;
const browser = Bun.spawn([chrome, '--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--window-size=1440,1000', url], { stdout: 'ignore', stderr: 'pipe' });
// Drain diagnostics without overflowing the terminal with Chromium platform noise.
const browserLog = new Response(browser.stderr).text();
console.log('Reviewing port, articulation and battles in an isolated Chrome WebGPU process…');
let timeout: ReturnType<typeof setTimeout>;
try {
  const result = await Promise.race([completed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Browser review exceeded 300 seconds')), 300000); })]);
  if (result.error) throw new Error(result.error + '\n' + result.stack);
  for (const id of ids) if (await publishedHash(id) !== presetHashes[id]) throw new Error(`${id} changed during the browser review; repeat against stable outputs`);
  await mkdir(folder, { recursive: true });
  for (const capture of result.captures) {
    if (!capture.data && streamedCaptures.has(capture.label)) continue;
    await saveCapture(capture);
  }
  await Bun.write(new URL('port-review.json', folder), JSON.stringify(result.report, null, 2) + '\n');
  if (result.battles) await Bun.write(new URL('battle-review.json', folder), JSON.stringify(result.battles, null, 2) + '\n');
  await Bun.write(new URL('run.json', folder), JSON.stringify({ startedAt, completedAt: new Date().toISOString(), engine: 'Chrome headless / real WebGPU', origin, presetHashes, captures: result.captures.length, portCases: result.report.length, battleCases: result.battles?.length, result: 'passed' }, null, 2) + '\n');
  console.log(JSON.stringify({ port: result.report.map((r: any) => ({ id: r.id, articulation: r.articulation, isolatedVolume: r.isolatedVolume })), battles: result.battles?.map((b: any) => ({ id: b.id, mixed: b.mixed, tick: b.active.tick, fleet: b.active.fleet.map((a: any, i: number) => ({ id: a.id, ship: a.definitionId, speed: a.motion.speed, roundsFired: b.initial.fleet[i].ammo - a.ammo })), impactMarks: b.active.renderedShips, maxMuzzleErrorM: b.active.maxMuzzleErrorM, resetTick: b.reset.tick })), captures: result.captures.length }, null, 2));
} finally {
  clearTimeout(timeout!); browser.kill(); server.stop(true);
  await browser.exited;
  const log = await browserLog;
  const errors = log.split('\n').filter(line => /Validation Error|Device.*lost|ERROR.*gpu/.test(line));
  if (errors.length) console.error(errors.slice(-10).join('\n'));
  console.log('Dedicated browser stopped; temporary profile: ' + profile);
}
