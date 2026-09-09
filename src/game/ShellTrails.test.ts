import { expect, test } from 'bun:test';
import { Matrix4, PerspectiveCamera, Vector3, type InstancedMesh } from 'three/webgpu';
import type { Shell } from '../simulation/damage';
import { ShellTrails } from './ShellTrails';

const camera = new PerspectiveCamera(52, 16 / 9, .1, 30000);
camera.updateMatrixWorld();
function round(id = 1): Shell {
  return { id, ownerId: 'player', position: [0, 100, -1000], velocity: [800, 0, 0], age: 0,
    caliberM: .38, visited: [], penetrationMm: 0, damage: 0 };
}
function endpoints(mesh: InstancedMesh, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const matrix = new Matrix4(); mesh.getMatrixAt(i, matrix);
    return [new Vector3(0, -.5, 0).applyMatrix4(matrix), new Vector3(0, .5, 0).applyMatrix4(matrix)];
  });
}

test('long trails retain curved CPU positions, reach the round and freeze on pause without changing simulation', () => {
  const trails = new ShellTrails(), shell = round();
  try {
    for (let i = 0; i <= 120; i++) {
      const t = i / 60;
      shell.age = t; shell.position = [800 * t, 100 + 160 * t - 5 * t * t, -1000]; shell.velocity = [800, 160 - 10 * t, 0];
      trails.update([shell], 1 / 60, camera);
    }
    const segments = endpoints(trails.mesh, trails.diagnostics().segments);
    expect(segments.length).toBeGreaterThan(15);
    expect(segments.length).toBeLessThan(30);
    expect(segments[0][0].x).toBeCloseTo(600, 2); // Exactly 1.25 seconds of retained flight.
    expect(segments.at(-1)![1].distanceTo(new Vector3(...shell.position))).toBeLessThan(.001);
    for (let i = 1; i < segments.length; i++) expect(segments[i - 1][1].distanceTo(segments[i][0])).toBeLessThan(.001);
    expect(segments[0][1].clone().sub(segments[0][0]).normalize().y)
      .toBeGreaterThan(segments.at(-1)![1].clone().sub(segments.at(-1)![0]).normalize().y);
    const state = JSON.stringify(shell), matrices = [...trails.mesh.instanceMatrix.array];
    trails.update([shell], 0, camera);
    expect([...trails.mesh.instanceMatrix.array]).toEqual(matrices);
    expect(JSON.stringify(shell)).toBe(state);
  } finally { trails.dispose(); }
});

test('launches cannot leave trails behind the muzzle; ricochets keep their observed corner', () => {
  const trails = new ShellTrails(), shell = round();
  try {
    shell.age = .01; shell.position[0] = 8;
    trails.update([shell], .01, camera);
    expect(endpoints(trails.mesh, 1)[0][0].x).toBeCloseTo(0, 5);
    shell.age = .04; shell.position[0] = 32; trails.update([shell], .03, camera);
    shell.age = .06; shell.velocity = [0, 800, 0]; shell.position = [32, 116, -1000];
    trails.update([shell], .02, camera);
    const segments = endpoints(trails.mesh, trails.diagnostics().segments);
    expect(segments[0][1].toArray()).toEqual([32, 100, -1000]);
    expect(segments[1][0].toArray()).toEqual([32, 100, -1000]);
    expect(segments[1][1].toArray()).toEqual(shell.position);
  } finally { trails.dispose(); }
});

test('impact tails fade, lodged and underwater rounds stop emitting, and reset or reused IDs leave no stale path', () => {
  const trails = new ShellTrails(), shell = round();
  try {
    for (let i = 0; i <= 20; i++) { shell.age = i / 60; shell.position[0] = shell.age * 800; trails.update([shell], 1 / 60, camera); }
    shell.lodged = { shipId: 'target', position: [0, 0, 0] };
    shell.age += .5; trails.update([shell], .5, camera);
    expect(trails.diagnostics().segments).toBeGreaterThan(0);
    trails.update([], 1, camera);
    expect(trails.diagnostics()).toEqual({ histories: 0, segments: 0 });
    shell.lodged = undefined; shell.waterDragPerSecond = 2;
    trails.update([shell], .1, camera);
    expect(trails.diagnostics().histories).toBe(0);
    const replacement = round(); replacement.age = .01; replacement.position[0] = 8;
    trails.update([replacement], .01, camera);
    expect(endpoints(trails.mesh, 1)[0][0].x).toBeCloseTo(0, 5);
    trails.reset();
    expect([...trails.mesh.instanceMatrix.array].every(value => value === 0)).toBe(true);
    expect(trails.diagnostics()).toEqual({ histories: 0, segments: 0 });
  } finally { trails.dispose(); }
});

