import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSessionServer,
  probeSession,
  liveSession,
  sessionCompile,
  sessionBrowser,
  sessionPath,
  stopSession,
  SESSION_VERSION,
  type RunningSession,
  type SessionServices,
} from './session';

// Protocol only: fake services stand in for the native compiler and Chromium.
const roots: string[] = [],
  sessions: RunningSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const root = async () => {
  const path = await mkdtemp(join(tmpdir(), 'construction-session-'));
  roots.push(path);
  return path;
};
function fakes(overrides: Partial<SessionServices> = {}) {
  const log: string[] = [];
  const services: SessionServices = {
    async compile({ source, parts }) {
      log.push('start ' + source);
      await new Promise((resolve) => setTimeout(resolve, 20));
      log.push('end ' + source);
      return { result: JSON.stringify({ echo: source, parts: parts ?? null }), reused: 3 };
    },
    async browser(inputs) {
      return {
        async open(lease) {
          log.push('open ' + inputs.get(lease));
          return {
            evaluate: async (expression, isFunction, arg) => (isFunction ? (0, eval)('(' + expression + ')')(arg) : (0, eval)(expression)),
            close: async () => {
              log.push('close ' + lease);
            },
          };
        },
      };
    },
    async close() {
      log.push('services closed');
    },
    ...overrides,
  };
  return { services, log };
}
async function start(
  path: string,
  options: Partial<Parameters<typeof createSessionServer>[0]> = {},
  overrides: Partial<SessionServices> = {},
) {
  const fake = fakes(overrides),
    session = await createSessionServer({ root: path, services: fake.services, sweepMs: 20, ...options });
  sessions.push(session);
  return { session, ...fake };
}
const request = (session: RunningSession, path: string, init: RequestInit = {}) =>
  fetch('http://127.0.0.1:' + session.record.port + path, init);

