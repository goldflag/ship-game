/** Browser side of research progress (not shared with the API). Signed-in players read and write their
 * profile through the accounts API; the account-free harness keeps a local profile with every ship open,
 * or, with `?progress=fresh`, a persisted local profile that starts empty so locked states can be tested. */
import { assetUrl } from '../assetUrl';
import { applyAward, applyGrant, applyUnlock, emptyProfile, openProfile, ownsPreset, ProgressError, sanitizeProfile, type ProgressProfile } from './rules';
import { presetPlace } from './techTree';
import { awardFor, validateSummary, type BattleSummary, type XpAward } from './xp';

export type ProgressStatus = 'loading' | 'ready' | 'unavailable';
export interface ProgressSnapshot {
  status: ProgressStatus;
  profile: ProgressProfile;
  source: 'account' | 'harness';
  /** Why progress could not load; ships stay available meanwhile. */
  error?: string;
  /** The most recent award this page received. */
  lastAward?: { battleId: string; award: XpAward };
}
export interface DeveloperGrant { xp?: number; unlockAll?: boolean; reset?: boolean }
export interface ProgressStore {
  snapshot(): ProgressSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  /** Spends XP on a node. Rejects with a readable message. */
  unlock(nodeId: string): Promise<void>;
  /** Reports a decided battle once; the same id never pays twice. */
  award(battleId: string, summary: BattleSummary): Promise<XpAward>;
  /** Developer console grants. The API refuses them unless enabled for the account. */
  grant(grant: DeveloperGrant): Promise<void>;
}
export class ProgressStoreError extends Error { constructor(readonly code: string, message: string) { super(message); } }

/** Whether a preset may join the player's own fleet. Player designs are always allowed and are not
 * presets; presets outside the trees (fictional ships, merchants) never are. Until progress has loaded,
 * or when it cannot load, every tree ship stays available rather than locking players out. */
export function canCommandPreset(snapshot: ProgressSnapshot, presetId: string) {
  if (!presetPlace(presetId)) return false;
  return snapshot.status !== 'ready' || ownsPreset(snapshot.profile, presetId);
}

function observable(initial: ProgressSnapshot) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next: Partial<ProgressSnapshot>) { current = { ...current, ...next }; listeners.forEach(fn => fn()); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export function createAccountProgressStore(account: string, fetcher: Fetcher = (input, init) => fetch(input, init)): ProgressStore {
  const state = observable({ status: 'loading', profile: emptyProfile(), source: 'account' });
  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await fetcher(assetUrl('api/progress') + path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-account-id': account },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ProgressStoreError('unavailable', 'Research progress is unreachable. Check your connection and retry.');
    }
    if (!response.ok) {
      const value = await response.json().catch(() => ({})) as { code?: string; error?: string };
      throw new ProgressStoreError(value.code ?? (response.status === 404 ? 'unavailable' : 'failed'),
        value.error ?? (response.status === 404 ? 'Research progress is not available on this server yet.' : 'Research progress could not be saved. Retry shortly.'));
    }
    return response.json() as Promise<T>;
  };
  const adopt = (profile: unknown) => state.set({ status: 'ready', profile: sanitizeProfile(profile), error: undefined });
  const refresh = async () => {
    try { adopt((await request<{ profile: unknown }>('')).profile); }
    catch (error) { state.set({ status: state.get().status === 'ready' ? 'ready' : 'unavailable', error: (error as Error).message }); }
  };
  const awarded = new Map<string, Promise<XpAward>>();
  return {
    snapshot: state.get, subscribe: state.subscribe, refresh,
    async unlock(nodeId) { adopt((await request<{ profile: unknown }>('/unlocks', { nodeId })).profile); },
    award(battleId, summary) {
      let pending = awarded.get(battleId);
      if (!pending) {
        pending = request<{ profile: unknown; award: XpAward }>('/awards', { id: battleId, summary }).then(result => {
          adopt(result.profile);
          state.set({ lastAward: { battleId, award: result.award } });
          return result.award;
        });
        pending.catch(() => awarded.delete(battleId));
        awarded.set(battleId, pending);
      }
      return pending;
    },
    async grant(grant) { adopt((await request<{ profile: unknown }>('/dev', grant)).profile); },
  };
}

export const HARNESS_PROGRESS_KEY = 'naval-progress-harness-v1';
/** The account-free harness. `fresh` persists a local profile that starts with only the starters. */
export function createHarnessProgressStore(fresh = typeof location !== 'undefined' && new URLSearchParams(location.search).get('progress') === 'fresh'): ProgressStore {
  const load = (): ProgressProfile => {
    if (!fresh) return openProfile();
    try { const saved = localStorage.getItem(HARNESS_PROGRESS_KEY); return saved ? sanitizeProfile(JSON.parse(saved)) : emptyProfile(); }
    catch { return emptyProfile(); }
  };
  const state = observable({ status: 'ready', profile: load(), source: 'harness' });
  const save = (profile: ProgressProfile) => {
    state.set({ profile });
    if (fresh) try { localStorage.setItem(HARNESS_PROGRESS_KEY, JSON.stringify(profile)); } catch { /* private window: keep it in memory */ }
  };
  const awarded = new Map<string, XpAward>();
  return {
    snapshot: state.get, subscribe: state.subscribe,
    async refresh() { state.set({ profile: load() }); },
    async unlock(nodeId) {
      try { save(applyUnlock(state.get().profile, nodeId).profile); }
      catch (error) { throw error instanceof ProgressError ? new ProgressStoreError(error.code, error.message) : error; }
    },
    async award(battleId, summary) {
      const prior = awarded.get(battleId);
      if (prior) return prior;
      const award = awardFor(validateSummary(summary));
      awarded.set(battleId, award);
      save(applyAward(state.get().profile, award));
      state.set({ lastAward: { battleId, award } });
      return award;
    },
    async grant(grant) { save(grant.reset ? (fresh ? emptyProfile() : openProfile()) : applyGrant(state.get().profile, grant)); },
  };
}
