import { expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { CameraRig } from './CameraRig';
import { sightAim } from './aiming';
import { createShipState } from '../simulation/ship';
import { localToWorld, normalize, sub } from '../simulation/geometry';
import type { Vec3 } from '../ships/blueprint';

test('the sight selects the first target armor surface before the sea behind it', () => {
  const pose = { ...createShipState('target'), x: 650, z: -550, heading: .7 };
  const center: Vec3 = [0, 8, 0];
  const origin: Vec3 = [0, 80, 0];
  const direction = normalize(sub(localToWorld(center, pose), origin));
  const point = sightAim(origin, direction, { pose, armor: [{ id: 'hull', name: 'Hull', center, size: [36, 16, 250], thicknessMm: 100 }] });
  expect(point[1]).toBeGreaterThan(.5);
  expect(Math.hypot(point[0], point[2])).toBeLessThan(Math.hypot(pose.x, pose.z));
  const miss = sightAim(origin, normalize([0, -1, -10]), { pose, armor: [{ id: 'hull', name: 'Hull', center, size: [36, 16, 250], thicknessMm: 100 }] });
  expect(miss).toEqual([0, .5, -795]);
});

test('a sea sight points at the CPU waterline and horizon aim stays finite and bounded', () => {
  const origin: Vec3 = [400, 80, -300];
  const point = sightAim(origin, normalize([0, -79.5, -2000]));
  expect(point[0]).toBe(400);
  expect(point[1]).toBe(.5);
  expect(point[2]).toBeCloseTo(-2300, 8);
  for (const direction of [[0, 0, -1], [0, .2, -1], [1, -1e-9, 0]] as Vec3[]) {
    const aim = sightAim(origin, direction);
    expect(aim.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(aim[0] - origin[0], aim[2] - origin[2])).toBeLessThanOrEqual(30000);
  }
});

test('manual fleet aiming chooses the closest hull even when a different enemy is selected', () => {
  const armor = [{ id: 'hull', name: 'Hull', center: [0, 8, 0] as Vec3, size: [36, 16, 250] as Vec3, thicknessMm: 100 }];
  const near = { pose: { ...createShipState('near'), z: -2000 }, armor };
  const far = { pose: { ...createShipState('far'), z: -5000 }, armor };
  const origin: Vec3 = [0, 10, 0], direction: Vec3 = [0, 0, -1];
  expect(sightAim(origin, direction, [far, near])).toEqual(sightAim(origin, direction, near));
  expect(sightAim(origin, direction, [near, far])[2]).toBe(-1875);
});

function withCamera(check: (rig: CameraRig, camera: PerspectiveCamera) => void) {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: new EventTarget() });
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  const rig = new CameraRig(camera, new EventTarget() as HTMLCanvasElement);
  try { check(rig, camera); } finally {
    rig.dispose();
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('entering and leaving binoculars keeps a distant aim point centered and restores the field of view', () => withCamera((rig, camera) => {
  const ship = { ...createShipState(), x: 120, z: -80, heading: .6 };
  const aim: Vec3 = [6200, .5, -9500];
  rig.setInPort(false);
  rig.aimAt(aim, ship);
  for (let i = 0; i < 4; i++) {
    const projected = new Vector3(...aim).project(camera);
    expect(Math.abs(projected.x)).toBeLessThan(.001);
    expect(Math.abs(projected.y)).toBeLessThan(.001);
    expect(camera.fov).toBeCloseTo(rig.binoculars ? 13.9061 : 52, 2);
    rig.toggleBinoculars(aim, ship);
  }
}));

test('turning the ship does not pull the sight off its world bearing', () => withCamera((rig, camera) => {
  const ship = createShipState();
  rig.setInPort(false);
  rig.aimAt([3000, .5, -6000], ship);
  const direction = camera.getWorldDirection(new Vector3());
  ship.heading = 1.2;
  rig.update(ship, ship.y, 1 / 60);
  expect(camera.getWorldDirection(new Vector3()).distanceTo(direction)).toBeLessThan(1e-8);
}));

test('the sight intersects a sloped physical plate rather than its bounding box', () => {
  const pose=createShipState('target');
  const point=sightAim([-20,5,0],[1,0,0],{pose,armor:[{id:'slope',name:'Slope',center:[5,5,0],size:[10,10,10],thicknessMm:100,plate:{material:'Wh',vertices:[[0,0,-5],[10,10,-5],[10,10,5],[0,0,5]]}}]});
  expect(point).toEqual([5,5,0]);
});
