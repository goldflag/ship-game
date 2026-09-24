import { describe, expect, test } from 'bun:test';
import { applyAdminAction, emptyProfile } from '../progression/rules';
import { modelledNodes } from '../progression/techTree';
import { requestErrorMessage, progressRequest, AdminRequestError } from './adminApi';
import { actionMessage, grantPreview, ownedCount, pageRange, parseXpAmount, playerRole, shipLedger, toPlayer } from './adminModel';
import { isAdminPath } from './route';

describe('route', () => {
  test('the admin page answers at the base path plus admin', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/')).toBe(true);
    expect(isAdminPath('/naval/admin', '/naval/')).toBe(true);
    expect(isAdminPath('/naval/admin', '/naval')).toBe(true);
    expect(isAdminPath('/admin', '/naval/')).toBe(false);
    expect(isAdminPath('/')).toBe(false);
    expect(isAdminPath('/administrator')).toBe(false);
    expect(isAdminPath('/admin/users')).toBe(false);
  });
});

describe('players', () => {
  test('accounts made before the admin plugin are players', () => {
    expect(playerRole(null)).toBe('user');
    expect(playerRole(undefined)).toBe('user');
    expect(playerRole('user')).toBe('user');
    expect(playerRole('admin')).toBe('admin');
    expect(playerRole('user, admin')).toBe('admin');
    const player = toPlayer({ id: 'a', name: '  ', email: 'a@example.test', role: null, createdAt: '2026-09-12T12:00:00.000Z' });
    expect(player).toEqual({ id: 'a', name: '', email: 'a@example.test', role: 'user', createdAt: new Date('2026-09-12T12:00:00.000Z') });
    expect(toPlayer({ id: 'b', email: 'b@example.test', createdAt: 'not a date' }).createdAt).toBeUndefined();
  });
  test('pages read as a range of the total', () => {
    expect(pageRange(0, 25, 0)).toBe('No players');
    expect(pageRange(0, 25, 7)).toBe('1–7 of 7');
    expect(pageRange(1, 25, 1234)).toBe('26–50 of 1,234');
    expect(pageRange(49, 25, 1234)).toBe('1,226–1,234 of 1,234');
  });
});

describe('grant XP', () => {
  test('amounts are whole numbers, negative to correct, within the API limit', () => {
    expect(parseXpAmount('5000')).toEqual({ amount: 5000 });
    expect(parseXpAmount(' 5,000 ')).toEqual({ amount: 5000 });
    expect(parseXpAmount('-500')).toEqual({ amount: -500 });
    expect(parseXpAmount('−500')).toEqual({ amount: -500 });
    expect(parseXpAmount('+20')).toEqual({ amount: 20 });
    for (const bad of ['', '0', '1.5', 'abc', '1e4', '1000001', '-1000001']) expect('error' in parseXpAmount(bad)).toBe(true);
    expect(parseXpAmount('1000000')).toEqual({ amount: 1_000_000 });
  });
  test('the preview shows what a grant leaves, never below zero', () => {
    const profile = applyAdminAction(emptyProfile(), { action: 'grant-xp', amount: 1200, pool: 'usa' });
    expect(grantPreview(profile, 5000, 'usa')).toBe('United States: 1,200 → 6,200 XP.');
    expect(grantPreview(profile, -5000, 'usa')).toBe('United States: 1,200 → 0 XP.');
    expect(grantPreview(profile, 300, 'free')).toBe('Free XP: 0 → 300 XP.');
    expect(grantPreview(profile, -10, 'all')).toBe('Takes 10 XP from each nation and free XP, none below zero.');
  });
  test('each saved change has a status line', () => {
    expect(actionMessage({ action: 'grant-xp', amount: 5000, pool: 'japan' }, 'Bill')).toBe('Granted 5,000 Japan XP to Bill.');
    expect(actionMessage({ action: 'grant-xp', amount: -250, pool: 'free' }, 'Bill')).toBe('Took 250 free XP from Bill.');
    expect(actionMessage({ action: 'grant-xp', amount: 10, pool: 'all' }, 'Bill')).toBe('Granted 10 XP to each of Bill’s pools.');
    expect(actionMessage({ action: 'unlock', nodeId: 'yamato' }, 'Bill')).toBe('Gave YAMATO to Bill.');
    expect(actionMessage({ action: 'lock', nodeId: 'yamato' }, 'Bill')).toBe('Took YAMATO back from Bill.');
    expect(actionMessage({ action: 'reset' }, 'Bill')).toBe('Bill’s research progress is reset.');
  });
});

