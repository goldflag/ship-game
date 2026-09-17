import type { ConstructionEquipment, ConstructionEquipmentPart, ConstructionSurface, Vec3 } from './blueprint';

/** Compatibility for the original door in retained catalogs predating wallMount. */
export function wallMount(part: ConstructionEquipmentPart): ConstructionEquipmentPart['wallMount'] {
  return part.wallMount ?? (part.id === 'generic-watertight-door' ? 'door' : undefined);
}

export function wallScale(part: ConstructionEquipmentPart, item: Pick<ConstructionEquipment, 'wall'>): Vec3 {
  return item.wall && wallMount(part) ? [item.wall.widthM / part.size[0], item.wall.heightM / part.size[1], 1] : [1, 1, 1];
}

/** Installation dimensions for picking, snapping and display. Rust owns physical validation. */
export function installedWallPart(part: ConstructionEquipmentPart, item: Pick<ConstructionEquipment, 'wall'>): ConstructionEquipmentPart {
  if (!item.wall) return part;
  const scale = wallScale(part, item), scaled = (v: Vec3) => v.map((n, k) => n * scale[k]) as Vec3;
  return { ...part, size: scaled(part.size), boundsCenter: scaled(part.boundsCenter), centerOfGravity: scaled(part.centerOfGravity),
    sockets: part.sockets?.map(s => ({ ...s, position: scaled(s.position) })),
    fitting: part.fitting?.map(b => ({ center: scaled(b.center), size: scaled(b.size) })), massKg: (part.massKg ?? 0) * scale[0] * scale[1] };
}

export const wallBearing = (normal: Vec3) => ((Math.atan2(normal[0], -normal[2]) * 180 / Math.PI) + 360) % 360;
export const wallNormal = (bearing: number): Vec3 => [Math.sin(bearing * Math.PI / 180), 0, -Math.cos(bearing * Math.PI / 180)];
const dot = (a: Vec3, b: Vec3) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a: Vec3, b: Vec3) => a.map((v, i) => v - b[i]) as Vec3;
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

/** Exact planar polygon coverage, including adjacent coplanar panels. */
export function wallPointSupported(point: Vec3, normal: Vec3, surfaces: readonly ConstructionSurface[]): boolean {
  return surfaces.some(s => !s.open && dot(s.normal, normal) > 1 - 1e-5
    && Math.abs(dot(sub(point, s.vertices[0]), s.normal)) <= .005
    && s.vertices.every((a, i) => dot(cross(sub(s.vertices[(i+1)%s.vertices.length], a), sub(point, a)), s.normal) >= -1e-6));
}

/** Sample the full mounting footprint, not just its center, before offering a mirrored placement. */
export function wallFittingSupported(item: ConstructionEquipment, part: ConstructionEquipmentPart, surfaces: readonly ConstructionSurface[]): boolean {
  const p = installedWallPart(part, item), n = wallNormal(item.bearingDeg), r = -item.bearingDeg * Math.PI / 180;
  const socket = p.sockets?.find(s => s.id === 'attachment')?.position ?? [0,0,0];
  for (const u of [-.5, 0, .5]) for (const v of [-.5, 0, .5]) {
    const x = p.boundsCenter[0] + p.size[0] * u, y = p.boundsCenter[1] + p.size[1] * v, z = socket[2];
    const point: Vec3 = [item.position[0] + x*Math.cos(r)+z*Math.sin(r), item.position[1]+y, item.position[2]-x*Math.sin(r)+z*Math.cos(r)];
    if (!wallPointSupported(point, n, surfaces)) return false;
  }
  return true;
}

/** A horizontal row in the supporting wall's own plane, anchored at its first fitting. */
export function wallRow(start: Vec3, end: Vec3, bearing: number, spacing: number, limit = 64): Vec3[] {
  const r = bearing * Math.PI / 180, tangent: Vec3 = [Math.cos(r), 0, Math.sin(r)];
  const distance = dot(sub(end, start), tangent), count = Math.min(limit, 1 + Math.floor(Math.abs(distance) / spacing + 1e-6));
  return Array.from({ length: count }, (_, i) => start.map((v, k) => v + tangent[k] * Math.sign(distance) * i * spacing) as Vec3);
}
