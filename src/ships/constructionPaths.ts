import type { ConstructionEquipment, ConstructionEquipmentPart, Vec3 } from './blueprint';
import { ladderRungs } from '../../assets/parts/construction/ladder_geometry';
import { pathDistance, samplePath } from '../../assets/parts/construction/path_geometry';

export const DEFAULT_PATH: { points: Vec3[]; slackM?: number } = { points: [[0, 0, 0], [0, 0, -4]] };
export const pathOf = (item: Pick<ConstructionEquipment, 'path'>) => item.path ?? DEFAULT_PATH;
export const railingSettings = (part: ConstructionEquipmentPart, path?: ConstructionEquipment['path']) => ({ heightM: path?.heightM ?? part.path?.heightM ?? 1.1, railCount: path?.railCount ?? 3 });
export function pathWorldPoint(item: Pick<ConstructionEquipment, 'position' | 'bearingDeg'>, p: Vec3): Vec3 {
  const a = -item.bearingDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [item.position[0] + c * p[0] + s * p[2], item.position[1] + p[1], item.position[2] - s * p[0] + c * p[2]];
}
export function pathSlackLimit(points: readonly Vec3[]): number {
  return points.length < 2 ? 20 : Math.min(20, ...points.slice(1).map((p, i) => pathDistance(points[i], p) / 2));
}
export function pathProblem(points: readonly Vec3[], slackM = 0): string | undefined {
  if (points.length < 2) return 'Add a second point to finish the path.';
  if (points.length > 64) return 'A path supports up to 64 points. Finish this path before adding another.';
  if (points.some(p => p.some(v => !Number.isFinite(v) || Math.abs(v) > 1000))) return 'Path coordinates must stay within 1,000 m.';
  const lengths = points.slice(1).map((p, i) => pathDistance(points[i], p));
  if (lengths.some(length => length < .05)) return 'Keep consecutive points at least 5 cm apart.';
  if (lengths.reduce((sum, length) => sum + length, 0) > 500) return 'A path can be at most 500 m long. Finish this path and start another.';
  if (!Number.isFinite(slackM) || slackM < 0 || slackM > pathSlackLimit(points) + 1e-8) return 'Reduce rope slack to half the shortest segment or less.';
  const sampled = samplePath(points, slackM);
  if (sampled.slice(1).reduce((sum, p, i) => sum + pathDistance(sampled[i], p), 0) > 500) return 'The sagging path exceeds 500 m. Shorten the route or reduce slack.';
}
export function equipmentPathBounds(part: ConstructionEquipmentPart, item: Pick<ConstructionEquipment, 'path'>): { center: Vec3; size: Vec3 } {
  if (!part.path) return { center: part.boundsCenter, size: part.size };
  const path = pathOf(item), profile = part.path;
  const ladder = profile.kind === 'ladder' ? ladderRungs(path.points, {widthM:profile.widthM!,standOffM:profile.standOffM!,postSpacingM:profile.postSpacingM!}) : undefined;
  const points = ladder ? ladder.members.flat() : profile.kind === 'railing' ? path.points.flatMap(p => [p, [p[0], p[1] + Math.max(railingSettings(part, item.path).heightM, profile.diameterM * .75), p[2]] as Vec3]) : samplePath(path.points, path.slackM ?? 0);
  // Railing feet are 3 diameters wide, wider than both the rails and the
  // 1.25-radius stanchions. Keep the selection box around those actual feet.
  const radius = (axis: number) => profile.diameterM * (profile.kind === 'chain' ? 3 : profile.kind === 'railing' && axis !== 1 ? 1.5 : .5);
  const min = [0, 1, 2].map(k => Math.min(...points.map(p => p[k])) - radius(k)), max = [0, 1, 2].map(k => Math.max(...points.map(p => p[k])) + radius(k));
  return { center: min.map((v, k) => (v + max[k]) / 2) as Vec3, size: min.map((v, k) => max[k] - v) as Vec3 };
}
