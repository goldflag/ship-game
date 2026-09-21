/** Display geometry of the construction shape vocabulary, shared by the editor's hull blocks and
 * design-local fittings. No editor state: the battle and export model builders import it too. */
import { blockAngles } from '../ships/constructionOrientation';
import { meshFaces } from '../ships/constructionMesh';
import { shapedFaces } from '../ships/freeformShape';
import { balconyFaces } from '../ships/constructionBalcony';
import * as THREE from 'three';
import { cornerVertices, VERTEX_FACES } from '../ships/constructionVertex';
import type { ConstructionPrimitive, Vec3 } from '../ships/blueprint';
import { CONSTRUCTION_SHAPES } from '../ships/constructionShapes';
import { constructionVertexNormals, customHullSmoothingGroup, SMOOTH_HULL_SHAPES } from './constructionShading';
import { customHullFaces, customHullPoints, customHullPrimitive, makeHull } from '../ships/customHullModel';

/** Display-only source envelopes for placement and invalid drafts. Rust remains
 * authoritative for unions, material, fit, loading and all battle geometry. */
export function primitiveGeometry(kind: ConstructionPrimitive['kind'], size: Vec3, corners?: Vec3[], customHull?: ConstructionPrimitive['customHull'], shaping?: ConstructionPrimitive['shaping'], balcony?: ConstructionPrimitive['balcony'], mesh?: ConstructionPrimitive['mesh'], solid?: ConstructionPrimitive['solid']): THREE.BufferGeometry {
  if (solid) {
    // The union's own skin comes from Rust; the draft envelope just draws every part, whose
    // shared faces sit inside the solid and are covered by the parts that meet them.
    const positions: number[] = [];
    for (const part of solid.parts) for (const face of part.faces) {
      const q = face.corners.map(i => solid.vertices[i]);
      if (q.some(v => !v)) continue;
      const scaled = q.map(v => v.map((n, k) => n * size[k]) as Vec3);
      for (let i = 1; i < scaled.length - 1; i++) positions.push(...scaled[0], ...scaled[i], ...scaled[i + 1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals(); return g;
  }
  if(mesh){
    const faces=meshFaces(mesh,size).map(f=>({vertices:f.points,normal:new THREE.Vector3(...f.points[1]).sub(new THREE.Vector3(...f.points[0])).cross(new THREE.Vector3(...f.points[2]).sub(new THREE.Vector3(...f.points[0]))).normalize().toArray() as Vec3,group:'mesh'}));
    const normalAt=mesh.family==='rings'?constructionVertexNormals(faces):(_v:Vec3,n:Vec3)=>n;
    const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(faces.flatMap(f=>f.vertices.flat()),3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(faces.flatMap(f=>f.vertices.flatMap(v=>normalAt(v,f.normal,'mesh'))),3));return g;
  }
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
    const p = { ...customHullPrimitive(makeHull()), size, ...(customHull ? { customHull } : {}) };
    const faces = customHullFaces(p).map(f => ({ ...f, group: customHullSmoothingGroup(f.group), normal: new THREE.Vector3(...f.vertices[1]).sub(new THREE.Vector3(...f.vertices[0])).cross(new THREE.Vector3(...f.vertices[2]).sub(new THREE.Vector3(...f.vertices[0]))).normalize().toArray() as Vec3 }));
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

export function primitiveRotation(p: Pick<ConstructionPrimitive, 'rotationDeg' | 'tilt'>): THREE.Euler { const [x, y, z] = blockAngles(p).map(n => n * Math.PI / 180); return new THREE.Euler(x, y, z, 'YXZ'); }
