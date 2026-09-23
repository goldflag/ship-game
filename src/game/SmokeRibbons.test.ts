import { expect, test } from 'bun:test';
import { Color, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { EffectLighting } from './EffectLighting';
import { SmokeRibbons, type RibbonPoint } from './SmokeRibbons';

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
