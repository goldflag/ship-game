import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { nearPlaneMayBeSubmerged } from './underwater';

test('the underwater pass runs whenever the near plane may reach the highest wave', () => {
  const camera = new THREE.PerspectiveCamera(90, 1, 1, 1000);
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
  for (const reversedDepth of [false, true]) {
    Object.defineProperty(camera, 'reversedDepth', { configurable: true, value: reversedDepth });
    camera.updateProjectionMatrix();
    // The near plane's lower corners sit a metre below a level camera.
    camera.position.set(0, 14, 0); camera.rotation.set(0, 0, 0); camera.updateMatrixWorld();
    expect(nearPlaneMayBeSubmerged(camera, 13.5)).toBe(true);
    camera.position.y = 15; camera.updateMatrixWorld();
    expect(nearPlaneMayBeSubmerged(camera, 13.5)).toBe(false);
    expect(nearPlaneMayBeSubmerged(camera, Infinity)).toBe(true);
    camera.position.y = -2; camera.updateMatrixWorld();
    expect(nearPlaneMayBeSubmerged(camera, 13.5)).toBe(true);
    // Looking straight down puts the whole near plane a metre below the camera.
    camera.position.y = 14.4; camera.rotation.set(-Math.PI / 2, 0, 0); camera.updateMatrixWorld();
    expect(nearPlaneMayBeSubmerged(camera, 13.5)).toBe(true);
  }
});
