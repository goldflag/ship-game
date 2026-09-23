import { expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { CLIPMAP_LEVELS, OceanGeometry } from './OceanGeometry';

const smoothstep = (low: number, high: number, x: number) => { const t = Math.min(1, Math.max(0, (x - low) / (high - low))); return t * t * (3 - 2 * t); };
const mod2 = (n: number) => n - 2 * Math.floor(n / 2);

/** The vertex stage's grid position of every vertex, evaluated on the CPU for an eye at `eye`. */
function grid(surface: OceanGeometry, eye: Vector3) {
  const position = surface.mesh.geometry.getAttribute('position'), data = surface.mesh.geometry.getAttribute('oceanLevel');
  const frames = Array.from({ length: CLIPMAP_LEVELS }, (_, level) => {
    const cell = surface.cell(level), step = cell * 2;
    return { x: Math.round(eye.x / step) * step, z: Math.round(eye.z / step) * step, cell };
  });
  return Array.from({ length: position.count }, (_, i) => {
    const horizon = data.getX(i) > CLIPMAP_LEVELS - .5, level = Math.min(data.getX(i), CLIPMAP_LEVELS - 1);
    const frame = frames[level], finer = frames[Math.max(level - 1, 0)];
    let x = position.getX(i) / frame.cell, z = position.getZ(i) / frame.cell;
    const ring = Math.max(Math.abs(x), Math.abs(z));
    if (level > 0 && !horizon && ring <= surface.segments / 4) { x += (finer.x - frame.x) / frame.cell; z += (finer.z - frame.z) / frame.cell; }
    const worldX = frame.x + x * frame.cell, worldZ = frame.z + z * frame.cell;
    const reach = Math.max(Math.abs(worldX - eye.x), Math.abs(worldZ - eye.z)) / (frame.cell * surface.segments / 2);
    const morph = horizon ? 0 : smoothstep(.6, .85, reach);
    return { level: data.getX(i), ring, morph, x: worldX - mod2(x) * morph * frame.cell, z: worldZ - mod2(z) * morph * frame.cell };
  });
}

const key = (v: { x: number; z: number }) => `${v.x},${v.z}`;

for (const segments of [16, 32, 64, 128]) test(`clipmap seams share exact vertices at ${segments} segments`, () => {
  const surface = new OceanGeometry(segments, 60000);
  const edge = segments / 2 * surface.cell(CLIPMAP_LEVELS - 1);
  for (const eye of [new Vector3(0, 30, 0), new Vector3(3.7, 12, -9.1), new Vector3(-1234.5, 80, 777.25), new Vector3(98765.4, 5, -45678.9)]) {
    const vertices = grid(surface, eye);
    for (let level = 0; level < CLIPMAP_LEVELS; level++) {
      // Every vertex on a level's outer edge has reached the coarser lattice.
      const outer = vertices.filter(v => v.level === level && v.ring === segments / 2);
      expect(outer.every(v => v.morph === 1)).toBe(true);
      const coarser = level + 1 < CLIPMAP_LEVELS
        ? vertices.filter(v => v.level === level + 1 && v.ring === segments / 4)
        : vertices.filter(v => v.level === CLIPMAP_LEVELS && Math.abs(Math.max(Math.abs(v.x - Math.round(eye.x / surface.cell(level) / 2) * surface.cell(level) * 2),
          Math.abs(v.z - Math.round(eye.z / surface.cell(level) / 2) * surface.cell(level) * 2)) - edge) < 1e-6);
      expect(new Set(outer.map(key))).toEqual(new Set(coarser.map(key)));
    }
  }
  surface.dispose();
});

test('the horizon ring reaches 95% of the far plane and grows, never shrinks', () => {
  const surface = new OceanGeometry(32, 60000), camera = new PerspectiveCamera(52, 1, .5, 60000);
  camera.position.set(1000, 50, -2000); camera.updateMatrixWorld(); surface.update(camera);
  expect(surface.covers(1000 + 55000, -2000)).toBe(true);
  expect(surface.covers(1000 + 58000, -2000)).toBe(false);
  surface.ensureHorizon(1e6);
  const grown = surface.mesh.geometry;
  expect(surface.covers(1000, -2000 + 900000)).toBe(true);
  surface.ensureHorizon(60000);
  expect(surface.mesh.geometry).toBe(grown);
  surface.dispose();
});
