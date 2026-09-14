/** Local authoring sources only. Compiled meshes/physics and battle damage never enter this store. */
export const CONSTRUCTION_DATABASE = 'fleet-command-construction';
const DATABASE_VERSION = 1;

export type ConstructionStoreErrorCode = 'unavailable' | 'quota' | 'blocked' | 'unsupported-version' | 'catalog' | 'migration' | 'corrupt' | 'conflict' | 'not-found';

export class ConstructionStoreError extends Error {
  constructor(readonly code: ConstructionStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConstructionStoreError';
  }
}

export interface ConstructionDesignHead {
  id: string;
  name: string;
  revisionId: string;
  updatedAt: number;
  schemaVersion: number;
  catalogRevision: string;
  readError?: string;
}

export interface ConstructionRevision {
  formatVersion: 1;
  id: string;
  designId: string;
  parentId: string | null;
  createdAt: number;
  schemaVersion: number;
  catalogRevision: string;
  /** Exact saved source, kept even when a future reader cannot decode it. */
  sourceJson: string;
}

export interface SaveConstructionSource {
  designId: string;
  name: string;
  source: unknown;
  schemaVersion: number;
  catalogRevision: string;
  /** Compare-and-swap protects against stale autosaves and another browser tab. */
  expectedRevisionId: string | null;
}

export interface ConstructionStore {
  list(): Promise<ConstructionDesignHead[]>;
  load(designId: string): Promise<{ head: ConstructionDesignHead; revision: ConstructionRevision }>;
  revisions(designId: string): Promise<ConstructionRevision[]>;
  save(input: SaveConstructionSource): Promise<ConstructionRevision>;
  /** Delete the head and every retained revision atomically, only if the listed head is still current. */
  remove(designId: string, expectedRevisionId: string): Promise<void>;
  close(): void;
}

function isHead(value: unknown): value is ConstructionDesignHead {
  if (!value || typeof value !== 'object') return false;
  const head = value as ConstructionDesignHead;
  return typeof head.id === 'string' && typeof head.name === 'string' && typeof head.revisionId === 'string' && !!head.revisionId
    && Number.isFinite(head.updatedAt) && Number.isFinite(head.schemaVersion) && typeof head.catalogRevision === 'string';
}

function storageError(error: unknown): ConstructionStoreError {
  if (error instanceof ConstructionStoreError) return error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError') return new ConstructionStoreError('quota', 'Local storage is full. Download your source as a backup, free browser storage, then retry saving.', { cause: error });
  if (name === 'VersionError') return new ConstructionStoreError('unsupported-version', 'This ship library was saved by a newer game. Open that version to use it; your originals are unchanged.', { cause: error });
  return new ConstructionStoreError('unavailable', 'Local saving is unavailable. Keep this editor open, download a source backup, and retry when browser storage is available.', { cause: error });
}

export function encodeConstructionSource(source: unknown): string {
  try {
    const json = JSON.stringify(source, (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite number');
      return value;
    });
    if (json === undefined) throw new Error('No source');
    return json;
  } catch (cause) {
    throw new ConstructionStoreError('corrupt', 'The source contains data that cannot be saved as JSON. The previous revision is unchanged.', { cause });
  }
}

export interface ConstructionSourceReader<T> {
  schemaVersion: number;
  catalogRevision: string;
  decode(value: unknown): T;
  /** Migrate a detached copy. The caller must explicitly save it as a new revision. */
  migrate?(value: unknown, fromVersion: number): unknown;
}

export function readConstructionSource<T>(revision: ConstructionRevision, reader: ConstructionSourceReader<T>): { source: T; migrated: boolean } {
  if (!revision || revision.formatVersion !== 1 || typeof revision.sourceJson !== 'string') {
    throw new ConstructionStoreError('corrupt', 'This revision cannot be read. Recover an earlier revision or download the original for repair.');
  }
  if (revision.schemaVersion > reader.schemaVersion || (revision.schemaVersion !== reader.schemaVersion && !reader.migrate)) {
    throw new ConstructionStoreError('unsupported-version', `Source version ${revision.schemaVersion} is unsupported here. Open a compatible game version or recover an earlier revision; the original is preserved.`);
  }
  if (revision.catalogRevision !== reader.catalogRevision) {
    throw new ConstructionStoreError('catalog', `This design requires component catalog ${revision.catalogRevision}. Restore that catalog or recover a compatible revision. No equipment has been substituted.`);
  }
  let value: unknown;
  try { value = JSON.parse(revision.sourceJson); }
  catch (cause) { throw new ConstructionStoreError('corrupt', 'This source is damaged. Recover an earlier revision or download the original for repair.', { cause }); }
  const migrated = revision.schemaVersion !== reader.schemaVersion;
  if (migrated) {
    try { value = reader.migrate!(value, revision.schemaVersion); }
    catch (cause) { throw new ConstructionStoreError('migration', 'This source could not be upgraded. Its original revision is preserved; recover an earlier version or download it for repair.', { cause }); }
  }
  try { return { source: reader.decode(value), migrated }; }
  catch (cause) { throw new ConstructionStoreError(migrated ? 'migration' : 'corrupt', 'The saved source could not be opened. Recover an earlier revision or download the original; no saved data has changed.', { cause }); }
}