describe('ship ledger', () => {
  test('only modelled ships, by nation and line in tree order', () => {
    const ledger = shipLedger(emptyProfile());
    expect(ledger.map(entry => entry.nation.id)).toEqual(['usa', 'japan', 'germany', 'uk']);
    const ids = ledger.flatMap(entry => entry.lines.flatMap(line => line.ships.map(ship => ship.node.id)));
    expect(ids).toEqual(modelledNodes().map(node => node.id));
    expect(ledger.every(entry => entry.lines.every(line => line.ships.length > 0))).toBe(true);
    // Germany has no modelled destroyer or carrier, so those lines are left out.
    expect(ledger[2].lines.map(line => line.line.id)).toEqual(['cruisers', 'battleships', 'submarines']);
    expect(ledger[0].lines[0].ships.map(ship => ship.node.id)).toEqual(['gleaves', 'fletcher']);
  });
  test('starters are fixed; the rest can be gifted and removed', () => {
    const find = (profile = emptyProfile(), id: string) => shipLedger(profile).flatMap(entry => entry.lines.flatMap(line => line.ships)).find(ship => ship.node.id === id)!;
    expect(find(undefined, 'gleaves')).toMatchObject({ standing: 'starter', detail: 'Owned from the start' });
    expect(find(undefined, 'gleaves').action).toBeUndefined();
    expect(find(undefined, 'fletcher')).toMatchObject({ standing: 'locked', action: 'unlock', detail: 'Not enough XP' });
    expect(find(undefined, 'baltimore')).toMatchObject({ standing: 'locked', detail: 'Not enough XP' });
    expect(find(undefined, 'alaska')).toMatchObject({ standing: 'locked', detail: 'Needs BALTIMORE' });
    const rich = applyAdminAction(emptyProfile(), { action: 'grant-xp', amount: 2000, pool: 'usa' });
    expect(find(rich, 'fletcher').detail).toBe('Could unlock now');
    const gifted = applyAdminAction(emptyProfile(), { action: 'unlock', nodeId: 'fletcher' });
    expect(find(gifted, 'fletcher')).toMatchObject({ standing: 'owned', listed: true, action: 'lock' });
    const open = applyAdminAction(gifted, { action: 'unlock-all', value: true });
    expect(find(open, 'yamato')).toMatchObject({ standing: 'owned', listed: false, action: 'unlock', detail: 'Open: every ship unlocked' });
    expect(find(open, 'fletcher')).toMatchObject({ standing: 'owned', listed: true, action: 'lock' });
    expect(ownedCount(shipLedger(emptyProfile()))).toEqual({ owned: modelledNodes().filter(node => node.starter).length, total: modelledNodes().length });
    expect(ownedCount(shipLedger(open)).owned).toBe(modelledNodes().length);
  });
});

describe('requests', () => {
  test('failures read as words for the admin', () => {
    expect(requestErrorMessage(401, { code: 'unauthorized', error: 'Sign in' })).toBe('Your session has ended. Sign in again.');
    expect(requestErrorMessage(403, { code: 'forbidden', error: 'This account is not an administrator.' })).toBe('This account is not an administrator.');
    expect(requestErrorMessage(404, { code: 'not-found', error: 'No such player.' })).toBe('No player has that id.');
    expect(requestErrorMessage(409, { code: 'invalid', error: 'Starters cannot be locked.' })).toBe('Starters cannot be locked.');
    expect(requestErrorMessage(400, null)).toBe('The server refused that change.');
    expect(requestErrorMessage(502)).toBe('The accounts service is unavailable. Retry shortly.');
  });
  test('the progress endpoint is read and changed with same-origin JSON', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const reply = (status: number, body: unknown) => async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); };
    const profile = applyAdminAction(emptyProfile(), { action: 'grant-xp', amount: 50, pool: 'uk' });
    expect(await progressRequest('user/1', undefined, reply(200, { profile }))).toEqual(profile);
    expect(calls[0].url).toBe('/api/admin/progress/user%2F1');
    expect(calls[0].init).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    await progressRequest('u', { action: 'reset' }, reply(200, { profile: emptyProfile() }));
    expect(calls[1].init).toMatchObject({ method: 'POST', body: '{"action":"reset"}' });
    const refused = await progressRequest('u', { action: 'lock', nodeId: 'gleaves' }, reply(409, { code: 'invalid', error: 'Starters cannot be locked.' })).catch(error => error);
    expect(refused).toBeInstanceOf(AdminRequestError);
    expect(refused).toMatchObject({ status: 409, code: 'invalid', message: 'Starters cannot be locked.' });
    const offline = await progressRequest('u', undefined, async () => { throw new TypeError('Failed to fetch'); }).catch(error => error);
    expect(offline).toMatchObject({ status: 0, message: 'The accounts service is unavailable. Retry shortly.' });
  });
});
