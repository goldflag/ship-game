import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireLock, readCatalog } from './files';
import { CompilerProcess, compilerBinaryIdentity, freshCompilerBinary } from './compiler';

/** Warm authoring session: one loopback daemon per worktree keeping a native compiler process, a review
 * server and a Chromium alive. Every client call degrades to the cold path; none waits on a dead daemon. */
export const SESSION_VERSION = 1;
export interface SessionRecord { version: number; pid: number; port: number; token: string; root: string; startedAt: number; idleTimeoutMs: number; fingerprint: string }
export interface SessionStatus {
  version: number; pid: number; root: string; startedAt: number; idleTimeoutMs: number; idleMs: number; fingerprint: string;
  compiler: { requests: number; reusedGeometryOperations: number; restarts: number };
  browser: { state: 'disabled' | 'idle' | 'starting' | 'ready' | 'failed'; requests: number; waiting: number; leased: boolean; error?: string };
}
/** A review page the daemon holds for one lease, already composed from that lease's input. */
export interface SessionPage { evaluate(expression: string, isFunction: boolean, arg: unknown): Promise<unknown>; close(): Promise<void> }
export interface SessionBrowser { open(lease: string): Promise<SessionPage> }
/** What the daemon keeps warm. Tests substitute fakes; `nativeServices` is the real set. */
export interface SessionServices {
  /** Exact compiler output, or `undefined` when the warm compiler cannot vouch for it and the client must compile cold. */
  compile(request: { source: string; catalogRevision: string; parts?: string[] }): Promise<{ result: string; reused: number } | undefined>;
  /** `inputs` maps a lease to the review input the page of that lease loads. */
  browser?(inputs: Map<string, string>): Promise<SessionBrowser>;
  compilerRestarts?(): number;
  close(): Promise<void>;
}
/** Bun cannot attach Playwright to a remote Chromium, so the daemon keeps the page and the client forwards
 * `page.evaluate`, the one Page method the review contract uses. Any other member throws rather than misbehave. */
export interface BrowserLease { page: import('playwright').Page; release(): Promise<void> }

export const sessionPath = (root: string) => join(root, '.build/construction/session.json');
export const sessionLogPath = (root: string) => join(root, '.build/construction/session.log');
const DAEMON_SOURCES = ['scripts/construction/session.ts', 'scripts/construction/session-daemon.ts', 'scripts/construction/compiler.ts', 'scripts/construction/browser.ts', 'scripts/construction/server.ts', 'scripts/construction/files.ts', 'package.json', 'bun.lock'];
/** Identity of the code a daemon runs. A daemon started from other code is stale: clients ignore it and it exits.
 * Rust inputs are not part of it; the daemon checks those before every compile and restarts only its compiler. */
export async function sessionFingerprint(root: string): Promise<string> {
  const parts = await Promise.all(DAEMON_SOURCES.map(path => stat(join(root, path)).then(s => path + ':' + s.mtimeMs + ':' + s.size, () => path + ':absent')));
  return createHash('sha256').update([SESSION_VERSION, process.versions.bun ?? process.version, ...parts].join('\n')).digest('hex').slice(0, 32);
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };
export async function readSession(root: string): Promise<SessionRecord | undefined> {
  const record = await readFile(sessionPath(root), 'utf8').then(text => JSON.parse(text) as SessionRecord).catch(() => undefined);
  return record && typeof record.port === 'number' && typeof record.token === 'string' && typeof record.pid === 'number' ? record : undefined;
}
const call = (record: SessionRecord, path: string, init: RequestInit & { timeoutMs: number }) =>
  fetch('http://127.0.0.1:' + record.port + path, { ...init, headers: { ...init.headers, authorization: 'Bearer ' + record.token }, signal: AbortSignal.timeout(init.timeoutMs) });
