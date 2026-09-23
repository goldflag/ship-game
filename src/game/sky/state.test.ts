import { expect, test } from 'bun:test';
import { Vector3 } from 'three/webgpu';
import { SkyState } from './state';

test('seeking stands sky time and the cloud drift where that many seconds of the wind put them, whatever ran before', () => {
  const ridden = new SkyState(), sought = new SkyState();
  for (let i = 0; i < 90 * 30; i++) ridden.advance(1 / 30, new Vector3());
  for (let i = 0; i < 400; i++) sought.advance(1 / 24, new Vector3());
  sought.seek(90);
  expect(sought.time).toBe(90);
  expect(sought.uniforms.time.value).toBe(90);
  expect(sought.uniforms.windOffset.value.distanceTo(ridden.uniforms.windOffset.value)).toBeLessThan(1e-6);
  expect(sought.uniforms.windOffset.value.length()).toBeCloseTo(sought.wind.length() * 90, 6);
});
