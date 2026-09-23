import { expect, test } from 'bun:test';
import { PerspectiveCamera } from 'three/webgpu';
import { BOW_WAVE_SLOTS, BowWaves, kelvinSystems } from './BowWaves';
import type { WakeShip } from './FleetWakeFoam';
import { PreparedPoseGroup } from './FrameScene';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';

const k0 = 9.81 / 15.4 ** 2, depth = 4;
const height = (a: number, y: number) => kelvinSystems(a, y, k0, depth).reduce((sum, system) => sum + system.height, 0);

/** The Kelvin integral for a pressure point: Re ∫ e^(−k d) e^(i k (a cos θ + y sin θ)) dθ, k = k₀ sec²θ. */
function integral(a: number, y: number, samples = 6000): number {
  let sum = 0;
  const step = (Math.PI - 2e-3) / (samples - 1);
  for (let i = 0; i < samples; i++) {
    const theta = -Math.PI / 2 + 1e-3 + i * step, k = k0 / Math.cos(theta) ** 2;
    sum += Math.exp(-k * depth) * Math.cos(k * (a * Math.cos(theta) + y * Math.sin(theta)));
  }
  return sum * step;
}
const correlation = (x: number[], y: number[]) => {
  const mean = (v: number[]) => v.reduce((s, n) => s + n, 0) / v.length, mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  x.forEach((value, i) => { sxy += (value - mx) * (y[i] - my); sxx += (value - mx) ** 2; syy += (y[i] - my) ** 2; });
  return sxy / Math.sqrt(sxx * syy);
};

test('the closed-form Kelvin wake matches the Kelvin integral across the wedge', () => {
  for (const degrees of [0, 8, 14]) {
    const angle = degrees * Math.PI / 180, ranges = Array.from({ length: 140 }, (_, i) => 200 + i * 5);
    const closed = ranges.map(r => height(r * Math.cos(angle), r * Math.sin(angle)));
    const exact = ranges.map(r => integral(r * Math.cos(angle), r * Math.sin(angle)));
    expect(correlation(closed, exact)).toBeGreaterThan(.99);
    const rms = (v: number[]) => Math.sqrt(v.reduce((s, n) => s + n * n, 0) / v.length);
    expect(rms(exact) / rms(closed)).toBeCloseTo(1, 1);
  }
  // Mirror images to port and starboard; nothing ahead of the stem or outside the 19.47° cusp.
  expect(height(400, 60)).toBeCloseTo(height(400, -60), 10);
  expect(kelvinSystems(-10, 0, k0, depth)).toEqual([]);
  expect(kelvinSystems(400, 400 * Math.tan(20 * Math.PI / 180), k0, depth)).toEqual([]);
});

test('the analytic slope is the wave vector and needs no finite differences', () => {
  const analytic: number[] = [], numeric: number[] = [], h = .05;
  for (let a = 300; a < 500; a += 3.7) for (let y = 10; y < 120; y += 4.3) {
    if (y / a > .3) continue;
    const slope = kelvinSystems(a, y, k0, depth).reduce((sum, s) => ({ a: sum.a + s.slopeA, y: sum.y + s.slopeY }), { a: 0, y: 0 });
    analytic.push(slope.a, slope.y);
    numeric.push((height(a + h, y) - height(a - h, y)) / (2 * h), (height(a, y + h) - height(a, y - h)) / (2 * h));
  }
  expect(correlation(analytic, numeric)).toBeGreaterThan(.97);
});

function ship(x: number, speed: number): WakeShip {
  const definition = shipPreset('fletcher');
  return { definition, root: new PreparedPoseGroup(), motion: { ...new CombatSimulation(definition).ship, x, z: 0, speed } };
}

test('the nearest moving, surfaced hulls hold the bow-wave slots', () => {
  const waves = new BowWaves(), camera = new PerspectiveCamera(50, 1.6, 1, 1000);
  const ships = [ship(0, 0), ...Array.from({ length: 11 }, (_, i) => ship((i + 1) * 300, 15))];
  ships[1].motion.y = -4;
  waves.update(ships, .1, camera);
  // Stopped and submerged hulls raise no bow wave; the rest fill the nearest slots.
  expect(waves.diagnostics().slots).toBe(BOW_WAVE_SLOTS);
  expect(waves.diagnostics().speeds.every(speed => speed === 15)).toBe(true);
  waves.enabled = false;
  waves.update(ships, .1, camera);
  expect(waves.diagnostics().enabled).toBe(false);
  waves.enabled = true;
  // A hull that surges ahead eases into its wave pattern instead of snapping to it.
  const surging = ship(0, 0);
  waves.update([surging], .1, camera);
  surging.motion.speed = 15;
  waves.update([surging], .1, camera);
  expect(waves.diagnostics().speeds[0]).toBeLessThan(1);
  for (let i = 0; i < 20; i++) waves.update([surging], .1, camera);
  const [eased] = waves.diagnostics().speeds;
  expect(eased).toBeGreaterThan(5);
  expect(eased).toBeLessThan(15);
  waves.reset();
  expect(waves.diagnostics().slots).toBe(0);
});

test('a steady turn bends the V onto the circle the hull is running', () => {
  const waves = new BowWaves(), camera = new PerspectiveCamera(50, 1.6, 1, 1000);
  const turning = ship(0, 12), radius = 600, pace = 18, dt = .1;
  for (let i = 0; i < 120; i++) {
    const { motion } = turning;
    motion.x += Math.sin(motion.heading) * pace * dt; motion.z -= Math.cos(motion.heading) * pace * dt;
    motion.heading += pace / radius * dt;
    waves.update([turning], dt, camera);
  }
  expect(waves.diagnostics().curvatures[0]).toBeCloseTo(1 / radius, 4);
  // Turning to port reverses the sign; a teleport forgets the old track.
  for (let i = 0; i < 120; i++) {
    const { motion } = turning;
    motion.x += Math.sin(motion.heading) * pace * dt; motion.z -= Math.cos(motion.heading) * pace * dt;
    motion.heading -= pace / radius * dt;
    waves.update([turning], dt, camera);
  }
  expect(waves.diagnostics().curvatures[0]).toBeCloseTo(-1 / radius, 4);
  turning.motion.x += 5000;
  waves.update([turning], dt, camera);
  expect(waves.diagnostics().curvatures[0]).toBe(0);
});
