import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock } from './files';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const directory = async () => { const root = await mkdtemp(join(tmpdir(), 'construction-lock-')); roots.push(root); return join(root, 'ship.lock'); };
// A pid that certainly ended: a child that has already been reaped.
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

test('a live holder keeps the lock and release frees it', async () => {
  const lock = await directory(), release = await acquireLock(lock);
  expect(JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')).pid).toBe(process.pid);
  await expect(acquireLock(lock)).rejects.toMatchObject({ code: 'EEXIST' });
  await release();
  expect(existsSync(lock)).toBe(false);
  await (await acquireLock(lock))();
});
test('a lock whose holder died is taken over', async () => {
  const lock = await directory();
  await mkdir(lock); await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: deadPid(), at: Date.now(), owner: 'crashed' }));
  const release = await acquireLock(lock);
  expect(JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')).pid).toBe(process.pid);
  await release();
  expect(existsSync(lock)).toBe(false);
});
test('a lock older than its limit is taken over and the stalled holder cannot release the new one', async () => {
  const lock = await directory(), stalled = await acquireLock(lock, 20);
  await new Promise(resolve => setTimeout(resolve, 40));
  await expect(acquireLock(lock, 60_000)).rejects.toMatchObject({ code: 'EEXIST' });
  const release = await acquireLock(lock, 20);
  await stalled();
  expect(existsSync(lock)).toBe(true);
  await release();
  expect(existsSync(lock)).toBe(false);
});
test('a lock directory without an owner record is broken only once it is old', async () => {
  const lock = await directory();
  await mkdir(lock);
  await expect(acquireLock(lock)).rejects.toMatchObject({ code: 'EEXIST' });
  const old = new Date(Date.now() - 60_000); await utimes(lock, old, old);
  await (await acquireLock(lock))();
});
test('contenders for one broken lock yield exactly one holder', async () => {
  const lock = await directory();
  await mkdir(lock); await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: deadPid(), at: Date.now(), owner: 'crashed' }));
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => acquireLock(lock)));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
});
