import { expect, test } from 'bun:test';
import { Color, PerspectiveCamera, Vector3, type BufferAttribute } from 'three/webgpu';
import { EffectLighting } from './EffectLighting';
import { effectUploads } from './InstanceUploads';
import { SmokeRibbons, type RibbonPoint } from './SmokeRibbons';
import { GpuUploadModel, sameWords } from './testing/gpuUploads';

test('a plume drifting toward the camera keeps one side and never twists into edge-on slivers', () => {
  const ribbons = new SmokeRibbons(new EffectLighting()), camera = new PerspectiveCamera(55, 16 / 9, .5, 60000);
  camera.position.set(0, 45, 0); camera.lookAt(0, 38, -300); camera.updateMatrixWorld();
  // Oldest first: released at a funnel 300 m ahead, drifting toward and past the camera, rising
  // as it ages and swinging back and forth across the line of sight.
  const points: RibbonPoint[] = Array.from({ length: 40 }, (_, i) => {
    const age = 40 - i;
    return { position: new Vector3(Math.sin(i * .7) * 6, 40 + age * .4, -300 + age * 8), width: 8 + age, opacity: .5,
      color: new Color(1, 1, 1), along: i * 8, age, spent: 0 };
  });
  ribbons.begin(camera); ribbons.strip(points, points.length); ribbons.end();
  const position = ribbons.mesh.geometry.getAttribute('position'), side = ribbons.mesh.geometry.getAttribute('plumeSide');
  const across = (i: number) => new Vector3().fromBufferAttribute(position, i * 2 + 1).sub(new Vector3().fromBufferAttribute(position, i * 2));
  for (let i = 0; i < points.length; i++) {
    // Full width across every sample, square to the view, and on the same side as its neighbour.
    expect(across(i).length()).toBeCloseTo(points[i].width, 3);
    expect(Math.abs(across(i).normalize().dot(new Vector3().subVectors(camera.position, points[i].position).normalize()))).toBeLessThan(1e-4);
    if (i) expect(across(i).dot(across(i - 1))).toBeGreaterThan(0);
    if (i) expect(new Vector3().fromBufferAttribute(side, i * 2).dot(new Vector3().fromBufferAttribute(side, i * 2 - 2))).toBeGreaterThan(0);
  }
  ribbons.dispose();
});

test('trails upload their live range once a frame however many passes draw them, and each pass reads this frame\'s strips', () => {
  const camera = new PerspectiveCamera(55, 16 / 9, .5, 60000), lighting = new EffectLighting();
  const arms = { versioned: new SmokeRibbons(lighting, 4096), dynamic: new SmokeRibbons(lighting, 4096) };
  const models = { versioned: new GpuUploadModel(), dynamic: new GpuUploadModel() };
  const buffers = (ribbons: SmokeRibbons) => { const g = ribbons.mesh.geometry; return [...Object.values(g.attributes), g.index!] as BufferAttribute[]; };
  try {
    for (let frame = 0; frame < 120; frame++) {
      camera.position.set(Math.sin(frame / 20) * 300, 60, Math.cos(frame / 20) * 300); camera.lookAt(0, 40, 0); camera.updateMatrixWorld();
      const plumes = 1 + frame % 7;
      for (const [key, ribbons] of Object.entries(arms)) {
        effectUploads.versioned = key === 'versioned';
        ribbons.begin(camera);
        for (let p = 0; p < plumes; p++) {
          const points: RibbonPoint[] = Array.from({ length: 12 + p * 3 }, (_, i) => ({ position: new Vector3(p * 40 + Math.sin(i + frame * .1) * 5, 30 + i * 2, -i * 9),
            width: 6 + i, opacity: .5, color: new Color(.8, .8, .8), along: i * 9, age: i + frame / 60, spent: i / 40 }));
          ribbons.strip(points, points.length);
        }
        ribbons.end();
      }
      effectUploads.versioned = true;
      // Two passes draw the trails every frame (the scene and, say, a capture).
      for (let pass = 0; pass < 2; pass++) for (const key of ['versioned', 'dynamic'] as const) models[key].render(buffers(arms[key]));
      const geometry = arms.versioned.mesh.geometry, indices = geometry.drawRange.count, index = geometry.index!.array as Uint32Array;
      const vertices = Math.max(...index.subarray(0, indices)) + 1;
      expect(sameWords(models.versioned.gpu(geometry.index!), index, indices)).toBe(true);
      for (const attribute of Object.values(geometry.attributes) as BufferAttribute[])
        expect(sameWords(models.versioned.gpu(attribute), attribute.array as Float32Array, vertices * attribute.itemSize)).toBe(true);
    }
    // Dynamic usage sends every whole array again on the second pass.
    expect(models.dynamic.bytes).toBeGreaterThan(models.versioned.bytes * 20);
  } finally { effectUploads.versioned = true; arms.versioned.dispose(); arms.dynamic.dispose(); lighting.dispose(); }
});
