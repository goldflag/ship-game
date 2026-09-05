import { afterEach, beforeEach, expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { createShipState } from '../simulation/ship';
import { CameraRig } from './CameraRig';

const globals = ['window', 'document'] as const;
let originals: (PropertyDescriptor | undefined)[];
beforeEach(() => {
  originals = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  globals.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: new EventTarget() }));
});
afterEach(() => globals.forEach((name, i) => {
  if (originals[i]) Object.defineProperty(globalThis, name, originals[i]!); else Reflect.deleteProperty(globalThis, name);
}));

for (const mode of ['Chase', 'Bridge', 'Tactical', 'Inspection'] as const) {
  test(`${mode} camera keeps its ship offset steady when frame duration varies`, () => {
    const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
    const rig = new CameraRig(camera, { addEventListener() {} } as unknown as HTMLCanvasElement);
    const ship = createShipState();
    rig.mode = mode === 'Inspection' ? 'Chase' : mode;
    rig.setInspecting(mode === 'Inspection');
    rig.update(ship, 0, 0, true);
    const offset = camera.position.clone();
    const frameTimes = [1 / 144, 1 / 47, 1 / 72, .043];
    for (let frame = 0; frame < 120; frame++) {
      const dt = frameTimes[frame % frameTimes.length];
      ship.x += 8 * dt; ship.z -= 15.43 * dt;
      rig.update(ship, 0, dt);
      expect(camera.position.clone().sub(new Vector3(ship.x, 0, ship.z)).distanceTo(offset)).toBeLessThan(1e-9);
    }
    rig.dispose();
  });
}

test('switching the followed ship still eases the camera toward the new target', () => {
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  const rig = new CameraRig(camera, { addEventListener() {} } as unknown as HTMLCanvasElement);
  rig.setInspecting(true);
  const player = createShipState(), target = createShipState('target');
  target.x = 650; target.z = -550;
  rig.update(player, 0, 0, true);
  const from = camera.position.clone();
  rig.update(target, 0, 1 / 60);
  const movement = camera.position.clone().sub(from);
  expect(movement.x).toBeCloseTo(650 * (1 - Math.exp(-5 / 60)), 8);
  expect(movement.z).toBeCloseTo(-550 * (1 - Math.exp(-5 / 60)), 8);
  rig.dispose();
});
