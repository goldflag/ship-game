import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { ConstructionSource, ConstructionCatalog } from '../../src/ships/blueprint';
import { parseConstructionCatalog } from '../../src/ships/constructionEquipment';
import { decodeConstructionSource } from '../../src/ships/constructionEditor';
import { ConstructionStoreError, type ConstructionRevision, type ConstructionStore, type SaveConstructionSource } from '../../src/ships/constructionStore';

export const constructionId = (id: string) => {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || id.length > 64 || id === 'all' || id.startsWith('local-')) throw new Error('Expected a lowercase ship ID.');
  return id;
};
export const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const sourcePath = (root: string, id: string) => join(root, 'assets/ships', constructionId(id), 'blueprint.json');
export async function readSource(root: string, id: string) {
  const path = sourcePath(root, id);
  const actual = await realpath(path);
  if (!actual.startsWith((await realpath(join(root, 'assets/ships'))) + sep)) throw new Error('Source must remain inside assets/ships.');
  const json = await readFile(actual, 'utf8');
  if (Buffer.byteLength(json) > 16 * 1024 * 1024) throw new Error('Construction source exceeds 16 MB.');
  const source = decodeConstructionSource(JSON.parse(json));
  if (source.id !== id) throw new Error('Source ID must match its ship directory.');
  return { source, json, hash: digest(json), modified: (await stat(actual)).mtimeMs };
}
export async function readCatalog(root: string, revision: string): Promise<ConstructionCatalog> {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Expected an immutable equipment catalog revision.');
  const catalog = parseConstructionCatalog(JSON.parse(await readFile(join(root, 'public/models/components/catalogs', revision, 'catalog.json'), 'utf8')));
  if (catalog.revision !== revision) throw new Error('Equipment catalog identity mismatch.');
  return catalog;
}
/** A lock directory holding its owner's pid and start time. A holder that died, or that has held the lock longer than
 * `staleMs`, is broken and replaced; a live holder rejects with code `EEXIST`. Returns the release. */
