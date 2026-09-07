import type { Vec3, Volume } from '../ships/blueprint';

type Box = Pick<Volume, 'center' | 'size'>;
type Entry = { box: Box; mountId?: string };
type Branch = { bounds: Box; left?: Branch; right?: Branch; entries?: Entry[] };

/** Static hull-local broad phase; leaves still use the exact readiness test. */
export class BarrelObstructionTree {
  private readonly root?: Branch;
  constructor(entries: Entry[]) {
    const build = (items: Entry[]): Branch => {
      const low: Vec3 = [Infinity, Infinity, Infinity], high: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const { box } of items) for (let axis = 0; axis < 3; axis++) {
        low[axis] = Math.min(low[axis], box.center[axis] - box.size[axis] / 2);
        high[axis] = Math.max(high[axis], box.center[axis] + box.size[axis] / 2);
      }
      const bounds: Box = { center: low.map((n, i) => (n + high[i]) / 2) as Vec3,
        size: low.map((n, i) => high[i] - n + 1e-6) as Vec3 };
      if (items.length <= 4) return { bounds, entries: items };
      const axis = bounds.size.indexOf(Math.max(...bounds.size));
      items.sort((a, b) => a.box.center[axis] - b.box.center[axis]);
      const middle = Math.floor(items.length / 2);
      return { bounds, left: build(items.slice(0, middle)), right: build(items.slice(middle)) };
    };
    if (entries.length) this.root = build([...entries]);
  }
  intersects(from: Vec3, to: Vec3, mountId: string): boolean {
    const visit = (node: Branch): boolean => {
      if (!segmentIntersectsBox(from, to, node.bounds)) return false;
      if (node.entries) {
        for (const entry of node.entries) if (entry.mountId !== mountId && segmentIntersectsBox(from, to, entry.box)) return true;
        return false;
      }
      return visit(node.left!) || visit(node.right!);
    };
    return !!this.root && visit(this.root);
  }
}

/** Exact boolean counterpart of segmentBox for gun readiness. No contact point,
 * normal or temporary vectors are needed, and tangencies remain obstructions. */
export function segmentIntersectsBox(from: Vec3, to: Vec3, box: Pick<Volume, 'center' | 'size'>): boolean {
  let enter = 0, exit = 1;
  for (let axis = 0; axis < 3; axis++) {
    const delta = to[axis] - from[axis], half = box.size[axis] / 2;
    const low = box.center[axis] - half, high = box.center[axis] + half;
    if (Math.abs(delta) < 1e-10) { if (from[axis] < low || from[axis] > high) return false; continue; }
    const a = (low - from[axis]) / delta, b = (high - from[axis]) / delta;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return true;
}
