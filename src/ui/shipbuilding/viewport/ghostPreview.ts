import * as THREE from 'three';
import type { Vec3 } from '../../../ships/blueprint';
import { createConstructionWallModel } from '../../../game/constructionWallModel';
import { placementBalcony } from '../../../ships/constructionBalcony';
import { wallFittingSupported, wallScale } from '../../../ships/constructionWallFittings';
import { boundaryGeometry } from '../boundaryGeometry';
import type { BuilderPick, BuilderPlacement, BuilderScene } from '../builderScene';
import type { EquipmentPreview } from '../equipmentPreview';
import { placementGeometry, placementRotation, primitiveGeometry } from '../primitiveGeometry';
import { BRASS, BRASS_LIGHT } from './resources';

export interface GhostView {
  equipment: EquipmentPreview;
  scene: BuilderScene;
  pick?: Pick<BuilderPick, 'placement'>;
  /** A boundary ghost's offset along its axis. */
  offset?: number;
}

/** The cursor piece (or its mirror) as a translucent brass ghost inside `group`. */
export function buildGhost(view: GhostView, item: BuilderPlacement, group: THREE.Group, opacity: number, mirrored = false) {
  const { pick, offset } = view;
  let equipment = item.kind === 'equipment' && item.partId ? view.equipment.clone(item.partId, true) : undefined;
  if (equipment) {
    const part = view.scene.catalog.equipment.find((p) => p.id === (item.kind === 'equipment' ? item.partId : undefined));
    if (part && item.kind === 'equipment') {
      if (item.wall && pick) {
        const position = [...pick.placement] as Vec3;
        if (mirrored) position[0] *= -1;
        equipment = createConstructionWallModel(
          equipment,
          part,
          { id: 'preview', partId: part.id, position, bearingDeg: item.bearingDeg, wall: item.wall },
          view.scene.current?.surfaces ?? [],
          view.scene.source.construction.primitives,
        );
      } else equipment.scale.fromArray(wallScale(part, { wall: item.wall }));
    }
    group.add(equipment);
    group.rotation.copy(placementRotation(item));
    return;
  }
  const balcony =
    item.kind === 'hull' && item.shape === 'balcony'
      ? (item.balcony ?? placementBalcony([(pick?.placement[0] ?? 1) * (mirrored ? -1 : 1), 0, 0], item.rotationDeg))
      : undefined;
  const geometry =
    item.kind === 'boundary'
      ? boundaryGeometry(view.scene.source.construction.primitives, item.axis, offset ?? NaN)
      : balcony
        ? primitiveGeometry('balcony', item.size, undefined, undefined, undefined, balcony)
        : placementGeometry(item);
  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: BRASS,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: item.kind === 'boundary',
      side: THREE.DoubleSide,
    }),
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false, transparent: true, opacity: opacity * 3.6 }),
  );
  fill.renderOrder = 20;
  edges.renderOrder = 21;
  group.add(fill, edges);
  group.rotation.copy(placementRotation(item));
}

export function tintGhosts(groups: THREE.Group[], blocked: boolean) {
  for (const group of groups)
    group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        const material = object.material as THREE.MeshBasicMaterial;
        material.color.set(blocked ? '#ffb5a6' : object instanceof THREE.LineSegments ? BRASS_LIGHT : BRASS);
      }
    });
}

/** A wall fitting's mirror ghost shows only where the opposite wall can carry it. */
export function mirroredWallGhostSupported(scene: BuilderScene, piece: Extract<BuilderPlacement, { kind: 'equipment' }>, position: Vec3) {
  const part = scene.catalog.equipment.find((p) => p.id === piece.partId);
  const supported =
    !!part &&
    wallFittingSupported(
      {
        id: 'preview',
        partId: part.id,
        position: [-position[0], position[1], position[2]],
        bearingDeg: -piece.bearingDeg,
        wall: piece.wall,
      },
      part,
      scene.current?.surfaces ?? [],
    );
  return supported;
}
