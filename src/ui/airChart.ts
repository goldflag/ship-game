export interface ChartView { x: number; z: number; radius: number; }
export const BATTLEFIELD_FOV = 52;
export const BATTLEFIELD_TILT = 20 * Math.PI / 180;
const sin = Math.sin(BATTLEFIELD_TILT), cos = Math.cos(BATTLEFIELD_TILT);
const focalLength = (height: number) => height / (2 * Math.tan(BATTLEFIELD_FOV * Math.PI / 360));
export const battlefieldDistance = (view: ChartView, width: number, height: number) => 2 * view.radius * focalLength(height) / width;

/** Shared perspective projection for the tilted scene, sea targets and airborne routes. */
export function chartPoint(view: ChartView, width: number, height: number, x: number, z: number, altitude = 0): [number, number] {
  const dz = z - view.z;
  const depth = battlefieldDistance(view, width, height) - dz * sin - altitude * cos;
  const scale = focalLength(height) / Math.max(1, depth);
  return [width / 2 + (x - view.x) * scale, height / 2 + (dz * cos - altitude * sin) * scale];
}
export function chartWorld(view: ChartView, width: number, height: number, x: number, y: number): [number, number] {
  const focal = focalLength(height), dy = (y - height / 2) / focal;
  const distance = battlefieldDistance(view, width, height);
  const dz = dy * distance / (cos + dy * sin);
  return [view.x + (x - width / 2) / focal * (distance - dz * sin), view.z + dz];
}
export function fitAirChart(points: { x: number; z: number }[], width: number, height: number): ChartView {
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, radius: Math.max(1500, (maxX - minX) * .65, (maxZ - minZ) * .65 * width / Math.max(1, height)) };
}
