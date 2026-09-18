import type { ConstructionPrimitive, ConstructionSource, ConstructionSurface, Vec3 } from '../../ships/blueprint';
import { balconyPlan, defaultBalcony } from '../../ships/constructionBalcony';
import { rotateVertex } from '../../ships/constructionVertex';
import { add, sub, dot, cross } from '../../ships/freeformShape';
import { pendingHullSurfaces } from './pendingHull';
import type { BuilderPlacement } from './builderScene';

const SEAT_M = .01;

/** The deck edge facing the actual support, independent of the ship centerline. */
export function balconyInnerEdge(primitive: Pick<ConstructionPrimitive, 'size' | 'rotationDeg' | 'balcony'>, normal: Vec3) {
  const deck = balconyPlan(primitive.size, primitive.balcony ?? defaultBalcony()).deck
    .map(p => rotateVertex([p.x, 0, p.z], primitive.rotationDeg));
  const sign = deck.reduce((sum, p, i) => sum + p[0] * deck[(i + 1) % deck.length][2] - deck[(i + 1) % deck.length][0] * p[2], 0) > 0 ? 1 : -1;
  const facing = (i: number) => {
    const a = deck[i], b = deck[(i + 1) % deck.length], length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    return sign * ((b[2] - a[2]) * normal[0] - (b[0] - a[0]) * normal[2]) / length;
  };
  let edge = 0;
  for (let i = 1; i < deck.length; i++) if (facing(i) < facing(edge)) edge = i;
  return { edge, corners: [deck[edge], deck[(edge + 1) % deck.length]].flatMap(p => [-1, 1].map(sign => [p[0], sign * primitive.size[1] / 2, p[2]] as Vec3)) };
}

/** Side-wall ends sit on the authored outline, inside the deck overhang. Their
 * upper corners must reach a leaning support too, not stop short above the deck. */
export function balconyAttachmentPoints(primitive: Pick<ConstructionPrimitive, 'size' | 'rotationDeg' | 'balcony'>, normal: Vec3): Vec3[] {
  const balcony = primitive.balcony ?? defaultBalcony(), { edge, corners } = balconyInnerEdge(primitive, normal);
  const plan = balconyPlan(primitive.size, balcony), count = balcony.points.length;
  const points = [...corners], top = primitive.size[1] / 2;
  for (const [neighbor, ends] of [[(edge + count - 1) % count, [1, 2]], [(edge + 1) % count, [0, 3]]] as const) {
    if (balcony.points[neighbor].edge === 'open') continue;
    for (const end of ends) for (const y of [top, top + balcony.heightM]) {
      const p = plan.walls[neighbor][end];
      points.push(rotateVertex([p.x, y, p.z], primitive.rotationDeg));
    }
  }
  return points;
}

/** Keep every corner of the mounting edge just inside the support plane. */
export function seatBalconyCenter(primitive: Pick<ConstructionPrimitive, 'size' | 'rotationDeg' | 'balcony'>, position: Vec3, point: Vec3, normal: Vec3): Vec3 {
  const axis = Math.abs(normal[0]) >= Math.abs(normal[2]) ? 0 : 2;
  if (Math.abs(normal[axis]) < .1) return position;
  const corners = balconyAttachmentPoints(primitive, normal);
  const gap = Math.max(...corners.map(corner => dot(sub(add(position, corner), point), normal)));
  const next = [...position] as Vec3;
  next[axis] -= (gap + SEAT_M) / normal[axis];
  return next;
}

/** New side balconies put their long local Z edge against the clicked surface. */
export function balconyPlacement(piece: Extract<BuilderPlacement, { kind: 'hull' }>, normal: Vec3): Extract<BuilderPlacement, { kind: 'hull' }> {
  if (piece.shape !== 'balcony' || Math.abs(normal[1]) >= .9) return piece;
  const rotationDeg = Math.abs(normal[0]) >= Math.abs(normal[2]) ? 0 : 90;
  const balcony = defaultBalcony();
  const { edge } = balconyInnerEdge({ ...piece, rotationDeg, balcony }, normal);
  balcony.points.forEach((point, i) => { point.edge = i === edge ? 'open' : 'wall'; });
  return { ...piece, rotationDeg, balcony };
}

