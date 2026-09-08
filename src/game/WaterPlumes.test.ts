import { expect, test } from 'bun:test';
import { Camera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { effectTexture } from './EffectParticles';
import { WaterPlumes } from './WaterPlumes';

// Inspect only vertices referenced by the current draw, as the renderer does.
function visibleVertices(plumes: WaterPlumes): Vector3[] {
  const geometry = plumes.mesh.geometry, position = geometry.getAttribute('position');
  const alpha = geometry.getAttribute('waterOpacity'), indices = geometry.getIndex()!;
  const used = new Set<number>();
  for (let i = 0; i < geometry.drawRange.count; i++) used.add(indices.getX(i));
  return [...used].filter(i => alpha.getX(i) > .001).map(i => new Vector3().fromBufferAttribute(position, i));
}

test('water sheets rise from the impact, slow under gravity, and fall completely into the sea', () => {
  const map = effectTexture('water'), plumes = new WaterPlumes(48, map), camera = new Camera();
  plumes.emit(new Vector3(0, 4.35, 0), 1, new Vector3(0, -1, 0), () => .5);
  const heights: number[] = [];
  for (const dt of [.06, .5, 1.5, 1.5, 1.5]) {
    plumes.advance(dt); plumes.publish(camera);
    const vertices = visibleVertices(plumes);
    expect(vertices.length).toBeGreaterThan(0);
    expect(vertices.every(p => p.y > 4.35)).toBe(true);
    heights.push(Math.max(...vertices.map(p => p.y)));
  }
  expect(heights[0]).toBeLessThan(6);
  expect(heights[1]).toBeGreaterThan(heights[0] + 10);
  expect(heights[2]).toBeGreaterThan(heights[1]);
  expect(heights[4]).toBeLessThan(heights[3]);
  plumes.advance(4); plumes.publish(camera);
  expect(plumes.count).toBe(0);
  expect(plumes.mesh.geometry.drawRange.count).toBe(0);
  plumes.dispose(); map.dispose();
});

test('water sheet motion is frame-rate independent and changing camera cannot turn the water', () => {
  const map = effectTexture('water'), camera = new Camera();
  const results = [30, 60, 144].map(fps => {
    const plumes = new WaterPlumes(48, map);
    plumes.emit(new Vector3(5, .35, 8), 1, new Vector3(.9, -.2, 0).normalize(), () => .42);
    for (let i = 0; i < fps * 2; i++) plumes.advance(1 / fps);
    plumes.publish(camera);
    const before = visibleVertices(plumes);
    camera.position.set(50, 20, -100); camera.lookAt(0, 5, 0); camera.updateMatrixWorld();
    plumes.advance(0); plumes.publish(camera);
    expect(visibleVertices(plumes)).toEqual(before);
    plumes.dispose(); return before;
  });
  expect(results[0].length).toBeGreaterThan(0);
  for (const result of results.slice(1)) {
    expect(result.length).toBe(results[0].length);
    result.forEach((position, i) => expect(position.distanceTo(results[0][i])).toBeLessThan(.00001));
  }
  map.dispose();
});

test('caliber increases the plume and oblique entries carry water downrange', () => {
  const map = effectTexture('water'), camera = new Camera();
  const bounds = (scale: number, direction: Vector3) => {
    const plumes = new WaterPlumes(48, map);
    plumes.emit(new Vector3(0, .35, 0), scale, direction, () => .5);
    plumes.advance(1); plumes.publish(camera);
    const vertices = visibleVertices(plumes);
    const height = Math.max(...vertices.map(p => p.y));
    const x = vertices.reduce((sum, p) => sum + p.x, 0) / vertices.length;
    plumes.dispose(); return { height, x };
  };
  const vertical = new Vector3(0, -1, 0);
  expect(bounds(1, vertical).height).toBeGreaterThan(bounds(.4, vertical).height * 1.5);
  const forward = bounds(1, new Vector3(1, -.1, 0).normalize());
  const backward = bounds(1, new Vector3(-1, -.1, 0).normalize());
  expect(forward.x - backward.x).toBeGreaterThan(5);
  expect(forward.height).toBeLessThan(bounds(1, vertical).height);
  map.dispose();
});

test('overlapping salvos stay bounded and reset leaves no rendered geometry', () => {
  const map = effectTexture('water'), plumes = new WaterPlumes(48, map), camera = new Camera();
  for (let i = 0; i < 100; i++) plumes.emit(new Vector3(i, .35, 0), 1, new Vector3(0, -1, 0), () => .5);
  plumes.advance(.5); plumes.publish(camera);
  expect(plumes.count).toBe(48);
  expect(visibleVertices(plumes).every(p => Number.isFinite(p.x + p.y + p.z))).toBe(true);
  plumes.reset(); plumes.publish(camera);
  expect(plumes.count).toBe(0);
  expect(plumes.mesh.geometry.drawRange.count).toBe(0);
  plumes.emit(new Vector3(0, .35, 0), 1, new Vector3(0, -1, 0), () => .5);
  plumes.advance(.5); plumes.publish(camera);
  expect(plumes.count).toBe(24);
  expect(visibleVertices(plumes).every(p => Math.abs(p.x) < 20)).toBe(true);
  plumes.dispose(); map.dispose();
});

test('reused sheet slots take the new splash shape, scale and direction after overwrite or reset', () => {
  const map = effectTexture('water'), camera = new Camera();
  const random = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try {
    for (const reset of [false, true]) {
      const reused = new WaterPlumes(24, map), fresh = new WaterPlumes(24, map);
      try {
        reused.emit(new Vector3(80, 3, 40), 2.4, new Vector3(1, -.1, 0).normalize(), random(41));
        reused.advance(1.5); reused.publish(camera);
        if (reset) reused.reset();
        for (const pool of [reused, fresh]) {
          pool.emit(new Vector3(-20, -2, 15), .6, new Vector3(-.3, -1, .7).normalize(), random(832));
          pool.setSun(new Vector3(.4, .3, -.7).normalize());
          pool.advance(.9); pool.publish(camera);
        }
        expect(reused.count).toBeGreaterThan(0);
        expect(reused.mesh.geometry.drawRange).toEqual(fresh.mesh.geometry.drawRange);
        for (const name of ['position', 'color', 'waterOpacity'])
          expect(reused.mesh.geometry.getAttribute(name).array).toEqual(fresh.mesh.geometry.getAttribute(name).array);
      } finally { reused.dispose(); fresh.dispose(); }
    }
  } finally { map.dispose(); }
});

test('offscreen sheets keep aging and distant views retain the original streaks', () => {
  const map = effectTexture('water'), plumes = new WaterPlumes(48, map);
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  plumes.emit(new Vector3(0, .35, 0), 1, new Vector3(0, -1, 0), () => .5);
  plumes.advance(1);
  camera.position.set(0, 30, 180); camera.lookAt(0, 20, 0); camera.updateMatrixWorld();
  plumes.publish(camera); const near = visibleVertices(plumes);
  camera.position.z = 5000; camera.lookAt(0, 20, 0); camera.updateMatrixWorld();
  plumes.publish(camera);
  expect(visibleVertices(plumes)).toEqual(near);
  camera.fov = 4.33; camera.updateProjectionMatrix(); plumes.publish(camera);
  expect(visibleVertices(plumes)).toEqual(near);
  camera.lookAt(0, 30, 10000); camera.updateMatrixWorld(); plumes.publish(camera);
  expect(plumes.mesh.geometry.drawRange.count).toBe(0);
  plumes.advance(.5); camera.lookAt(0, 20, 0); camera.updateMatrixWorld(); plumes.publish(camera);
  expect(plumes.count).toBeGreaterThan(0);
  expect(visibleVertices(plumes)).not.toEqual(near);
  plumes.advance(10); plumes.publish(camera);
  expect(plumes.mesh.geometry.drawRange.count).toBe(0);
  plumes.dispose(); map.dispose();
});
