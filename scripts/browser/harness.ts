/** Playwright driver for the account-free harness page (`scripts/diagnostics/app.html`).
 *
 * One place for what every UI verification otherwise rediscovers: WebGPU needs a headed Chromium,
 * a free strict port per run, screenshots through CDP (`page.screenshot()` blurs a headed window and
 * cancels drags, ghosts and tooltips), a battle reached through the real dialog, a deadline on every
 * launch stage, and WebGPU validation errors that fail the run instead of scrolling past on the console.
 * See `docs/browser-verification.md`. */
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ViteDevServer } from 'vite';
import { chromium, type Browser, type Page } from 'playwright';
import { authoringServer, serverUrl } from '../construction/browser';
import { designsCacheStatus, STALE_DESIGNS_HOURS } from './designs';
import type { CameraPose } from './cameraPoses';
import type { CameraPin } from '../../src/game/Game';
import type {} from '../diagnostics/app';

export const ROOT = resolve(import.meta.dir, '../..');
export const HARNESS_PAGE = '/scripts/diagnostics/app.html';

/** Seconds each launch stage may take. On expiry the harness kills the browser and dev server it started and throws with the
 * stage and the page's latest errors. Generous on purpose: a cold Vite or a loaded machine is slow, not hung. */
export const DEADLINES = { server: 90, browser: 90, page: 180, ready: 300, close: 30 };
export type HarnessStage = keyof typeof DEADLINES;

/** WebGPU validation, WGSL and device failures. Dawn and three report them on the console, never as exceptions, so a shadow map
 * "used in a submit" after it was destroyed would otherwise ship unnoticed. Dawn's "… is unusual" notes are not errors. */
