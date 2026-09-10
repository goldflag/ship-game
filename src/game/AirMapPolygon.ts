import { Vector4, type PerspectiveCamera } from 'three/webgpu';
import type { Vec3 } from '../ships/blueprint';

/** Filled planar polygons need their clipped boundary, including viewport edges.
 * Clipping individual strokes would close disconnected fragments diagonally.
 * Recon patches are convex; preserve their winding and emit one closed subpath.
 */
export function projectAirMapPolygon(points: readonly Vec3[], camera: PerspectiveCamera, width: number, height: number): string {
  if (points.length < 3 || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || !Number.isFinite(camera.near) || !Number.isFinite(camera.far) || camera.near <= 0 || camera.far <= camera.near) return '';
  let polygon = points.map(([x, y, z]) => new Vector4(x, y, z, 1)
    .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix));
  if (polygon.some(p => ![p.x, p.y, p.z, p.w].every(Number.isFinite))) return '';
  // For PerspectiveCamera w is positive camera-space depth. Using near/far
  // distances also works with either WebGL or WebGPU clip-space z conventions.
  const planes: ((p: Vector4) => number)[] = [
    p => p.w - camera.near, p => camera.far - p.w,
    p => p.w + p.x, p => p.w - p.x, p => p.w + p.y, p => p.w - p.y,
  ];
  for (const distance of planes) {
    if (polygon.length < 3) return '';
    const clipped: Vector4[] = [];
    let previous = polygon.at(-1)!, previousDistance = distance(previous);
    for (const current of polygon) {
      const currentDistance = distance(current);
      const previousInside = previousDistance >= 0, currentInside = currentDistance >= 0;
      if (previousInside !== currentInside) {
        const fraction = previousDistance / (previousDistance - currentDistance);
        clipped.push(previous.clone().lerp(current, fraction));
      }
      if (currentInside) clipped.push(current);
      previous = current; previousDistance = currentDistance;
    }
    polygon = clipped;
  }
  if (polygon.length < 3) return '';
  const screen = polygon.map(p => [(p.x / p.w + 1) * width / 2, (1 - p.y / p.w) * height / 2]);
  if (screen.some(p => !p.every(Number.isFinite))) return '';
  const area = screen.reduce((sum, p, i) => {
    const next = screen[(i + 1) % screen.length];
    return sum + p[0] * next[1] - next[0] * p[1];
  }, 0);
  if (area === 0) return '';
  return screen.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('') + 'Z';
}
