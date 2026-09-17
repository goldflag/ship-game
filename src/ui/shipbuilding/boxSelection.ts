import { equipmentPathBounds } from '../../ships/constructionPaths';
import { cornerVertices } from '../../ships/constructionVertex';
import * as THREE from 'three';
import type { ConstructionCatalog, ConstructionSource, Vec3 } from '../../ships/blueprint';

export interface SelectionRect { left: number; top: number; right: number; bottom: number }

/** Screen-space selection includes pieces enclosed by the rectangle, through the
 * hull. Hidden internal packages and pieces above the slice are excluded. */
export function boxSelectedPieces(source: ConstructionSource, catalog: ConstructionCatalog, camera: THREE.Camera, rect: SelectionRect, width: number, height: number, slice?: number, internals = false): string[] {
  const result: string[] = [];
  camera.updateMatrixWorld(true);
  const overlaps = (position: Vec3, size: Vec3, rotation: number, center: Vec3 = [0, 0, 0]) => {
    const lowY = position[1] + center[1] - size[1] / 2, highY = Math.min(position[1] + center[1] + size[1] / 2, slice ?? Infinity);
    if (lowY > highY) return false;
    const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity, near: Infinity, far: -Infinity };
    const matrix = new THREE.Matrix4().makeRotationY(rotation);
    for (const x of [-.5, .5]) for (const y of [lowY, highY]) for (const z of [-.5, .5]) {
      const point = new THREE.Vector3(center[0] + x * size[0], 0, center[2] + z * size[2]).applyMatrix4(matrix);
      point.set(point.x + position[0], y, point.z + position[2]).project(camera);
      const px = (point.x + 1) * width / 2, py = (1 - point.y) * height / 2;
      bounds.left = Math.min(bounds.left, px); bounds.right = Math.max(bounds.right, px);
      bounds.top = Math.min(bounds.top, py); bounds.bottom = Math.max(bounds.bottom, py);
      bounds.near = Math.min(bounds.near, point.z); bounds.far = Math.max(bounds.far, point.z);
    }
    return bounds.near <= 1 && bounds.far >= -1 && bounds.left >= rect.left && bounds.right <= rect.right && bounds.top >= rect.top && bounds.bottom <= rect.bottom;
  };
  for (const part of internals ? [] : source.construction.primitives) {
    if(part.kind==='vertex') {
      const corners=cornerVertices(part).map(v=>v.map((n,k)=>n*part.size[k]));
      const min=[0,1,2].map(k=>Math.min(...corners.map(v=>v[k]))),max=[0,1,2].map(k=>Math.max(...corners.map(v=>v[k])));
      if(overlaps(part.position,max.map((n,k)=>n-min[k]) as Vec3,part.rotationDeg*Math.PI/180,min.map((n,k)=>(n+max[k])/2) as Vec3))result.push(part.id);
    }else if (overlaps(part.position, part.size, part.rotationDeg * Math.PI / 180)) result.push(part.id);
  }
  for (const item of source.construction.equipment) {
    const part = catalog.equipment.find(part => part.id === item.partId);
    if (part && (internals ? part.placement === 'internal' : part.placement !== 'internal')) {
      const bounds = equipmentPathBounds(part, item);
      if (overlaps(item.position, bounds.size, -item.bearingDeg * Math.PI / 180, bounds.center)) result.push(item.id);
    }
  }
  return result;
}