export const GPU_ERROR = /GPUValidationError|GPUOutOfMemoryError|GPUInternalError|Uncaptured WebGPU|used in a submit|\[Invalid \w+|Error while parsing WGSL|Tint WGSL reader|pipeline creation failed|Device Lost/i;

export interface HarnessOptions {
  /** Query parameters for the harness page, e.g. `{ battle: 'fletcher;;bismarck', range: 8000 }`. */
  params?: Record<string, string | number>;
  /** Another page to drive instead of the harness page, e.g. `/scripts/diagnostics/terrain-review.html`. It answers the
   * readiness polling through its own `window.review` (`ready`, `errors`, `stage`). */
  page?: string;
  /** Bill's display; representative for port, editor and HUD captures. */
  viewport?: { width: number; height: number };
  /** Headless Chromium reaches the port but its WebGPU frame loop stalls, so headed is the default. */
  headless?: boolean;
  /** Reuse a running dev server (`http://127.0.0.1:5200`) instead of starting one on a free port. */
  url?: string;
  /** Playwright's per-action timeout in ms (default 60 s): a stalled click fails in a minute instead of looking like a hang. */
  timeout?: number;
  /** Extra Chromium switches. */
  args?: string[];
  /** Launch stage deadlines in seconds, over `DEADLINES`. */
  deadlines?: Partial<Record<HarnessStage, number>>;
  /** Chromium without vsync or its frame-rate limit, so frames run past the display refresh; `measureFrameCost` needs it. */
  uncapped?: boolean;
  /** Off by default: the harness's own server pushes no hot updates or full reloads, and the page drops any a reused dev server
   * (`url`) sends, so a source edit during a run cannot restart the page (and a battle mid-ramp). `harness.reload()` picks
   * edits up. `true` restores Vite's hot updates, for a live session that should follow the source. */
  hmr?: boolean;
  /** Keep WebGPU errors out of `errors` (they stay in `gpuErrors`), for a GPU bug already known red. */
  allowGpuErrors?: boolean;
  /** Progress lines with elapsed seconds, to stderr by default; `false` silences them. */
  log?: false | ((line: string) => void);
}
export interface Harness {
  page: Page; browser: Browser; url: string;
  /** The current document's page errors, game errors and (unless `allowGpuErrors`) WebGPU errors; a reload starts a new list. */
  errors: string[];
  /** The current document's WebGPU validation, WGSL and device-lost messages. */
  gpuErrors: string[];
  /** Console errors and warnings from the first navigation on, across reloads. */
  console: string[];
  /** Wait until the page is in port, or in battle when `params.battle` is set, failing on page or WebGPU errors. */
  ready(seconds?: number): Promise<void>;
  /** Load the harness page afresh and wait until it is ready. Works while Vite is itself reloading the page after an edit. */
  reload(): Promise<void>;
  /** Close the browser and dev server, each within a deadline; a browser that does not close is killed. */
  close(): Promise<void>;
  /** Kill the browser this harness started, at once. */
  kill(): void;
}

/** What the page-level helpers (`designCheck`, `measureFrameCost`) need to know about the harness that owns a page. */
const owners = new WeakMap<Page, { gpuErrors: string[]; allowGpuErrors: boolean; uncapped: boolean }>();
const elapsed = (since: number) => ((performance.now() - since) / 1000).toFixed(1);
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function launchHarness(options: HarnessOptions = {}): Promise<Harness> {
  const started = performance.now(), deadlines = { ...DEADLINES, ...options.deadlines };
  const log = options.log ?? ((line: string) => console.error(line));
  const note = (line: string) => { if (log) log(`harness ${elapsed(started)} s: ${line}`); };
  const params = options.params ?? {}, battle = 'battle' in params, viewport = options.viewport ?? { width: 1728, height: 1030 };
  const errors: string[] = [], gpuErrors: string[] = [], messages: string[] = [];
  let server: ViteDevServer | undefined, browser: Browser | undefined, browserPid: number | undefined, stage: HarnessStage = 'server', pageStage = '';
  preflight(note);
  const cache = params.designs === 'none' ? undefined : designsCacheStatus(ROOT);
  if (cache) note(`saved designs cached ${cache.ageHours.toFixed(1)} h ago${cache.ageHours > STALE_DESIGNS_HOURS
    ? `: warning, older than ${STALE_DESIGNS_HOURS} h; \`bun run harness:designs\` fetches the latest revisions` : ''}`);
  const kill = () => { if (browserPid) killGroup(browserPid); };
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    if (browser) await within(browser.close(), deadlines.close, 'close').catch(() => { kill(); note(`the browser did not close in ${deadlines.close} s; killed it`); });
    if (!server) return;
    (server.httpServer as Server | null)?.closeAllConnections();
    await within(server.close(), 10, 'close').catch(() => note('the dev server did not close in 10 s; the process exit ends it'));
  })();
  try {
    if (!options.url) server = await within(authoringServer(ROOT, 0, options.hmr ? 'live' : true), deadlines.server, stage);
    const url = options.url ?? serverUrl(server!);
    if (server) note(`dev server at ${url}`);
    stage = 'browser';
    const before = new Set(childBrowsers());
    browser = await within(chromium.launch({ headless: options.headless ?? false, timeout: deadlines.browser * 1000,
      args: ['--enable-unsafe-webgpu', '--window-position=0,0', `--window-size=${viewport.width},${viewport.height + 90}`,
        ...options.uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [], ...options.args ?? []],
      ...(process.env.HARNESS_CHROME ? { executablePath: process.env.HARNESS_CHROME } : {}) }), deadlines.browser, stage);
    browserPid = childBrowsers().find(pid => !before.has(pid));
    note(`browser launched${browserPid ? ` (pid ${browserPid})` : ''}`);
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(options.timeout ?? 60_000);
    owners.set(page, { gpuErrors, allowGpuErrors: !!options.allowGpuErrors, uncapped: !!options.uncapped });
    // Errors belong to a document: a reload (Vite's after an edit included) starts clean instead of failing every later run.
    page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) { errors.length = 0; gpuErrors.length = 0; } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('crash', () => errors.push('The page crashed.'));
    page.on('console', message => {
      const type = message.type(), text = message.text();
      if (type !== 'error' && type !== 'warning') return;
      messages.push(`${type}: ${text}`); if (messages.length > 4000) messages.splice(0, 2000);
      if (!GPU_ERROR.test(text)) return;
      if (gpuErrors.length < 3) note(`WebGPU error: ${text.slice(0, 400)}`);
      gpuErrors.push(text); if (!options.allowGpuErrors) errors.push(`WebGPU: ${text}`);
    });
    // Our own server sends no file-change updates, but still the dependency optimizer's reload a cold first load may need;
    // a reused dev server sends both, so its page drops them.
    if (!options.hmr && options.url) await dropHotUpdates(page);
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
    const pageUrl = `${url}${options.page ?? HARNESS_PAGE}?${query}`;
    stage = 'page';
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: deadlines.page * 1000 });
    note('page loaded');
    const ready = (seconds = deadlines.ready) => awaitPage(page, battle ? 'inBattle' : 'ready', seconds, note,
      () => options.allowGpuErrors ? [] : gpuErrors.map(text => `WebGPU: ${text}`), value => { pageStage = value; });
    const reload = async () => {
      // Vite may already be reloading the page after an edit; a navigation it interrupts is tried once more.
      for (let attempt = 0; ; attempt++) try { await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: deadlines.page * 1000 }); break; }
      catch (error) { if (attempt || !/interrupt|not attached|detached|ERR_ABORTED|destroyed/i.test((error as Error).message)) throw error; await sleep(1000); }
      await ready();
    };
    stage = 'ready';
    await ready();
    note(battle ? 'in battle' : 'in port');
    return { page, browser, url, errors, gpuErrors, console: messages, ready, reload, close, kill };
  } catch (error) {
    const message = (error as Error).message, where = pageStage && !message.includes(pageStage) ? ` (the page was at: ${pageStage})` : '';
    const report = [`Harness: the ${stage} stage failed after ${elapsed(started)} s${where}: ${message}`,
      ...latest('Page errors', errors), ...latest('Console errors', messages.filter(line => line.startsWith('error')))];
    await close();
    throw new Error(report.join('\n'));
  }
}

/** `launchHarness`, then `work`, then a bounded close, then the process exits: 0, or 1 when anything threw or the page recorded
 * errors. Finished scripts otherwise linger for hours on a dev server or browser that will not close. `deadline` (seconds, default
 * 900; `Infinity` for a server) bounds the whole run: past it the browser is killed and the process exits 1, whatever `work` is
 * waiting on. `exit: false` returns (or rethrows) after the close instead of exiting. */
export async function withHarness<T>(options: HarnessOptions & { deadline?: number; exit?: boolean }, work: (harness: Harness) => Promise<T>): Promise<T> {
  const deadline = options.deadline ?? 900;
  let harness: Harness | undefined, failure: unknown, result: T | undefined;
  const timer = Number.isFinite(deadline) ? setTimeout(() => {
    console.error(`harness: the run passed its ${deadline} s deadline; killing its browser and exiting.`, ...latest('Page errors', harness?.errors ?? []));
    harness?.kill(); process.exit(1);
  }, deadline * 1000) : undefined;
  try {
    harness = await launchHarness(options);
    result = await work(harness);
    if (harness.errors.length) failure = new Error(`Page errors:\n${harness.errors.join('\n')}`);
  } catch (error) { failure = error; }
  await harness?.close();
  clearTimeout(timer);
  if (options.exit === false) { if (failure) throw failure; return result!; }
  if (failure) console.error(failure instanceof Error ? failure.message : failure);
  process.exit(failure ? 1 : 0);
}

/** Poll the page until `review[key]`, printing what it is doing every 15 s, and fail on its errors or on `failures()`. */
async function awaitPage(page: Page, key: 'ready' | 'inBattle', seconds: number, note: (line: string) => void, failures: () => string[], seen: (stage: string) => void): Promise<void> {
  const started = performance.now(), until = started + seconds * 1000, label = key === 'ready' ? 'the port' : 'the battle';
  let heard = started, stage = '';
  for (;;) {
    const failed = failures();
    if (failed.length) throw new Error(failed.join('\n'));
    // A page busy compiling pipelines answers late; that is reported, not waited on.
    const status = await Promise.race([sleep(5000).then(() => 'busy' as const),
      page.evaluate(key => { const review = window.review; return review ? { done: !!review[key], errors: review.errors, stage: review.stage } : null; }, key).catch(() => null)]);
    if (status && status !== 'busy') {
      if (status.errors.length) throw new Error(status.errors.join('\n'));
      if (status.done) return;
      if (status.stage !== stage) seen(stage = status.stage);
    }
    if (performance.now() > until) throw new Error(`${label} was not ready within ${seconds} s${stage ? `; the page was at: ${stage}` : ''}.`);
    if (performance.now() - heard > 15_000) { heard = performance.now(); note(`waiting for ${label}: ${status === 'busy' ? 'the page is busy and not answering' : stage || 'loading'}`); }
    await sleep(250);
  }
}

function within<T>(work: Promise<T>, seconds: number, stage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${stage} did not finish within ${seconds} s`)), seconds * 1000); });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}
const latest = (title: string, lines: readonly string[]) => lines.length ? [`${title} (latest ${Math.min(lines.length, 10)} of ${lines.length}):`, ...lines.slice(-10).map(line => `  ${line.slice(0, 600)}`)] : [];

