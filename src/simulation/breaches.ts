import type { Vec3 } from '../ships/blueprint';
import type { CompartmentState } from './damage';
import { dot, normalize, sub } from './geometry';

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function axes(normal: Vec3) {
  const u = normalize(cross(Math.abs(normal[1]) < .9 ? [0, 1, 0] : [0, 0, 1], normal));
  return [u, cross(normal, u)];
}
/** Bounded deterministic aperture-union estimate: sample only the new opening,
 * then subtract portions already open on the same local face. Damage to an
 * existing hole is credited only when it widens it. */
export function addBreach(state: CompartmentState, position: Vec3, areaM2: number, shellId: number,
  apertureRadiusM = Math.sqrt(areaM2 / Math.PI), normal: Vec3 = [Math.sign(position[0]) || 1, 0, 0], incremental = false): number {
  if (!(areaM2 > 0) || !(apertureRadiusM > 0)) return 0;
  normal = normalize(normal);
  const [u, v] = axes(normal), width = areaM2 / (Math.PI * apertureRadiusM);
  const candidates = incremental ? [] : state.breaches.filter(b => {
    const footprint = b.footprintAreaM2 ?? b.areaM2;
    return Math.abs(dot(normal, b.normal ?? normal)) > .95 && Math.abs(dot(sub(position, b.position), normal)) < .05 &&
      Math.hypot(...sub(position, b.position)) < Math.max(width, apertureRadiusM) + Math.max(b.radiusM, footprint / (Math.PI * b.radiusM));
  });
  let uncovered = 128;
  if (candidates.length) {
    uncovered = 0;
    for (let ring = 0; ring < 8; ring++) for (let sector = 0; sector < 16; sector++) {
      const radius = Math.sqrt((ring + .5) / 8), angle = (sector + .5) * Math.PI / 8;
      const point = position.map((n, i) => n + u[i] * width * radius * Math.cos(angle) + v[i] * apertureRadiusM * radius * Math.sin(angle)) as Vec3;
      const covered = candidates.some(b => {
        const [bu, bv] = axes(b.normal ?? normal), delta = sub(point, b.position);
        const fraction = b.areaM2 / (b.initialAreaM2 ?? b.areaM2);
        const bw = (b.footprintAreaM2 ?? b.areaM2) / (Math.PI * b.radiusM);
        return (dot(delta, bu) / bw) ** 2 + (dot(delta, bv) / b.radiusM) ** 2 <= fraction + 1e-9;
      });
      if (!covered) uncovered++;
    }
  }
  const added = Math.max(0, Math.min(areaM2 * uncovered / 128, 4 - state.breachAreaM2));
  if (added <= 0) return 0;
  const separation = (b: typeof state.breaches[number]) => Math.hypot(...sub(b.position, position));
  const closest = state.breaches.reduce<typeof state.breaches[number] | undefined>((best, b) => !best || separation(b) < separation(best) ? b : best, undefined);
  // Incremental growth widens the opening at its own location; it must not
  // migrate a distant shell hole. At the cap preserve hydraulic area/height and
  // bounded cost, where coverage becomes a nearest-cluster approximation.
  if (closest && ((incremental && separation(closest) < .1) || state.breaches.length >= 64)) {
    const total = closest.areaM2 + added;
    closest.position = closest.position.map((n, i) => (n * closest.areaM2 + position[i] * added) / total) as Vec3;
    closest.areaM2 = total; closest.initialAreaM2 = total;
    closest.footprintAreaM2 = (closest.footprintAreaM2 ?? closest.areaM2 - added) + added;
    closest.radiusM = Math.max(closest.radiusM, apertureRadiusM);
  } else state.breaches.push({ position: [...position], areaM2: added, radiusM: apertureRadiusM, shellId,
    footprintAreaM2: areaM2, initialAreaM2: added, normal: [...normal] });
  state.breachAreaM2 += added;
  return added;
}