export type SessionProbe = { live: true; record: SessionRecord; status: SessionStatus } | { live: false; reason: string; record?: SessionRecord };
/** Why a session is or is not usable. Bounded by `timeoutMs`; never throws. */
export async function probeSession(root: string, timeoutMs = 500): Promise<SessionProbe> {
  const record = await readSession(root);
  if (!record) return { live: false, reason: 'No session file.' };
  if (record.version !== SESSION_VERSION) return { live: false, reason: 'Session protocol version differs.', record };
  if (record.root !== root) return { live: false, reason: 'Session file belongs to another worktree.', record };
  if (!alive(record.pid)) return { live: false, reason: 'Session process is gone.', record };
  if (record.fingerprint !== await sessionFingerprint(root)) return { live: false, reason: 'Session was started from different daemon sources.', record };
  try {
    const response = await call(record, '/status', { timeoutMs });
    if (!response.ok) return { live: false, reason: 'Session refused its token.', record };
    const status = await response.json() as SessionStatus;
    if (status.pid !== record.pid || status.fingerprint !== record.fingerprint) return { live: false, reason: 'Another process answers on the session port.', record };
    return { live: true, record, status };
  } catch { return { live: false, reason: 'Session did not answer within ' + timeoutMs + ' ms.', record }; }
}
export async function liveSession(root: string, timeoutMs = 500): Promise<SessionRecord | undefined> {
  if (process.env.CONSTRUCTION_SESSION === 'off') return undefined;
  const probe = await probeSession(root, timeoutMs);
  return probe.live ? probe.record : undefined;
}
/** Exact compiler output from the warm compiler, or `undefined` for every reason to compile cold instead. */
export async function sessionCompile(root: string, source: string, catalogRevision: string, parts?: string[]): Promise<string | undefined> {
  const record = await liveSession(root);
  if (!record) return undefined;
  try {
    const response = await call(record, '/compile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source, catalogRevision, parts }), timeoutMs: 660_000 });
    // Compile failures are reproduced cold, so their message never depends on the path.
    return response.ok ? await response.text() : undefined;
  } catch { return undefined; }
}
/** Exclusive use of the warm Chromium with the review model of `input` (review input JSON) composed, or `undefined` to render cold.
 * Arguments and results of `evaluate` cross as JSON; `undefined` results survive, other non-JSON values do not. */
export async function sessionBrowser(root: string, input: string): Promise<BrowserLease | undefined> {
  const record = await liveSession(root);
  if (!record) return undefined;
  try {
    const response = await call(record, '/browser/acquire?pid=' + process.pid, { method: 'POST', headers: { 'content-type': 'application/json' }, body: input, timeoutMs: 900_000 });
    if (!response.ok) return undefined;
    const { lease } = await response.json() as { lease: string };
    const evaluate = async (work: unknown, arg?: unknown) => {
      const reply = await call(record, '/browser/evaluate?lease=' + lease, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expression: String(work), isFunction: typeof work === 'function', arg }), timeoutMs: 1_800_000 });
      const answer = await reply.json() as { value?: unknown; error?: string };
      if (!reply.ok) throw new Error(answer.error ?? 'Session page evaluation failed.');
      return answer.value;
    };
    const page = new Proxy({}, { get(_, key) {
      if (key === 'evaluate') return evaluate;
      if (key === 'then' || typeof key === 'symbol') return undefined;
      throw new Error('A warm session page supports page.evaluate only, not page.' + key + '. Run with CONSTRUCTION_SESSION=off, or extend scripts/construction/session.ts.');
    } }) as import('playwright').Page;
    return { page, release: async () => { await call(record, '/browser/release?lease=' + lease, { method: 'POST', timeoutMs: 5_000 }).catch(() => {}); } };
  } catch { return undefined; }
}

