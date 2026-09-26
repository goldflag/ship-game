import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BattleSummary, XpAward as Award } from '../../progression/xp';
import { AWARD_MAX_WAIT_MS, AWARD_SETTLE_MS, AwardClaim, awardSplit, unlockProgress, type AwardClock, type XpReadout } from './battleAward';
import { emptyProfile, openProfile } from '../../progression/rules';
import { XpAward } from './XpAward';

const summary = (integrity: number): BattleSummary => ({ mode: 'custom', result: 'victory', durationS: 600,
  friendly: [{ presetId: 'fletcher', massKg: 2_900_000, lost: false, integrity: 1 }],
  enemy: [{ presetId: 'mogami', massKg: 15_000_000, lost: false, integrity, opposition: 'normal' }] });
const award: Award = { total: 376, nations: { usa: 338 }, free: 38, breakdown: { sinking: 0, damage: 190, time: 80, odds: 1.5, outcome: 1.5 } };

/** A clock the test advances by hand. */
function manualClock() {
  let now = 0, next = 1;
  const timers = new Map<number, { at: number; run(): void }>();
  const clock: AwardClock = { now: () => now, set: (run, ms) => { timers.set(next, { at: now + ms, run }); return next++; }, clear: handle => { timers.delete(handle as number); } };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run(); }
  };
  return { clock, advance };
}
const flushed = () => new Promise(resolve => setTimeout(resolve, 0));

describe('XP claim', () => {
  test('waits for the debrief to hold still, then reports the latest summary exactly once', async () => {
    const calls: [string, BattleSummary][] = [];
    const { clock, advance } = manualClock();
    const claim = new AwardClaim('b1', { award: async (id, value) => { calls.push([id, value]); return award; } }, clock);
    claim.observe(summary(.9));
    advance(AWARD_SETTLE_MS - 100);
    claim.observe(summary(.8)); // A late shell landed: the wait starts again.
    advance(AWARD_SETTLE_MS - 100);
    expect(calls).toHaveLength(0);
    claim.observe(summary(.8)); // Unchanged telemetry does not extend it.
    advance(100);
    expect(calls).toEqual([['b1', summary(.8)]]);
    expect(claim.state()).toEqual({ status: 'saving' });
    await flushed();
    expect(claim.state()).toEqual({ status: 'awarded', award });
    claim.observe(summary(.1)); claim.flush(); advance(AWARD_MAX_WAIT_MS);
    expect(calls).toHaveLength(1);
  });

  test('a debrief that never settles is reported at the ceiling, and leaving reports at once', async () => {
    const calls: BattleSummary[] = [];
    const store = { award: async (_: string, value: BattleSummary) => { calls.push(value); return award; } };
    const { clock, advance } = manualClock();
    const busy = new AwardClaim('b2', store, clock);
    for (let t = 0; t < AWARD_MAX_WAIT_MS; t += 1000) { busy.observe(summary(1 - t / 10000)); advance(1000); }
    expect(calls).toHaveLength(1);
    const leaving = new AwardClaim('b3', store, clock);
    leaving.observe(summary(.5)); leaving.flush();
    expect(calls).toHaveLength(2);
    advance(AWARD_MAX_WAIT_MS);
    expect(calls).toHaveLength(2);
    // Nothing observed, nothing to report.
    new AwardClaim('b4', store, clock).flush();
    expect(calls).toHaveLength(2);
  });

  test('a failed report keeps its summary for Retry', async () => {
    const calls: BattleSummary[] = [];
    let fail = true;
    const { clock } = manualClock();
    const claim = new AwardClaim('b5', { award: async (_, value) => { calls.push(value); if (fail) throw new Error('Research progress is unreachable.'); return award; } }, clock);
    claim.observe(summary(.7)); claim.flush();
    await flushed();
    expect(claim.state()).toEqual({ status: 'failed', error: 'Research progress is unreachable.' });
    claim.observe(summary(.2)); // Later changes do not alter what was reported.
    fail = false; claim.retry();
    await flushed();
    expect(calls).toEqual([summary(.7), summary(.7)]);
    expect(claim.state()).toEqual({ status: 'awarded', award });
    claim.retry();
    expect(calls).toHaveLength(2);
  });
});

describe('XP readout', () => {
  const readout = (state: XpReadout['state'], note?: string): XpReadout => ({ state, retry() {}, note });
  test('shows the award and its split by tree, with free XP last', () => {
    expect(awardSplit(award)).toBe('United States 338 · Free 38');
    expect(awardSplit({ ...award, nations: { japan: 1200, usa: 40 }, free: 0 })).toBe('United States 40 · Japan 1,200');
    const html = renderToStaticMarkup(<XpAward xp={readout({ status: 'awarded', award })} />);
    expect(html).toContain('+376 XP');
    expect(html).toContain('United States 338 · Free 38');
    expect(html).toContain('data-state="awarded"');
  });
  test('says when it is still tallying or saving, and offers Retry after a failure', () => {
    expect(renderToStaticMarkup(<XpAward xp={readout({ status: 'tallying' })} />)).toContain('Tallying XP…');
    expect(renderToStaticMarkup(<XpAward xp={readout({ status: 'saving' })} />)).toContain('Saving XP…');
    const failed = renderToStaticMarkup(<XpAward xp={readout({ status: 'failed', error: 'Research progress is unreachable.' })} />);
    expect(failed).toContain('XP not saved. Research progress is unreachable.');
    expect(failed).toMatch(/<button[^>]*>Retry<\/button>/);
  });
  test('an award of nothing explains itself when the enemy never fought back', () => {
    const none = { ...award, total: 0, nations: {}, free: 0 };
    const html = renderToStaticMarkup(<XpAward xp={readout({ status: 'awarded', award: none }, 'Targets that neither move nor shoot earn no XP.')} />);
    expect(html).toContain('+0 XP');
    expect(html).toContain('Targets that neither move nor shoot earn no XP.');
  });
});

test('XP counts toward the next ship in the line sailed, or the cheapest open one, and nothing when every ship is owned', () => {
  const profile = { ...emptyProfile(), xp: { ...emptyProfile().xp, usa: 1338 }, freeXp: 38 };
  expect(unlockProgress(profile, award, 'gleaves')).toEqual({ name: 'Fletcher', line: 'Destroyers', before: 1000, after: 1376, cost: 1800 });
  // Pensacola (1,500 XP) is the cheapest open US ship now that it replaced the cruiser line's placeholder.
  expect(unlockProgress(profile, award, 'local-design')?.name).toBe('Pensacola');
  expect(unlockProgress({ ...profile, xp: { ...profile.xp, usa: 5000 } }, award, 'gleaves')).toMatchObject({ after: 1800, cost: 1800 });
  expect(unlockProgress(openProfile(), award, 'gleaves')).toBeUndefined();
});
