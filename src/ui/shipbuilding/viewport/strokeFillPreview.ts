import * as THREE from 'three';
import type { ConstructionSurface, Vec3 } from '../../../ships/blueprint';
import { createConstructionWallModel } from '../../../game/constructionWallModel';
import { seatWallFitting, wallRow } from '../../../ships/constructionWallFittings';
import type { BuilderPick, BuilderPlacement, BuilderScene } from '../builderScene';
import type { EquipmentPreview } from '../equipmentPreview';
import { pieceExtents } from '../placement';
import { surfaceOutline } from '../surfaceOutline';
import { BRASS, BRASS_LIGHT } from './resources';

/** Stretch the unit fill box over the lattice from the drag's start to its current end. */
export function placeFillPreview(fillPreview: THREE.LineSegments, start: Vec3, end: Vec3, piece: BuilderPlacement) {
  const extents = pieceExtents(piece);
  const low = start.map((value, index) => Math.min(value, end[index]) - extents[index] / 2),
    high = start.map((value, index) => Math.max(value, end[index]) + extents[index] / 2);
  fillPreview.visible = true;
  fillPreview.position.set((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2);
  fillPreview.scale.set(Math.max(0.01, high[0] - low[0]), Math.max(0.01, high[1] - low[1]), Math.max(0.01, high[2] - low[2]));
}

/** A window row from its placed first end to the pointer, while both lie on the same wall. */
export function rowPoints(start: BuilderPick, hit: BuilderPick | undefined, spacing: number): Vec3[] {
  if (
    !hit ||
    start.bearingDeg === undefined ||
    hit.bearingDeg === undefined ||
    Math.cos(((start.bearingDeg - hit.bearingDeg) * Math.PI) / 180) < 0.7
  )
    return [start.placement];
  return wallRow(start.placement, hit.placement, start.bearingDeg, spacing);
}

export interface StrokeView {
  group: THREE.Group;
  scene: BuilderScene;
  equipment: EquipmentPreview;
  ghost: THREE.Group;
  ghostMirror: THREE.Group;
}

/** One preview per pending point. Hull pieces and free fittings clone the cursor ghost and borrow its resources; wall fittings are seated afresh. */
export function fillStrokePreview(view: StrokeView, points: Vec3[], piece: BuilderPlacement | undefined, startBearing: number | undefined) {
  for (const point of points) {
    if (piece?.kind === 'equipment' && piece.wall) {
      const part = view.scene.catalog.equipment.find((p) => p.id === piece.partId),
        surfaces = view.scene.current?.surfaces ?? [];
      if (!part) continue;
      const item = seatWallFitting(
        {
          id: 'row-preview',
          partId: part.id,
          position: point,
          bearingDeg: startBearing ?? piece.bearingDeg,
          wall: piece.wall,
        },
        part,
        surfaces,
      );
      for (const fitting of view.scene.placementMirror
        ? [item, { ...item, position: [-item.position[0], item.position[1], item.position[2]] as Vec3, bearingDeg: -item.bearingDeg }]
        : [item]) {
        const template = view.equipment.clone(part.id, true);
        if (!template) continue;
        const model = createConstructionWallModel(template, part, fitting, surfaces, view.scene.source.construction.primitives);
        model.position.fromArray(fitting.position);
        model.rotation.y = (-fitting.bearingDeg * Math.PI) / 180;
        view.group.add(model);
      }
      continue;
    }
    const instance = view.ghost.clone(true);
    instance.traverse((n) => {
      n.userData.sharedPreviewResources = true;
    });
    instance.position.set(...point);
    instance.visible = true;
    instance.userData.placementPreview = false;
    view.group.add(instance);
    if (view.ghostMirror.visible && view.scene.placementMirror && Math.abs(point[0]) > 1e-6) {
      const twin = view.ghostMirror.clone(true);
      twin.traverse((n) => {
        n.userData.sharedPreviewResources = true;
      });
      twin.position.set(-point[0], point[1], point[2]);
      twin.visible = true;
      view.group.add(twin);
    }
  }
}

/** Brass over the faces a sweep has crossed, as the cursor piece's ghost is for laid pieces. */
export function fillFacesPreview(target: THREE.Group, faces: Iterable<string>, surfacesByKey: Map<string, ConstructionSurface[]>) {
  const fill: number[] = [],
    outline: THREE.Vector3[] = [];
  for (const face of faces) {
    const group = surfacesByKey.get(face);
    if (!group) continue;
    for (const surface of group)
      for (let i = 1; i < surface.vertices.length - 1; i++)
        for (const vertex of [surface.vertices[0], surface.vertices[i], surface.vertices[i + 1]])
          fill.push(...vertex.map((value, axis) => value + surface.normal[axis] * 0.02));
    for (const edge of surfaceOutline(group)) {
      const normal = new THREE.Vector3(...edge.surface.normal);
      outline.push(new THREE.Vector3(...edge.a).addScaledVector(normal, 0.03), new THREE.Vector3(...edge.b).addScaledVector(normal, 0.03));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(fill, 3));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
  );
  const edges = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(outline),
    new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false }),
  );
  mesh.renderOrder = 20;
  edges.renderOrder = 21;
  target.add(mesh, edges);
}
