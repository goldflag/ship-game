import { afterEach, beforeEach, expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { createShipState } from '../simulation/ship';
import { CameraRig } from './CameraRig';
import viic from '../../assets/ships/type-viic/blueprint.json';

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

test('port preset switches keep both submarine and battleship hulls in view without resetting the orbit', () => {
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  const rig = new CameraRig(camera, { addEventListener() {} } as unknown as HTMLCanvasElement);
  const ship = { ...createShipState(), x: 240 };
  rig.setHullLength(67.1);
  rig.setInPort(true);
  const bearing = rig.bearing;
  for (const length of [67.1, 251, 67.1, 263]) {
    rig.setHullLength(length);
    rig.update(ship, 0, 0, true);
    expect(rig.bearing).toBe(bearing);
    for (const z of [-length / 2, length / 2]) {
      const projected = new Vector3(ship.x, 0, z).project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(1);
      expect(Math.abs(projected.y)).toBeLessThan(1);
      expect(projected.z).toBeGreaterThan(-1);
      expect(projected.z).toBeLessThan(1);
    }
  }
  rig.dispose();
});

test('submarine chase framing leaves the complete hull above the weapon instruments', () => {
  const camera = new PerspectiveCamera(52, 1137 / 906, .5, 60000);
  const rig = new CameraRig(camera, { addEventListener() {} } as unknown as HTMLCanvasElement);
  rig.setHullLength(67.1);
  rig.setInPort(false);
  rig.aimAt([0, 0, -1000], createShipState());
  for (const z of [-33.55, 0, 33.55]) {
    const projected = new Vector3(0, 0, z).project(camera);
    expect(projected.y).toBeGreaterThan(-.45);
    expect(projected.y).toBeLessThan(1);
  }
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

test('port framing scales the aim point and camera offsets with the hull', () => {
  const { camera, rig } = interactiveCamera();
  const ship = { ...createShipState(), x: 240 };
  rig.setInPort(true);
  try {
    for (const aspect of [16 / 9, .7]) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      rig.setHullLength(250.5);
      rig.update(ship, 0, 0, true);
      const reference = [-.5, 0, .5].map(z => new Vector3(ship.x, 0, z * 250.5).project(camera));
      rig.setHullLength(67.1);
      rig.update(ship, 0, 0, true);
      reference.forEach((expected, i) => {
        const projected = new Vector3(ship.x, 0, (i - 1) * 67.1 / 2).project(camera);
        expect(projected.x).toBeCloseTo(expected.x, 6);
        expect(projected.y).toBeCloseTo(expected.y, 6);
      });
    }
  } finally { rig.dispose(); }
});

test('port zoom stays proportional when switching very small and large hulls', () => {
  const { camera, canvas, rig, drag } = interactiveCamera();
  const ship = { ...createShipState(), x: 240 };
  rig.setInPort(true);
  drag(70, 40);
  const bearing = rig.bearing;
  const orbitRadius = () => Math.hypot(camera.position.x - ship.x, camera.position.z - ship.z);
  try {
    for (const zoom of [0, -100000, 100000]) {
      rig.setHullLength(250.5);
      canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: zoom }));
      rig.update(ship, 0, 0, true);
      const relativeRadius = orbitRadius() / 250.5;
      for (const length of [25, 67.1, 500, 250.5]) {
        rig.setHullLength(length);
        // A zero-delta wheel event must not jump to an unscaled zoom limit.
        canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 0 }));
        rig.update(ship, 0, 0, true);
        expect(rig.bearing).toBe(bearing);
        expect(orbitRadius() / length).toBeCloseTo(relativeRadius, 6);
        expect(camera.position.y).toBeGreaterThanOrEqual(12);
        const center = new Vector3(ship.x, 0, ship.z).project(camera);
        expect(Math.abs(center.x)).toBeLessThan(.5);
        expect(Math.abs(center.y)).toBeLessThan(.7);
      }
    }
  } finally { rig.dispose(); }
});