/** Vite's HMR socket without its updates and full reloads: the page keeps running whatever changes on disk. */
async function dropHotUpdates(page: Page): Promise<void> {
  await page.routeWebSocket(/[?&]token=/, socket => {
    const server = socket.connectToServer();
    server.onMessage(message => { if (typeof message !== 'string' || !/"type":\s*"(update|full-reload|prune)"/.test(message)) socket.send(message); });
  });
}

interface ProcessRow { pid: number; ppid: number; elapsed: string; command: string }
function processTable(): ProcessRow[] {
  try {
    return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,etime=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').flatMap(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), elapsed: match[3], command: match[4] }] : [];
    });
  } catch { return []; }
}
/** A test browser's main process (Chrome for Testing, the headless shell, Chromium), not one of its helpers. */
const isTestBrowser = (command: string) => /(Chrome for Testing|chrome-headless-shell|\/chrom(e|ium))( --|$)/.test(command) && !command.includes('--type=');
const childBrowsers = () => processTable().filter(row => row.ppid === process.pid && isTestBrowser(row.command)).map(row => row.pid);
/** Playwright starts each browser as a process group leader, so the group takes its GPU and renderer helpers with it. */
function killGroup(pid: number): void {
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}
/** Other sessions' test browsers share the GPU: frame timings swing 20–90 ms and launches slow down while they draw. Said, never killed. */
function preflight(note: (line: string) => void): void {
  const table = processTable(), byPid = new Map(table.map(row => [row.pid, row]));
  const others = table.filter(row => isTestBrowser(row.command) && row.ppid !== process.pid);
  if (!others.length) return;
  note(`warning: ${others.length} other test browser${others.length > 1 ? 's are' : ' is'} running; frame timings swing 20-90 ms and launches slow down while they draw.`);
  for (const row of others.slice(0, 6)) {
    const parent = byPid.get(row.ppid);
    note(`  pid ${row.pid}, up ${row.elapsed}, ${row.ppid === 1 || !parent ? 'orphaned' : `from pid ${parent.pid}: ${parent.command.slice(0, 140)}`}`);
  }
}

