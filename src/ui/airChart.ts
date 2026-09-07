export interface ChartView { x: number; z: number; radius: number; tilt?: number; bearing?: number; }
export const BATTLEFIELD_FOV = 52;
export const BATTLEFIELD_TILT = 20 * Math.PI / 180;
export const BATTLEFIELD_MAX_TILT = 55 * Math.PI / 180;
const focalLength = (height: number) => height / (2 * Math.tan(BATTLEFIELD_FOV * Math.PI / 360));
export const battlefieldDistance = (view: ChartView, width: number, height: number) => 2 * view.radius * focalLength(height) / width;

/** Shared perspective projection for the tilted scene, sea targets and airborne routes. */
export function chartPoint(view: ChartView, width: number, height: number, x: number, z: number, altitude = 0): [number, number] {
  const sin = Math.sin(view.tilt ?? BATTLEFIELD_TILT), cos = Math.cos(view.tilt ?? BATTLEFIELD_TILT);
  const bearing = view.bearing ?? 0, dx = x - view.x, worldZ = z - view.z;
  const dz = dx * Math.sin(bearing) + worldZ * Math.cos(bearing);
  const localX = dx * Math.cos(bearing) - worldZ * Math.sin(bearing);
  const depth = battlefieldDistance(view, width, height) - dz * sin - altitude * cos;
  const scale = focalLength(height) / Math.max(1, depth);
  return [width / 2 + localX * scale, height / 2 + (dz * cos - altitude * sin) * scale];
}
export function chartWorld(view: ChartView, width: number, height: number, x: number, y: number): [number, number] {
  const sin = Math.sin(view.tilt ?? BATTLEFIELD_TILT), cos = Math.cos(view.tilt ?? BATTLEFIELD_TILT);
  const focal = focalLength(height), dy = (y - height / 2) / focal;
  const distance = battlefieldDistance(view, width, height);
  const dz = dy * distance / (cos + dy * sin);
  const dx = (x - width / 2) / focal * (distance - dz * sin), bearing = view.bearing ?? 0;
  return [view.x + dx * Math.cos(bearing) + dz * Math.sin(bearing), view.z - dx * Math.sin(bearing) + dz * Math.cos(bearing)];
}
export function fitAirChart(points: { x: number; z: number }[], width: number, height: number): ChartView {
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, radius: Math.max(1500, (maxX - minX) * .65, (maxZ - minZ) * .65 * width / Math.max(1, height)) };
}