export async function acquireLock(lock: string, staleMs = 30_000): Promise<() => Promise<void>> {
  const owner = crypto.randomUUID(), record = join(lock, 'owner.json');
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };
  let breaking = '';
  for (let attempt = 0; ; attempt++) {
    try {
      // After a takeover the breaker mutex stays held until the new owner is on record.
      try { await mkdir(lock); await writeFile(record, JSON.stringify({ pid: process.pid, at: Date.now(), owner })); }
      finally { if (breaking) await rm(breaking, { recursive: true, force: true }); }
      return async () => {
        // A lock taken over after this holder stalled belongs to its new owner.
        const current = await readFile(record, 'utf8').then(text => JSON.parse(text).owner).catch(() => undefined);
        if (current === owner) await rm(lock, { recursive: true, force: true });
      };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt) throw error; }
    const held = await readFile(record, 'utf8').then(text => JSON.parse(text) as { pid: number; at: number; owner: string }).catch(() => undefined);
    // Locks written before owners were recorded, and the instant between mkdir and its record, carry only a directory time.
    const since = held?.at ?? (await stat(lock).then(s => s.mtimeMs, () => Date.now()));
    const broken = held ? !alive(held.pid) || Date.now() - since > staleMs : Date.now() - since > Math.min(staleMs, 5_000);
    if (!broken) throw held_(lock);
    // One breaker at a time: contenders that judged the same dead lock must not remove each other's fresh one.
    const breaker = lock + '.takeover';
    try { await mkdir(breaker); } catch {
      // A breaker that died mid-takeover leaves this behind; it is only ever held for a few file operations.
      if (Date.now() - await stat(breaker).then(s => s.mtimeMs, () => Date.now()) > 10_000) await rm(breaker, { recursive: true, force: true });
      throw held_(lock);
    }
    breaking = breaker;
    try {
      const aside = lock + '.broken-' + owner;
      try { await rename(lock, aside); } catch { continue; }
      const moved = await readFile(join(aside, 'owner.json'), 'utf8').then(text => JSON.parse(text).owner).catch(() => undefined);
      // The holder changed since it was judged: put the live lock back.
      if (moved !== held?.owner) { await rename(aside, lock).catch(() => rm(aside, { recursive: true, force: true })); throw held_(lock); }
      await rm(aside, { recursive: true, force: true });
    } catch (error) { await rm(breaker, { recursive: true, force: true }); throw error; }
  }
}
const held_ = (lock: string) => Object.assign(new Error('Lock is held: ' + lock), { code: 'EEXIST' });
function saved(id: string, json: string, createdAt: number, parentId: string | null = null): ConstructionRevision {
  const source = decodeConstructionSource(JSON.parse(json));
  return { formatVersion: 1, id: digest(json), designId: id, parentId, createdAt, schemaVersion: source.schemaVersion, catalogRevision: source.construction.catalogRevision, sourceJson: json };
}
/** Repository source is durable. Undo snapshots are recoverable scratch; Git retains committed history. */
export function repositoryStore(root: string): ConstructionStore {
  const history = (id: string) => join(root, '.build/construction/history', constructionId(id));
  const load = async (id: string) => {
    const { json, source, hash, modified } = await readSource(root, id);
    return { head: { id, name: source.name, revisionId: hash, updatedAt: modified, schemaVersion: source.schemaVersion, catalogRevision: source.construction.catalogRevision }, revision: saved(id, json, modified) };
  };
  return {
    async list() {
      const entries = await readdir(join(root, 'assets/ships'), { withFileTypes: true });
      const result = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const json = JSON.parse(await readFile(sourcePath(root, entry.name), 'utf8'));
          if (!json.construction || json.hull) continue;
          result.push((await load(entry.name)).head);
        } catch { /* Historical assets and incomplete scaffolds are not construction documents. */ }
      }
      return result;
    },
    load,
    async revisions(id) {
      const current = (await load(id)).revision;
      const entries = await readdir(history(id)).catch(() => []);
      const revisions = await Promise.all(entries.filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(async n => JSON.parse(await readFile(join(history(id), n), 'utf8')) as ConstructionRevision));
      return [current, ...revisions.filter(r => r.id !== current.id)].sort((a, b) => b.createdAt - a.createdAt);
    },
    async save(input: SaveConstructionSource) {
      const id = constructionId(input.designId), source = decodeConstructionSource(input.source);
      if (source.id !== id || source.schemaVersion !== input.schemaVersion || source.construction.catalogRevision !== input.catalogRevision) throw new Error('Source and save identity disagree.');
      await readCatalog(root, source.construction.catalogRevision);
      const lock = join(root, '.build/construction', id + '.lock');
      await mkdir(join(root, '.build/construction'), { recursive: true });
      const release = await acquireLock(lock).catch(error => { if (error.code !== 'EEXIST') throw error; throw new ConstructionStoreError('conflict', 'Another writer is saving this ship. Read the latest source and retry.'); });
      let temporary = '';
      try {
        const current = await readSource(root, id).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
        if ((current?.hash ?? null) !== input.expectedRevisionId) throw new ConstructionStoreError('conflict', 'The repository source changed. Download your draft, then reload the repository source or save a local copy.');
        const json = JSON.stringify(source, null, 2) + '\n';
        if (Buffer.byteLength(json) > 16 * 1024 * 1024) throw new Error('Construction source exceeds 16 MB.');
        const path = sourcePath(root, id);
        await mkdir(join(root, 'assets/ships', id), { recursive: true });
        const parent = await realpath(join(root, 'assets/ships', id));
        if (!parent.startsWith((await realpath(join(root, 'assets/ships'))) + sep)) throw new Error('Source directory escapes assets/ships.');
        await mkdir(history(id), { recursive: true });
        if (current) await writeFile(join(history(id), current.hash + '.json'), JSON.stringify(saved(id, current.json, current.modified)));
        temporary = path + '.' + crypto.randomUUID() + '.tmp';
        await writeFile(temporary, json, { flag: 'wx' });
        // Recheck external file edits that did not participate in our writer lock.
        const latest = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
        if ((latest === undefined ? null : digest(latest)) !== input.expectedRevisionId) throw new ConstructionStoreError('conflict', 'Source changed during save. Download your draft and reload.');
        await rename(temporary, path); temporary = '';
        return saved(id, json, Date.now(), current?.hash ?? null);
      } finally {
        if (temporary) await rm(temporary, { force: true });
        await release();
      }
    },
    async remove() { throw new Error('Repository ships are deleted through Git. Download a backup before removing their source.'); },
    close() {},
  };
}