/** PNG through CDP, which leaves window focus (and so drags, ghosts, tooltips and the running battle) alone. */
export async function shot(page: Page, path: string): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = resolve(ROOT, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  } finally { await cdp.detach(); }
}

/** Seeded designs with their battle ids, as the page reports them. */
export const designs = (page: Page) => page.evaluate(() => window.review.designs);

/** Berth a saved design, or a preset by its fleet-line name ("HMS King George V"), in port. */
export async function berth(page: Page, name: string): Promise<void> {
  const tab = page.locator(`nav[aria-label="Fleet line"] button[aria-label="${name}"]`);
  if (await tab.count()) await tab.first().click();
  else { await page.getByRole('button', { name: 'Open all designs' }).click(); await page.getByRole('button', { name: `View ${name} in port` }).click(); }
  // Historical presets are titled in capitals (`shipTitle`), so match the berthed name without case.
  await page.locator(`section.port-identity[aria-label="${name}" i]`).waitFor();
}

/** Open a saved design in the ship editor and wait for its viewport. */
export async function openEditor(page: Page, name: string): Promise<void> {
  // A draft that does not compile has no berth; the plan chest still opens it.
  if (await page.evaluate(wanted => window.review.designs.some(design => design.name === wanted && !design.shipId), name)) {
    await page.getByRole('button', { name: 'Open all designs' }).click(); await page.getByRole('button', { name: `Edit ${name}` }).click();
  } else { await berth(page, name); await page.getByRole('button', { name: /edit design/i }).first().click(); }
  await page.locator('.shipbuilder canvas').first().waitFor();
}

