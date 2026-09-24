import { describe, expect, test } from 'bun:test';
import type { Pool } from 'pg';
import type { Auth } from './auth';
import { createApp } from './app';
import { devAllowlist, ProgressStorage, readAward, readGrant, readUnlock, settleAward } from './progress';
import { ShipStorage } from './storage';
import { emptyProfile } from '../../src/progression/rules';
import { awardFor, type BattleSummary } from '../../src/progression/xp';

const summary = (overrides: Partial<BattleSummary> = {}): BattleSummary => ({
  mode: 'custom', result: 'victory', durationS: 600,
  friendly: [{ presetId: 'fletcher', massKg: 2_924_000, lost: false, integrity: .6 }],
  enemy: [{ presetId: 'fletcher', massKg: 2_924_000, lost: true, integrity: 0, opposition: 'normal' }],
  ...overrides,
});

/** The statements ProgressStorage issues, over maps. Advisory locks and transactions are no-ops. */
function fakePool() {
  const profiles = new Map<string, string>(), awards = new Map<string, { digest: string; award: string }>();
  const rows = (list: unknown[]) => ({ rows: list, rowCount: list.length });
  const query = async (sql: string, params: any[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$|pg_advisory_xact_lock/.test(sql)) return rows([]);
    if (sql.startsWith('SELECT profile FROM progress.profiles')) { const saved = profiles.get(params[0]); return rows(saved ? [{ profile: JSON.parse(saved) }] : []); }
    if (sql.startsWith('INSERT INTO progress.profiles')) { profiles.set(params[0], params[1]); return rows([]); }
    if (sql.startsWith('SELECT digest,award FROM progress.awards')) { const saved = awards.get(params[0] + '/' + params[1]); return rows(saved ? [{ digest: saved.digest, award: JSON.parse(saved.award) }] : []); }
    if (sql.startsWith('INSERT INTO progress.awards')) {
      const key = params[0] + '/' + params[1];
      if (awards.has(key)) throw new Error('duplicate key');
      awards.set(key, { digest: params[2], award: params[3] }); return rows([]);
    }
    throw new Error('Unexpected query: ' + sql);
  };
  return { pool: { query, connect: async () => ({ query, release() {} }) } as unknown as Pool, profiles, awards };
}

