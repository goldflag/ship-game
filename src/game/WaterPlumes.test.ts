import { expect, test } from 'bun:test';
import { Camera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { effectTexture } from './EffectParticles';
import { WaterPlumes } from './WaterPlumes';

// Inspect the compact instance positions actually consumed by the vertex shader.
function visibleVertices(plumes: WaterPlumes): Vector3[] {
  const geometry = plumes.mesh.geometry, position = geometry.getAttribute('waterParcel');
  const alpha = geometry.getAttribute('waterShape');
  return Array.from({ length: geometry.instanceCount }, (_, i) => i)
    .filter(i => alpha.getW(i) > .001).map(i => new Vector3().fromBufferAttribute(position, i));
}

test('water rises from the impact, slows under gravity, and falls completely into the sea', () => {
  const map = effectTexture('spray'), plumes = new WaterPlumes(2, map), camera = new Camera();
  plumes.emit(new Vector3(0, 4.35, 0), 1, new Vector3(0, -1, 0), () => .5);
  const heights: number[] = [];
  for (const dt of [.06, .5, 1, 1, 1]) {
    plumes.advance(dt); plumes.publish(camera);
    const vertices = visibleVertices(plumes);
    expect(vertices.length).toBeGreaterThan(0);
    expect(vertices.every(p => p.y > 4.35)).toBe(true);
    heights.push(Math.max(...vertices.map(p => p.y)));
  }
  expect(heights[0]).toBeLessThan(7);
  expect(heights[1]).toBeGreaterThan(heights[0] + 10);
  expect(heights[2]).toBeGreaterThan(heights[1]);
  expect(heights[4]).toBeLessThan(heights[3]);
  plumes.advance(4); plumes.publish(camera);
  expect(plumes.count).toBe(0);
  expect(plumes.mesh.geometry.drawRange.count).toBe(0);
  plumes.dispose(); map.dispose();
});

test('water motion is frame-rate independent and camera rotation cannot move it', () => {
  const map = effectTexture('spray'), camera = new Camera();
  const results = [30, 60, 144].map(fps => {
    const plumes = new WaterPlumes(2, map);
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
  const map = effectTexture('spray'), camera = new Camera();
  const bounds = (scale: number, direction: Vector3) => {
    const plumes = new WaterPlumes(2, map);
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
  const map = effectTexture('spray'), plumes = new WaterPlumes(2, map), camera = new Camera();
  for (let i = 0; i < 100; i++) plumes.emit(new Vector3(i, .35, 0), 1, new Vector3(0, -1, 0), () => .5);
  plumes.advance(.5); plumes.publish(camera);
  expect(plumes.count).toBe(2);
  expect(plumes.particleCount).toBeLessThanOrEqual(plumes.particleCapacity);
  expect(visibleVertices(plumes).every(p => Number.isFinite(p.x + p.y + p.z))).toBe(true);
  plumes.reset(); plumes.publish(camera);
  expect(plumes.count).toBe(0);
  expect(plumes.mesh.geometry.drawRange.count).toBe(0);
  plumes.emit(new Vector3(0, .35, 0), 1, new Vector3(0, -1, 0), () => .5);
  plumes.advance(.5); plumes.publish(camera);
  expect(plumes.count).toBe(1);
  expect(visibleVertices(plumes).every(p => Math.abs(p.x) < 20)).toBe(true);
  plumes.dispose(); map.dispose();
});

test('distant splashes reduce geometry, zoom restores it, and offscreen splashes keep aging', () => {
  const map = effectTexture('spray'), plumes = new WaterPlumes(2, map);
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  plumes.emit(new Vector3(0, .35, 0), 1, new Vector3(0, -1, 0), () => .5);
  plumes.advance(1);
  camera.position.set(0, 30, 180); camera.lookAt(0, 20, 0); camera.updateMatrixWorld();
  plumes.publish(camera); const near = plumes.particleCount;
  camera.position.z = 5000; camera.lookAt(0, 20, 0); camera.updateMatrixWorld();
  plumes.publish(camera);
  expect(plumes.particleCount).toBeLessThan(near * .6);
  expect(plumes.count).toBe(1);
  camera.fov = 4.33; camera.updateProjectionMatrix(); plumes.publish(camera);
  expect(plumes.particleCount).toBe(near);
  camera.lookAt(0, 30, 10000); camera.updateMatrixWorld(); plumes.publish(camera);
  expect(plumes.mesh.geometry.drawRange.count).toBe(0);
  plumes.advance(10); camera.lookAt(0, 20, 0); camera.updateMatrixWorld(); plumes.publish(camera);
  expect(plumes.count).toBe(0);
  plumes.dispose(); map.dispose();
});
