import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { createShipState } from '../simulation/ship';
import { CameraRig } from './CameraRig';
import viic from '../../assets/ships/type-viic/blueprint.json';
import { Game } from './Game';
import { ShellFollow } from './ShellFollow';
import { ShellTrails } from './ShellTrails';
import type { Shell } from '../simulation/damage';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';

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

function pointerLockCamera() {
  Object.assign(window, { matchMedia: () => ({ matches: true }) });
  const canvas = Object.assign(new EventTarget(), {
    focus() {},
    requestPointerLock: mock<() => Promise<void> | void>(() => new Promise<void>(() => {})),
  });
  const changeLock = (element: EventTarget | null) => {
    Object.assign(document, { pointerLockElement: element });
    document.dispatchEvent(new Event('pointerlockchange'));
  };
  Object.assign(document, { pointerLockElement: null, exitPointerLock: () => changeLock(null) });
  const pause = mock();
  const rig = new CameraRig(new PerspectiveCamera(52, 16 / 9, .5, 60000), canvas as unknown as HTMLCanvasElement,
    undefined, { pause, aim() {}, optics() {} });
  const clickSea = () => canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerType: 'mouse' }));
  return { rig, canvas, changeLock, clickSea, pause };
}

test('an interrupted capture can recover after pausing or leaving and re-entering battle', () => {
  const { rig, canvas, clickSea, changeLock } = pointerLockCamera();
  try {
    rig.capturePointer();
    rig.setEnabled(false);
    rig.setEnabled(true);
    clickSea();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
    rig.setInPort(true);
    rig.setInPort(false);
    clickSea();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(3);
    changeLock(canvas);
    expect(rig.pointerLocked).toBe(true);
  } finally { rig.dispose(); }
});

test('a completed request without a retained lock allows the next sea click to capture', async () => {
  const { rig, canvas, clickSea, changeLock } = pointerLockCamera();
  canvas.requestPointerLock.mockImplementation(() => Promise.resolve());
  try {
    clickSea();
    await Promise.resolve();
    clickSea();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
    changeLock(canvas);
    expect(rig.pointerLocked).toBe(true);
  } finally { rig.dispose(); }
});

test('an unanswered capture only suppresses duplicate requests briefly', () => {
  const clock = spyOn(performance, 'now').mockReturnValue(0);
  const { rig, canvas, clickSea, changeLock } = pointerLockCamera();
  try {
    clickSea();
    clickSea();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(2000);
    clickSea();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
    changeLock(canvas);
    expect(rig.pointerLocked).toBe(true);
  } finally { rig.dispose(); clock.mockRestore(); }
});

test('an unlock notification clears a capture whose acquired state was already lost', () => {
  const { rig, canvas, clickSea, changeLock, pause } = pointerLockCamera();
  try {
    clickSea();
    changeLock(null);
    expect(pause).toHaveBeenCalledTimes(1);
    clickSea();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
  } finally { rig.dispose(); }
});

for (const outcome of ['resolve', 'reject'] as const) {
  test(`an old request's late ${outcome} does not clear a newer capture`, async () => {
    const { rig, canvas, clickSea } = pointerLockCamera();
    let finish!: () => void;
    canvas.requestPointerLock.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finish = () => outcome === 'resolve' ? resolve() : reject(new Error('interrupted'));
    }));
    try {
      clickSea();
      rig.releasePointer();
      clickSea();
      expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
      finish();
      await Promise.resolve();
      clickSea();
      expect(canvas.requestPointerLock).toHaveBeenCalledTimes(2);
    } finally { rig.dispose(); }
  });
}

test('late capture is released while paused and intentional release does not pause', () => {
  const { rig, canvas, clickSea, changeLock, pause } = pointerLockCamera();
  try {
    clickSea();
    rig.setEnabled(false);
    changeLock(canvas);
    expect(rig.pointerLocked).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    rig.setEnabled(true);
    clickSea();
    changeLock(canvas);
    rig.releasePointer();
    expect(rig.pointerLocked).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    clickSea();
    changeLock(canvas);
    changeLock(null);
    expect(pause).toHaveBeenCalledTimes(1);
  } finally { rig.dispose(); }
});

test('legacy capture errors and rejected requests permit retry without firing on the capture click', async () => {
  const { rig, canvas, clickSea, changeLock } = pointerLockCamera();
  canvas.requestPointerLock.mockImplementationOnce(() => {});
  canvas.requestPointerLock.mockImplementationOnce(() => Promise.reject(new Error('denied')));
  canvas.requestPointerLock.mockImplementationOnce(() => { throw new Error('denied'); });
  try {
    clickSea();
    document.dispatchEvent(new Event('pointerlockerror'));
    clickSea();
    await Promise.resolve();
    clickSea();
    clickSea();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(4);
    changeLock(canvas);
    expect(rig.firing).toBe(false);
    clickSea();
    expect(rig.firing).toBe(true);
    window.dispatchEvent(new Event('pointerup'));
    expect(rig.firing).toBe(false);
  } finally { rig.dispose(); }
});

