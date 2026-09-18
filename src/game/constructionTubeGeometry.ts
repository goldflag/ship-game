import * as THREE from 'three';
import type { Vec3 } from '../ships/blueprint';

/** Six-sided welded tubing. Adjacent spans share one miter ring, so corners
 * have neither open wedges nor overlapping end caps. Dimensions stay in metres. */
export function constructionTubeGeometry(paths: readonly (readonly Vec3[])[], radius: number, projectEnd?: (point: Vec3) => Vec3 | undefined): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [], sides = 6;
  for (const points of paths) {
    if (points.length < 2) continue;
    const directions = points.slice(1).map((p, i) => new THREE.Vector3(...p).sub(new THREE.Vector3(...points[i])).normalize());
    const first = directions[0], reference = Math.abs(first.y) < .95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(first, reference).normalize(), base = positions.length / 3;
    points.forEach((point, i) => {
      const incoming = directions[Math.max(0, i - 1)], outgoing = directions[Math.min(i, directions.length - 1)];
      const bisector = incoming.clone().add(outgoing).normalize();
      const up = new THREE.Vector3().crossVectors(incoming, right).normalize();
      for (let side = 0; side < sides; side++) {
        const angle = side * Math.PI * 2 / sides;
        const offset = right.clone().multiplyScalar(Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius);
        const denominator = incoming.dot(bisector);
        if (denominator > 1e-5) offset.addScaledVector(incoming, THREE.MathUtils.clamp(-offset.dot(bisector) / denominator, -4 * radius, 4 * radius));
        const vertex: Vec3 = [point[0] + offset.x, point[1] + offset.y, point[2] + offset.z];
        positions.push(...((i === 0 || i === points.length - 1) && projectEnd ? projectEnd(vertex) ?? vertex : vertex));
      }
      if (i) for (let side = 0; side < sides; side++) {
        const a = base + (i - 1) * sides + side, b = base + (i - 1) * sides + (side + 1) % sides;
        const c = base + i * sides + side, d = base + i * sides + (side + 1) % sides;
        indices.push(a, b, c, b, d, c);
      }
      if (i < directions.length) right.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(incoming, outgoing));
    });
    const end = base + (points.length - 1) * sides;
    for (let i = 1; i < sides - 1; i++) indices.push(base, base + i + 1, base + i, end, end + i, end + i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
