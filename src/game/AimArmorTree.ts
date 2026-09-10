import type { Armor, ShipDefinition, Vec3, Volume } from '../ships/blueprint';
import { segmentIntersectsBox } from '../simulation/obstruction';

type Bounds = Pick<Volume, 'center' | 'size'>;
type Entry = { armor: Armor; index: number; bounds: Bounds };
type Branch = { bounds: Bounds; children?: Branch[]; entries?: Entry[] };
const trees = new WeakMap<ShipDefinition, Branch>();

/** Broad phase only: exact CPU plate/box intersections still choose the aim.
 * Turret bounds enclose their full rotation, so live train changes cannot make
 * this immutable definition index stale. */
export function aimArmorCandidates(definition: ShipDefinition, from: Vec3, to: Vec3): Armor[] {
  if (!definition.armor.length) return [];
  let tree = trees.get(definition);
  if (!tree) {
    const entries = definition.armor.map((armor, index): Entry => {
      const mount = armor.plate?.mountId && definition.mounts.find(m => m.id === armor.plate!.mountId);
      let center = armor.center, size = armor.size;
      if (mount) {
        const diameter = 2 * Math.hypot(Math.abs(center[0]) + size[0] / 2, Math.abs(center[2]) + size[2] / 2);
        center = [mount.position[0], mount.position[1] + center[1], mount.position[2]];
        size = [diameter, size[1], diameter];
      }
      return { armor, index, bounds: { center, size: size.map(n => n + .02) as Vec3 } };
    });
    const build = (entries: Entry[]): Branch => {
      const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
      for (const { bounds } of entries) for (let axis = 0; axis < 3; axis++) {
        low[axis] = Math.min(low[axis], bounds.center[axis] - bounds.size[axis] / 2);
        high[axis] = Math.max(high[axis], bounds.center[axis] + bounds.size[axis] / 2);
      }
      const bounds = { center: low.map((v, i) => (v + high[i]) / 2) as Vec3, size: low.map((v, i) => high[i] - v) as Vec3 };
      if (entries.length <= 8) return { bounds, entries };
      const axis = bounds.size.indexOf(Math.max(...bounds.size)), middle = Math.floor(entries.length / 2);
      entries.sort((a, b) => a.bounds.center[axis] - b.bounds.center[axis]);
      return { bounds, children: [build(entries.slice(0, middle)), build(entries.slice(middle))] };
    };
    trees.set(definition, tree = build(entries));
  }
  const found: Entry[] = [];
  const visit = (branch: Branch): void => {
    if (!segmentIntersectsBox(from, to, branch.bounds)) return;
    if (branch.entries) {
      for (const entry of branch.entries) if (segmentIntersectsBox(from, to, entry.bounds)) found.push(entry);
    } else for (const child of branch.children!) visit(child);
  };
  visit(tree);
  // Preserve the existing first-in-definition tie breaker for coincident plates.
  return found.sort((a, b) => a.index - b.index).map(entry => entry.armor);
}