/** Advance real time while the battle runs; the simulation is not stepped by hand here. */
export const settle = (page: Page, seconds: number) => page.waitForTimeout(seconds * 1000);

/** Hold the game camera on a hull (a preset such as `bowQuarter`, an eye and target, or an orbit; see `cameraPoses.ts`), or
 * give it back to the rig with no pose. Resolves once the camera stands there, with the pin it holds. */
export async function placeCamera(page: Page, pose?: CameraPose): Promise<CameraPin | undefined> {
  return page.evaluate(async pose => { const pin = window.review.placeCamera(pose); await window.review.settle(); return pin; }, pose);
}
/** Hold the berth's ride, the sea, clouds, smoke and battle at `time` seconds of sea after a `history`-second replay, so two runs
 * (master and a branch) render the same frame; `false` releases them. Place the camera first: smoke detail follows it. */
export async function freezeScene(page: Page, options: { time?: number; history?: number } | false = {}): Promise<void> {
  await page.evaluate(async options => { await window.review.freezeScene(options); await window.review.settle(); }, options);
}
/** Wait until no camera glide, zoom or orbit is easing (an optics glide takes about 0.42 s), then `frames` rendered frames. */
export const settleCamera = (page: Page, frames = 4) => page.evaluate(frames => window.review.settle({ frames }), frames);
/** Show or hide everything drawn over the 3D view: instruments, port panels, labels and the torpedo sheets on the sea. */
export const setHud = (page: Page, visible: boolean) => page.evaluate(visible => window.review.setHud(visible), visible);
/** Resize the page's viewport and wait until the game has drawn at the new size, to capture several sizes in one session. */
export async function resize(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.evaluate(async () => { for (let i = 0; i < 3; i++) await window.review.game?.nextFrame(); });
}

export interface FrameCost {
  /** Median frame interval with the feature on and off, and the median of the paired differences, in ms. */
  onMs: number; offMs: number; deltaMs: number;
  /** Interquartile range of the paired differences: a cost inside it is not resolved. */
  spreadMs: [number, number];
  rounds: number;
  /** Set when the frames could be held to the display refresh, which hides any difference below it. */
  warning?: string;
}

/** What `toggle` costs a frame, measured the one way that holds up on a shared Apple GPU: flip the feature every `flipSeconds`
 * over `rounds` on-off pairs (alternating which goes first, so a steady drift in load cancels) and compare median
 * requestAnimationFrame intervals, pair by pair. Launch with `uncapped: true`, or vsync quantizes every frame to the refresh.
 * `toggle(on)` runs in the page (`window.review` in reach) and must not close over anything in the script; it ends on. WebGPU
 * timestamps do not work here: `trackTimestamp` stalls the pipeline to about 9 fps, a single awaited frame overstates the cost
 * because the GPU clocks down between awaits, and timestamps summed over a batch overlap into impossible totals. */