export interface SessionServerOptions {
  root: string; services: SessionServices; idleTimeoutMs?: number; browser?: boolean;
  /** A lease whose holder died, or older than this, is revoked. */
  leaseTimeoutMs?: number; sweepMs?: number; fingerprint?: () => Promise<string>; writeRecord?: boolean;
}
export interface RunningSession { record: SessionRecord; status(): SessionStatus; close(reason?: string): Promise<void>; closed: Promise<string> }
/** The daemon without its process: loopback HTTP, bearer token, serialised compiler, one browser lease at a time. */
export async function createSessionServer(options: SessionServerOptions): Promise<RunningSession> {
  const { root, services } = options, idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60_000, leaseTimeoutMs = options.leaseTimeoutMs ?? 20 * 60_000;
  const fingerprintNow = options.fingerprint ?? (() => sessionFingerprint(root)), fingerprint = await fingerprintNow();
  const token = randomBytes(24).toString('hex'), startedAt = Date.now(), inputs = new Map<string, string>();
  let lastActivity = Date.now(), inflight = 0, compileRequests = 0, reused = 0, browserRequests = 0;
  let browserState: SessionStatus['browser']['state'] = options.browser === false || !services.browser ? 'disabled' : 'idle', browserError: string | undefined;
  let endpoint: Promise<SessionBrowser> | undefined;
  let compiling: Promise<unknown> = Promise.resolve();
  let lease: { id: string; pid: number; at: number; page?: SessionPage } | undefined;
  const waiting: { pid: number; grant(): void; cancelled: boolean }[] = [];
  let finish!: (reason: string) => void; const closed = new Promise<string>(resolve => { finish = resolve; });
  const status = (): SessionStatus => ({
    version: SESSION_VERSION, pid: process.pid, root, startedAt, idleTimeoutMs, idleMs: Date.now() - lastActivity, fingerprint,
    compiler: { requests: compileRequests, reusedGeometryOperations: reused, restarts: services.compilerRestarts?.() ?? 0 },
    browser: { state: browserState, requests: browserRequests, waiting: waiting.length, leased: !!lease, ...(browserError ? { error: browserError } : {}) },
  });
  const startBrowser = () => {
    if (browserState === 'disabled') return undefined;
    if (!endpoint) {
      browserState = 'starting';
      endpoint = services.browser!(inputs).then(value => { browserState = 'ready'; browserError = undefined; return value; });
      // A failed start is retried by the next request rather than remembered forever.
      endpoint.catch(error => { browserState = 'failed'; browserError = String(error?.message ?? error).slice(0, 500); endpoint = undefined; });
    }
    return endpoint;
  };
  const releaseLease = (id: string) => {
    if (lease?.id !== id) return;
    void lease.page?.close().catch(() => {});
    inputs.delete(id); lease = undefined; lastActivity = Date.now();
    let next; while ((next = waiting.shift())) if (!next.cancelled) { next.grant(); break; }
  };
  const body = async (request: IncomingMessage, limit: number) => {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Request body exceeds its limit.'), { status: 413 }); chunks.push(chunk); }
    return Buffer.concat(chunks).toString();
  };
  const expected = Buffer.from('Bearer ' + token);
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const send = (code: number, value: unknown, headers: Record<string, string> = {}) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      response.writeHead(code, { 'content-type': typeof value === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', ...headers }); response.end(text);
    };
    const given = Buffer.from(request.headers.authorization ?? '');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.host ?? '')) return send(403, { error: 'Sessions accept loopback connections only.' });
    // Browsers attach an Origin; no page may drive the session.
    if (request.headers.origin) return send(403, { error: 'Sessions do not accept browser requests.' });
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return send(401, { error: 'Session token required.' });
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/status') return send(200, status());
    if (request.method !== 'POST') return send(404, { error: 'Unknown session endpoint.' });
    lastActivity = Date.now(); inflight++;
    try {
      if (url.pathname === '/stop') { send(200, { stopped: true }); void close('Stopped by request.'); return; }
      if (url.pathname === '/compile') {
        const input = JSON.parse(await body(request, 40 * 1024 * 1024)) as { source: string; catalogRevision: string; parts?: string[] };
        if (typeof input.source !== 'string' || typeof input.catalogRevision !== 'string' || (input.parts && !Array.isArray(input.parts))) return send(400, { error: 'Expected source text, catalogRevision and optional parts.' });
        compileRequests++;
        // One compile at a time, whatever the services do: the compiler process answers in request order.
        const turn = compiling.then(() => services.compile(input)).catch(error => ({ error: String(error?.message ?? error) }));
        compiling = turn;
        const answer = await turn;
        if (!answer) return send(503, { error: 'Warm compiler unavailable.', fallback: true });
        if ('error' in answer) return send(422, { error: answer.error, fallback: true });
        reused += answer.reused;
        return send(200, answer.result, { 'x-construction-reused': String(answer.reused) });
      }
      if (url.pathname === '/browser/acquire') {
        const started = startBrowser();
        if (!started) return send(503, { error: 'Session runs without a browser.', fallback: true });
        const input = await body(request, 512 * 1024 * 1024), pid = Number(url.searchParams.get('pid'));
        if (!Number.isInteger(pid) || pid <= 0) return send(400, { error: 'Expected the client pid.' });
        const ready = await started.catch(() => undefined);
        if (!ready) return send(503, { error: browserError ?? 'Browser failed to start.', fallback: true });
        // Renders never interleave: one software-GL Chromium gives each request the whole renderer.
        if (lease) {
          const entry = { pid, grant: () => {}, cancelled: false };
          const granted = new Promise<void>(resolve => { entry.grant = resolve; });
          waiting.push(entry); request.socket.once('close', () => { entry.cancelled = true; entry.grant(); });
          await granted;
          if (entry.cancelled) return;
        }
        const id = randomBytes(12).toString('hex');
        const held = lease = { id, pid, at: Date.now() } as NonNullable<typeof lease>; inputs.set(id, input); browserRequests++;
        try { held.page = await ready.open(id); } catch (error) {
          // The cold path reproduces a genuine page failure with its own message.
          releaseLease(id); return send(503, { error: String((error as Error)?.message ?? error), fallback: true });
        }
        if (lease !== held) { void held.page.close().catch(() => {}); return send(503, { error: 'Lease was revoked while its page loaded.', fallback: true }); }
        return send(200, { lease: id });
      }
      if (url.pathname === '/browser/evaluate') {
        const held = lease?.id === url.searchParams.get('lease') ? lease : undefined;
        if (!held?.page) return send(410, { error: 'Session browser lease is gone.' });
        const input = JSON.parse(await body(request, 512 * 1024 * 1024)) as { expression: string; isFunction: boolean; arg?: unknown };
        held.at = Date.now();
        try { return send(200, { value: await held.page.evaluate(String(input.expression), !!input.isFunction, input.arg) }); }
        catch (error) { return send(422, { error: String((error as Error)?.message ?? error) }); }
      }
      if (url.pathname === '/browser/release') { releaseLease(url.searchParams.get('lease') ?? ''); return send(200, { released: true }); }
      return send(404, { error: 'Unknown session endpoint.' });
    } catch (cause) {
      const error = cause as Error & { status?: number };
      if (!response.headersSent) send(error.status ?? 400, { error: error.message });
    } finally { inflight--; lastActivity = Date.now(); }
  };
  const server: Server = createServer((request, response) => { void handle(request, response); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const record: SessionRecord = { version: SESSION_VERSION, pid: process.pid, port: (server.address() as { port: number }).port, token, root, startedAt, idleTimeoutMs, fingerprint };
  let closing: Promise<void> | undefined;
  const close = (reason = 'Closed.') => closing ??= (async () => {
    clearInterval(sweep);
    for (const entry of waiting.splice(0)) { entry.cancelled = true; entry.grant(); }
    if (options.writeRecord !== false) {
      const current = await readSession(root);
      if (current?.token === token) await rm(sessionPath(root), { force: true });
    }
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await services.close().catch(() => {});
    finish(reason);
  })();
  const sweep = setInterval(async () => {
    if (lease && (!alive(lease.pid) || Date.now() - lease.at > leaseTimeoutMs)) releaseLease(lease.id);
    if (lease || inflight) lastActivity = Date.now();
    if (Date.now() - lastActivity > idleTimeoutMs) return void close('Idle timeout.');
    if (await fingerprintNow().catch(() => fingerprint) !== fingerprint) void close('Daemon sources changed.');
  }, options.sweepMs ?? 2_000);
  if (options.writeRecord !== false) {
    await mkdir(join(root, '.build/construction'), { recursive: true });
    const temporary = sessionPath(root) + '.' + token.slice(0, 8) + '.tmp';
    await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 }); await chmod(temporary, 0o600);
    await rename(temporary, sessionPath(root));
  }
  if (browserState !== 'disabled') startBrowser();
  return { record, status, close, closed };
}

