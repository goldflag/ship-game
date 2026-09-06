import type { Hull, Vec3 } from '../ships/blueprint';

export function interpolate(table: [number, number][], at: number): number {
  if (at <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [a, x] = table[i - 1], [b, y] = table[i];
    if (at <= b) return x + (y - x) * (at - a) / (b - a);
  }
  return table.at(-1)![1];
}

/** Authoring-envelope query; protection surfaces do not define a ship's interior.
 * Section lofts interpolate corresponding points. Older station-only hulls use
 * their breadth/deck/keel envelope until explicit sections are authored. */
export function hullContains(hull: Hull, [x, y, z]: Vec3): boolean {
  const station = hull.length / 2 - z;
  if (station < 0 || station > hull.length) return false;
  if (!hull.sections) return Math.abs(x) <= interpolate(hull.halfBreadths, station) &&
    y >= interpolate(hull.keelHeights, station) && y <= interpolate(hull.deckHeights, station);
  const sections = hull.sections;
  const index = Math.max(1, sections.findIndex(s => s.station >= station));
  const a = sections[index - 1], b = sections[index], t = (station - a.station) / (b.station - a.station);
  let points: [number, number][];
  if (a.points.length === b.points.length) points = a.points.map(([width, height], i) => [width + (b.points[i][0] - width) * t, height + (b.points[i][1] - height) * t]);
  else {
    // Different sample counts are legal authoring data: interpolate breadth at a
    // common height rather than coupling the CPU envelope to a mesh tessellation.
    const bottom = a.points[0][1] * (1 - t) + b.points[0][1] * t;
    const top = a.points.at(-1)![1] * (1 - t) + b.points.at(-1)![1] * t;
    if (y < bottom || y > top) return false;
    return Math.abs(x) <= interpolate(a.points.map(([w, h]) => [h, w]), y) * (1 - t) + interpolate(b.points.map(([w, h]) => [h, w]), y) * t;
  }
  if (y < points[0][1] - 1e-7 || y > points.at(-1)![1] + 1e-7) return false;
  // Horizontal chines can have repeated heights. Choose the outside endpoint.
  let width = 0;
  for (let i = 1; i < points.length; i++) {
    const [aw, ay] = points[i - 1], [bw, by] = points[i];
    if (y >= ay - 1e-7 && y <= by + 1e-7) width = Math.max(width, by - ay < 1e-7 ? Math.max(aw, bw) : aw + (bw - aw) * (y - ay) / (by - ay));
  }
  return Math.abs(x) <= width + 1e-7;
}
