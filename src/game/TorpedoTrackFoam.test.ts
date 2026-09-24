import { expect, test } from 'bun:test';
import { TorpedoTrackFoam } from './TorpedoTrackFoam';
import { WAKE_EXTENT } from './WakeFoam';
import { cpuWakeFoamPainter } from './testing/wakeFoam';

const RESOLUTION = 512, SPEED = 24;
const coverage = (foam: TorpedoTrackFoam, x: number, z: number) => {
  const { data } = foam.texture.image as { data: Uint8Array };
  const scale = RESOLUTION / WAKE_EXTENT;
  const px = Math.round((x - foam.center.x) * scale + RESOLUTION / 2 - .5), pz = Math.round((z - foam.center.y) * scale + RESOLUTION / 2 - .5);
  return data[pz * RESOLUTION + px];
};
/** Run one round due north from the origin, then turn it east. */
const run = (foam: TorpedoTrackFoam, seconds: number, depth = 3, from = { x: 0, z: 0, t: 0 }) => {
  const state = { ...from };
  for (let i = 0; i < seconds * 20; i++) {
    state.t += .05;
    if (state.t < 12) state.z -= SPEED * .05; else state.x += SPEED * .05;
    foam.update([{ id: 7, position: [state.x, -depth, state.z], velocity: [0, 0, -SPEED] }], .05, 0, 0);
  }
  return state;
};

test('a torpedo track surfaces astern of the round and stays where it was laid', () => {
  const foam = new TorpedoTrackFoam(RESOLUTION, cpuWakeFoamPainter);
  const state = run(foam, 10);
  // Exhaust from 3 m takes two seconds to rise: nothing shows over the round.
  expect(coverage(foam, 0, state.z)).toBe(0);
  expect(coverage(foam, 0, state.z + 20)).toBe(0);
  expect(coverage(foam, 0, state.z + 110)).toBeGreaterThan(90);
  // It is a narrow line on the water.
  expect(coverage(foam, 12, state.z + 110)).toBe(0);
  const turned = run(foam, 8, 3, state);
  // The northward leg remains on its own course after the round turns east.
  expect(coverage(foam, 0, -200)).toBeGreaterThan(40);
  expect(coverage(foam, turned.x - 110, turned.z)).toBeGreaterThan(90);
  // The track outlives the round, then dissolves.
  for (let i = 0; i < 100; i++) foam.update([], .05, 0, 0);
  expect(coverage(foam, turned.x - 60, turned.z)).toBeGreaterThan(40);
  for (let i = 0; i < 800; i++) foam.update([], .05, 0, 0);
  expect((foam.texture.image as { data: Uint8Array }).data.every(value => value === 0)).toBe(true);
  expect(foam.diagnostics().samples).toBe(0);
  foam.dispose();
});

test('airborne and deep rounds leave no track, and a pause or reset holds or clears it', () => {
  const foam = new TorpedoTrackFoam(RESOLUTION, cpuWakeFoamPainter);
  for (const height of [3, -9]) {
    for (let i = 1; i <= 200; i++) foam.update([{ id: 1, position: [0, height, -i * SPEED * .05], velocity: [0, 0, -SPEED] }], .05, 0, 0);
    expect(foam.diagnostics().samples).toBe(0);
  }
  run(foam, 8);
  const before = Uint8Array.from((foam.texture.image as { data: Uint8Array }).data);
  foam.update([{ id: 7, position: [0, -3, -500], velocity: [0, 0, -SPEED] }], 0, 0, 0);
  expect((foam.texture.image as { data: Uint8Array }).data).toEqual(before);
  expect(before.some(value => value > 0)).toBe(true);
  foam.reset();
  expect((foam.texture.image as { data: Uint8Array }).data.every(value => value === 0)).toBe(true);
  foam.dispose();
});

test('expiry cuts exactly the samples a filter of the whole track would, however deep each round ran', () => {
  const painted = (foam: TorpedoTrackFoam) => (foam as unknown as { samples: { x: number; z: number; surfaced: number }[] }).samples;
  const foam = new TorpedoTrackFoam(RESOLUTION, cpuWakeFoamPainter), reference = new TorpedoTrackFoam(RESOLUTION, cpuWakeFoamPainter);
  // The reference drops expired samples by filtering the whole list, as the track did before it cut only the old run.
  Object.assign(reference, { expire(this: { samples: { surfaced: number }[] }, now: number) { this.samples = this.samples.filter(s => now - s.surfaced <= 30); } });
  const rounds = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, position: [i * 40, -(1 + i * 1.4), 0] as [number, number, number], velocity: [0, 0, -SPEED] as [number, number, number] }));
  for (let frame = 0; frame < 1500; frame++) {
    const live = frame < 700 ? rounds : rounds.filter(r => r.id % 2);
    for (const r of live) r.position[2] -= SPEED * .05 * (1 + r.id * .1);
    for (const f of [foam, reference]) f.update(live, frame % 50 ? .05 : .031, 0, 0);
    expect(painted(foam).map(s => [s.x, s.z, s.surfaced])).toEqual(painted(reference).map(s => [s.x, s.z, s.surfaced]));
  }
  expect(painted(foam).length).toBeGreaterThan(0);
  foam.dispose(); reference.dispose();
});