/** Factory injection permits real IndexedDB browser tests without a runtime dependency. */
export async function openConstructionStore(options: { name?: string; indexedDB?: IDBFactory } = {}): Promise<ConstructionStore> {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) throw storageError(new Error('IndexedDB unavailable'));
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    let abandoned = false;
    let request: IDBOpenDBRequest;
    try { request = factory.open(options.name ?? CONSTRUCTION_DATABASE, DATABASE_VERSION); }
    catch (error) { reject(storageError(error)); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('designs')) db.createObjectStore('designs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('revisions')) {
        const revisions = db.createObjectStore('revisions', { keyPath: 'id' });
        revisions.createIndex('designId', 'designId');
      }
    };
    request.onblocked = () => {
      abandoned = true;
      reject(new ConstructionStoreError('blocked', 'Another game tab is holding this ship library open. Close that tab and retry. Your sources are unchanged.'));
    };
    request.onerror = () => reject(storageError(request.error));
    request.onsuccess = () => {
      if (abandoned) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });

  function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void, fail: (error: ConstructionStoreError) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = database.transaction(['designs', 'revisions'], mode); }
      catch (error) { reject(storageError(error)); return; }
      let value: T;
      let failure: ConstructionStoreError | undefined;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(failure ?? storageError(tx.error));
      tx.onerror = () => { /* Abort is the single rejection path, after all writes are rolled back. */ };
      try { run(tx, result => { value = result; }, error => { failure = error; tx.abort(); }); }
      catch (error) { failure = storageError(error); tx.abort(); }
    });
  }

  return {
    close: () => database.close(),
    list: () => transaction('readonly', (tx, result, fail) => {
      const request = tx.objectStore('designs').getAll();
      request.onsuccess = () => {
        const rows: ConstructionDesignHead[] = [];
        for (const value of request.result as unknown[]) {
          if (isHead(value)) { rows.push(value); continue; }
          const head = value as Partial<ConstructionDesignHead> | undefined;
          if (!head || typeof head.id !== 'string') { fail(new ConstructionStoreError('corrupt', 'The local library index is damaged. Its source revisions are preserved.')); return; }
          rows.push({ id: head.id, name: typeof head.name === 'string' ? head.name : 'Unreadable design', revisionId: typeof head.revisionId === 'string' ? head.revisionId : '', updatedAt: 0, schemaVersion: 0, catalogRevision: '', readError: 'Library entry is damaged. Recover an earlier source revision.' });
        }
        result(rows.sort((a, b) => b.updatedAt - a.updatedAt));
      };
    }),
    load: designId => transaction('readonly', (tx, result, fail) => {
      const headRequest = tx.objectStore('designs').get(designId);
      headRequest.onsuccess = () => {
        const head = headRequest.result as ConstructionDesignHead | undefined;
        if (!head) { fail(new ConstructionStoreError('not-found', 'This local design no longer exists. Choose another design or start a new one.')); return; }
        if (!isHead(head)) { fail(new ConstructionStoreError('corrupt', 'This library entry is damaged. Recover an earlier source revision; its original data is preserved.')); return; }
        const revisionRequest = tx.objectStore('revisions').get(head.revisionId);
        revisionRequest.onsuccess = () => {
          const revision = revisionRequest.result as ConstructionRevision | undefined;
          if (!revision || revision.designId !== designId) { fail(new ConstructionStoreError('corrupt', 'The latest source revision is missing. Recover an earlier revision from this library.')); return; }
          result({ head, revision });
        };
      };
    }),
    revisions: designId => transaction('readonly', (tx, result) => {
      const request = tx.objectStore('revisions').index('designId').getAll(designId);
      request.onsuccess = () => result((request.result as ConstructionRevision[]).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)));
    }),
    remove: (designId, expectedRevisionId) => transaction<void>('readwrite', (tx, result, fail) => {
      const heads = tx.objectStore('designs'), request = heads.get(designId);
      request.onsuccess = () => {
        const current = request.result as Partial<ConstructionDesignHead> | undefined;
        if (current && (current.revisionId ?? '') !== expectedRevisionId) {
          fail(new ConstructionStoreError('conflict', 'This design changed in another editor. Review its latest revision before deleting it.'));
          return;
        }
        heads.delete(designId);
        const revisions = tx.objectStore('revisions').index('designId').openCursor(IDBKeyRange.only(designId));
        revisions.onsuccess = () => { const cursor = revisions.result; if (cursor) { cursor.delete(); cursor.continue(); } };
        result(undefined);
      };
    }),
    save: input => {
      const sourceJson = encodeConstructionSource(input.source);
      const revision: ConstructionRevision = {
        formatVersion: 1, id: crypto.randomUUID(), designId: input.designId,
        parentId: input.expectedRevisionId, createdAt: Date.now(), schemaVersion: input.schemaVersion,
        catalogRevision: input.catalogRevision, sourceJson,
      };
      return transaction('readwrite', (tx, result, fail) => {
        const heads = tx.objectStore('designs');
        const request = heads.get(input.designId);
        request.onsuccess = () => {
          const current = request.result as ConstructionDesignHead | undefined;
          if (current && !isHead(current)) { fail(new ConstructionStoreError('corrupt', 'This library entry is damaged. Recover its source into a new design; the original is preserved.')); return; }
          if ((current?.revisionId ?? null) !== input.expectedRevisionId) {
            fail(new ConstructionStoreError('conflict', 'A newer revision was saved in another editor. Download this draft, then reopen the latest revision or save this draft as a new design.'));
            return;
          }
          tx.objectStore('revisions').add(revision);
          heads.put({ id: input.designId, name: input.name, revisionId: revision.id, updatedAt: revision.createdAt, schemaVersion: input.schemaVersion, catalogRevision: input.catalogRevision } satisfies ConstructionDesignHead);
          result(revision);
        };
      });
    },
  };
}
