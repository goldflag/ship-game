import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import type { WaterSystem } from '../../vendor/threejs-water-pro/build/index.js';
import { cameraAboveSurface, spectrumHeightBound, UnderwaterPassVisibility } from './UnderwaterPassVisibility';

test('spectral envelope bounds every phase and protects a near plane crossing the crest', () => {
  expect(spectrumHeightBound(new Float32Array([3, 4, 20, 10, 0, -2, 5, 4]))).toBe(14);
  expect(spectrumHeightBound(new Float32Array([NaN, 0, 0, 0]))).toBe(Infinity);
  const camera = new THREE.PerspectiveCamera(90, 1, 1, 1000);
  for (const reversedDepth of [false, true]) {
    camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
    Object.defineProperty(camera, 'reversedDepth', { configurable: true, value: reversedDepth });
    camera.updateProjectionMatrix();
    camera.position.set(0, 14, 0); camera.updateMatrixWorld();
    expect(cameraAboveSurface(camera, 13.5)).toBe(false);
    camera.position.y = 15; camera.updateMatrixWorld();
    expect(cameraAboveSurface(camera, 13.5)).toBe(true);
    expect(cameraAboveSurface(camera, Infinity)).toBe(false);
    camera.position.y = -2; camera.updateMatrixWorld();
    expect(cameraAboveSurface(camera, 13.5)).toBe(false);
  }
});

test('spectrum changes and pending or failed GPU reads keep underwater passes enabled', async () => {
  const cascade = { initialized: true, scale: 100, h0Buffer: { value: new THREE.BufferAttribute(new Float32Array(4), 4) } };
  const water = { underwater: { enabled: true }, waves: { dirty: false, amplitude: { value: 1 }, standingWaveRatio: { value: 0 } }, oceanSim: { cascades: [cascade] } };
  let finish!: (value: ArrayBuffer) => void, reject!: (reason: Error) => void, reads = 0;
  const renderer = { getArrayBufferAsync: () => { reads++; return new Promise<ArrayBuffer>((resolve, fail) => { finish = resolve; reject = fail; }); } } as Pick<THREE.WebGPURenderer, 'getArrayBufferAsync'>;
  const visibility = new UnderwaterPassVisibility(water as unknown as WaterSystem, renderer);
  const camera = new THREE.PerspectiveCamera(60, 1, .5, 1000); camera.position.y = 100; camera.updateMatrixWorld();
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  visibility.update(camera); visibility.capture(); visibility.capture();
  expect(reads).toBe(1); expect(water.underwater.enabled).toBe(true);
  finish(new Float32Array([3, 4, 0, 0]).buffer); await flush();
  visibility.update(camera); expect(water.underwater.enabled).toBe(false);
  camera.position.y = 12; camera.updateMatrixWorld(); visibility.update(camera);
  expect(water.underwater.enabled).toBe(true);
  camera.position.y = 100; camera.updateMatrixWorld();
  water.waves.dirty = true; visibility.update(camera); expect(water.underwater.enabled).toBe(true);
  water.waves.dirty = false; visibility.capture();
  // A second preset invalidates a result that is still in flight.
  water.waves.dirty = true; visibility.update(camera); water.waves.dirty = false;
  finish(new Float32Array(4).buffer); await flush(); visibility.update(camera);
  expect(water.underwater.enabled).toBe(true);
  visibility.capture(); reject(new Error('GPU unavailable')); await flush(); visibility.update(camera);
  expect(water.underwater.enabled).toBe(true);
  visibility.dispose();
});
