import { envelopeVertices } from '../../ships/freeformShape';
import { equipmentPathBounds } from '../../ships/constructionPaths';
import { worldVertex } from '../../ships/constructionVertex';
import * as THREE from 'three';
import type { ConstructionCatalog, ConstructionSource, Vec3 } from '../../ships/blueprint';

export interface SelectionRect { left: number; top: number; right: number; bottom: number }

/** Screen-space selection includes pieces enclosed by the rectangle, through the
 * hull. Hidden internal packages are excluded. */
export function boxSelectedPieces(source: ConstructionSource, catalog: ConstructionCatalog, camera: THREE.Camera, rect: SelectionRect, width: number, height: number, internals = false): string[] {
  const result: string[] = [];
  camera.updateMatrixWorld(true);
  const contains = (points: THREE.Vector3[]) => {
    const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity, near: Infinity, far: -Infinity };
    for (const point of points) {
      point.project(camera);
      const px = (point.x + 1) * width / 2, py = (1 - point.y) * height / 2;
      bounds.left = Math.min(bounds.left, px); bounds.right = Math.max(bounds.right, px);
      bounds.top = Math.min(bounds.top, py); bounds.bottom = Math.max(bounds.bottom, py);
      bounds.near = Math.min(bounds.near, point.z); bounds.far = Math.max(bounds.far, point.z);
    }
    return bounds.near <= 1 && bounds.far >= -1 && bounds.left >= rect.left && bounds.right <= rect.right && bounds.top >= rect.top && bounds.bottom <= rect.bottom;
  };
  const overlaps = (position: Vec3, size: Vec3, rotation: number, center: Vec3 = [0, 0, 0]) => {
    const matrix = new THREE.Matrix4().makeRotationY(rotation), points: THREE.Vector3[] = [];
    for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
      points.push(new THREE.Vector3(center[0] + x * size[0], center[1] + y * size[1], center[2] + z * size[2]).applyMatrix4(matrix).add(new THREE.Vector3(...position)));
    }
    return contains(points);
  };
  for (const part of internals ? [] : source.construction.primitives) {
    if (contains(envelopeVertices(part).map(v => new THREE.Vector3(...worldVertex(part, v))))) result.push(part.id);
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
