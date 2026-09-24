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

/** The samples of a track in order, as (x, z, surfaced) triples. */
const samplesOf = (foam: TorpedoTrackFoam) => {
  const { data, first, count } = foam as unknown as { data: Float64Array; first: number; count: number };
  return Array.from({ length: count }, (_, i) => [data[(first + i) * 8], data[(first + i) * 8 + 1], data[(first + i) * 8 + 4]]);
};
type Round = { id: number; position: [number, number, number]; velocity: [number, number, number] };
/** The track as it kept its samples before: an object each, laid the same way, expired by filtering the whole list. */
function listTrack() {
  const running = new Map<number, { x: number; z: number; carry: number }>();
  let samples: { x: number; z: number; surfaced: number }[] = [], time = 0;
  return {
    get samples() { return samples.map(s => [s.x, s.z, s.surfaced]); },
    update(rounds: Round[], dt: number) {
      time += dt;
      const now = time, present = new Set(rounds.map(t => t.id));
      for (const id of running.keys()) if (!present.has(id)) running.delete(id);
      for (const t of rounds) {
        const [x, y, z] = t.position, previous = running.get(t.id);
        if (!previous) { running.set(t.id, { x, z, carry: 0 }); continue; }
        const distance = Math.hypot(x - previous.x, z - previous.z);
        const t2 = Math.max(0, Math.min((y + 8) / 4, 1)), strength = y > 0 ? 0 : t2 * t2 * (3 - 2 * t2);
        if (distance > 200 || strength <= 0) { previous.x = x; previous.z = z; previous.carry = 0; continue; }
        if (distance < .0001) continue;
        const rise = Math.max(.6, -y / 1.5);
        for (let along = 4 - previous.carry; along <= distance; along += 4) {
          const fraction = along / distance, born = now - dt * (1 - fraction);
          samples.push({ x: previous.x + (x - previous.x) * fraction, z: previous.z + (z - previous.z) * fraction, surfaced: born + rise });
        }
        previous.carry = (previous.carry + distance) % 4;
        previous.x = x; previous.z = z;
      }
      if (samples.length && now - samples[0].surfaced > 30) samples = samples.filter(s => now - s.surfaced <= 30);
    },
  };
}

test('expiry cuts exactly the samples a filter of the whole track would, however deep each round ran', () => {
  const foam = new TorpedoTrackFoam(RESOLUTION, cpuWakeFoamPainter), reference = listTrack();
  const rounds: Round[] = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, position: [i * 40, -(1 + i * 1.4), 0], velocity: [0, 0, -SPEED] }));
  for (let frame = 0; frame < 1500; frame++) {
    const live = frame < 700 ? rounds : rounds.filter(r => r.id % 2);
    for (const r of live) r.position[2] -= SPEED * .05 * (1 + r.id * .1);
    const dt = frame % 50 ? .05 : .031;
    foam.update(live, dt, 0, 0); reference.update(live, dt);
    expect(samplesOf(foam)).toEqual(reference.samples);
  }
  expect(samplesOf(foam).length).toBeGreaterThan(0);
  foam.dispose();
});

test('a field with nothing to show is painted once, not again on every refresh', () => {
  const updates = { count: 0 };
  const foam = new TorpedoTrackFoam(RESOLUTION, (resolution, tiles, channels) => {
    const painter = cpuWakeFoamPainter(resolution, tiles, channels), update = painter.update.bind(painter);
    painter.update = collectors => { updates.count++; update(collectors); };
    return painter;
  });
  const texture = () => (foam.texture.image as { data: Uint8Array }).data;
  // A round far outside the field refreshes it twenty times a second, with nothing to paint after the first clear.
  for (let i = 1; i <= 200; i++) foam.update([{ id: 1, position: [5000, -3, -i * SPEED * .05], velocity: [0, 0, -SPEED] }], .05, 0, 0);
  expect(foam.diagnostics().samples).toBeGreaterThan(0);
  expect(updates.count).toBe(1);
  // A near one paints; once its track has faded the field is cleared, and a far round again paints nothing.
  const state = run(foam, 8);
  expect(texture().some(value => value > 0)).toBe(true);
  for (let i = 0; i < 900; i++) foam.update([], .05, 0, 0);
  expect(texture().every(value => value === 0)).toBe(true);
  const cleared = updates.count;
  for (let i = 0; i < 100; i++) foam.update([{ id: 2, position: [5000, -3, state.z - i * 2], velocity: [0, 0, -SPEED] }], .05, 0, 0);
  expect(foam.diagnostics().samples).toBeGreaterThan(0);
  expect(updates.count).toBe(cleared);
  foam.dispose();
});
