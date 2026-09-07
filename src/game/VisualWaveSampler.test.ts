import { expect, test } from 'bun:test';
import { Vector3 } from 'three/webgpu';
import type { IWaveSampler } from '../../vendor/threejs-water-pro/build/simulation/waves/IWaveSampler';
import { VisualWaveSampler } from './VisualWaveSampler';

function delayedSampler() {
  let finish!: () => void, reject!: (error: Error) => void, calls = 0, disposed = false, height = 0, x = 0;
  const normal = new Vector3(0, 1, 0);
  const sampler: IWaveSampler = {
    setPositions: p => { x = p[0].x; },
    update: () => { calls++; const sampledX = x; return new Promise<void>((resolve, fail) => { finish = () => { height = sampledX; resolve(); }; reject = fail; }); },
    updateLowLatency: async () => {}, getSample: () => ({ height, normal }), getSamples: () => [{ height, normal }], getSampleCount: () => 1,
    updateCascadeUniforms() {}, dispose: () => { disposed = true; },
  };
  return { sampler, finish: () => finish(), fail: () => reject(new Error('readback failed')), calls: () => calls, disposed: () => disposed };
}
test('visual frames reuse completed ocean samples without waiting or queueing GPU readbacks', async () => {
  const gpu = delayedSampler(), visual = new VisualWaveSampler(gpu.sampler);
  visual.setPositions([new Vector3(10, 0, 0)]);
  await visual.updateLowLatency(); // Must resolve before the GPU callback below.
  for (let frame = 0; frame < 10; frame++) { visual.setPositions([new Vector3(20 + frame, 0, 0)]); await visual.updateLowLatency(); }
  expect(gpu.calls()).toBe(1); expect(visual.getSample(0).height).toBe(0);
  gpu.finish(); await Promise.resolve(); await Promise.resolve();
  expect(visual.getSample(0).height).toBe(10);
  await visual.updateLowLatency(); expect(gpu.calls()).toBe(2);
  let drained = false; const draining = visual.drain().then(() => { drained = true; });
  await Promise.resolve(); expect(drained).toBe(false);
  gpu.finish(); await draining; expect(visual.getSample(0).height).toBe(29);
  await visual.updateLowLatency(); expect(gpu.calls()).toBe(2);
  visual.dispose(); expect(gpu.disposed()).toBe(true);
});
test('readback errors reach the next frame and cleanup still completes', async () => {
  const gpu = delayedSampler(), visual = new VisualWaveSampler(gpu.sampler);
  visual.setPositions([new Vector3()]); await visual.updateLowLatency(); gpu.fail();
  await Promise.resolve(); await Promise.resolve();
  await expect(visual.updateLowLatency()).rejects.toThrow('readback failed');
  await visual.drain(); visual.dispose(); expect(gpu.disposed()).toBe(true);
});
