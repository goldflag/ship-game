import type { ConstructionPrimitive, ConstructionSource, Vec3 } from './blueprint';
import { newConstructionId } from './constructionEditor';
import { customHullPoints } from './customHullModel';

export const VERTEX_UNITS = [.05, .1, .2, .5, 1, 2] as const;
export const VERTEX_SNAP_DISTANCE = .025;
export const CORNER_SIGNS: Vec3[] = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
export const VERTEX_FACES = [
  { name: 'bow', corners: [0,3,2,1] }, { name: 'stern', corners: [4,5,6,7] },
  { name: 'port', corners: [0,4,7,3] }, { name: 'starboard', corners: [1,2,6,5] },
  { name: 'bottom', corners: [0,1,5,4] }, { name: 'top', corners: [3,7,6,2] },
] as const;
export type MirrorAxes = [boolean, boolean, boolean];
export type HullSelectionMode = 'vertex' | 'edge' | 'face';
export interface HullSelection { mode: HullSelectionMode; index: number }
export const VERTEX_EDGES: readonly (readonly [number, number])[] = [
  [0,1], [1,2], [2,3], [3,0], [4,5], [5,6], [6,7], [7,4],
  [0,4], [1,5], [2,6], [3,7],
];
export function selectionCorners(selection: HullSelection): readonly number[] {
  if (selection.mode === 'edge') return VERTEX_EDGES[selection.index] ?? [];
  if (selection.mode === 'face') return VERTEX_FACES[selection.index]?.corners ?? [];
  return CORNER_SIGNS[selection.index] ? [selection.index] : [];
}
export function selectionLabel(selection: HullSelection): string {
  if (selection.mode === 'face') {
    const name = VERTEX_FACES[selection.index]?.name ?? 'Unknown';
    return `${name[0].toUpperCase()}${name.slice(1)} face`;
  }
  return `${selection.mode === 'edge' ? 'Edge' : 'Vertex'} ${selection.index + 1}`;
}
export function selectionCenter(p: ConstructionPrimitive, selection: HullSelection): Vec3 {
  const corners = selectionCorners(selection), points = cornerVertices(p);
  return [0,1,2].map(k => corners.reduce((sum,i) => sum + points[i][k] * p.size[k], 0) / (corners.length || 1)) as Vec3;
}
/** A rigid selection spanning a mirror plane cannot translate across that plane. */
export function selectionLocks(selection: HullSelection, axes: MirrorAxes): MirrorAxes {
  const corners = selectionCorners(selection);
  return axes.map((on,k) => on && new Set(corners.map(i => CORNER_SIGNS[i][k])).size > 1) as MirrorAxes;
}
function mirrorTransforms(axes: MirrorAxes): Vec3[] {
  return axes.reduce<Vec3[]>((transforms,on,k) => on
    ? transforms.flatMap(t => [t, t.map((n,j) => j === k ? -n : n) as Vec3]) : transforms, [[1,1,1]]);
}
function reflectedCorner(i: number, transform: Vec3): number {
  return CORNER_SIGNS.findIndex(sign => sign.every((n,k) => n === CORNER_SIGNS[i][k] * transform[k]));
}
export function affectedCorners(selection: HullSelection, axes: MirrorAxes): number[] {
  return [...new Set(mirrorTransforms(axes).flatMap(t => selectionCorners(selection).map(i => reflectedCorner(i,t))))];
}
export const cornerVertices = (p: ConstructionPrimitive): Vec3[] => p.kind === 'custom-hull' && p.customHull ? customHullPoints(p).map(v => v.map((n, k) => n / p.size[k]) as Vec3) : p.vertices?.map(v => [...v]) ?? CORNER_SIGNS.map(v => v.map(n => n / 2) as Vec3);
export const canEditVertices = (p: ConstructionPrimitive) => p.kind === 'box' || p.kind === 'vertex';
export function rotateVertex(v: Vec3, degrees: number): Vec3 {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [c*v[0]+s*v[2], v[1], -s*v[0]+c*v[2]];
}
export function worldVertex(p: ConstructionPrimitive, v: Vec3): Vec3 {
  return rotateVertex(v.map((n,k) => n*p.size[k]) as Vec3, p.rotationDeg).map((n,k) => n+p.position[k]) as Vec3;
}
export function sampleVertex(vertices: Vec3[], uvw: Vec3): Vec3 {
  const out: Vec3 = [0,0,0];
  CORNER_SIGNS.forEach((sign,i) => {
    const weight = sign.reduce((w,s,k) => w * (s > 0 ? uvw[k] : 1-uvw[k]), 1);
    for (let k=0;k<3;k++) out[k] += vertices[i][k]*weight;
  });
  return out;
}
/** Resolve the entire selection against one source snapshot, then propagate nearby
 * corners. No corner accumulates duplicate motion and neighbors never recurse. */
