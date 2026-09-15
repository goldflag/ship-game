import * as THREE from 'three';
import type { ConstructionEquipmentPart, ConstructionPrimitive, Vec3 } from '../../ships/blueprint';
import { CONSTRUCTION_SHAPES } from '../../ships/constructionShapes';
import { constructionVertexNormals, SMOOTH_HULL_SHAPES } from '../../game/constructionShading';

/** Display-only source envelopes for placement and invalid drafts. Rust remains
 * authoritative for unions, material, fit, loading and all battle geometry. */
export function primitiveGeometry(kind: ConstructionPrimitive['kind'], size: Vec3): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [];
  const faces = CONSTRUCTION_SHAPES[kind].map(face => {
    const vertices = face.map(point => point.map((v, axis) => v * size[axis]) as Vec3);
    const a = new THREE.Vector3(...vertices[0]), b = new THREE.Vector3(...vertices[1]), c = new THREE.Vector3(...vertices[2]);
    return { vertices, normal: b.sub(a).cross(c.sub(a)).normalize().toArray() as Vec3, group: kind };
  });
  const normalAt = SMOOTH_HULL_SHAPES.has(kind) ? constructionVertexNormals(faces) : (_point: Vec3, normal: Vec3) => normal;
  for (const face of faces) for (let i = 1; i < face.vertices.length - 1; i++) {
    for (const point of [face.vertices[0], face.vertices[i], face.vertices[i + 1]]) {
      positions.push(...point); normals.push(...normalAt(point, face.normal, kind));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
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
