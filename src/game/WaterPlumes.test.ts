import { expect, test } from 'bun:test';
import { Camera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { JETS_PER_SPLASH, WaterPlumes } from './WaterPlumes';

const random = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

/** Vertices referenced by the current draw and not faded out, as the renderer draws them. */
function visibleVertices(plumes: WaterPlumes): Vector3[] {
  const geometry = plumes.mesh.geometry, position = geometry.getAttribute('position');
  const state = geometry.getAttribute('jetState'), indices = geometry.getIndex()!;
  const used = new Set<number>();
  for (let i = 0; i < geometry.drawRange.count; i++) used.add(indices.getX(i));
  return [...used].filter(i => state.getX(i) > .001).map(i => new Vector3().fromBufferAttribute(position, i));
}

const ROWS = 15;
/** Each drawn strip's centre line, row by row: the midpoint of its two edge vertices. Jets draw far to near, so
 * strips are put back in a fixed order (by where they leave the sea) before views from different places compare. */
function spines(plumes: WaterPlumes): Vector3[] {
  const geometry = plumes.mesh.geometry, position = geometry.getAttribute('position'), jets: Vector3[][] = [];
  for (let jet = 0; jet < geometry.drawRange.count / 6 / (ROWS - 1); jet++) {
    jets.push(Array.from({ length: ROWS }, (_, row) => {
      const vertex = (jet * ROWS + row) * 2;
      return new Vector3().fromBufferAttribute(position, vertex).add(new Vector3().fromBufferAttribute(position, vertex + 1)).multiplyScalar(.5);
    }));
  }
  const key = (points: Vector3[]) => [points[0].x, points[0].z, points[ROWS - 1].x, points[ROWS - 1].z];
  jets.sort((a, b) => { const ka = key(a), kb = key(b); return ka.map((k, i) => k - kb[i]).find(d => Math.abs(d) > 1e-6) ?? 0; });
  return jets.flat();
}

function camera(position: [number, number, number], target: [number, number, number] = [0, 20, 0]): PerspectiveCamera {
  const view = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  view.position.set(...position); view.lookAt(...target); view.updateMatrixWorld();
  return view;
}

test('water jets rise from the impact, slow under gravity, and fall completely into the sea', () => {
  const plumes = new WaterPlumes(64), view = new Camera();
  plumes.emit(new Vector3(0, 4.35, 0), 1, new Vector3(0, -1, 0), () => .5);
  const heights: number[] = [];
  for (const dt of [.06, .5, 1.5, 1.5, 1.5]) {
    plumes.advance(dt); plumes.publish(view);
    expect(visibleVertices(plumes).length).toBeGreaterThan(0);
    // Spines never dip more than half a metre below the impact's sea surface, where the strips fade out.
    const points = spines(plumes);
    expect(points.every(p => p.y >= 4.35 - .5 - 1e-4)).toBe(true);
    heights.push(Math.max(...points.map(p => p.y)));
  }
  expect(heights[0]).toBeLessThan(8);
  expect(heights[1]).toBeGreaterThan(heights[0] + 10);
  expect(heights[2]).toBeGreaterThan(heights[1]);
  // A heavy column stands about 60 m high at its apex.
  expect(Math.max(...heights)).toBeGreaterThan(50);
  expect(Math.max(...heights)).toBeLessThan(80);
  expect(heights[4]).toBeLessThan(heights[3]);
  plumes.advance(4); plumes.publish(view);
  expect(plumes.count).toBe(0);
  expect(plumes.mesh.geometry.drawRange.count).toBe(0);
  plumes.dispose();
});

test('jet motion is frame-rate independent, and the strips turn to face the camera about fixed spines', () => {
  const results = [30, 60, 144].map(fps => {
    const plumes = new WaterPlumes(64), view = camera([60, 25, 300]);
    plumes.emit(new Vector3(5, .35, 8), 1, new Vector3(.9, -.2, 0).normalize(), () => .42);
    for (let i = 0; i < fps * 2; i++) plumes.advance(1 / fps);
    plumes.publish(view);
    const before = spines(plumes);
    const moved = camera([-250, 120, -80]);
    plumes.advance(0); plumes.publish(moved);
    // The water itself never turns with the camera; only each strip's width does, to lie across the line of sight.
    const after = spines(plumes);
    expect(after.length).toBe(before.length);
    after.forEach((point, i) => expect(point.distanceTo(before[i])).toBeLessThan(1e-3));
    const position = plumes.mesh.geometry.getAttribute('position'), side = new Vector3(), toCamera = new Vector3(), edge = new Vector3();
    for (let i = 0; i < after.length * 2; i += 2) {
      edge.fromBufferAttribute(position, i);
      side.fromBufferAttribute(position, i + 1).sub(edge);
      if (side.length() < 1e-3) continue;
      toCamera.subVectors(moved.position, edge.addScaledVector(side, .5)).normalize();
      expect(Math.abs(side.normalize().dot(toCamera))).toBeLessThan(1e-3);
    }
    plumes.dispose(); return before;
  });
  expect(results[0].length).toBeGreaterThan(0);
  for (const result of results.slice(1)) {
    expect(result.length).toBe(results[0].length);
    result.forEach((position, i) => expect(position.distanceTo(results[0][i])).toBeLessThan(1e-3));
  }
});

test('a heavy column rises as a fan of jets over a low, wide skirt', () => {
  const plumes = new WaterPlumes(64), view = camera([0, 25, 400]);
  plumes.emit(new Vector3(0, .35, 0), 1, new Vector3(0, -1, 0), random(3));
  plumes.advance(2); plumes.publish(view);
  const points = spines(plumes), top = Math.max(...points.map(p => p.y));
  const reach = (low: number, high: number) => Math.max(...points.filter(p => p.y >= low * top && p.y <= high * top).map(p => Math.hypot(p.x, p.z)));
  expect(top).toBeGreaterThan(40);
  // The jets flare: the crown spreads over half the column's height, not a thin pillar...
  expect(reach(.7, 1) * 2).toBeGreaterThan(top * .5);
  // ...and the skirt thrown out around the base reaches further still, low over the sea.
  expect(reach(0, .25)).toBeGreaterThan(reach(.7, 1));
  plumes.dispose();
});

test('caliber increases the plume and oblique entries carry water downrange', () => {
  const view = new Camera();
  const bounds = (scale: number, direction: Vector3) => {
    const plumes = new WaterPlumes(64);
    plumes.emit(new Vector3(0, .35, 0), scale, direction, () => .5);
    plumes.advance(1); plumes.publish(view);
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
});

test('light guns throw fewer jets than heavy ones', () => {
  const count = (scale: number) => {
    const plumes = new WaterPlumes(128);
    plumes.emit(new Vector3(0, .35, 0), scale, new Vector3(0, -1, 0), () => .5);
    plumes.advance(.5); plumes.publish(new Camera());
    const jets = plumes.count; plumes.dispose(); return jets;
  };
  expect(count(1)).toBe(JETS_PER_SPLASH);
  expect(count(.3)).toBeLessThan(JETS_PER_SPLASH * .6);
  expect(count(.3)).toBeGreaterThan(0);
});

test('overlapping salvos stay bounded and reset leaves no rendered geometry', () => {
  const plumes = new WaterPlumes(48), view = new Camera();
  for (let i = 0; i < 100; i++) plumes.emit(new Vector3(i, .35, 0), 1, new Vector3(0, -1, 0), () => .5);
  plumes.advance(.5); plumes.publish(view);
  expect(plumes.count).toBe(48);
  expect(visibleVertices(plumes).every(p => Number.isFinite(p.x + p.y + p.z))).toBe(true);
  plumes.reset(); plumes.publish(view);
  expect(plumes.count).toBe(0);
  expect(plumes.mesh.geometry.drawRange.count).toBe(0);
  plumes.emit(new Vector3(0, .35, 0), 1, new Vector3(0, -1, 0), () => .5);
  plumes.advance(.5); plumes.publish(view);
  expect(plumes.count).toBe(JETS_PER_SPLASH);
  expect(visibleVertices(plumes).every(p => Math.abs(p.x) < 40)).toBe(true);
  plumes.dispose();
});

test('a full batch gives the next splash the jets nearest the end of their flight', () => {
  const plumes = new WaterPlumes(JETS_PER_SPLASH * 2), view = new Camera(), down = new Vector3(0, -1, 0);
  plumes.emit(new Vector3(-500, .35, 0), 1, down, random(1));
  plumes.advance(3);
  plumes.emit(new Vector3(500, .35, 0), 1, down, random(2));
  plumes.advance(.5);
  plumes.emit(new Vector3(0, .35, 0), 1, down, random(3));
  plumes.advance(.1); plumes.publish(view);
  const xs = spines(plumes).map(p => p.x);
  // The older splash gave way; the younger one still stands whole.
  expect(xs.some(x => x < -400)).toBe(false);
  expect(xs.filter(x => x > 400).length).toBe(JETS_PER_SPLASH * 15);
  plumes.dispose();
});

test('reused jet slots take the new splash shape, scale and direction after overwrite or reset', () => {
  const view = camera([30, 40, 260]);
  for (const reset of [false, true]) {
    const reused = new WaterPlumes(JETS_PER_SPLASH), fresh = new WaterPlumes(JETS_PER_SPLASH);
    try {
      reused.emit(new Vector3(80, 3, 40), 2.4, new Vector3(1, -.1, 0).normalize(), random(41));
      reused.advance(1.5); reused.publish(view);
      if (reset) reused.reset();
      for (const pool of [reused, fresh]) {
        pool.emit(new Vector3(-20, -2, 15), .6, new Vector3(-.3, -1, .7).normalize(), random(832));
        pool.setSun(new Vector3(.4, .3, -.7).normalize());
        pool.advance(.9); pool.publish(view);
      }
      expect(reused.count).toBeGreaterThan(0);
      expect(reused.mesh.geometry.drawRange).toEqual(fresh.mesh.geometry.drawRange);
      for (const name of ['position', 'jetSide', 'jetState'])
        expect(reused.mesh.geometry.getAttribute(name).array).toEqual(fresh.mesh.geometry.getAttribute(name).array);
    } finally { reused.dispose(); fresh.dispose(); }
  }
});

test('offscreen jets keep aging and distant views keep the same water', () => {
  const plumes = new WaterPlumes(64), view = camera([0, 30, 180]);
  plumes.emit(new Vector3(0, .35, 0), 1, new Vector3(0, -1, 0), () => .5);
  plumes.advance(1);
  plumes.publish(view); const near = spines(plumes);
  view.position.z = 5000; view.lookAt(0, 20, 0); view.updateMatrixWorld();
  plumes.publish(view);
  const far = spines(plumes);
  expect(far.length).toBe(near.length);
  far.forEach((point, i) => expect(point.distanceTo(near[i])).toBeLessThan(1e-3));
  view.fov = 4.33; view.updateProjectionMatrix(); plumes.publish(view);
  expect(spines(plumes).length).toBe(near.length);
  view.lookAt(0, 30, 10000); view.updateMatrixWorld(); plumes.publish(view);
  expect(plumes.mesh.geometry.drawRange.count).toBe(0);
  plumes.advance(.5); view.lookAt(0, 20, 0); view.updateMatrixWorld(); plumes.publish(view);
  expect(plumes.count).toBeGreaterThan(0);
  expect(spines(plumes)[5].distanceTo(near[5])).toBeGreaterThan(.1);
  plumes.advance(10); plumes.publish(view);
  expect(plumes.mesh.geometry.drawRange.count).toBe(0);
  plumes.dispose();
});

test('a low sun leaves the column\'s far side in its own shadow; a high sun lights it all round', () => {
  const sunlight = (sun: Vector3) => {
    const plumes = new WaterPlumes(64), view = camera([0, 30, 300]);
    plumes.setSun(sun.normalize());
    plumes.emit(new Vector3(0, .35, 0), 1, new Vector3(0, -1, 0), random(9));
    plumes.advance(1.5); plumes.publish(view);
    const geometry = plumes.mesh.geometry, position = geometry.getAttribute('position'), state = geometry.getAttribute('jetState');
    const sides = { near: [] as number[], far: [] as number[] };
    for (let i = 0; i < geometry.drawRange.count / 6 / 14 * 30; i++) {
      if (position.getY(i) > 20 || state.getX(i) < .01) continue;
      (position.getX(i) > 0 ? sides.near : sides.far).push(state.getZ(i));
    }
    plumes.dispose();
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    return { near: mean(sides.near), far: mean(sides.far) };
  };
  const low = sunlight(new Vector3(1, .25, 0));
  expect(low.near).toBeGreaterThan(low.far * 1.15);
  const high = sunlight(new Vector3(0, 1, 0));
  expect(Math.abs(high.near - high.far)).toBeLessThan(.05);
});
