/** The XP claim for one decided battle. Shells in flight keep landing after the decision, so the debrief changes for a
 * few seconds; the claim waits until the summary has held still (or a ceiling passes), then reports it exactly once.
 * Leaving the end screen reports at once with what is known. A failed report keeps the same summary for Retry, so the
 * accounts API, which pays each battle id once, never sees two different results for one battle. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BattleSummary, XpAward } from '../../progression/xp';
import type { ProgressStore } from '../../progression/store';
import { NATION_IDS, techNation } from '../../progression/techTree';

export type AwardState =
  | { status: 'tallying' }
  | { status: 'saving' }
  | { status: 'awarded'; award: XpAward }
  | { status: 'failed'; error: string };
/** What the end screens show: the claim's state and the Retry command. */
export interface XpReadout { state: AwardState; retry(): void; note?: string }

/** The summary must hold this long unchanged… */
export const AWARD_SETTLE_MS = 2500;
/** …or this long after the decision, whichever comes first. Well inside the 15 s automatic return. */
export const AWARD_MAX_WAIT_MS = 8000;

export interface AwardClock { now(): number; set(run: () => void, ms: number): unknown; clear(handle: unknown): void }
const realClock: AwardClock = { now: () => Date.now(), set: (run, ms) => setTimeout(run, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

export class AwardClaim {
  private summary?: BattleSummary;
  private key = '';
  private first = 0;
  private changed = 0;
  private timer: unknown;
  private submitted = false;
  private current: AwardState = { status: 'tallying' };
  private readonly listeners = new Set<() => void>();
  constructor(readonly battleId: string, private readonly store: Pick<ProgressStore, 'award'>, private readonly clock: AwardClock = realClock) {}

  readonly state = () => this.current;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  /** The latest summary while the debrief settles. Ignored once reported. */
  observe(summary: BattleSummary): void {
    if (this.submitted) return;
    const now = this.clock.now(), key = JSON.stringify(summary);
    if (!this.summary) this.first = now;
    if (key !== this.key) { this.key = key; this.summary = summary; this.changed = now; }
    this.clock.clear(this.timer);
    this.timer = this.clock.set(() => this.submit(), Math.max(0, Math.min(this.changed + AWARD_SETTLE_MS, this.first + AWARD_MAX_WAIT_MS) - now));
  }
  /** Report now: the player is leaving the end screen. */
  readonly flush = () => { if (!this.submitted) this.submit(); };
  readonly retry = () => { if (this.current.status === 'failed') { this.submitted = false; this.submit(); } };
  dispose(): void { this.clock.clear(this.timer); }

  private submit(): void {
    this.clock.clear(this.timer);
    const summary = this.summary;
    if (!summary || this.submitted) return;
    this.submitted = true;
    this.set({ status: 'saving' });
    this.store.award(this.battleId, summary).then(
      award => this.set({ status: 'awarded', award }),
      error => this.set({ status: 'failed', error: error instanceof Error ? error.message : String(error) }),
    );
  }
  private set(state: AwardState): void { this.current = state; this.listeners.forEach(listener => listener()); }
}

const idle = () => () => {};
const tallying: AwardState = { status: 'tallying' };
/** Holds the claim for the battle on the end screen. `summary` is present only while a decided battle's end screen is up;
 * when it goes (the player left, the mission restarted) the claim reports what it has. */
export function useBattleAward(store: Pick<ProgressStore, 'award'>, battleId: string | undefined, summary: BattleSummary | undefined, note?: string): XpReadout | undefined {
  const held = useRef<AwardClaim | undefined>(undefined);
  const [claim, setClaim] = useState<AwardClaim>();
  const key = summary && JSON.stringify(summary);
  useEffect(() => {
    if (!battleId || !summary) { held.current?.flush(); return; }
    let current = held.current;
    if (current?.battleId !== battleId) {
      current?.flush(); current?.dispose();
      current = held.current = new AwardClaim(battleId, store);
      setClaim(current);
    }
    current.observe(summary);
  }, [battleId, key]);
  useEffect(() => () => { held.current?.flush(); held.current?.dispose(); }, []);
  const state = useSyncExternalStore(claim?.subscribe ?? idle, claim?.state ?? (() => tallying), claim?.state ?? (() => tallying));
  if (!summary || !battleId) return undefined;
  // Until the effect has made this battle's claim, the readout says the tally is under way.
  return claim?.battleId === battleId ? { state, retry: claim.retry, note } : { state: tallying, retry: () => {}, note };
}

/** "United States 338 · Free 38": the award split into the pools it was credited to. */
export function awardSplit(award: XpAward): string {
  const parts = NATION_IDS.filter(id => (award.nations[id] ?? 0) > 0).map(id => `${techNation(id).name} ${award.nations[id]!.toLocaleString('en-US')}`);
  if (award.free > 0) parts.push(`Free ${award.free.toLocaleString('en-US')}`);
  return parts.join(' · ');
}