function insideFace(point: Vec3, surface: ConstructionSurface) {
  return surface.vertices.every((a, i) => dot(cross(sub(surface.vertices[(i + 1) % surface.vertices.length], a), sub(point, a)), surface.normal) >= -1e-6);
}

/** Seat across adjacent hull panels too, so curvature does not leave the ends
 * of a wide balcony hanging away from the surface selected at its midpoint. */
export function seatBalconyOnHull(primitive: Pick<ConstructionPrimitive, 'size' | 'rotationDeg' | 'balcony'>, position: Vec3, support: ConstructionSurface, surfaces: readonly ConstructionSurface[]): Vec3 {
  const normal = support.normal, axis = Math.abs(normal[0]) >= Math.abs(normal[2]) ? 0 : 2, sign = Math.sign(normal[axis]);
  const panels = surfaces.filter(s => s.primitiveId === support.primitiveId && !s.open && s.normal[axis] * sign > .1);
  const { corners } = balconyInnerEdge(primitive, normal);
  let shift = -Infinity;
  const samples = balconyAttachmentPoints(primitive, normal);
  for (let i = 0; i <= 16; i++) for (let level = 0; level < 2; level++) samples.push(corners[level].map((v, k) => v + (corners[level + 2][k] - v) * i / 16) as Vec3);
  for (const local of samples) {
    const sample = add(position, local);
    let contact: number | undefined;
    for (const panel of panels) {
      const projected = [...sample] as Vec3;
      projected[axis] -= dot(sub(sample, panel.vertices[0]), panel.normal) / panel.normal[axis];
      if (insideFace(projected, panel)) contact = Math.max(contact ?? -Infinity, projected[axis] * sign);
    }
    if (contact !== undefined) shift = Math.max(shift, sample[axis] * sign - contact + SEAT_M);
  }
  if (!Number.isFinite(shift)) return seatBalconyCenter(primitive, position, support.vertices[0], normal);
  const next = [...position] as Vec3; next[axis] -= sign * shift;
  return next;
}

/** Find support using the pre-edit footprint, then reseat the edited deck in the
 * same source transaction. Source surfaces also recover already detached drafts. */
export function reseatBalcony(source: ConstructionSource, before: ConstructionPrimitive, after: ConstructionPrimitive): ConstructionPrimitive {
  if (before.kind !== 'balcony' || after.kind !== 'balcony') return after;
  const surfaces = pendingHullSurfaces(source, { ...source, id: '' }, []);
  let best: { surface: ConstructionSurface; distance: number } | undefined;
  for (const surface of surfaces) {
    if (surface.primitiveId === before.id || surface.open || Math.abs(surface.normal[1]) >= .9) continue;
    const axis = Math.abs(surface.normal[0]) >= Math.abs(surface.normal[2]) ? 0 : 2;
    const { corners } = balconyInnerEdge(before, surface.normal);
    const center = corners.reduce<Vec3>((sum, p) => add(sum, p.map(v => v / corners.length) as Vec3), [...before.position]);
    const distance = dot(sub(center, surface.vertices[0]), surface.normal);
    if (distance < -Math.max(.1, Math.min(before.size[0], before.size[2])) || distance > Math.max(.5, Math.min(before.size[0], before.size[2]))) continue;
    const projected = [...center] as Vec3; projected[axis] -= distance / surface.normal[axis];
    if (!insideFace(projected, surface) || best && Math.abs(distance) >= best.distance) continue;
    best = { surface, distance: Math.abs(distance) };
  }
  if (!best) return after;
  return { ...after, position: seatBalconyOnHull(after, after.position, best.surface, surfaces) };
}
