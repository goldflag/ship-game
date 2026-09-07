export interface ChartView { x: number; z: number; radius: number; }
export function chartPoint(view: ChartView, width: number, height: number, x: number, z: number): [number, number] {
  const scale = width / (2 * view.radius);
  return [width / 2 + (x - view.x) * scale, height / 2 + (z - view.z) * scale];
}
export function chartWorld(view: ChartView, width: number, height: number, x: number, y: number): [number, number] {
  const scale = width / (2 * view.radius);
  return [view.x + (x - width / 2) / scale, view.z + (y - height / 2) / scale];
}
export function fitAirChart(points: { x: number; z: number }[], width: number, height: number): ChartView {
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, radius: Math.max(1500, (maxX - minX) * .65, (maxZ - minZ) * .65 * width / Math.max(1, height)) };
}
