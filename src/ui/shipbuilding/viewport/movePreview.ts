import * as THREE from 'three';
import type { ConstructionEquipment, Vec3 } from '../../../ships/blueprint';
import { createConstructionWallModel } from '../../../game/constructionWallModel';
import { equipmentPathBounds } from '../../../ships/constructionPaths';
import { installedWallPart, seatWallFitting, wallNormal, wallScale, wallTurn } from '../../../ships/constructionWallFittings';
import { mirroredMoveConstraint } from '../blockMovement';
import { boundaryGeometry } from '../boundaryGeometry';
import type { BuilderPick, BuilderScene } from '../builderScene';
import type { EquipmentPreview } from '../equipmentPreview';
import { internalSelectionIds } from '../internalSelection';
import { mirrorTwins } from '../mirrorEditing';
import { primitiveGeometry, primitiveOutlineGeometry, primitiveRotation } from '../primitiveGeometry';
import { BRASS, BRASS_LIGHT, MINT, release } from './resources';

/** A primary drag that began on a piece: the pieces it carries, the plane it slides in and the snapped offset so far. */
export interface MoveDrag {
  ids: string[];
  /** Mirror editing: twins that travel the reflected path. */ twins: string[];
  plane: THREE.Plane;
  origin: THREE.Vector3;
  free: [boolean, boolean, boolean];
  delta: Vec3;
  built: boolean;
  constrain(delta: Vec3): Vec3;
}

/** Mirror editing: the twins that follow these pieces. The selection's twins are already known; another gesture finds its own. */
export function twinIds(scene: BuilderScene, ids: string[]): string[] {
  if (!scene.mirrorEdits) return [];
  return ids.every((id) => scene.selected.has(id))
    ? ids.flatMap((id) => scene.twins.get(id) ?? [])
    : [...mirrorTwins(scene.source, new Set(ids)).values()];
}

/** Only an already-selected piece, fitting or wall can capture a primary drag.
 * A drag over anything else stays with the camera; a separate click selects it. */
export function moveDrag(scene: BuilderScene, hit: BuilderPick | undefined, camera: THREE.Camera): MoveDrag | undefined {
  const targets = scene.moveTargets;
  if (!hit?.id || !scene.selected.has(hit.id)) return undefined;
  const { primitives, equipment, boundaries } = scene.source.construction;
  const isPrimitive = (id: string) => primitives.some((part) => part.id === id),
    isEquipment = (id: string) => equipment.some((part) => part.id === id);
  const wall = boundaries.find((entry) => entry.id === hit.id);
  if (!isPrimitive(hit.id) && !isEquipment(hit.id) && !wall) return undefined;
  if (targets === 'equipment' && !isEquipment(hit.id)) return undefined;
  const allowed = scene.pickTargets === 'internals' ? internalSelectionIds(scene.source, scene.catalog) : undefined;
  const ids = [...scene.selected].filter(
    (id) => (!allowed || allowed.has(id)) && (isPrimitive(id) || isEquipment(id) || boundaries.some((entry) => entry.id === id)),
  );
  const origin = new THREE.Vector3(...hit.point),
    normal = new THREE.Vector3(),
    free: MoveDrag['free'] = [true, true, true];
  if (wall && ids.length === 1) {
    // A wall slides along its own axis only: drag in the plane that contains the axis and faces the camera.
    const axis = { x: 0, y: 1, z: 2 }[wall.axis];
    normal.copy(camera.getWorldDirection(new THREE.Vector3())).setComponent(axis, 0);
    if (normal.lengthSq() < 1e-6) normal.set(axis === 0 ? 0 : 1, 0, axis === 0 ? 1 : 0);
    free.fill(false);
    free[axis] = true;
  } else if (equipment.find((e) => e.id === hit.id)?.wall) {
    normal.fromArray(wallNormal(equipment.find((e) => e.id === hit.id)!.bearingDeg));
    for (let k = 0; k < 3; k++) free[k] = Math.abs(normal.getComponent(k)) < 0.99999;
  } else {
    // Pieces slide in the plane of the pressed face; press a side face to move vertically.
    normal.setComponent(hit.axis, Math.sign(hit.normal?.[hit.axis] ?? 1) || 1);
    free[hit.axis] = false;
  }
  const twins = twinIds(scene, ids);
  return {
    ids,
    twins,
    plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), origin),
    origin,
    free,
    delta: [0, 0, 0],
    built: false,
    constrain: mirroredMoveConstraint(scene.source, new Set(ids), new Set(twins)),
  };
}

