import type { Pool, PoolClient } from 'pg';
// The only runtime imports from src/: the API image copies these three files (deploy/Dockerfile.api).
import { applyAward, applyGrant, applyUnlock, emptyProfile, ProgressError, sanitizeProfile, type ProgressProfile } from '../../src/progression/rules';
import { awardFor, validateSummary, type BattleSummary, type XpAward } from '../../src/progression/xp';
import { ApiError, digest, lockedTransaction, uuid } from './storage';

export const MAX_GRANT_XP = 1_000_000;
export interface DeveloperGrant { xp?: number; unlockAll?: boolean; reset?: boolean }
export interface BattleReport { id: string; summary: BattleSummary; digest: string }
export interface RecordedAward { digest: string; award: XpAward }

function invalid(message: string): never { throw new ApiError(400, 'invalid', message); }
function object(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Expected a JSON object.');
  return body as Record<string, unknown>;
}

export function readUnlock(body: unknown) {
  const { nodeId } = object(body);
  return typeof nodeId === 'string' && nodeId.length > 0 && nodeId.length <= 160 ? nodeId : invalid('Choose a ship to research.');
}
/** The digest covers the validated summary, so key order and unknown fields never make a retry conflict. */
export function readAward(body: unknown): BattleReport {
  const { id, summary } = object(body);
  if (typeof id !== 'string' || !uuid.test(id)) invalid('A battle id (UUID) is required.');
  let checked: BattleSummary;
  try { checked = validateSummary(summary); } catch (error) { invalid((error as Error).message); }
  return { id: id.toLowerCase(), summary: checked, digest: digest(JSON.stringify(checked)) };
}
export function readGrant(body: unknown): DeveloperGrant {
  const { xp, unlockAll, reset } = object(body);
  if (xp !== undefined && (typeof xp !== 'number' || !Number.isFinite(xp) || xp < 0 || xp > MAX_GRANT_XP)) invalid(`Grant between 0 and ${MAX_GRANT_XP.toLocaleString('en-US')} XP.`);
  if ((unlockAll !== undefined && typeof unlockAll !== 'boolean') || (reset !== undefined && typeof reset !== 'boolean')) invalid('unlockAll and reset must be true or false.');
  return { ...(xp === undefined ? {} : { xp }), ...(unlockAll === undefined ? {} : { unlockAll }), ...(reset === undefined ? {} : { reset }) };
}
/** `PROGRESS_DEV_ACCOUNTS`: comma-separated user ids or emails; `*` allows every account (local development only). */
export function devAllowlist(setting = '') {
  const entries = new Set(setting.split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean));
  return (id: string, email = '') => entries.has('*') || entries.has(id.toLowerCase()) || (!!email && entries.has(email.toLowerCase()));
}
/** Pays a reported battle once. A retry with the same summary returns what was recorded without paying again. */
export function settleAward(profile: ProgressProfile, prior: RecordedAward | undefined, report: BattleReport) {
  if (prior) {
    if (prior.digest !== report.digest) throw new ApiError(409, 'conflict', 'This battle id was already reported with a different result.');
    return { profile, award: prior.award, paid: false };
  }
  const award = awardFor(report.summary);
  return { profile: applyAward(profile, award), award, paid: true };
}

export class ProgressStorage {
  readonly allowsDev: (id: string, email?: string) => boolean;
  constructor(readonly db: Pool, devAccounts = '') { this.allowsDev = devAllowlist(devAccounts); }
  private async read(db: Pool | PoolClient, owner: string) {
    const result = await db.query('SELECT profile FROM progress.profiles WHERE owner_id=$1', [owner]);
    return result.rowCount ? sanitizeProfile(result.rows[0].profile) : emptyProfile();
  }
  private async write(db: PoolClient, owner: string, profile: ProgressProfile) {
    await db.query('INSERT INTO progress.profiles(owner_id,profile) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET profile=EXCLUDED.profile,updated_at=now()', [owner, JSON.stringify(profile)]);
  }
  private change<T>(owner: string, work: (db: PoolClient, profile: ProgressProfile) => Promise<T>) {
    return lockedTransaction(this.db, 'progress:' + owner, async db => work(db, await this.read(db, owner)));
  }
  /** No row yet reads as an empty profile; nothing is written. */
  load(owner: string) { return this.read(this.db, owner); }
  unlock(owner: string, nodeId: string) {
    return this.change(owner, async (db, profile) => {
      let result: ReturnType<typeof applyUnlock>;
      try { result = applyUnlock(profile, nodeId); }
      catch (error) { throw error instanceof ProgressError ? new ApiError(409, error.code, error.message) : error; }
      await this.write(db, owner, result.profile);
      return result;
    });
  }
  award(owner: string, report: BattleReport) {
    return this.change(owner, async (db, profile) => {
      const found = await db.query('SELECT digest,award FROM progress.awards WHERE owner_id=$1 AND id=$2', [owner, report.id]);
      const settled = settleAward(profile, found.rowCount ? found.rows[0] as RecordedAward : undefined, report);
      if (settled.paid) {
        await db.query('INSERT INTO progress.awards(owner_id,id,digest,award) VALUES($1,$2,$3,$4)', [owner, report.id, report.digest, JSON.stringify(settled.award)]);
        await this.write(db, owner, settled.profile);
      }
      return { profile: settled.profile, award: settled.award };
    });
  }
  /** Developer grants. Callers check `allowsDev` first. Reset keeps award records, so old battles never pay again. */
  grant(owner: string, grant: DeveloperGrant) {
    return this.change(owner, async (db, profile) => {
      const next = grant.reset ? emptyProfile() : applyGrant(profile, grant);
      await this.write(db, owner, next);
      return next;
    });
  }
}