test('submerged zoom preserves forward and deliberately aft bearings through shallow dives', () => {
  const definition = shipPreset('type-viic');
  for (const depth of [0, 2, 3, 4, 7, 50]) for (const heading of [0, 1.2, Math.PI]) for (const aft of [false, true]) {
    const { camera, rig, drag } = interactiveCamera();
    const simulation = new CombatSimulation(definition);
    Object.assign(simulation.ship, { y: -depth, heading });
    rig.setHullLength(definition.hull.length); rig.setSubmarine(definition.submarine);
    rig.setInPort(false); rig.update(simulation.ship, -depth, 0, true); rig.recenter();
    if (aft) drag(Math.PI / .0025, 0);
    rig.update(simulation.ship, -depth, 0, true);
    const bearing = rig.bearing;
    const game = Object.assign(Object.create(Game.prototype), {
      camera, rig, simulation, definition, manualAim: true, battery: 'torpedo', shellFollow: new ShellFollow(),
    }) as Game;
    try {
      for (let toggle = 0; toggle < 4; toggle++) {
        const depthOrder = simulation.player.submarine!.targetDepthM;
        game.togglePeriscope();
        expect(simulation.player.submarine!.targetDepthM).toBe(depthOrder);
        for (let frame = 0; frame < 60; frame++) rig.update(simulation.ship, -depth, 1 / 60);
        const direction = camera.getWorldDirection(new Vector3());
        expect(direction.x * Math.sin(bearing) - direction.z * Math.cos(bearing)).toBeGreaterThan(.95);
        if (rig.binoculars) expect(camera.position.y).toBeCloseTo(definition.submarine!.periscopeEye[1] - depth);
      }
    } finally { rig.dispose(); }
  }
});

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

test('the default T shot-follow camera keeps the followed round tracer visible through orbit and zoom', () => {
  const { camera, canvas, rig, drag } = interactiveCamera(), follow = new ShellFollow(), trails = new ShellTrails();
  const shot: Shell = { id: 1, ownerId: 'player', position: [0, 300, -1000], velocity: [800, 0, 0], age: 0,
    caliberM: .38, damage: 70, penetrationMm: 400, visited: [] };
  try {
    follow.setEnabled(true);
    for (let frame = 0; frame <= 60; frame++) {
      shot.age = frame / 60; shot.position[0] = shot.age * 800;
      follow.update([shot], [], 'player', 1 / 60);
      rig.setShellView(follow.view); rig.update(createShipState(), 0, 1 / 60, true);
      trails.update([shot], 1 / 60, camera);
    }
    expect(camera.position.distanceTo(new Vector3(...shot.position))).toBeCloseTo(Math.hypot(45, 12, 12), 5);
    expect(trails.diagnostics().segments).toBeGreaterThan(0);
    drag(200, 40);
    canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: -2000, deltaMode: 0 }));
    rig.update(createShipState(), 0, 0, true); trails.update([shot], 0, camera);
    expect(camera.position.distanceTo(new Vector3(...shot.position))).toBeCloseTo(12, 5);
    expect(trails.diagnostics().segments).toBeGreaterThan(0);
  } finally { trails.dispose(); rig.dispose(); }
});

test('shell camera follows flight without frame lag or changed aim, and restores binoculars after orbit and zoom', () => {
  const { camera, canvas, rig, drag } = interactiveCamera();
  const ship = createShipState();
  rig.setInPort(false);
  rig.toggleBinoculars([1000, 0, -5000], ship);
  for (let i = 0; i < 180; i++) rig.update(ship, 0, 1 / 60);
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
    rig.update(ship, 0, dt);
    expect(camera.position.clone().sub(new Vector3(...view.position)).distanceTo(offset)).toBeLessThan(1e-9);
    expect(rig.bearing).toBe(bearing);
    const projected = new Vector3(...view.position).project(camera);
    expect(Math.abs(projected.x)).toBeLessThan(1);
    expect(Math.abs(projected.y)).toBeLessThan(1);
  }
  drag(300, 150);
  canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 600 }));
  rig.update(ship, 0, .016);
  expect(camera.position.clone().sub(new Vector3(...view.position)).distanceTo(offset)).toBeGreaterThan(10);
  view.position[1] = -40;
  rig.update(ship, 0, .016);
  expect(camera.position.y).toBeGreaterThanOrEqual(12);
  rig.setShellView();
  rig.update(ship, 0, .016);
  expect(rig.binoculars).toBe(true);
  expect(camera.fov).toBeCloseTo(fov, 10);
  expect(camera.position.distanceTo(position)).toBeLessThan(1e-9);
  expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-7);
  rig.dispose();
});