/** What the move gizmo carries: the movable selection, one anchor per piece and the axes it may travel. */
export function moveHandleTargets(scene: BuilderScene, orbitTarget: THREE.Vector3) {
  const { primitives, equipment, boundaries } = scene.source.construction;
  const internals = scene.pickTargets === 'internals';
  const allowed = internals ? internalSelectionIds(scene.source, scene.catalog) : undefined;
  const ids = [...scene.selected].filter(
    (id) => (!allowed || allowed.has(id)) && (scene.moveTargets !== 'equipment' || equipment.some((item) => item.id === id)),
  );
  const selected = new Set(ids),
    blocks = primitives.filter((p) => selected.has(p.id));
  if (scene.freeform || scene.moveTargets === 'none' || !ids.length) {
    return undefined;
  }
  const anchors: Vec3[] = blocks.map((p) => p.position);
  const modules = equipment.filter((p) => selected.has(p.id));
  const walls = internals ? boundaries.filter((p) => selected.has(p.id)) : [];
  for (const item of modules) {
    const part = scene.catalog.equipment.find((p) => p.id === item.partId);
    const center = new THREE.Vector3(...(part ? equipmentPathBounds(installedWallPart(part, item), item).center : ([0, 0, 0] as Vec3)));
    center.applyAxisAngle(new THREE.Vector3(0, 1, 0), (-item.bearingDeg * Math.PI) / 180).add(new THREE.Vector3(...item.position));
    anchors.push(center.toArray() as Vec3);
  }
  for (const wall of walls) {
    const center = orbitTarget.clone();
    center.setComponent({ x: 0, y: 1, z: 2 }[wall.axis], wall.offset);
    anchors.push(center.toArray() as Vec3);
  }
  if (!anchors.length) {
    return undefined;
  }
  const axes = [0, 1, 2].map((k) => !!blocks.length || !!modules.length || walls.some((wall) => 'xyz'.indexOf(wall.axis) === k)) as [
    boolean,
    boolean,
    boolean,
  ];
  return { ids, selected, anchors, axes };
}

export interface MovePreviewView {
  group: THREE.Group;
  scene: BuilderScene;
  equipment: EquipmentPreview;
}