test('shell camera follows flight without frame lag or changed aim, and restores binoculars', () => {
  const { camera, rig, drag } = interactiveCamera();
  const ship = createShipState();
  rig.setInPort(false);
  rig.toggleBinoculars([1000, 0, -5000], ship);
  const position = camera.position.clone(), orientation = camera.quaternion.clone(), fov = camera.fov;
  const bearing = rig.bearing;
  const view = { position: [0, 200, -1000] as [number, number, number], velocity: [0, -20, -800] as [number, number, number] };
  rig.setShellView(view);
  rig.update(ship, 0, .016);
  expect(rig.binoculars).toBe(false);
  expect(camera.fov).toBeCloseTo(52);
  const offset = camera.position.clone().sub(new Vector3(...view.position));
  for (const dt of [1 / 144, 1 / 30, .047]) {
    view.position[2] -= 800 * dt;
    rig.setShellView(view);
    drag(300, 300);
    rig.update(ship, 0, dt);
    expect(camera.position.clone().sub(new Vector3(...view.position)).distanceTo(offset)).toBeLessThan(1e-9);
    expect(rig.bearing).toBe(bearing);
    const projected = new Vector3(...view.position).project(camera);
    expect(Math.abs(projected.x)).toBeLessThan(1);
    expect(Math.abs(projected.y)).toBeLessThan(1);
  }
  view.position[1] = -40;
  rig.update(ship, 0, .016);
  expect(camera.position.y).toBeGreaterThanOrEqual(12);
  rig.setShellView();
  rig.update(ship, 0, .016);
  expect(rig.binoculars).toBe(true);
  expect(camera.fov).toBe(fov);
  expect(camera.position.distanceTo(position)).toBeLessThan(1e-9);
  expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-7);
  rig.dispose();
});

test('upward port dragging stops at the lowest ship-focused orbit across hull sizes and zoom limits', () => {
  const { camera, canvas, rig, drag } = interactiveCamera();
  const ship = { ...createShipState(), x: 240 };
  rig.setInPort(true);
  try {
    for (const length of [67.1, 250.5, 263]) for (const zoom of [-100000, 100000]) {
      rig.setHullLength(length);
      canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: zoom }));
      drag(0, -100000);
      rig.update(ship, ship.y, 0, true);
      const lowestOrbit = camera.position.clone(), direction = camera.getWorldDirection(new Vector3());
      expect(direction.y).toBeLessThan(0);
      expect(camera.position.y).toBeGreaterThanOrEqual(12);
      const center = new Vector3(ship.x, 0, ship.z).project(camera);
      expect(Math.abs(center.y)).toBeLessThan(1);
      drag(0, -250);
      rig.update(ship, ship.y, 0, true);
      expect(camera.position.distanceTo(lowestOrbit)).toBeLessThan(1e-9);
      expect(camera.getWorldDirection(new Vector3()).distanceTo(direction)).toBeLessThan(1e-9);
      // Dragging back responds immediately, without unwinding past the limit.
      drag(0, 20);
      rig.update(ship, ship.y, 0, true);
      expect(camera.getWorldDirection(new Vector3()).y).toBeLessThan(direction.y);
    }
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

test('VIIC chase follows underwater, scope eye breaks the surface at 7 m, and deeper scope stays submerged', () => {
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  const rig = new CameraRig(camera, { addEventListener() {} } as unknown as HTMLCanvasElement, [0, 5.6, -1.4]);
  rig.setHullLength(viic.hull.length);
  rig.setSubmarine(viic.submarine as import('../ships/blueprint').SubmarineDefinition);
  const ship = createShipState(); ship.y = -7;
  rig.update(ship, ship.y, 0, true);
  expect(camera.position.y).toBeLessThan(0);
  expect(Math.hypot(camera.position.x - ship.x, camera.position.z - ship.z)).toBeLessThan(50);
  camera.aspect = 390 / 844; camera.updateProjectionMatrix(); rig.update(ship, ship.y, 0, true);
  expect(Math.hypot(camera.position.x - ship.x, camera.position.z - ship.z)).toBeLessThan(60);
  rig.mode = 'Bridge'; rig.update(ship, ship.y, 0, true);
  // Captured notebook: 14.612 m maximum eye above keel, survey draft 4.7625 m.
  expect(camera.position.y).toBeCloseTo(14.612 - 4.7625 - 7);
  rig.binoculars = true; rig.update(ship, ship.y, 0, true);
  expect(camera.position.y).toBeCloseTo(14.612 - 4.7625 - 7);
  ship.y = -50; rig.update(ship, ship.y, 0, true);
  expect(camera.position.y).toBeCloseTo(14.612 - 4.7625 - 50);
  rig.binoculars = false; rig.mode = 'Tactical'; rig.update(ship, ship.y, 0, true);
  expect(camera.position.y).toBeGreaterThanOrEqual(12);
  rig.setInPort(true); ship.y = 0; rig.update(ship, 0, 0, true);
  expect(camera.position.y).toBeGreaterThanOrEqual(12);
  rig.setInPort(false); rig.setSubmarine(); ship.y = -50; rig.update(ship, ship.y, 0, true);
  expect(camera.position.y).toBeGreaterThanOrEqual(12);
  rig.dispose();
});
