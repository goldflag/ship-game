/** Mount clearance profile: closed bodies or installation envelopes. */
import type { AuthoredStructure } from '../blueprintTypes';
import { fail, record, text, numeric, list, literal, id, vector, unique, validateTriangle, type Rec } from '../validators';

export function validateMountClearanceBodies(b: Rec, mounts: Rec[]): void {
  if (b.mountClearance !== undefined) {
    const profile = record(b.mountClearance, 'mountClearance');
    literal(profile.version, [1], 'mountClearance.version');
    text(profile.basis, 'mountClearance.basis');
    const bodies = profile.mountIds !== undefined || profile.bodies !== undefined;
    const envelopes = profile.mounts !== undefined || profile.structures !== undefined || profile.neighbors !== undefined;
    if (bodies === envelopes) fail('mountClearance', 'expected exactly one geometry encoding: closed bodies or installation envelopes');
    numeric(profile.marginM, 'mountClearance.marginM', bodies ? 0 : 0.001, bodies ? 0.2 : 0.5);
    if (bodies) list(profile.mountIds, 'mountClearance.mountIds', 64);
    else list(profile.mounts, 'mountClearance.mounts', 128);
  }
  if (b.mountClearance !== undefined && record(b.mountClearance, 'mountClearance').mountIds !== undefined) {
    const profile = record(b.mountClearance, 'mountClearance');
    const participants = list(profile.mountIds, 'mountClearance.mountIds', 64);
    if (!participants.length || new Set(participants).size !== participants.length)
      fail('mountClearance.mountIds', 'requires distinct mount IDs');
    participants.forEach((value) => {
      id(value, 'mountClearance.mountIds');
      if (!mounts.some((m) => m.id === value)) fail('mountClearance.mountIds', `unknown mount ${value}`);
    });
    const bodies = list(profile.bodies, 'mountClearance.bodies', 4096).map((value, i) => record(value, `mountClearance.bodies[${i}]`));
    unique(bodies, 'mountClearance.bodies');
    bodies.forEach((body) => {
      const path = `mountClearance.${body.id}`;
      if (body.mountId !== undefined && !mounts.some((m) => m.id === body.mountId)) fail(path, 'unknown parent mount');
      const surface = record(body.surface, `${path}.surface`);
      const vertices = list(surface.vertices, `${path}.vertices`, 2048).map((v) => vector(v, `${path}.vertex`));
      const faces = list(surface.triangles, `${path}.triangles`, 4096);
      if (vertices.length < 4 || faces.length < 4) fail(path, 'requires a closed physical body');
      const edges = new Map<string, { count: number; winding: number }>();
      faces.forEach((face) => {
        validateTriangle(face, vertices, `${path}.triangle`);
        const indices = face as number[];
        indices.forEach((a, i) => {
          const c = indices[(i + 1) % 3],
            key = a < c ? `${a}:${c}` : `${c}:${a}`;
          const edge = edges.get(key) ?? { count: 0, winding: 0 };
          edge.count++;
          edge.winding += a < c ? 1 : -1;
          edges.set(key, edge);
        });
      });
      if ([...edges.values()].some((e) => e.count !== 2 || e.winding !== 0)) fail(path, 'body must be closed and consistently wound');
    });
  }
}

export function validateMountClearanceEnvelopes(b: Rec, mounts: Rec[]): void {
  if (b.mountClearance !== undefined && record(b.mountClearance, 'mountClearance').mounts !== undefined) {
    const c = record(b.mountClearance, 'mountClearance');
    const entries = list(c.mounts, 'mountClearance.mounts', 128).map((v) => record(v, 'clearance mount'));
    if (!entries.length) fail('mountClearance.mounts', 'requires participating mounts');
    const selected = new Set<string>();
    for (const e of entries) {
      const m = mounts.find((m) => m.id === e.mountId);
      if (!m || m.parentMountId !== undefined || selected.has(String(e.mountId)))
        fail('mountClearance.mounts', 'expected unique hull-mounted gun IDs');
      selected.add(String(e.mountId));
      numeric(e.barrelRadiusM, 'clearance barrel radius', 0.01, 2);
      if (e.fittings !== undefined)
        for (const value of list(e.fittings, 'clearance fittings', 64)) {
          const fitting = record(value, 'clearance fitting');
          literal(fitting.joint, ['yaw', 'elevation'], 'clearance fitting joint');
          vector(fitting.a, 'clearance fitting endpoint');
          vector(fitting.b, 'clearance fitting endpoint');
          numeric(fitting.radiusM, 'clearance fitting radius', 0.001, 2);
        }
      if (e.body !== undefined) {
        const body = record(e.body, 'clearance body');
        vector(body.center, 'clearance body center');
        vector(body.size, 'clearance body size').forEach((n) => numeric(n, 'clearance body dimension', 0.01, 30));
      }
    }
    const structures = b.structures as AuthoredStructure[] | undefined;
    const seen = new Set<string>();
    for (const v of list(c.structures, 'mountClearance.structures', 128)) {
      const e = record(v, 'clearance structure');
      if (!structures?.some((s) => s.id === e.structureId) || seen.has(String(e.structureId)))
        fail('mountClearance.structures', 'expected unique authored structure IDs');
      seen.add(String(e.structureId));
      numeric(e.topExtensionM, 'clearance structure extension', 0, 5);
    }
    const pairs = new Set<string>();
    for (const v of list(c.neighbors, 'mountClearance.neighbors', 128)) {
      const pair = list(v, 'clearance neighbor pair', 2).map(String),
        key = [...pair].sort().join(':');
      if (pair.length !== 2 || pair[0] === pair[1] || pair.some((id) => !selected.has(id)) || pairs.has(key))
        fail('mountClearance.neighbors', 'expected distinct selected mount pairs');
      pairs.add(key);
    }
  }
}
