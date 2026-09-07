import { Vector4, type PerspectiveCamera } from 'three/webgpu';
import type { Vec3 } from '../ships/blueprint';

/** Clip before dividing by depth: endpoints behind the camera otherwise mirror the route. */
export function projectAirMapPath(points: Vec3[], camera: PerspectiveCamera, width: number, height: number, closed = false): string {
  const projected = points.map(([x, y, z]) => new Vector4(x, y, z, 1)
    .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix));
  const planes = (p: Vector4) => [p.w + p.x, p.w - p.x, p.w + p.y, p.w - p.y, p.w - camera.near, camera.far - p.w];
  const screen = (p: Vector4) => `${(p.x / p.w + 1) * width / 2} ${(1 - p.y / p.w) * height / 2}`;
  let path = '', connected = false;
  for (let i = 0; i < projected.length - (closed ? 0 : 1); i++) {
    const a = projected[i], b = projected[(i + 1) % projected.length];
    const start = planes(a), end = planes(b);
    let enter = 0, leave = 1;
    for (let j = 0; j < start.length; j++) {
      if (start[j] < 0 && end[j] < 0) { leave = -1; break; }
      if (start[j] < 0) enter = Math.max(enter, start[j] / (start[j] - end[j]));
      else if (end[j] < 0) leave = Math.min(leave, start[j] / (start[j] - end[j]));
    }
    if (enter > leave) { connected = false; continue; }
    if (!connected || enter > 0) path += `M${screen(a.clone().lerp(b, enter))}`;
    path += `L${screen(a.clone().lerp(b, leave))}`;
    connected = leave === 1;
  }
  return path;
}
