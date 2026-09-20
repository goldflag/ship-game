import * as THREE from 'three';
import type { ConstructionPrimitive, ConstructionSurface } from '../../../ships/blueprint';
import { itemOutlineGeometry } from '../itemOutline';
import { primitiveOutlineGeometry, primitiveRotation } from '../primitiveGeometry';
import { surfaceOutline } from '../surfaceOutline';
import { IVORY } from './resources';

/** The ivory outline of the hovered fitting, block or face. `key` is a face's selection key when `face`, else an item id. */
export function fillHoverOutline(
  target: THREE.Group,
  key: string,
  primitive: ConstructionPrimitive | undefined,
  face: boolean | undefined,
  highlightFaces: boolean | undefined,
  pickMeshes: THREE.Object3D[],
  surfacesByKey: Map<string, ConstructionSurface[]>,
) {
  const material = () => new THREE.LineBasicMaterial({ color: IVORY, depthTest: false, transparent: true, opacity: 0.95 });
  if (!primitive) {
    const edges = new THREE.LineSegments(itemOutlineGeometry(pickMeshes, key), material());
    edges.renderOrder = 25;
    target.add(edges);
    return;
  }
  if (!face) {
    const edges = new THREE.LineSegments(primitiveOutlineGeometry(primitive), material());
    edges.position.set(...primitive.position);
    edges.rotation.copy(primitiveRotation(primitive));
    edges.renderOrder = 25;
    target.add(edges);
    return;
  }
  const groups = highlightFaces
    ? [surfacesByKey.get(key) ?? []]
    : [...surfacesByKey.values()].filter((group) => group[0].primitiveId === key);
  for (const group of groups) {
    const points = surfaceOutline(group).flatMap((edge) =>
      [edge.a, edge.b].map((point) => new THREE.Vector3(...point).addScaledVector(new THREE.Vector3(...edge.surface.normal), 0.03)),
    );
    const outline = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), material());
    outline.renderOrder = 25;
    target.add(outline);
  }
}