export async function measureFrameCost(page: Page, toggle: (on: boolean) => unknown, options: { rounds?: number; flipSeconds?: number; discardFrames?: number } = {}): Promise<FrameCost> {
  const { rounds = 20, flipSeconds = .6, discardFrames = 5 } = options;
  const result = await page.evaluate(async ({ source, rounds, flipMs, discardFrames }) => {
    const toggle = (0, eval)(`(${source})`) as (on: boolean) => unknown;
    const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const sample = async (on: boolean) => {
      await toggle(on);
      for (let i = 0; i < discardFrames; i++) await frame();
      const intervals: number[] = [];
      for (let last = await frame(), end = last + flipMs; last < end;) { const now = await frame(); intervals.push(now - last); last = now; }
      return median(intervals);
    };
    const pairs: [number, number][] = [];
    for (let round = 0; round < rounds; round++) {
      const onFirst = round % 2 === 0, first = await sample(onFirst), second = await sample(!onFirst);
      pairs.push(onFirst ? [first, second] : [second, first]);
    }
    await toggle(true);
    return pairs;
  }, { source: toggle.toString(), rounds, flipMs: flipSeconds * 1000, discardFrames });
  const sorted = (values: number[]) => [...values].sort((a, b) => a - b), quantile = (values: number[], q: number) => sorted(values)[Math.floor((values.length - 1) * q)];
  const deltas = result.map(([on, off]) => on - off), offMs = quantile(result.map(pair => pair[1]), .5);
  const ms = (value: number) => Math.round(value * 100) / 100;
  const cost: FrameCost = { onMs: ms(quantile(result.map(pair => pair[0]), .5)), offMs: ms(offMs), deltaMs: ms(quantile(deltas, .5)),
    spreadMs: [ms(quantile(deltas, .25)), ms(quantile(deltas, .75))], rounds };
  if (!owners.get(page)?.uncapped) cost.warning = 'launched without `uncapped: true`: vsync holds frames to the display refresh and hides costs below it.';
  else if ([1000 / 60, 1000 / 120].some(refresh => Math.abs(offMs - refresh) < .15)) cost.warning = `frames run at the display refresh (${offMs.toFixed(2)} ms): the switches did not take.`;
  return cost;
}

export interface DesignCheck {
  /** The chip's own words: `No warnings`, `2 warnings`, `1 block · 2 warnings`, prefixed `Draft · ` before the first compile. */
  status: string;
  blocks: number;
  warnings: number;
  findings: string[];
  /** The ledger as it reads on screen: `Displacement` → `38,280 t`. */
  ledger: Record<string, string>;
}

/** Wait for the editor's in-browser design check to finish, then read what it decided.
 *
 * The ledger heading carries a `pending`/`last check` badge for exactly as long as there is no
 * current compiled result, so its absence is the settled signal every shipbuilder browser check
 * already uses. On the dev WASM build a first check takes about 30 s. The checks panel is opened to
 * read the findings and closed again, so a capture afterwards shows the editor as it was. A WebGPU
 * error on the page fails the check. */
export async function designCheck(page: Page, timeoutMs = 120_000): Promise<DesignCheck> {
  await page.waitForFunction(() => !document.querySelector('.sb-ledger h4 span'), undefined, { polling: 250, timeout: timeoutMs });
  const chip = page.locator('.sb-warn .lead');
  const status = (await chip.innerText()).replace(/\s*W\s*$/, '').trim();
  const wasOpen = (await chip.getAttribute('aria-expanded')) === 'true';
  if (!wasOpen) await chip.click();
  const panel = await page.evaluate(() => ({
    blocks: document.querySelectorAll('.sb-checks .rows button.row .sb-dot.block').length,
    warnings: document.querySelectorAll('.sb-checks .rows button.row .sb-dot.warn').length,
    findings: [...document.querySelectorAll('.sb-checks .rows button.row span')].map(node => (node.textContent ?? '').trim()).filter(Boolean),
  }));
  if (!wasOpen) await chip.click();
  const ledger = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('.sb-ledger > .row')].map(row => [row.querySelector('span')?.textContent ?? '', row.querySelector('b')?.textContent ?? ''])));
  const owner = owners.get(page);
  if (owner && !owner.allowGpuErrors && owner.gpuErrors.length) throw new Error(`WebGPU errors during the design check:\n${owner.gpuErrors.slice(-10).join('\n')}`);
  return { status, ...panel, ledger };
}
