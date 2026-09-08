import { afterEach, expect, test } from 'bun:test';
import { Group, Mesh } from 'three/webgpu';
import { Game } from './Game';

const originalRaf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
afterEach(() => {
  if (originalRaf) Object.defineProperty(globalThis, 'requestAnimationFrame', originalRaf);
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
});

function startup() {
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now())); return 1;
  } });
  const scene = new Group(), scenery = new Mesh(), unculled = new Mesh();
  unculled.frustumCulled = false; scene.add(scenery, unculled);
  const frames: boolean[] = [], scarFrames: boolean[] = [], target = {}, progress: number[] = [];
  const scar = new Mesh();
  let scarDisposed = false;
  scar.geometry.addEventListener('dispose', () => { scarDisposed = true; });
  let finishGpu!: () => void, reading = false;
  const gpu = new Promise<void>(resolve => { finishGpu = resolve; });
  const game = Object.assign(Object.create(Game.prototype), {
    scene, disposed: false, finalFrame: { renderTarget: target },
    playerView: { impactMarks: { createWarmupMesh: () => scar } },
    callbacks: { progress(_label: string, fraction: number) { progress.push(fraction); } },
    async frame(_time: number, warmingUp: boolean) {
      expect(warmingUp).toBe(true); frames.push(scenery.frustumCulled);
      scarFrames.push(scar.parent === scene);
    },
    renderer: { async readRenderTargetPixelsAsync(actual: object, ...region: number[]) {
      expect(actual).toBe(target); expect(region).toEqual([0, 0, 1, 1]); reading = true; await gpu;
    } },
  }) as { warmupRendering(): Promise<void>; frame(time: number, warmingUp: boolean): Promise<void>; disposed: boolean };
  return { game, scenery, unculled, frames, scar, scarFrames, progress, finishGpu,
    isReading: () => reading, isScarDisposed: () => scarDisposed };
}

test('startup prepares offscreen scenery and periodic passes, restores culling, then waits for GPU completion', async () => {
  const h = startup();
  let complete = false;
  const task = h.game.warmupRendering().then(() => { complete = true; });
  // Let asynchronous frames finish without completing the GPU readback.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(h.frames).toEqual([...Array(12).fill(false), true]);
  expect(h.scarFrames).toEqual([...Array(12).fill(true), false]);
  expect(h.scar.parent).toBeNull(); expect(h.isScarDisposed()).toBe(true);
  expect(h.scenery.frustumCulled).toBe(true); expect(h.unculled.frustumCulled).toBe(false);
  expect(h.progress.every((fraction, i) => fraction < 1 && (!i || fraction > h.progress[i - 1]))).toBe(true);
  expect(h.isReading()).toBe(true); expect(complete).toBe(false);
  h.finishGpu(); await task; expect(complete).toBe(true);
});

test('failed startup rendering restores culling and propagates the error for retry', async () => {
  const h = startup();
  h.game.frame = async () => { throw new Error('GPU startup failed'); };
  await expect(h.game.warmupRendering()).rejects.toThrow('GPU startup failed');
  expect(h.scenery.frustumCulled).toBe(true); expect(h.unculled.frustumCulled).toBe(false);
  expect(h.isReading()).toBe(false);
  expect(h.scar.parent).toBeNull(); expect(h.isScarDisposed()).toBe(true);
});

test('disposing during warmup stops subsequent frames and restores culling', async () => {
  const h = startup();
  h.game.frame = async () => { h.game.disposed = true; };
  await expect(h.game.warmupRendering()).rejects.toThrow('Game disposed');
  expect(h.scenery.frustumCulled).toBe(true); expect(h.isReading()).toBe(false);
  expect(h.scar.parent).toBeNull(); expect(h.isScarDisposed()).toBe(true);
});
