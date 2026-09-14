import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import type { ConstructionEquipmentPart, ConstructionPrimitive, Vec3 } from '../../ships/blueprint';

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
  | { kind: 'equipment'; partId?: string; size: Vec3; boundsCenter: Vec3; bearingDeg: number; sockets?: ConstructionEquipmentPart['sockets']; arc?: { traverseDeg: number; radius: number }; /** Clearance from the hit face, e.g. the inward skin thickness for internal packages. */ inset?: number }
  | { kind: 'boundary'; axis: 'x' | 'y' | 'z'; thicknessMm: number };

/** Boundaries preview as a plane spanning the ship's bounds. */
export function placementGeometry(piece: BuilderPlacement, span: Vec3 = [60, 60, 60]): THREE.BufferGeometry {
  if (piece.kind === 'hull') return primitiveGeometry(piece.shape, piece.size);
  if (piece.kind === 'equipment') return new THREE.BoxGeometry(...piece.size).translate(...piece.boundsCenter);
  const size: Vec3 = [...span]; size[{ x: 0, y: 1, z: 2 }[piece.axis]] = Math.max(.04, piece.thicknessMm / 1000);
  return new THREE.BoxGeometry(...size);
}

export function placementRotation(piece: BuilderPlacement): number {
  return (piece.kind === 'hull' ? piece.rotationDeg : piece.kind === 'equipment' ? -piece.bearingDeg : 0) * Math.PI / 180;
}