const origin = 'http://localhost:8788';
const users: Record<string, { id: string; email: string }> = {
  captain: { id: 'user-captain', email: 'Captain@Example.test' },
  admiral: { id: 'user-admiral', email: 'admiral@example.test' },
};
/** A session per `cookie: session=<name>`. */
const fakeAuth = { api: { getSession: async ({ headers }: { headers: Headers }) => {
  const user = users[/session=(\w+)/.exec(headers.get('cookie') ?? '')?.[1] ?? ''];
  return user ? { user } : null;
} }, handler: () => new Response(null, { status: 404 }) } as unknown as Auth;
function harness(devAccounts = '') {
  const fake = fakePool();
  const app = createApp(fakeAuth, new ShipStorage(fake.pool), 'x'.repeat(32), origin, 'http://127.0.0.1:1', new ProgressStorage(fake.pool, devAccounts));
  const send = async (path: string, { user = 'captain', method = 'GET', body, headers = {} }: { user?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const response = await app.request(origin + path, { method, headers: { origin, cookie: `session=${user}`, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: response.status, json: await response.json().catch(() => null) as any };
  };
  return { ...fake, send };
}

describe('request validation', () => {
  test('unlocks name one node', () => {
    expect(readUnlock({ nodeId: 'fletcher' })).toBe('fletcher');
    for (const body of [undefined, null, [], 'fletcher', {}, { nodeId: 3 }, { nodeId: '' }, { nodeId: 'x'.repeat(161) }])
      expect(() => readUnlock(body)).toThrow(expect.objectContaining({ status: 400, code: 'invalid' }));
  });
  test('awards need a UUID battle id and a valid summary', () => {
    const id = crypto.randomUUID();
    expect(readAward({ id, summary: summary() }).summary).toEqual(summary());
    for (const body of [{ id: 'battle-1', summary: summary() }, { summary: summary() }, { id, summary: { ...summary(), durationS: 99999 } }, { id }])
      expect(() => readAward(body)).toThrow(expect.objectContaining({ status: 400, code: 'invalid' }));
  });
  test('grants are bounded booleans and XP', () => {
    expect(readGrant({ xp: 5000, unlockAll: true })).toEqual({ xp: 5000, unlockAll: true });
    expect(readGrant({ reset: true })).toEqual({ reset: true });
    for (const body of [{ xp: -1 }, { xp: 1_000_001 }, { xp: Infinity }, { xp: '500' }, { unlockAll: 'yes' }, { reset: 1 }, []])
      expect(() => readGrant(body)).toThrow(expect.objectContaining({ status: 400, code: 'invalid' }));
  });
  test('the developer allowlist matches ids, emails without case, or everyone', () => {
    expect(devAllowlist('')('user-captain', 'captain@example.test')).toBe(false);
    expect(devAllowlist(' user-captain , other@example.test')('user-captain')).toBe(true);
    expect(devAllowlist('CAPTAIN@example.test')('user-captain', 'captain@EXAMPLE.test')).toBe(true);
    expect(devAllowlist('someone-else,')('user-captain', '')).toBe(false);
    expect(devAllowlist('*')('anyone')).toBe(true);
  });
});

describe('award idempotency', () => {
  test('the digest ignores key order and unknown fields but not the result', () => {
    const id = crypto.randomUUID(), base = readAward({ id, summary: summary() });
    const reordered = Object.fromEntries(Object.entries(summary()).reverse());
    expect(readAward({ id, summary: { ...reordered, award: { total: 5000 } } }).digest).toBe(base.digest);
    expect(readAward({ id: id.toUpperCase(), summary: summary() }).id).toBe(id);
    expect(readAward({ id, summary: summary({ result: 'draw' }) }).digest).not.toBe(base.digest);
  });
  test('a first report pays; a matching retry returns the recorded award unpaid; a different summary conflicts', () => {
    const report = readAward({ id: crypto.randomUUID(), summary: summary() });
    const first = settleAward(emptyProfile(), undefined, report);
    expect(first.paid).toBe(true);
    expect(first.award).toEqual(awardFor(summary()));
    expect(first.profile.earned).toBe(first.award.total);
    const recorded = { digest: report.digest, award: { ...first.award, total: 1 } };
    const retry = settleAward(first.profile, recorded, report);
    expect(retry).toEqual({ profile: first.profile, award: recorded.award, paid: false });
    expect(() => settleAward(first.profile, recorded, { ...report, digest: 'other' })).toThrow(expect.objectContaining({ status: 409, code: 'conflict' }));
  });
});

describe('progress routes', () => {
  test('require a session, the bound account and an allowed origin for writes', async () => {
    const { send } = harness();
    expect((await send('/api/progress', { user: 'nobody' })).status).toBe(401);
    expect((await send('/api/progress', { headers: { 'x-account-id': 'user-admiral' } })).status).toBe(401);
    expect((await send('/api/progress', { headers: { 'x-account-id': 'user-captain' } })).status).toBe(200);
    const blocked = await send('/api/progress/unlocks', { method: 'POST', body: { nodeId: 'fletcher' }, headers: { origin: 'https://evil.example' } });
    expect(blocked).toEqual({ status: 403, json: { code: 'forbidden', error: 'Origin not allowed' } });
    expect((await send('/api/progress/unlocks', { method: 'POST', body: 'x'.repeat(70_000) })).status).toBe(413);
  });
  test('a new account reads an empty profile without writing a row', async () => {
    const { send, profiles } = harness();
    expect(await send('/api/progress')).toEqual({ status: 200, json: { profile: emptyProfile() } });
    expect(profiles.size).toBe(0);
  });
  test('awards pay once per battle id, computed on the server', async () => {
    const { send } = harness();
    const id = crypto.randomUUID(), expected = awardFor(summary());
    const first = await send('/api/progress/awards', { method: 'POST', body: { id, summary: summary(), award: { total: 5000, nations: { usa: 5000 }, free: 0 } } });
    expect(first.status).toBe(200);
    expect(first.json.award).toEqual(expected);
    expect(first.json.profile.earned).toBe(expected.total);
    expect(first.json.profile.xp.usa).toBe(expected.nations.usa);
    const retry = await send('/api/progress/awards', { method: 'POST', body: { id, summary: summary() } });
    expect(retry).toEqual({ status: 200, json: first.json });
    const conflict = await send('/api/progress/awards', { method: 'POST', body: { id, summary: summary({ result: 'defeat' }) } });
    expect(conflict.status).toBe(409);
    expect(conflict.json.code).toBe('conflict');
    expect((await send('/api/progress')).json.profile.earned).toBe(expected.total);
    // Battle ids are per account.
    expect((await send('/api/progress/awards', { user: 'admiral', method: 'POST', body: { id, summary: summary({ result: 'defeat' }) } })).status).toBe(200);
  });
  test('bad bodies are 400 invalid, rule failures 409 with the rule code', async () => {
    const { send } = harness();
    for (const [path, body] of [['/api/progress/unlocks', '{not json'], ['/api/progress/unlocks', { node: 'fletcher' }], ['/api/progress/awards', { id: crypto.randomUUID(), summary: { mode: 'arcade' } }]] as const) {
      const response = await send(path, { method: 'POST', body });
      expect(response.status).toBe(400);
      expect(response.json.code).toBe('invalid');
    }
    for (const [nodeId, code] of [['fletcher', 'insufficient-xp'], ['gleaves', 'owned'], ['us-gearing', 'placeholder'], ['nowhere', 'unknown-node']]) {
      const response = await send('/api/progress/unlocks', { method: 'POST', body: { nodeId } });
      expect(response.status).toBe(409);
      expect(response.json.code).toBe(code);
      expect(typeof response.json.error).toBe('string');
    }
  });
  test('developer grants need PROGRESS_DEV_ACCOUNTS, then grant, unlock and reset', async () => {
    const closed = harness();
    const refused = await closed.send('/api/progress/dev', { method: 'POST', body: { xp: 5000 } });
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe('forbidden');
    expect(refused.json.error).toContain('PROGRESS_DEV_ACCOUNTS');
    const { send } = harness('captain@example.test');
    expect((await send('/api/progress/dev', { user: 'admiral', method: 'POST', body: { xp: 5000 } })).status).toBe(403);
    expect((await send('/api/progress/dev', { method: 'POST', body: { xp: 2_000_000 } })).status).toBe(400);
    expect((await send('/api/progress/dev', { method: 'POST', body: { xp: 2000 } })).json.profile.freeXp).toBe(2000);
    const unlocked = await send('/api/progress/unlocks', { method: 'POST', body: { nodeId: 'fletcher' } });
    expect(unlocked.status).toBe(200);
    expect(unlocked.json.spent).toEqual({ nation: 'usa', fromNation: 1800, fromFree: 0 });
    expect(unlocked.json.profile.unlocked).toEqual(['fletcher']);
    expect((await send('/api/progress/dev', { method: 'POST', body: { unlockAll: true } })).json.profile.allUnlocked).toBe(true);
    expect((await send('/api/progress/dev', { method: 'POST', body: { reset: true, xp: 10 } })).json.profile).toEqual(emptyProfile());
    expect((await send('/api/progress')).json.profile).toEqual(emptyProfile());
  });
});
