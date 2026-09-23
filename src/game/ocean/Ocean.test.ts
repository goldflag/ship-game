import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { nearPlaneAbove } from './Ocean';

test('the near-plane bound protects a camera whose near plane crosses the crest', () => {
  const camera = new THREE.PerspectiveCamera(90, 1, 1, 1000);
  for (const reversedDepth of [false, true]) {
    camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
    Object.defineProperty(camera, 'reversedDepth', { configurable: true, value: reversedDepth });
    camera.updateProjectionMatrix();
    camera.position.set(0, 14, 0); camera.updateMatrixWorld();
    expect(nearPlaneAbove(camera, 13.5)).toBe(false);
    camera.position.y = 15; camera.updateMatrixWorld();
    expect(nearPlaneAbove(camera, 13.5)).toBe(true);
    expect(nearPlaneAbove(camera, Infinity)).toBe(false);
    camera.position.y = -2; camera.updateMatrixWorld();
    expect(nearPlaneAbove(camera, 13.5)).toBe(false);
  }
});