for (const [pointerType, button] of [['mouse', 0], ['mouse', 2], ['touch', 0]] as const) {
  test(`${pointerType} button ${button} orbits and zooms a followed object without losing the moving target`, () => {
    const { camera, canvas, rig } = interactiveCamera();
    const ship = createShipState();
    const view = { position: [0, 1000, -1000] as [number, number, number], velocity: [0, 0, -1] as [number, number, number] };
    const bearing = rig.bearing;
    rig.setShellView(view); rig.update(ship, 0, 0);
    const initial = camera.position.clone(), distance = initial.distanceTo(new Vector3(...view.position));
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button, pointerType, pointerId: 1, clientX: 0, clientY: 0 }));
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 1, clientX: 180, clientY: -50 }));
    window.dispatchEvent(new Event('pointerup'));
    rig.update(ship, 0, .016);
    expect(camera.position.distanceTo(initial)).toBeGreaterThan(20);
    expect(camera.position.distanceTo(new Vector3(...view.position))).toBeCloseTo(distance, 8);
    canvas.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaY: -400 }));
    rig.update(ship, 0, .016);
    expect(camera.position.distanceTo(new Vector3(...view.position))).toBeLessThan(distance);
    const offset = camera.position.clone().sub(new Vector3(...view.position));
    for (const dt of [1 / 144, 1 / 30, .047]) {
      view.position[0] += 50 * dt; view.position[2] -= 800 * dt;
      rig.setShellView(view); rig.update(ship, 0, dt);
      expect(camera.position.clone().sub(new Vector3(...view.position)).distanceTo(offset)).toBeLessThan(1e-9);
      const projected = new Vector3(...view.position).project(camera);
      expect(projected.x).toBeCloseTo(0, 8); expect(projected.y).toBeCloseTo(0, 8);
    }
    expect(rig.bearing).toBe(bearing);
    rig.dispose();
  });
}

test('pointer-locked follow controls orbit without firing, changing ship aim or triggering right-click optics', () => {
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  const canvas = Object.assign(new EventTarget(), { setPointerCapture() { throw new Error('Locked mouse must not capture a drag'); } });
  Object.assign(document, { pointerLockElement: canvas });
  let aim = 0, optics = 0;
  const rig = new CameraRig(camera, canvas as unknown as HTMLCanvasElement, undefined, { aim() { aim++; }, optics() { optics++; }, pause() {} });
  const ship = createShipState();
  const click = (button: number) => canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button, pointerType: 'mouse' }));
  click(0); expect(rig.firing).toBe(true);
  rig.setShellView({ position: [0, 500, -1000], velocity: [0, 0, -1] }); rig.update(ship, 0, 0);
  expect(rig.firing).toBe(false);
  const start = camera.position.clone();
  click(0); click(2);
  canvas.dispatchEvent(Object.assign(new Event('pointermove'), { movementX: 200, movementY: 80 }));
  rig.update(ship, 0, .016);
  expect(camera.position.distanceTo(start)).toBeGreaterThan(20);
  expect(rig.firing).toBe(false); expect(aim).toBe(0); expect(optics).toBe(0);
  rig.setShellView(); expect(rig.firing).toBe(false);
  Object.assign(document, { pointerLockElement: null }); rig.dispose();
});

