import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import type { ConstructionPrimitive, Vec3 } from '../../ships/blueprint';

/** Display-only source envelopes for placement and invalid drafts. Rust remains
 * authoritative for unions, material, fit, loading and all battle geometry. */
export function primitiveGeometry(kind: ConstructionPrimitive['kind'], size: Vec3): THREE.BufferGeometry {
  const vertices: THREE.Vector3[] = [];
  for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
    if (kind === 'wedge' && y + z > 0) continue;
    if (kind === 'corner' && x + y + z > -.5) continue;
    if (kind === 'inverse-corner' && x + y + z > .5) continue;
    vertices.push(new THREE.Vector3(x, y, z));
  }
  return new ConvexGeometry(vertices).scale(...size);
}

export type BuilderPlacement =
  | { kind: 'hull'; shape: ConstructionPrimitive['kind']; size: Vec3; rotationDeg: number }
  | { kind: 'equipment'; size: Vec3; boundsCenter: Vec3; bearingDeg: number };

export function placementGeometry(piece: BuilderPlacement): THREE.BufferGeometry {
  return piece.kind === 'hull' ? primitiveGeometry(piece.shape, piece.size) : new THREE.BoxGeometry(...piece.size).translate(...piece.boundsCenter);
}

export function placementRotation(piece: BuilderPlacement): number {
  return (piece.kind === 'hull' ? piece.rotationDeg : -piece.bearingDeg) * Math.PI / 180;
}
