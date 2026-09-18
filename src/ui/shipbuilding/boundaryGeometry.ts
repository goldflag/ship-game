import * as THREE from 'three';
import type { ConstructionPrimitive } from '../../ships/blueprint';
import { primitiveGeometry } from './primitiveGeometry';

const EPS = 1e-6;
// Source primitives are immutable across editor revisions. Retain CPU attributes
// weakly so hovering and multiple walls do not rebuild the same hull meshes.
const envelopes = new WeakMap<ConstructionPrimitive, { vertices: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; bounds: THREE.Box3 }>();
const key = (p: THREE.Vector3) => p.toArray().map(v => Math.round(v / EPS)).join(',');

/** Cut the source envelopes, including invalid/uncompiled drafts. These are display
 * planes only; Rust clips their physical thickness to the union hull interior. */
export function boundaryGeometry(primitives: ConstructionPrimitive[], axis: 'x' | 'y' | 'z', offset: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const project = (p: THREE.Vector3) => axis === 'x' ? new THREE.Vector2(p.y, p.z) : axis === 'y' ? new THREE.Vector2(p.x, p.z) : new THREE.Vector2(p.x, p.y);
  for (const primitive of Number.isFinite(offset) ? primitives : []) {
    let envelope = envelopes.get(primitive);
    if (!envelope) {
      const solid = primitiveGeometry(primitive.kind, primitive.size, primitive.vertices, primitive.customHull, primitive.shaping, primitive.balcony, primitive.mesh);
      solid.rotateY(primitive.rotationDeg * Math.PI / 180).translate(...primitive.position);
      solid.computeBoundingBox();
      envelope = { vertices: solid.getAttribute('position'), bounds: solid.boundingBox! };
      envelopes.set(primitive, envelope); solid.dispose();
    }
    if (offset < envelope.bounds.min[axis] - EPS || offset > envelope.bounds.max[axis] + EPS) continue;
    const { vertices } = envelope;
    const points = new Map<string, THREE.Vector3>(), neighbors = new Map<string, Set<string>>();
    const connect = (a: THREE.Vector3, b: THREE.Vector3) => {
      const ka = key(a), kb = key(b);
      if (ka === kb) return;
      points.set(ka, a); points.set(kb, b);
      if (!neighbors.has(ka)) neighbors.set(ka, new Set());
      if (!neighbors.has(kb)) neighbors.set(kb, new Set());
      neighbors.get(ka)!.add(kb); neighbors.get(kb)!.add(ka);
    };
    for (let i = 0; i < vertices.count; i += 3) {
      const triangle = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(vertices, i + k));
      if (triangle.every(p => Math.abs(p[axis] - offset) < EPS)) continue;
      const hits = new Map<string, THREE.Vector3>();
      for (let e = 0; e < 3; e++) {
        const a = triangle[e], b = triangle[(e + 1) % 3], da = a[axis] - offset, db = b[axis] - offset;
        if (Math.abs(da) < EPS) { const p = a.clone(); p[axis] = offset; hits.set(key(p), p); }
        if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
          const p = a.clone().lerp(b, da / (da - db)); p[axis] = offset; hits.set(key(p), p);
        }
      }
      if (hits.size === 2) { const [a, b] = [...hits.values()]; connect(a, b); }
    }
    const loops: THREE.Vector3[][] = [];
    for (const [start, edges] of neighbors) while (edges.size) {
      const loop: THREE.Vector3[] = []; let at = start, closed = false;
      for (let step = 0; step <= points.size; step++) {
        loop.push(points.get(at)!);
        const next = neighbors.get(at)?.values().next().value as string | undefined;
        if (!next) break;
        neighbors.get(at)!.delete(next); neighbors.get(next)!.delete(at);
        at = next;
        if (at === start) { closed = true; break; }
      }
      if (closed && loop.length >= 3) loops.push(loop);
    }
    const contours = loops.map(loop => loop.map(project));
    const areas = contours.map(loop => Math.abs(THREE.ShapeUtils.area(loop)));
    const contains = (loop: THREE.Vector2[], p: THREE.Vector2) => {
      let inside = false;
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i], b = loop[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    const parents = contours.map((loop, i) => contours.reduce((parent, outer, j) =>
      areas[j] > areas[i] && (parent < 0 || areas[j] < areas[parent]) && contains(outer, loop[0]) ? j : parent, -1));
    const depth = (i: number): number => parents[i] < 0 ? 0 : depth(parents[i]) + 1;
    for (let i = 0; i < loops.length; i++) {
      if (depth(i) % 2 || areas[i] < EPS) continue;
      const holes = loops.map((_, j) => j).filter(j => parents[j] === i);
      const flat = [...loops[i], ...holes.flatMap(j => loops[j])];
      for (const triangle of THREE.ShapeUtils.triangulateShape(contours[i], holes.map(j => contours[j]))) {
        for (const index of triangle) positions.push(...flat[index].toArray());
      }
    }
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