test('follow orbit stays bounded through vertical flight, extreme zoom, terrain and disabled input', () => {
  const { camera, canvas, rig, drag } = interactiveCamera();
  const ship = createShipState();
  const view = { position: [0, 1200, -1000] as [number, number, number], velocity: [0, 1, 0] as [number, number, number] };
  rig.setShellView(view);
  for (const velocity of [[0, 1, 0], [0, -1, 0], [0, 0, 0]] as [number, number, number][]) {
    view.velocity = velocity;
    for (const delta of [-100000, 100000]) {
      drag(delta, delta); canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: delta }));
      rig.update(ship, 0, .016);
      const radius = camera.position.distanceTo(new Vector3(...view.position));
      expect(radius).toBeGreaterThanOrEqual(12 - 1e-8); expect(radius).toBeLessThanOrEqual(800 + 1e-8);
      expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
      expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true);
    }
  }
  rig.setEnabled(false);
  const position = camera.position.clone();
  drag(400, 100); canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: -700 }));
  rig.update(ship, 0, 0); expect(camera.position.distanceTo(position)).toBeLessThan(1e-9);
  rig.setEnabled(true); rig.setBattleTerrain(() => 80); view.position[1] = 0;
  rig.update(ship, 0, .016); expect(camera.position.y).toBeGreaterThanOrEqual(92);
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
  // Submerged views still clear an island if the camera crosses its shore.
  rig.setBattleTerrain(() => 80);
  rig.update(ship, ship.y, 0, true);
  expect(camera.position.y).toBeGreaterThanOrEqual(92);
  rig.setBattleTerrain(() => 0);
  rig.update(ship, ship.y, 0, true);
  expect(camera.position.y).toBeCloseTo(14.612 - 4.7625 - 50);
  rig.binoculars = false; rig.mode = 'Tactical'; rig.update(ship, ship.y, 0, true);
  expect(camera.position.y).toBeGreaterThanOrEqual(12);
  rig.setInPort(true); ship.y = 0; rig.update(ship, 0, 0, true);
  expect(camera.position.y).toBeGreaterThanOrEqual(12);
  rig.setInPort(false); rig.setSubmarine(); ship.y = -50; rig.update(ship, ship.y, 0, true);
  expect(camera.position.y).toBeGreaterThanOrEqual(12);
  rig.dispose();
});

test('tiny scroll inputs zoom continuously and settle without a camera jump', () => {
  const { camera, canvas, rig } = interactiveCamera();
  const ship = createShipState();
  rig.aimAt([0, .5, -5000], ship);
  const start = camera.position.clone(), fov = camera.fov;
  rig.toggleBinoculars([0, .5, -5000], ship);
  expect(camera.position.distanceTo(start)).toBeLessThan(1e-6);
  expect(camera.fov).toBeCloseTo(fov, 10);
  rig.update(ship, 0, 1 / 60);
  expect(camera.fov).toBeLessThan(fov);
  expect(camera.fov).toBeGreaterThan(14);
  for (let i = 0; i < 120; i++) rig.update(ship, 0, 1 / 60);
  const before = rig.magnification;
  canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: -1, deltaMode: 0 }));
  for (let i = 0; i < 120; i++) rig.update(ship, 0, 1 / 60);
  expect(rig.magnification).toBeGreaterThan(before);
  expect(rig.magnification).toBeLessThan(before + .1);
  rig.dispose();
});

test('chase tilt orbits above the hull at both zoom limits and permits a close look', () => {
  const { camera, canvas, rig, drag } = interactiveCamera();
  const ship = createShipState();
  rig.setInPort(false); drag(0, 100000);
  for (const deltaY of [100000, -100000]) {
    canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY }));
    rig.update(ship, 0, 0, true);
    const offset = camera.position.clone().sub(new Vector3(ship.x, ship.y, ship.z));
    expect(Math.hypot(offset.x, offset.z)).toBeLessThan(offset.y * .04);
    const hull = new Vector3(ship.x, 0, ship.z).project(camera);
    expect(Math.abs(hull.x)).toBeLessThan(.02); expect(Math.abs(hull.y)).toBeLessThan(.1);
  }
  expect(camera.position.length()).toBeLessThan(100);
  rig.dispose();
});

test('aiming during an optics transition keeps the camera glide and rapid toggles remain continuous', () => {
  const { camera, rig, drag } = interactiveCamera();
  const ship = createShipState();
  const aim: [number, number, number] = [0, .5, -5000];
  rig.aimAt(aim, ship); rig.toggleBinoculars(aim, ship); rig.update(ship, 0, .08);
  const start = camera.position.clone();
  drag(2, 1); rig.update(ship, 0, 0);
  expect(camera.position.distanceTo(start)).toBeLessThan(.01);
  const beforeReverse = camera.position.clone(), fov = camera.fov;
  rig.toggleBinoculars(aim, ship);
  expect(camera.position.distanceTo(beforeReverse)).toBeLessThan(1e-6);
  expect(camera.fov).toBeCloseTo(fov, 10);
  for (let i = 0; i < 120; i++) rig.update(ship, 0, 1 / 60);
  expect(camera.fov).toBeCloseTo(52, 5);
  rig.dispose();
});


test('a submerged submarine can also orbit to a near-vertical view of its hull', () => {
  const { camera, rig, drag } = interactiveCamera();
  rig.setHullLength(viic.hull.length);
  rig.setSubmarine(viic.submarine as import('../ships/blueprint').SubmarineDefinition);
  rig.setInPort(false);
  const ship = createShipState(); ship.y = -50;
  drag(0, 100000); rig.update(ship, ship.y, 0, true);
  expect(Math.hypot(camera.position.x, camera.position.z)).toBeLessThan((camera.position.y - ship.y) * .04);
  rig.dispose();
});
