import type { Pool, PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import type { ConstructionRevision, SaveConstructionSource } from '../../src/ships/constructionStore';
export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = /^[a-zA-Z0-9_.-]{1,160}$/;
export function validateSave(input: SaveConstructionSource) {
  if (!input || !key.test(input.designId) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160
    || input.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(input.catalogRevision)
    || (input.expectedRevisionId !== null && !uuid.test(input.expectedRevisionId))) throw new ApiError(400, 'corrupt', 'Invalid source envelope.');
  const source = input.source as Record<string, any>;
  if (!source || typeof source !== 'object' || !key.test(source.id) || typeof source.revision !== 'string'
    || source.schemaVersion !== input.schemaVersion || source.construction?.catalogRevision !== input.catalogRevision)
    throw new ApiError(400, 'corrupt', 'Source identity, schema or catalog does not match.');
  const json = JSON.stringify(source);
  if (Buffer.byteLength(json) > MAX_SOURCE_BYTES) throw new ApiError(413, 'quota', 'Each source must be at most 16 MiB. Download this draft to keep it.');
  return json; // No physical validation or compilation in autosave.
}
const revision = (r: any): ConstructionRevision => ({ formatVersion: 1, id: r.id, designId: r.design_id, sourceId: r.source_id,
  parentId: r.parent_id, createdAt: Number(r.created_at), schemaVersion: r.schema_version, catalogRevision: r.catalog_revision, sourceJson: r.source_json });
const head = (r: any) => ({ id: r.id, sourceId:r.source_id, name: r.name, revisionId: r.revision_id, updatedAt: Number(r.updated_at), schemaVersion: r.schema_version, catalogRevision: r.catalog_revision });
/** Runs work in one transaction holding an advisory lock on `key`, so one account's writes serialize. */
export async function lockedTransaction<T>(pool: Pool, key: string, work: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]); const value = await work(db); await db.query('COMMIT'); return value; }
  catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
export class ShipStorage {
  constructor(readonly db: Pool, readonly maxDesigns = 100, readonly maxBytes = 100 * 1024 * 1024) {}
  private transaction<T>(owner: string, work: (db: PoolClient) => Promise<T>) { return lockedTransaction(this.db, owner, work); }
  async list(owner: string) { return (await this.db.query('SELECT d.*,r.source_id,r.schema_version,r.catalog_revision FROM ships.designs d JOIN ships.revisions r ON r.id=d.revision_id WHERE d.owner_id=$1 ORDER BY d.updated_at DESC', [owner])).rows.map(head); }
  async load(owner: string, id: string) {
    const result = await this.db.query('SELECT d.*,r.source_id,r.schema_version,r.catalog_revision FROM ships.designs d JOIN ships.revisions r ON r.id=d.revision_id WHERE d.owner_id=$1 AND (d.id::text=$2 OR d.client_key=$2)', [owner, id]);
    if (!result.rowCount) throw new ApiError(404, 'not-found', 'Design not found.');
    const row = result.rows[0]; return { head: head(row), revision: await this.revision(owner, row.id, row.revision_id) };
  }
  async revision(owner: string, design: string, id: string) {
    const result = await this.db.query('SELECT r.* FROM ships.revisions r JOIN ships.designs d ON d.id=r.design_id WHERE d.owner_id=$1 AND d.id::text=$2 AND r.id::text=$3', [owner, design, id]);
    if (!result.rowCount) throw new ApiError(404, 'not-found', 'Revision not found.');
    return revision(result.rows[0]);
  }
  async revisions(owner: string, id: string) {
    const saved = await this.load(owner, id);
    return (await this.db.query('SELECT * FROM ships.revisions WHERE design_id=$1 ORDER BY created_at DESC,id DESC', [saved.head.id])).rows.map(revision);
  }
  async save(owner: string, operation: string, input: SaveConstructionSource) {
    if (!uuid.test(operation)) throw new ApiError(400, 'corrupt', 'An idempotency key is required.');
    const json = validateSave(input), hash = digest(JSON.stringify(input));
    return this.transaction(owner, async db => {
      const prior = await db.query('SELECT * FROM ships.operations WHERE owner_id=$1 AND id=$2', [owner, operation]);
      if (prior.rowCount) {
        if (prior.rows[0].digest !== hash) throw new ApiError(409, 'conflict', 'This retry key belongs to a different save.');
        const existing = await db.query('SELECT * FROM ships.revisions WHERE id=$1', [prior.rows[0].response.id]);
        if (!existing.rowCount) throw new ApiError(410, 'not-found', 'This saved revision was deleted. Import the draft as a new copy.');
        return revision(existing.rows[0]);
      }
      const existing = await db.query('SELECT * FROM ships.designs WHERE owner_id=$1 AND (id::text=$2 OR client_key=$2)', [owner, input.designId]);
      const current = existing.rows[0];
      if ((current?.revision_id ?? null) !== input.expectedRevisionId) throw new ApiError(409, 'conflict', 'Another device saved a newer revision. Download this draft, then open the latest revision or save a copy.');
      const count = await db.query('SELECT count(*)::int AS count FROM ships.designs WHERE owner_id=$1', [owner]);
      const used = await db.query('SELECT coalesce(sum(r.bytes),0)::bigint AS bytes FROM ships.revisions r JOIN ships.designs d ON d.id=r.design_id WHERE d.owner_id=$1', [owner]);
      if ((!current && count.rows[0].count >= this.maxDesigns) || Number(used.rows[0].bytes) + Buffer.byteLength(json) > this.maxBytes)
        throw new ApiError(413, 'quota', 'Account storage is full. Download this draft, then remove designs you no longer need and retry.');
      const now = Date.now(), designId = current?.id ?? randomUUID(), id = randomUUID();
      if (!current) await db.query('INSERT INTO ships.designs VALUES($1,$2,$3,$4,NULL,$5)', [designId, owner, input.designId, input.name, now]);
      const sourceId = (input.source as { id: string }).id;
      if (!current && sourceId !== input.designId) throw new ApiError(400,'corrupt','New source identity mismatch');
      if (current && current.client_key !== sourceId) throw new ApiError(400, 'corrupt', 'Source identity changed. Import it as a new copy.');
      await db.query('INSERT INTO ships.revisions VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, designId, input.expectedRevisionId, now, input.schemaVersion, input.catalogRevision, json, sourceId, Buffer.byteLength(json)]);
      await db.query('UPDATE ships.designs SET revision_id=$1,name=$2,updated_at=$3 WHERE id=$4', [id, input.name, now, designId]);
      const saved: ConstructionRevision = { formatVersion: 1, id, designId, sourceId, parentId: input.expectedRevisionId, createdAt: now, schemaVersion: input.schemaVersion, catalogRevision: input.catalogRevision, sourceJson: json };
      await db.query('INSERT INTO ships.operations VALUES($1,$2,$3,$4)', [owner, operation, hash, JSON.stringify({id:saved.id,designId:saved.designId})]);
      return saved;
    });
  }
  async remove(owner: string, id: string, expected: string) {
    await this.transaction(owner, async db => {
      const found = await db.query('SELECT * FROM ships.designs WHERE owner_id=$1 AND id::text=$2', [owner, id]);
      if (!found.rowCount) return;
      if (found.rows[0].revision_id !== expected) throw new ApiError(409, 'conflict', 'This design changed. Review the latest revision before deleting.');
      // Keep tiny operation tombstones so a delayed retry cannot recreate a deleted design.
      await db.query('DELETE FROM ships.designs WHERE owner_id=$1 AND id::text=$2', [owner,id]);
    });
  }
}
