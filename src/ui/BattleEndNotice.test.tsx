import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BattleEndNotice, scheduleBattleExit } from './BattleEndNotice';

test('battle end notice explains the result and automatic departure', () => {
  for (const result of ['victory', 'defeat', 'draw'] as const) {
    const html = renderToStaticMarkup(<BattleEndNotice result={result} onExit={() => {}}/>);
    expect(html).toContain('Battle over');
    expect(html).toContain(result[0].toUpperCase() + result.slice(1));
    expect(html).toContain('Returning to port in');
    expect(html).toContain('15');
  }
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
