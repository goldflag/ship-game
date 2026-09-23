import { expect, test } from 'bun:test';
import { cameraPin, parseCameraPose } from './cameraPoses';

test('presets orbit the hull in her own frame: bow ahead (−Z), broadside to starboard (+X), top above her', () => {
  const [bow, broadside, astern, top] = (['bow', 'broadside', 'astern', 'top'] as const).map(preset => cameraPin(preset, 200));
  expect(bow.eye[2]).toBeLessThan(-200); expect(Math.abs(bow.eye[0])).toBeLessThan(1e-9);
  expect(broadside.eye[0]).toBeCloseTo(200 * 1.35 * Math.cos(6 * Math.PI / 180), 6); expect(broadside.eye[2]).toBeCloseTo(0, 6);
  expect(astern.eye[2]).toBeGreaterThan(200);
  expect(top.eye[1]).toBeGreaterThan(290); expect(top.eye[2]).toBeGreaterThan(0);
  for (const pin of [bow, broadside, astern, top]) expect(pin.target).toEqual([0, 6, 0]);
});

test('explicit poses keep their target, lens and ship; text parses to a preset or an orbit', () => {
  expect(cameraPin({ eye: [10, 20, 30], target: [1, 2, 3], fov: 30, ship: 'b' }, 100)).toEqual({ eye: [10, 20, 30], target: [1, 2, 3], fov: 30, shipId: 'b' });
  const orbit = cameraPin({ azimuth: 270, elevation: 0, distance: 50, target: [0, 0, 0] }, 100);
  expect(orbit.eye[0]).toBeCloseTo(-50, 9); expect(orbit.eye[1]).toBeCloseTo(0, 9);
  expect(cameraPin({ preset: 'broadside', ship: 'enemy-1' }, 100).shipId).toBe('enemy-1');
  expect(parseCameraPose('bowQuarter')).toBe('bowQuarter');
  expect(parseCameraPose('30,10,400')).toEqual({ azimuth: 30, elevation: 10, distance: 400 });
  expect(() => parseCameraPose('sideways')).toThrow(/preset/);
  expect(() => cameraPin('sideways' as never, 100)).toThrow(/Unknown camera preset/);
});
