import { expect, test } from 'bun:test';
import { BerthMotion } from './BerthMotion';
import { createSeaState, seaHeight, seaResponse } from './session/sea';

const hull = { length: 241, beam: 36, draft: 9.3 }, berth = { x: 240, z: 0, heading: 0 };
const port = { ...createSeaState('north-atlantic', 'clear', 0x6e617661, 9), direction: 35 * Math.PI / 180 };

test('a berthed destroyer rolls moderately in the default 9 m/s wind', () => {
  const destroyer = { length: 114.7, beam: 12.1, draft: 4.2 };
  for (const [direction, low, high] of [[35, 2, 3.5], [0, 3, 4.8]]) {
    const motion = new BerthMotion();
    let peakDegrees = 0;
    for (let tick = 0; tick < 120 * 60; tick++) {
      motion.update({ ...port, direction: direction * Math.PI / 180 }, destroyer, berth, 1 / 60);
      if (tick >= 30 * 60) peakDegrees = Math.max(peakDegrees, Math.abs(motion.roll) * 180 / Math.PI);
    }
    expect(peakDegrees).toBeGreaterThan(low);
    expect(peakDegrees).toBeLessThan(high);
  }
});

test('the sea response mirrors the authority: mean height under the hull and clamped slopes', () => {
  expect(seaResponse(createSeaState('north-atlantic', undefined, 1), hull, berth, 12)).toEqual({ heave: 0, roll: 0, pitch: 0 });
  const wave = seaResponse(port, hull, berth, 12);
  let mean = 0;
  for (const z of [-.4, -.2, 0, .2, .4]) for (const x of [-.3, .3]) mean += seaHeight(port, berth.x + x * hull.beam, berth.z + z * hull.length, 12) / 10;
  expect(wave.heave).toBeCloseTo(mean, 12);
  expect(wave.roll).toBeCloseTo((seaHeight(port, berth.x + 14.4, 0, 12) - seaHeight(port, berth.x - 14.4, 0, 12)) / 28.8, 12);
  expect(wave.pitch).toBeCloseTo((seaHeight(port, berth.x, -96.4, 12) - seaHeight(port, berth.x, 96.4, 12)) / 192.8, 12);
  // Heading turns the footprint with the hull: beam-on samples become fore and aft.
  const turned = seaResponse(port, hull, { ...berth, heading: Math.PI / 2 }, 12);
  expect(turned.roll).toBeCloseTo((seaHeight(port, berth.x, 14.4, 12) - seaHeight(port, berth.x, -14.4, 12)) / 28.8, 12);
  const steep = seaResponse({ ...port, amplitudeM: 40, wavelengthM: 60 }, hull, berth, 3);
  expect(Math.abs(steep.roll)).toBeLessThanOrEqual(.18);
  expect(Math.abs(steep.pitch)).toBeLessThanOrEqual(.08);
});

test('a berthed hull rides a 9 m/s sea gently, at any frame rate, and settles when the sea calms', () => {
  const ride = (dt: number) => {
    const motion = new BerthMotion(), peak = { heave: 0, roll: 0, pitch: 0 };
    for (let t = 0; t < 120; t += dt) {
      motion.update(port, hull, berth, dt);
      for (const key of ['heave', 'roll', 'pitch'] as const) peak[key] = Math.max(peak[key], Math.abs(motion[key]));
    }
    return { motion, peak };
  };
  const { motion, peak } = ride(1 / 60);
  // Visible, but a battleship alongside: decimetres of heave and well under two degrees.
  expect(peak.heave).toBeGreaterThan(.05); expect(peak.heave).toBeLessThan(port.amplitudeM);
  expect(peak.roll).toBeGreaterThan(.002); expect(peak.roll).toBeLessThan(.035);
  expect(peak.pitch).toBeGreaterThan(.0005); expect(peak.pitch).toBeLessThan(.01);
  const slow = ride(1 / 24).peak;
  for (const key of ['heave', 'roll', 'pitch'] as const) expect(slow[key] / peak[key]).toBeCloseTo(1, 1);
  for (let t = 0; t < 60; t += 1 / 60) motion.update({ ...port, amplitudeM: 0 }, hull, berth, 1 / 60);
  expect(Math.abs(motion.heave)).toBeLessThan(1e-3);
  expect(Math.abs(motion.roll)).toBeLessThan(1e-4);
  expect(Math.abs(motion.pitch)).toBeLessThan(1e-4);
  motion.reset();
  expect([motion.heave, motion.roll, motion.pitch]).toEqual([0, 0, 0]);
});
