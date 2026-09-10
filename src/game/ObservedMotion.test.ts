import { expect, test } from 'bun:test';
import { ObservedMotion } from './ObservedMotion';
import type { ObservedPose } from './session/BattleSession';

test.each([1, 2, 4])('10 Hz aircraft samples stay smooth on render frames at %sx, including repeated worker ticks', speed => {
  const motion = new ObservedMotion();
  let last = 0, movingFrames = 0;
  const report: ObservedPose = { id: 'contact', position: [0, 400, 0], velocity: [90, 0, 0], heading: Math.PI / 2, observedTick: 0, observers: ['own'] };
  motion.update([report], 0, 0);
  for (let frame = 1; frame <= 180; frame++) {
    // Worker responses at 20 Hz; visibility is sampled at 10 Hz. Rendering
    // must keep advancing on the intervening frames, without changing reports.
    const tick = Math.floor(frame / 3) * 3 * speed;
    const observedTick = Math.floor(tick / 6) * 6;
    const sample = { ...report, observedTick, position: [observedTick / 60 * 90, 400, 0] as [number, number, number] };
    const wire = JSON.stringify(sample);
    motion.update([sample], tick, speed / 60);
    const x = motion.get('contact')!.position.x;
    expect(x).toBeGreaterThan(last);
    expect(x - last).toBeLessThan(90 * speed / 60 * 2);
    if (frame % 3 !== 0 && x > last) movingFrames++;
    expect(JSON.stringify(sample)).toBe(wire);
    last = x;
  }
  expect(movingFrames).toBe(120);
  const frozen = motion.get('contact')!.position.toArray();
  motion.update([{ ...report, observedTick: 180 * speed, position: [last + 1, 400, 0] }], 180 * speed, 0);
  expect(motion.get('contact')!.position.toArray()).toEqual(frozen);
  motion.update([], 180 * speed, 0);
  expect(motion.get('contact')).toBeUndefined();
});
