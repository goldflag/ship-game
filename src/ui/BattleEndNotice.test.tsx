import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BATTLE_END_HOLD_MS, BattleEndNotice, holdBattleEnd, scheduleBattleExit } from './BattleEndNotice';

test('battle end notice explains the result and automatic departure', () => {
  for (const result of ['victory', 'defeat', 'draw'] as const) {
    const html = renderToStaticMarkup(<BattleEndNotice result={result} onExit={() => {}}/>);
    expect(html).toContain('Battle over');
    expect(html).toContain(result[0].toUpperCase() + result.slice(1));
    expect(html).toContain('Returning to port in');
    expect(html).toContain('15');
  }
});

test('battle end notice carries the XP line, and a failed save stays quiet with Retry', () => {
  const award = { total: 52, nations: { japan: 47 }, free: 5, breakdown: { sinking: 0, damage: 0, time: 35, odds: 1, outcome: 1.5 } };
  const html = renderToStaticMarkup(<BattleEndNotice result="victory" onExit={() => {}} xp={{ state: { status: 'awarded', award }, retry() {} }}/>);
  expect(html).toContain('+52 XP'); expect(html).toContain('Japan 47 · Free 5');
  const failed = renderToStaticMarkup(<BattleEndNotice result="defeat" onExit={() => {}} xp={{ state: { status: 'failed', error: 'Offline.' }, retry() {} }}/>);
  expect(failed).toContain('XP not saved. Offline.'); expect(failed).toContain('Retry'); expect(failed).toContain('Returning to port in');
  expect(renderToStaticMarkup(<BattleEndNotice result="draw" outcome={{ winnerTeamId: null, reason: 'abandoned', finalTick: 1, afloatKg: [1, 1] }} onExit={() => {}}/>)).not.toContain('XP');
});

test('departure uses a real-time deadline and cleanup cancels both timers', () => {
  const original = { now: Date.now, timeout: globalThis.setTimeout, interval: globalThis.setInterval, clearTimeout: globalThis.clearTimeout, clearInterval: globalThis.clearInterval };
  let now = 1000, seconds = 15, exits = 0, delay = 0;
  let update!: () => void, leave!: () => void;
  const cleared: number[] = [];
  try {
    Date.now = () => now;
    globalThis.setInterval = ((callback: () => void) => { update = callback; return 1; }) as typeof setInterval;
    globalThis.setTimeout = ((callback: () => void, ms: number) => { leave = callback; delay = ms; return 2; }) as typeof setTimeout;
    globalThis.clearInterval = ((id: number) => { cleared.push(id); }) as typeof clearInterval;
    globalThis.clearTimeout = ((id: number) => { cleared.push(id); }) as typeof clearTimeout;
    const cancel = scheduleBattleExit(value => { seconds = value; }, () => { exits++; });
    expect(delay).toBe(15000);
    now += 1000; update(); expect(seconds).toBe(14); expect(exits).toBe(0);
    now += 13999; update(); expect(seconds).toBe(1); expect(exits).toBe(0);
    now += 1; leave(); expect(seconds).toBe(0); expect(exits).toBe(1);
    cancel(); expect(cleared).toContain(1); expect(cleared).toContain(2);
  } finally {
    Date.now = original.now; globalThis.setTimeout = original.timeout; globalThis.setInterval = original.interval;
    globalThis.clearTimeout = original.clearTimeout; globalThis.clearInterval = original.clearInterval;
  }
});

test('the end screen waits a few seconds after the decision, and cleanup cancels the wait', () => {
  const original = { timeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let show!: () => void, delay = 0, shown = 0;
  const cleared: number[] = [];
  try {
    globalThis.setTimeout = ((callback: () => void, ms: number) => { show = callback; delay = ms; return 3; }) as typeof setTimeout;
    globalThis.clearTimeout = ((id: number) => { cleared.push(id); }) as typeof clearTimeout;
    const cancel = holdBattleEnd(() => { shown++; });
    expect(delay).toBe(BATTLE_END_HOLD_MS); expect(BATTLE_END_HOLD_MS).toBeGreaterThanOrEqual(3000); expect(shown).toBe(0);
    show(); expect(shown).toBe(1);
    cancel(); expect(cleared).toEqual([3]);
  } finally {
    globalThis.setTimeout = original.timeout; globalThis.clearTimeout = original.clearTimeout;
  }
});
