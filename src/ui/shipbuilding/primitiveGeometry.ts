import { shapedFaces } from '../../ships/freeformShape';
import { balconyFaces } from '../../ships/constructionBalcony';
import * as THREE from 'three';
import { cornerVertices, VERTEX_FACES } from '../../ships/constructionVertex';
import type { ConstructionEquipmentPart, ConstructionPrimitive, Vec3 } from '../../ships/blueprint';
import { CONSTRUCTION_SHAPES } from '../../ships/constructionShapes';
import { constructionVertexNormals, SMOOTH_HULL_SHAPES } from '../../game/constructionShading';
import { customHullFaces, customHullPoints, customHullPrimitive, makeHull } from '../../ships/customHullModel';

/** Display-only source envelopes for placement and invalid drafts. Rust remains
 * authoritative for unions, material, fit, loading and all battle geometry. */
export function primitiveGeometry(kind: ConstructionPrimitive['kind'], size: Vec3, corners?: Vec3[], customHull?: ConstructionPrimitive['customHull'], shaping?: ConstructionPrimitive['shaping'], balcony?: ConstructionPrimitive['balcony']): THREE.BufferGeometry {
  if (kind === 'balcony') {
    const positions = balconyFaces(size, balcony).flatMap(face => face.slice(1, -1).flatMap((v, i) => [face[0], v, face[i + 2]].flat()));
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals(); return geometry;
  }
  if (kind === 'vertex' && shaping) {
    const faces=shapedFaces({id:'',kind,size,position:[0,0,0],rotationDeg:0,vertices:corners,shaping});
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(faces.flatMap(f=>f.points.flat()),3));g.computeVertexNormals();return g;
  }
  if (kind === 'custom-hull') {
    const p = { ...customHullPrimitive(makeHull(0)), size, ...(customHull ? { customHull } : {}) };
    const faces = customHullFaces(p).map(f => ({ ...f, normal: new THREE.Vector3(...f.vertices[1]).sub(new THREE.Vector3(...f.vertices[0])).cross(new THREE.Vector3(...f.vertices[2]).sub(new THREE.Vector3(...f.vertices[0]))).normalize().toArray() as Vec3 }));
    const normalAt = constructionVertexNormals(faces, -1), positions: number[] = [], normals: number[] = [];
    for (const face of faces) for (const point of face.vertices) { positions.push(...point); normals.push(...normalAt(point, face.normal, face.group)); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); return g;
  }
  if (kind === 'vertex') {
    const v = corners ?? cornerVertices({kind, size, position:[0,0,0],rotationDeg:0,id:''});
    const positions:number[]=[];
    for (const face of VERTEX_FACES) {
      // Same unbiased bilinear face-center fan as the authoritative compiler.
      const q=face.corners.map(i=>v[i]), center=q.reduce((a,v)=>a.map((n,k)=>n+v[k]/4) as Vec3,[0,0,0] as Vec3);
      for(let i=0;i<4;i++) for(const point of [q[i],q[(i+1)%4],center]) positions.push(...point.map((n,k)=>n*size[k]));
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();return g;
  }
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

export type { BuilderPlacement } from './builderScene';
import type { BuilderPlacement } from './builderScene';

/** Hull and equipment ghosts; internal planes use hull-clipped boundaryGeometry. */
export function placementGeometry(piece: Exclude<BuilderPlacement, { kind: 'boundary' }>): THREE.BufferGeometry {
  if (piece.kind === 'hull') return primitiveGeometry(piece.shape, piece.size);
  return new THREE.BoxGeometry(...piece.size).translate(...piece.boundsCenter);
}

export function placementRotation(piece: BuilderPlacement): number {
  return (piece.kind === 'hull' ? piece.rotationDeg : piece.kind === 'equipment' ? -piece.bearingDeg : 0) * Math.PI / 180;
}

/** Selection follows authored sections and chines, without tessellation diagonals. */
export function primitiveOutlineGeometry(p: ConstructionPrimitive): THREE.BufferGeometry {
  if (p.kind !== 'custom-hull' || !p.customHull) {
    const solid = primitiveGeometry(p.kind, p.size, p.vertices, p.customHull, p.shaping, p.balcony);
    const edges = new THREE.EdgesGeometry(solid, p.shaping ? 25 : 1); solid.dispose(); return edges;
  }
  const points = customHullPoints(p), lines: number[] = [];
  for (let section = 0; section < p.customHull.stations.length; section++) {
    for (let edge = 0; edge < 9; edge++) {
      lines.push(...points[section * 9 + edge], ...points[section * 9 + (edge + 1) % 9]);
      if (section > 0) lines.push(...points[(section - 1) * 9 + edge], ...points[section * 9 + edge]);
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
}