export function freeformEdit(source: ConstructionSource, id: string, selection: HullSelection, delta: Vec3, axes: MirrorAxes, snap: boolean): ConstructionPrimitive[] {
  const corners = selectionCorners(selection), locks = selectionLocks(selection, axes);
  const movement = delta.map((n,k) => locks[k] ? 0 : n) as Vec3;
  if (!corners.length || movement.every(n => Math.abs(n) < 1e-9)) return [];
  const seed = source.construction.primitives.find(p => p.id === id);
  if (!seed || !canEditVertices(seed)) return [];
  const points = cornerVertices(seed), edits = new Map<string, Map<number, Vec3>>();
  const put = (id: string, i: number, d: Vec3) => {
    if (!edits.has(id)) edits.set(id, new Map());
    if (!edits.get(id)!.has(i)) edits.get(id)!.set(i,d);
  };
  for (const transform of mirrorTransforms(axes)) {
    const local = movement.map((d,k) => d * transform[k]) as Vec3;
    for (const corner of corners) put(id, reflectedCorner(corner, transform), local);
  }
  for (const [i,local] of edits.get(id)!) {
    if (!snap) continue;
    const anchor = worldVertex(seed,points[i]), worldDelta = rotateVertex(local,seed.rotationDeg);
    for (const other of source.construction.primitives) if (other.id !== id && canEditVertices(other)) {
      cornerVertices(other).forEach((v,j) => {
        if (Math.hypot(...worldVertex(other,v).map((n,k) => n-anchor[k])) <= VERTEX_SNAP_DISTANCE) put(other.id,j,rotateVertex(worldDelta,-other.rotationDeg));
      });
    }
  }
  return source.construction.primitives.filter(p => edits.has(p.id)).map(p => {
    const vertices = cornerVertices(p);
    for (const [i,d] of edits.get(p.id)!) vertices[i] = vertices[i].map((v,k) => v+d[k]/p.size[k]) as Vec3;
    return {...structuredClone(p),kind:'vertex',vertices};
  });
}
export function replaceVertexPrimitives(source: ConstructionSource, replacements: ConstructionPrimitive[]) {
  const map = new Map(replacements.map(p => [p.id,p]));
  source.construction.primitives = source.construction.primitives.map(p => structuredClone(map.get(p.id) ?? p));
}
export function splitVertexPrimitive(source: ConstructionSource, id: string, axis: number, count: number): string[] {
  const p = source.construction.primitives.find(p => p.id === id);
  if (!p || !canEditVertices(p)) throw new Error('Select one cube or freeform hull to split.');
  if (![0,1,2].includes(axis) || !Number.isInteger(count) || count < 2 || count > 16) throw new Error('Split count must be 2–16.');
  if (source.construction.primitives.length+count-1 > 512) throw new Error('Splitting would exceed the 512 hull piece limit.');
  const vertices = cornerVertices(p), negative = ['port','bottom','bow'][axis], positive = ['starboard','top','stern'][axis];
  const children = Array.from({length:count},(_,i): ConstructionPrimitive => {
    const start=i/count,end=(i+1)/count, center: Vec3=[.5,.5,.5]; center[axis]=(start+end)/2;
    const localCenter=sampleVertex(vertices,center), size: Vec3=[...p.size]; size[axis]/=count;
    return {...structuredClone(p),id:newConstructionId('hull'),kind:'vertex',position:worldVertex(p,localCenter),size,
      vertices:CORNER_SIGNS.map(sign => {
        const uvw=sign.map(s => (s+1)/2) as Vec3; uvw[axis]=sign[axis]<0?start:end;
        return sampleVertex(vertices,uvw).map((n,k)=>(n-localCenter[k])*p.size[k]/size[k]) as Vec3;
      })};
  });
  const assignments=source.construction.surfaces.filter(s=>s.primitiveId===id);
  source.construction.surfaces=source.construction.surfaces.filter(s=>s.primitiveId!==id);
  children.forEach((child,i)=> assignments.forEach(s=> {
    if ((s.face===negative && i!==0) || (s.face===positive && i!==count-1)) return;
    source.construction.surfaces.push({...s,primitiveId:child.id});
  }));
  source.construction.primitives.splice(source.construction.primitives.indexOf(p),1,...children);
  return children.map(c=>c.id);
}
