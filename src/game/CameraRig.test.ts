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

function interactiveCamera() {
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  const canvas = Object.assign(new EventTarget(), { setPointerCapture() {} });
  const rig = new CameraRig(camera, canvas as unknown as HTMLCanvasElement);
  const drag = (dx: number, dy: number) => {
    // Touch follows the same angular controls without requiring pointer lock.
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0 }));
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 1, clientX: dx, clientY: dy }));
    window.dispatchEvent(new Event('pointerup'));
  };
  return { camera, canvas, rig, drag };
}

function sunDirection(elevation: number, azimuth: number) {
  return new Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
}

test('port dragging reveals the sun without lowering the camera below its lowest orbit', () => {
  const { camera, rig, drag } = interactiveCamera();
  const ship = { ...createShipState(), x: 240 };
  const sun = sunDirection(36 * Math.PI / 180, 58 * Math.PI / 180);
  rig.setInPort(true);
  try {
    drag((1.08 - Math.atan2(-sun.x, -sun.z)) / .005, -50);
    rig.update(ship, ship.y, 0, true);
    const lowestOrbit = camera.position.clone();
    drag(0, -250);
    rig.update(ship, ship.y, 0, true);
    const projected = camera.position.clone().addScaledVector(sun, 10000).project(camera);
    expect(Math.abs(projected.x)).toBeLessThan(.9);
    expect(Math.abs(projected.y)).toBeLessThan(.9);
    expect(projected.z).toBeGreaterThan(-1);
    expect(projected.z).toBeLessThan(1);
    expect(camera.position.distanceTo(lowestOrbit)).toBeLessThan(1e-9);
    expect(Math.asin(camera.getWorldDirection(new Vector3()).y)).toBeLessThanOrEqual(Math.PI / 6 + 1e-9);
    rig.recenter();
    rig.update(ship, ship.y, 0, true);
    expect(camera.getWorldDirection(new Vector3()).y).toBeLessThan(0);
  } finally { rig.dispose(); }
});

for (const mode of ['Chase', 'Bridge', 'Tactical'] as const) {
  test(`${mode} mouse aiming reveals the sailing sun within a restrained upward tilt`, () => {
    const { camera, canvas, rig } = interactiveCamera();
    const ship = createShipState();
    const sun = sunDirection(48 * Math.PI / 180, 235 * Math.PI / 180);
    rig.setInPort(false);
    rig.mode = mode;
    Object.assign(document, { pointerLockElement: canvas, exitPointerLock() { Object.assign(document, { pointerLockElement: null }); } });
    try {
      canvas.dispatchEvent(Object.assign(new Event('pointermove'), {
        movementX: (Math.atan2(sun.x, -sun.z) - .82) / .0025,
        movementY: (-48 * Math.PI / 180 - .1) / .0025,
      }));
      rig.update(ship, ship.y, 0, true);
      const direction = camera.getWorldDirection(new Vector3());
      expect(Math.asin(direction.y)).toBeCloseTo(Math.PI / 6, 9);
      const sunPosition = camera.position.clone().addScaledVector(sun, 10000).project(camera);
      expect(Math.abs(sunPosition.x)).toBeLessThan(.9);
      expect(Math.abs(sunPosition.y)).toBeLessThan(.9);
      expect(sunPosition.z).toBeGreaterThan(-1);
      expect(sunPosition.z).toBeLessThan(1);
      const aim = camera.position.clone().addScaledVector(direction, 10000);
      rig.toggleBinoculars(aim.toArray(), ship);
      const projected = aim.project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(.001);
      expect(Math.abs(projected.y)).toBeLessThan(.001);
    } finally { rig.dispose(); }
  });
}

for (const mode of ['Port', 'Inspection', 'Chase', 'Bridge', 'Tactical', 'Binoculars'] as const) {
  test(`${mode} camera stays above water through extreme input, zoom and sinking`, () => {
    const { camera, canvas, rig, drag } = interactiveCamera();
    const ship = createShipState();
    rig.setInPort(mode === 'Port');
    if (mode === 'Inspection') rig.setInspecting(true);
    if (mode === 'Bridge' || mode === 'Tactical') rig.mode = mode;
    if (mode === 'Binoculars') rig.toggleBinoculars([0, .5, -1000], ship);
    try {
      for (const aspect of [16 / 9, .7]) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        for (const input of [-100000, 100000]) {
          drag(input, input);
          canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: input }));
          ship.y = 0;
          rig.update(ship, ship.y, 0, true);
          for (let frame = 0; frame < 120; frame++) {
            ship.y -= 20;
            ship.pitch = .4; ship.roll = .8;
            rig.update(ship, ship.y, frame % 2 ? 1 / 30 : 1 / 144);
            expect(camera.position.y).toBeGreaterThanOrEqual(12);
          }
          rig.update(ship, ship.y, 0, true);
          expect(camera.position.y).toBeGreaterThanOrEqual(12);
        }
      }
    } finally { rig.dispose(); }
  });
}
