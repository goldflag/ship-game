import type { ConstructionEquipment, ConstructionEquipmentPart, ConstructionSurface, Vec3 } from './blueprint';

/** Compatibility for the original door in retained catalogs predating wallMount. */
export function wallMount(part: ConstructionEquipmentPart): ConstructionEquipmentPart['wallMount'] {
  return part.wallMount ?? (part.id === 'generic-watertight-door' ? 'door' : undefined);
}

export function wallScale(part: ConstructionEquipmentPart, item: Pick<ConstructionEquipment, 'wall'>): Vec3 {
  if (!item.wall || !wallMount(part)) return [1, 1, 1];
  const x = item.wall.widthM / part.size[0];
  return part.wallSizing === 'uniform' ? [x, x, x] : [x, item.wall.heightM / part.size[1], 1];
}

/** Installation dimensions for picking, snapping and display. Rust owns physical validation. */
export function installedWallPart(part: ConstructionEquipmentPart, item: Pick<ConstructionEquipment, 'wall'>): ConstructionEquipmentPart {
  if (!item.wall) return part;
  const scale = wallScale(part, item), scaled = (v: Vec3) => v.map((n, k) => n * scale[k]) as Vec3;
  return { ...part, size: scaled(part.size), boundsCenter: scaled(part.boundsCenter), centerOfGravity: scaled(part.centerOfGravity),
    sockets: part.sockets?.map(s => ({ ...s, position: scaled(s.position) })),
    fitting: part.fitting?.map(b => ({ center: scaled(b.center), size: scaled(b.size) })), massKg: (part.massKg ?? 0) * scale[0] * scale[1] * scale[2] };
}

export const wallBearing = (normal: Vec3) => ((Math.atan2(normal[0], -normal[2]) * 180 / Math.PI) + 360) % 360;
export const wallNormal = (bearing: number): Vec3 => [Math.sin(bearing * Math.PI / 180), 0, -Math.cos(bearing * Math.PI / 180)];
const dot = (a: Vec3, b: Vec3) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a: Vec3, b: Vec3) => a.map((v, i) => v - b[i]) as Vec3;
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

/** Side-facing supports include sloped and faceted hulls, but never decks. */
export const wallSurface = (surface: ConstructionSurface, normal: Vec3) => !surface.open && Math.abs(surface.normal[1]) < .9 && dot(surface.normal, normal) > .35;
export const wallProjectionDepth = (width: number, height: number) => Math.max(.15, Math.max(width, height) * .75);

/** Project along the fitting's outward direction to the nearest closed hull panel. */
export function projectWallPoint(point: Vec3, normal: Vec3, surfaces: readonly ConstructionSurface[], depth: number): Vec3 | undefined {
  let best: Vec3 | undefined, nearest = depth + 1e-6;
  for (const s of surfaces) {
    if (!wallSurface(s, normal)) continue;
    const distance = dot(sub(s.vertices[0], point), s.normal) / dot(normal, s.normal);
    if (Math.abs(distance) > nearest) continue;
    const projected = point.map((v,k) => v + normal[k] * distance) as Vec3;
    if (!s.vertices.every((a,i) => dot(cross(sub(s.vertices[(i+1)%s.vertices.length],a),sub(projected,a)),s.normal) >= -1e-6)) continue;
    best = projected; nearest = Math.abs(distance);
  }
  return best;
}
export const wallPointSupported = (point: Vec3, normal: Vec3, surfaces: readonly ConstructionSurface[]) => !!projectWallPoint(point, normal, surfaces, .005);

/** Slide a fitting back onto its hull after a tangent drag or a row step. */
export function seatWallFitting(item: ConstructionEquipment, part: ConstructionEquipmentPart, surfaces: readonly ConstructionSurface[]): ConstructionEquipment {
  const p=installedWallPart(part,item), r=-item.bearingDeg*Math.PI/180, socket=p.sockets?.find(s=>s.id==='attachment')?.position ?? [0,0,0];
  const offset:Vec3=[socket[0]*Math.cos(r)+socket[2]*Math.sin(r),socket[1],-socket[0]*Math.sin(r)+socket[2]*Math.cos(r)];
  const hit=projectWallPoint(item.position.map((v,k)=>v+offset[k]) as Vec3,wallNormal(item.bearingDeg),surfaces,wallProjectionDepth(p.size[0],p.size[1]));
  return hit ? {...item,position:hit.map((v,k)=>v-offset[k]) as Vec3} : item;
}

/** The datum must touch the hull; the footprint may follow adjacent sloping panels. */
export function wallFittingSupported(item: ConstructionEquipment, part: ConstructionEquipmentPart, surfaces: readonly ConstructionSurface[]): boolean {
  const p = installedWallPart(part, item), n = wallNormal(item.bearingDeg), r = -item.bearingDeg * Math.PI / 180;
  const socket = p.sockets?.find(s => s.id === 'attachment')?.position ?? [0,0,0];
  const attachment = [item.position[0]+socket[0]*Math.cos(r)+socket[2]*Math.sin(r),item.position[1]+socket[1],item.position[2]-socket[0]*Math.sin(r)+socket[2]*Math.cos(r)] as Vec3;
  if (!wallPointSupported(attachment,n,surfaces)) return false;
  for (const u of [-.5, 0, .5]) for (const v of [-.5, 0, .5]) {
    const x = p.boundsCenter[0] + p.size[0] * u, y = p.boundsCenter[1] + p.size[1] * v, z = socket[2];
    const point: Vec3 = [item.position[0] + x*Math.cos(r)+z*Math.sin(r), item.position[1]+y, item.position[2]-x*Math.sin(r)+z*Math.cos(r)];
    const projected = projectWallPoint(point, n, surfaces, wallProjectionDepth(p.size[0],p.size[1]));
    if (!projected) return false;
    if (item.wall?.mirrorId) {
      const reflected: Vec3 = [-projected[0],projected[1],projected[2]];
      if (!wallPointSupported(reflected,[-n[0],n[1],n[2]],surfaces)) return false;
    }
  }
  return true;
}

/** A horizontal row in the supporting wall's own plane, anchored at its first fitting. */
export function wallRow(start: Vec3, end: Vec3, bearing: number, spacing: number, limit = 64): Vec3[] {
  const r = bearing * Math.PI / 180, tangent: Vec3 = [Math.cos(r), 0, Math.sin(r)];
  const distance = dot(sub(end, start), tangent), count = Math.min(limit, 1 + Math.floor(Math.abs(distance) / spacing + 1e-6));
  return Array.from({ length: count }, (_, i) => start.map((v, k) => v + tangent[k] * Math.sign(distance) * i * spacing) as Vec3);
}
