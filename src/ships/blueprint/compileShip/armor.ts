/** Authored armor plus the plates compiled from fitted gunhouse meshes. */
import type { GunPart, Vec3 } from '../blueprintTypes';
import { fail, record, text, numeric, list, literal, id, sourceReference, vector, volumes, type Rec } from '../validators';

export function compileArmor(b: Rec, parts: Rec[], mounts: Rec[]): unknown[] {
  const compiledArmor = [
    ...list(b.armor, 'armor', 1024),
    ...mounts.flatMap((m) => {
      const part = parts.find((p) => p.id === m.partId) as unknown as GunPart;
      if (!part.gunhouseMesh) return [];
      return part.gunhouseMesh.faces.map((face) => {
        const vertices = face.indices.map((i) => {
          const [x, y, z] = part.gunhouseMesh!.vertices[i];
          return [-y, z, -x] as Vec3;
        });
        const low = [0, 1, 2].map((i) => Math.min(...vertices.map((v) => v[i]))),
          high = [0, 1, 2].map((i) => Math.max(...vertices.map((v) => v[i])));
        return {
          id: `${m.id}-turret-${face.id}`,
          name: `${m.name} · ${face.id.replace(/-/g, ' ')}`,
          center: low.map((v, i) => (v + high[i]) / 2),
          size: low.map((v, i) => Math.max(0.001, high[i] - v)),
          thicknessMm: face.thicknessMm,
          plate: { vertices, material: face.material, mountId: m.id },
          ...(part.gunhouseMesh!.provenance ? { provenance: part.gunhouseMesh!.provenance } : {}),
        };
      });
    }),
  ];
  volumes(compiledArmor, 'armor', 2048).forEach((a) => {
    text(a.name, `${a.id}.name`);
    numeric(a.thicknessMm, `${a.id}.thicknessMm`, 0.001, 2000);
    if (a.exterior !== undefined) literal(a.exterior, [true, false], `${a.id}.exterior`);
    if (a.provenance !== undefined) {
      const p = record(a.provenance, `${a.id}.provenance`);
      sourceReference(p.sourceId, `${a.id}.provenance.sourceId`);
      text(p.note, 'provenance.note');
      literal(p.basis, ['documented', 'plan-measured', 'estimated', 'inferred'], 'provenance.basis');
    }
    if (a.plate !== undefined) {
      const p = record(a.plate, `${a.id}.plate`);
      literal(p.material, ['KC', 'Wh', 'Ww', 'steel', 'teak'], 'plate.material');
      if (p.exterior !== undefined) literal(p.exterior, [true, false], 'plate.exterior');
      if (p.surfaceId !== undefined) id(p.surfaceId, 'plate.surfaceId');
      if (p.mountId !== undefined && !mounts.some((m) => m.id === p.mountId)) fail(String(a.id), 'unknown plate mount');
      const points = list(p.vertices, 'plate.vertices', 16).map((v) => vector(v, 'plate vertex'));
      if (points.length < 3) fail(String(a.id), 'plate needs at least three vertices');
      const delta = (u: Vec3, v: Vec3) => u.map((n, i) => n - v[i]) as Vec3;
      const cross = (u: Vec3, v: Vec3) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] as Vec3;
      const dot = (u: Vec3, v: Vec3) => u.reduce((n, x, i) => n + x * v[i], 0);
      const raw = cross(delta(points[1], points[0]), delta(points[2], points[0]));
      const area = Math.hypot(...raw);
      if (area < 1e-8) fail(String(a.id), 'degenerate plate');
      const normal = raw.map((n) => n / area) as Vec3;
      points.forEach((v, i) => {
        if (Math.abs(dot(delta(v, points[0]), normal)) > 1e-5) fail(String(a.id), 'nonplanar plate');
        if (
          dot(
            cross(delta(points[(i + 1) % points.length], v), delta(points[(i + 2) % points.length], points[(i + 1) % points.length])),
            normal,
          ) <= 1e-8
        )
          fail(String(a.id), 'plate must be strictly convex and consistently wound');
        if (v.some((n, axis) => Math.abs(n - (a.center as number[])[axis]) > (a.size as number[])[axis] / 2 + 1e-5))
          fail(String(a.id), 'plate lies outside inspection bounds');
      });
    }
  });
  return compiledArmor;
}