/** The real warm services: `compile_construction --serve` and, on first use, a review server plus Chromium. */
export function nativeServices(root: string): SessionServices {
  let compiler: { process: CompilerProcess; identity: string } | undefined, restarts = -1;
  let queue: Promise<unknown> = Promise.resolve();
  const catalogs = new Map<string, string>();
  let closeBrowser: (() => Promise<void>) | undefined;
  return {
    compilerRestarts: () => Math.max(restarts, 0),
    compile(request) {
      // The freshness check and the request form one step, so a rebuild never kills a compile in flight.
      const next = queue.then(async () => {
        const binary = await freshCompilerBinary(root);
        if (!binary) return undefined;
        const identity = await compilerBinaryIdentity(binary);
        if (!compiler || compiler.process.closed || compiler.identity !== identity) { compiler?.process.close(); compiler = { process: new CompilerProcess(binary, root), identity }; restarts++; }
        // Catalog revisions are immutable. The text matches the cold path's catalog.json byte for byte.
        let catalog = catalogs.get(request.catalogRevision);
        if (!catalog) { catalog = JSON.stringify(await readCatalog(root, request.catalogRevision)); if (catalogs.size >= 4) catalogs.clear(); catalogs.set(request.catalogRevision, catalog); }
        return compiler.process.request({ source: request.source, catalog, ...(request.parts ? { parts: JSON.stringify(request.parts) } : {}) });
      });
      queue = next.catch(() => {});
      return next;
    },
    async browser(inputs) {
      const { authoringServer, serverUrl, openReviewPage, CHROMIUM_LAUNCH } = await import('./browser');
      const { chromium } = await import('playwright');
      const vite = await authoringServer(root, 0, false, url => inputs.get(url.searchParams.get('lease') ?? ''));
      const chrome = await chromium.launch(CHROMIUM_LAUNCH()).catch(async error => { await vite.close(); throw error; });
      closeBrowser = async () => { await chrome.close().catch(() => {}); (vite.httpServer as Server | null)?.closeAllConnections(); await vite.close(); };
      // Transform and dependency caches fill once here instead of inside the first request.
      const warm = await chrome.newContext();
      try { const page = await warm.newPage(); await page.goto(serverUrl(vite) + '/tools/construction/review.html', { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForFunction(() => !!window.constructionReviewModule, undefined, { timeout: 120_000 }); }
      finally { await warm.close(); }
      return {
        async open(lease) {
          if (!chrome.isConnected()) throw new Error('Session Chromium exited.');
          // A context per lease: no cache, storage or GPU resource handle outlives the request.
          const context = await chrome.newContext({ viewport: { width: 1600, height: 1000 } });
          try {
            const page = await openReviewPage(context, serverUrl(vite), '/__review_input.json?lease=' + lease);
            return {
              evaluate: (expression, isFunction, arg) => page.evaluate(({ expression, isFunction, arg }) => { const value = (0, eval)('(' + expression + ')'); return isFunction ? value(arg) : value; }, { expression, isFunction, arg }),
              close: () => context.close(),
            };
          } catch (error) { await context.close().catch(() => {}); throw error; }
        },
      };
    },
    async close() { compiler?.process.close(); await closeBrowser?.(); },
  };
}

export interface StartOptions { idleMinutes?: number; browser?: boolean; timeoutMs?: number }
/** Starts the detached daemon unless a live one exists. Resolves once it answers. */
export async function startSession(root: string, options: StartOptions = {}): Promise<{ started: boolean; record: SessionRecord }> {
  const existing = await probeSession(root);
  if (existing.live) return { started: false, record: existing.record };
  const idleMinutes = options.idleMinutes ?? 30;
  if (!Number.isFinite(idleMinutes) || idleMinutes <= 0 || idleMinutes > 24 * 60) throw new Error('Idle timeout must be between 0 and 1440 minutes.');
  await mkdir(join(root, '.build/construction'), { recursive: true });
  const log = openSync(sessionLogPath(root), 'a');
  let exited: number | null | undefined;
  try {
    const child = spawn(process.execPath, [join(import.meta.dir, 'session-daemon.ts'), root, '--idle-ms', String(Math.round(idleMinutes * 60_000)), ...(options.browser === false ? ['--no-browser'] : [])], { cwd: root, detached: true, stdio: ['ignore', log, log], env: { ...process.env, CONSTRUCTION_SESSION: 'off' } });
    child.on('exit', code => { exited = code; }); child.unref();
    const deadline = Date.now() + (options.timeoutMs ?? 30_000);
    while (Date.now() < deadline && exited === undefined) {
      const probe = await probeSession(root);
      // A concurrent start may have won; its daemon is as good as ours.
      if (probe.live) return { started: probe.record.pid === child.pid, record: probe.record };
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const probe = await probeSession(root);
    if (probe.live) return { started: false, record: probe.record };
    if (exited === undefined) child.kill();
    throw new Error('Session daemon did not start. See ' + sessionLogPath(root) + '.');
  } finally { closeSync(log); }
}
/** Stops the daemon of this worktree. A dead daemon's file is removed. */
export async function stopSession(root: string): Promise<{ stopped: boolean; reason?: string }> {
  const probe = await probeSession(root, 2_000);
  if (!probe.live) {
    if (probe.record && probe.record.root === root && !alive(probe.record.pid)) await rm(sessionPath(root), { force: true });
    return { stopped: false, reason: probe.reason };
  }
  await call(probe.record, '/stop', { method: 'POST', timeoutMs: 5_000 }).catch(() => {});
  for (let i = 0; i < 100 && alive(probe.record.pid); i++) await new Promise(resolve => setTimeout(resolve, 50));
  if (alive(probe.record.pid)) process.kill(probe.record.pid);
  return { stopped: true };
}
/** Daemon entry. Resolves with the reason it ended. One daemon per worktree: a second one yields to the first. */
export async function runSession(root: string, options: { idleTimeoutMs?: number; browser?: boolean } = {}): Promise<string> {
  await mkdir(join(root, '.build/construction'), { recursive: true });
  const release = await acquireLock(join(root, '.build/construction/session.lock'), 60_000);
  let session: RunningSession;
  try {
    if ((await probeSession(root)).live) return 'A live session already serves this worktree.';
    session = await createSessionServer({ root, services: nativeServices(root), ...options });
  } finally { await release(); }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void session.close('Received ' + signal + '.'); });
  return session.closed;
}