/** Brass copies of the moved pieces, mint copies of the twins that mirror the move; the originals stay until the source commits on release. */
export function buildMovePreview(view: MovePreviewView, ids: string[], twins: string[] = []) {
  release(view.group);
  const { primitives, equipment, boundaries } = view.scene.source.construction;
  const partners = new Set<string>(twins);
  for (const item of equipment)
    if (ids.includes(item.id) && item.wall?.mirrorId && !ids.includes(item.wall.mirrorId)) partners.add(item.wall.mirrorId);
  for (const id of [...ids, ...partners]) {
    const primitive = primitives.find((part) => part.id === id);
    if (primitive) {
      const twin = partners.has(id);
      const geometry = primitiveGeometry(
        primitive.kind,
        primitive.size,
        primitive.vertices,
        primitive.customHull,
        primitive.shaping,
        primitive.balcony,
        primitive.mesh,
        primitive.solid,
      );
      const fill = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: twin ? MINT : BRASS, transparent: true, opacity: 0.22, depthWrite: false }),
      );
      const edges = new THREE.LineSegments(
        primitiveOutlineGeometry(primitive),
        new THREE.LineBasicMaterial({ color: twin ? MINT : BRASS_LIGHT, depthTest: false }),
      );
      for (const object of [fill, edges]) {
        object.position.set(...primitive.position);
        object.rotation.copy(primitiveRotation(primitive));
        object.renderOrder = 20;
        if (twin) object.userData.mirrorOrigin = [...primitive.position];
        view.group.add(object);
      }
      continue;
    }
    const item = equipment.find((part) => part.id === id);
    if (item) {
      const datum = new THREE.Group();
      if (item.wall) datum.userData.wallItem = item;
      datum.position.set(...item.position);
      datum.rotation.y = (-item.bearingDeg * Math.PI) / 180;
      const ghost = view.equipment.clone(item.partId, true, item.path),
        part = view.scene.catalog.equipment.find((entry) => entry.id === item.partId);
      // Scale, then the wall turn, inside the bearing frame.
      const body = new THREE.Group();
      body.rotation.z = (wallTurn(item.wall) * Math.PI) / 180;
      datum.add(body);
      if (ghost) body.add(ghost);
      if (part) body.scale.fromArray(wallScale(part, item));
      if (partners.has(id)) datum.userData.mirrorOrigin = [...item.position];
      else if (part) {
        const box = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(...part.size)),
          new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false }),
        );
        box.position.set(...part.boundsCenter);
        body.add(box);
      }
      view.group.add(datum);
      continue;
    }
    const wall = boundaries.find((entry) => entry.id === id);
    if (wall) {
      const plane = new THREE.Mesh(
        boundaryGeometry(primitives, wall.axis, wall.offset),
        new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }),
      );
      plane.userData.boundary = wall;
      plane.userData.offset = wall.offset;
      view.group.add(plane);
    }
  }
  view.group.position.set(0, 0, 0);
}

export function positionMovePreview(view: MovePreviewView, delta: Vec3) {
  view.group.position.set(...delta);
  for (const child of view.group.children) {
    const wallItem = child.userData.wallItem as ConstructionEquipment | undefined;
    if (wallItem) {
      const part = view.scene.catalog.equipment.find((p) => p.id === wallItem.partId),
        surfaces = view.scene.current?.surfaces ?? [];
      if (part) {
        const mirrored = !!child.userData.mirrorOrigin,
          position = wallItem.position.map((v, k) => v + delta[k] * (mirrored && k === 0 ? -1 : 1)) as Vec3;
        const item = seatWallFitting({ ...wallItem, position }, part, surfaces),
          key = JSON.stringify(item.position);
        if (child.userData.projectedKey !== key) {
          release(child);
          const template = view.equipment.clone(part.id, true);
          if (template) child.add(createConstructionWallModel(template, part, item, surfaces, view.scene.source.construction.primitives));
          child.scale.set(1, 1, 1);
          child.userData.projectedKey = key;
        }
        child.position.fromArray(item.position.map((v, k) => v - delta[k]) as Vec3);
      }
      continue;
    }
    const mirrored = child.userData.mirrorOrigin as Vec3 | undefined;
    if (mirrored) child.position.set(mirrored[0] - 2 * delta[0], mirrored[1], mirrored[2]);
    const wall = child.userData.boundary;
    if (!wall || !(child instanceof THREE.Mesh)) continue;
    const offset = wall.offset + delta[{ x: 0, y: 1, z: 2 }[wall.axis as 'x' | 'y' | 'z']];
    if (offset !== child.userData.offset) {
      child.geometry.dispose();
      child.geometry = boundaryGeometry(view.scene.source.construction.primitives, wall.axis, offset);
      child.userData.offset = offset;
    }
    // Only the normal offset moves a boundary, including in mixed selections.
    child.position.set(-delta[0], -delta[1], -delta[2]);
  }
}