test('busy salvos grow GPU batches and clear every page', () => {
  const trails = new ShellTrails(), shells = Array.from({ length: 1100 }, (_, id) => ({ ...round(id), age: .01 }));
  try {
    trails.update(shells, .01, camera);
    expect(trails.diagnostics().histories).toBe(1100);
    expect(trails.diagnostics().segments).toBe(1100);
    expect(trails.mesh.children).toHaveLength(1);
    trails.reset();
    for (const page of [trails.mesh, ...trails.mesh.children as InstancedMesh[]])
      expect([...page.instanceMatrix.array].every(value => value === 0)).toBe(true);
  } finally { trails.dispose(); }
});

test('close views and distant views both retain the round trail', () => {
  const trails = new ShellTrails(), shell = { ...round(), age: .01 };
  const closeCamera = new PerspectiveCamera(52, 16 / 9, .1, 30000);
  closeCamera.position.set(0, 103, -990); closeCamera.lookAt(...shell.position); closeCamera.updateMatrixWorld();
  try {
    trails.update([shell], .01, closeCamera);
    expect(trails.diagnostics()).toEqual({ histories: 1, segments: 1 });
    trails.update([shell], 0, camera);
    expect(trails.diagnostics()).toEqual({ histories: 1, segments: 1 });
  } finally { trails.dispose(); }
});

test('a trail crossing the follow camera clips at the near plane and stays thin at both ends', () => {
  const trails = new ShellTrails(), shell = round();
  const closeCamera = new PerspectiveCamera(52, 16 / 9, .5, 30000);
  closeCamera.position.set(2, 101, -990); closeCamera.lookAt(0, 100, -920); closeCamera.updateMatrixWorld();
  try {
    shell.velocity = [0, 0, 800];
    trails.update([shell], 0, closeCamera);
    shell.age = .1; shell.position[2] = -920;
    trails.update([shell], .1, closeCamera);
    const segments = endpoints(trails.mesh, trails.diagnostics().segments);
    expect(segments).toHaveLength(1);
    for (const [side, point] of segments[0].entries()) {
      const depth = -point.clone().applyMatrix4(closeCamera.matrixWorldInverse).z;
      expect(depth).toBeGreaterThan(closeCamera.near - .0001);
      const width = trails.mesh.geometry.getAttribute(side ? 'headWidth' : 'tailWidth').getX(0);
      const pixels = width * closeCamera.projectionMatrix.elements[5] / (2 * depth) * 720;
      expect(pixels).toBeGreaterThan(1);
      expect(pixels).toBeLessThan(3);
    }
    expect(segments[0][1].distanceTo(new Vector3(...shell.position))).toBeLessThan(.001);
  } finally { trails.dispose(); }
});

test('the shell follow camera hides trails while they keep recording, so leaving T restores the retained path', () => {
  const trails = new ShellTrails(), shell = round();
  try {
    for (let i = 0; i <= 120; i++) {
      shell.age = i / 60; shell.position[0] = shell.age * 800;
      trails.update([shell], 1 / 60, camera, true);
      expect(trails.diagnostics()).toEqual({ histories: 1, segments: 0 });
    }
    expect(trails.mesh.visible).toBe(false);
    expect([...trails.mesh.instanceMatrix.array].every(value => value === 0)).toBe(true);
    trails.update([shell], 0, camera);
    const segments = endpoints(trails.mesh, trails.diagnostics().segments);
    expect(trails.mesh.visible).toBe(true);
    expect(segments.length).toBeGreaterThan(15);
    expect(segments[0][0].x).toBeCloseTo(600, 2); // The full 1.25 seconds recorded while hidden.
    expect(segments.at(-1)![1].distanceTo(new Vector3(...shell.position))).toBeLessThan(.001);
    // Expiry continues while hidden: a finished flight leaves no stale history.
    trails.update([], 1.3, camera, true);
    expect(trails.diagnostics()).toEqual({ histories: 0, segments: 0 });
  } finally { trails.dispose(); }
});