test('the session file is private, names this process and answers only its token', async () => {
  const path = await root(),
    { session } = await start(path);
  expect(session.record).toMatchObject({ version: SESSION_VERSION, pid: process.pid, root: path });
  expect((await Bun.file(sessionPath(path)).stat()).mode & 0o077).toBe(0);
  expect((await request(session, '/status')).status).toBe(401);
  expect((await request(session, '/status', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
  expect(
    (await request(session, '/status', { headers: { authorization: 'Bearer ' + session.record.token, origin: 'http://127.0.0.1:5173' } }))
      .status,
  ).toBe(403);
  expect(
    (await request(session, '/status', { headers: { authorization: 'Bearer ' + session.record.token, host: 'example.test' } })).status,
  ).toBe(403);
  const probe = await probeSession(path);
  expect(probe.live && probe.status.compiler.requests).toBe(0);
});
test('compile returns the exact text and concurrent requests never interleave', async () => {
  const path = await root(),
    { session, log } = await start(path);
  const answers = await Promise.all(
    ['a', 'b', 'c'].map((source) => sessionCompile(path, source, 'r'.repeat(64), source === 'b' ? ['x'] : undefined)),
  );
  expect(answers).toEqual(['a', 'b', 'c'].map((source) => JSON.stringify({ echo: source, parts: source === 'b' ? ['x'] : null })));
  for (let i = 0; i < log.length; i += 2) expect(log[i + 1]).toBe(log[i].replace('start', 'end'));
  expect(session.status().compiler).toMatchObject({ requests: 3, reusedGeometryOperations: 9 });
});
test('an unavailable or failing warm compiler means compile cold, never an error', async () => {
  const path = await root();
  await start(
    path,
    {},
    {
      compile: async ({ source }) => {
        if (source === 'unsure') return undefined;
        throw new Error('panicked');
      },
    },
  );
  expect(await sessionCompile(path, 'unsure', 'r')).toBeUndefined();
  expect(await sessionCompile(path, 'bad', 'r')).toBeUndefined();
});
test('stale session files fall back quickly: dead pid, closed port, other version, other worktree, changed sources, env off', async () => {
  const path = await root();
  expect(await liveSession(path)).toBeUndefined();
  const { session } = await start(path),
    record = { ...session.record };
  expect((await liveSession(path))?.pid).toBe(process.pid);
  process.env.CONSTRUCTION_SESSION = 'off';
  try {
    expect(await liveSession(path)).toBeUndefined();
  } finally {
    delete process.env.CONSTRUCTION_SESSION;
  }
  await session.close();
  expect(existsSync(sessionPath(path))).toBe(false);
  const write = (value: object) => writeFile(sessionPath(path), JSON.stringify(value));
  await mkdir(join(path, '.build/construction'), { recursive: true });
  // A listener that accepts and never answers stands in for a hung daemon.
  const hung = createServer(() => {});
  await new Promise<void>((resolve) => hung.listen(0, '127.0.0.1', resolve));
  try {
    const cases: [object, string][] = [
      [{ ...record, pid: spawnSync(process.execPath, ['-e', '0']).pid }, 'gone'],
      [record, 'did not answer'],
      [{ ...record, port: (hung.address() as { port: number }).port }, 'did not answer'],
      [{ ...record, version: SESSION_VERSION + 1 }, 'version'],
      [{ ...record, root: path + '-other' }, 'another worktree'],
      [{ ...record, fingerprint: 'older' }, 'different daemon sources'],
    ];
    for (const [value, reason] of cases) {
      await write(value);
      const from = performance.now(),
        probe = await probeSession(path, 300);
      expect(probe.live).toBe(false);
      expect(!probe.live && probe.reason).toContain(reason);
      expect(performance.now() - from).toBeLessThan(1_500);
      expect(await sessionCompile(path, 'a', 'r')).toBeUndefined();
      expect(await sessionBrowser(path, '{}')).toBeUndefined();
    }
    await writeFile(sessionPath(path), 'not json');
    expect((await probeSession(path)).live).toBe(false);
  } finally {
    hung.close();
  }
});
test('browser leases are exclusive, forward evaluate, and a dead holder is revoked', async () => {
  const path = await root(),
    { session, log } = await start(path);
  const first = (await sessionBrowser(path, '"one"'))!;
  expect(await first.page.evaluate((value: number) => value * 2, 21)).toBe(42);
  expect(await first.page.evaluate(() => undefined)).toBeUndefined();
  await expect(
    first.page.evaluate(() => {
      throw new Error('inside page');
    }),
  ).rejects.toThrow('inside page');
  expect(() => first.page.screenshot()).toThrow('page.evaluate only');
  let second: Awaited<ReturnType<typeof sessionBrowser>>;
  const queued = sessionBrowser(path, '"two"').then((lease) => {
    second = lease;
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(second).toBeUndefined();
  expect(session.status().browser).toMatchObject({ leased: true, waiting: 1 });
  await first.release();
  await queued;
  expect(log.filter((line) => line.startsWith('open'))).toEqual(['open "one"', 'open "two"']);
  await expect(first.page.evaluate(() => 1)).rejects.toThrow('gone');
  expect(await second!.page.evaluate(() => 7)).toBe(7);
  await second!.release();
  // A holder that died without releasing: the sweep frees the renderer for the next client.
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  const response = await request(session, '/browser/acquire?pid=' + dead, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + session.record.token },
    body: '"crashed"',
  });
  expect(response.status).toBe(200);
  const third = (await sessionBrowser(path, '"three"'))!;
  expect(await third.page.evaluate(() => 3)).toBe(3);
  await third.release();
});
test('a browser that cannot start or open means render cold', async () => {
  const path = await root();
  await start(
    path,
    {},
    {
      browser: async () => {
        throw new Error('no chromium');
      },
    },
  );
  expect(await sessionBrowser(path, '{}')).toBeUndefined();
  const probe = await probeSession(path);
  expect(probe.live && probe.status.browser.state).toBe('failed');
  const other = await root();
  await start(other, { browser: false });
  expect(await sessionBrowser(other, '{}')).toBeUndefined();
});
test('the daemon ends itself when idle, when its sources change, and on stop', async () => {
  const idle = await root(),
    { session, log } = await start(idle, { idleTimeoutMs: 60 });
  expect(await session.closed).toBe('Idle timeout.');
  expect(existsSync(sessionPath(idle))).toBe(false);
  expect(log).toContain('services closed');
  const changed = await root();
  let fingerprint = 'one';
  const edited = await start(changed, { fingerprint: async () => fingerprint });
  fingerprint = 'two';
  expect(await edited.session.closed).toBe('Daemon sources changed.');
  const stopped = await root(),
    running = await start(stopped);
  // stopSession would signal the recorded pid, which is this test process, if the daemon ignored the request.
  const closed = running.session.closed.then((reason) => reason);
  expect(
    (await request(running.session, '/stop', { method: 'POST', headers: { authorization: 'Bearer ' + running.session.record.token } }))
      .status,
  ).toBe(200);
  expect(await closed).toBe('Stopped by request.');
  expect(await stopSession(stopped)).toMatchObject({ stopped: false });
});
