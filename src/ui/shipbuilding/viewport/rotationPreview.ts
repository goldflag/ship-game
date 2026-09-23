import type * as THREE from 'three';
import type { Vec3 } from '../../../ships/blueprint';
import type { BuilderPick, BuilderScene } from '../builderScene';
import { internalSelectionIds } from '../internalSelection';
import { twinIds } from './movePreview';
import { carriedIds, carryRoots, turnedAbout } from '../../../ships/constructionParents';

/** A secondary drag rotates installed fittings, or the cursor at its held placement. */
export interface RotationDrag {
  ids: string[];
  /** Mirror editing: fittings that turn the opposite way. */ twins?: string[];
  degrees: number;
  travelDegrees: number;
  lastX: number;
  position?: Vec3;
}

/** The drag a secondary press begins: the fittings under it (or the selection it belongs to), else the held cursor ghost. */
export function rotationDrag(
  scene: BuilderScene,
  pick: () => BuilderPick | undefined,
  clientX: number,
  ghostPosition: Vec3 | undefined,
): RotationDrag | undefined {
  if (
    scene.freeform ||
    scene.pathDraft ||
    scene.moveTargets === 'none' ||
    (scene.placementPiece?.kind === 'equipment' && scene.placementPiece.wall)
  )
    return undefined;
  const hit = pick();
  if (hit?.id && scene.source.construction.equipment.some((item) => item.id === hit.id && item.wall)) return undefined;
  if (hit?.id && scene.source.construction.equipment.some((item) => item.id === hit.id)) {
    const allowed = scene.pickTargets === 'internals' ? internalSelectionIds(scene.source, scene.catalog) : undefined;
    const ids = scene.source.construction.equipment
      .filter(
        (item) => (!allowed || allowed.has(item.id)) && (scene.selected.has(hit.id!) ? scene.selected.has(item.id) : item.id === hit.id),
      )
      .map((item) => item.id);
    return { ids, twins: twinIds(scene, ids), degrees: 0, travelDegrees: 0, lastX: clientX };
  }
  if (scene.placementPiece?.kind === 'equipment' && ghostPosition)
    return { ids: [], degrees: 0, travelDegrees: 0, lastX: clientX, position: [...ghostPosition] };
  return undefined;
}

/** Turn the installed models (and their pick proxies) in place; the source commits once on release. What a turned
 * fitting carries (`parent`) swings about its datum, as the `rotate` command will move it. */
export function previewRotation(
  scene: BuilderScene,
  equipmentGroup: THREE.Object3D,
  details: THREE.Object3D,
  rotation: RotationDrag,
  degrees: number,
) {
  const data = scene.source.construction;
  const pose = (id: string, bearing: number, position?: Vec3) => {
    const object = equipmentGroup.getObjectByName(id);
    if (object) {
      object.rotation.y = (-bearing * Math.PI) / 180;
      if (position) object.position.fromArray(position);
      object.updateMatrixWorld(true);
    }
    for (const datum of details.children)
      if (datum.children.some((child) => child.userData.sourceId === id)) {
        datum.rotation.y = (-bearing * Math.PI) / 180;
        if (position) datum.position.fromArray(position);
      }
  };
  for (const item of data.equipment) {
    const twin = !!rotation.twins?.includes(item.id);
    if (!twin && !rotation.ids.includes(item.id)) continue;
    pose(item.id, item.bearingDeg + (twin ? -degrees : degrees));
  }
  for (const [ids, sign] of [
    [rotation.ids, 1],
    [rotation.twins ?? [], -1],
  ] as const) {
    for (const id of carryRoots(data, new Set(ids))) {
      const root = data.equipment.find((item) => item.id === id),
        riders = carriedIds(data, [id]);
      if (!root || !riders.size) continue;
      for (const rider of data.equipment)
        if (riders.has(rider.id)) pose(rider.id, rider.bearingDeg + sign * degrees, turnedAbout(rider.position, root.position, sign * degrees));
    }
  }
}
