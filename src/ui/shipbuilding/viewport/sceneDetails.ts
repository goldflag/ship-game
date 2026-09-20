import * as THREE from 'three';
import type { ConstructionSurface } from '../../../ships/blueprint';
import { surfaceSelectionKey } from '../../../ships/constructionEditor';
import { equipmentPathBounds } from '../../../ships/constructionPaths';
import { installedWallPart } from '../../../ships/constructionWallFittings';
import { boundaryGeometry } from '../boundaryGeometry';
import type { BuilderScene } from '../builderScene';
import type { EquipmentPreview } from '../equipmentPreview';
import { itemOutlineGeometry } from '../itemOutline';
import { primitiveOutlineGeometry, primitiveRotation } from '../primitiveGeometry';
import { surfaceOutline } from '../surfaceOutline';
import { BRASS, BRASS_LIGHT, MINT, READY, SALMON, arcMesh, centerTag } from './resources';

export interface DetailView {
  scene: BuilderScene;
  invalid: Set<string>;
  nativeSurfaces?: ConstructionSurface[];
  hull: THREE.Group;
  details: THREE.Group;
  selection: THREE.Group;
  equipment: EquipmentPreview;
  /** Receives the pick proxies, magazines and visible walls. */
  pickMeshes: THREE.Object3D[];
  /** Receives the deck planes: floors an internal package can land on. */
  deckMeshes: THREE.Object3D[];
  surfacesByKey: Map<string, ConstructionSurface[]>;
  span: number;
}

/** Pick proxies, magazines, walls and center markers into `details`; selection and twin outlines into `selection`. */
export function fillDetails(view: DetailView) {
  const { scene, invalid, nativeSurfaces } = view;
  if (!nativeSurfaces)
    for (const object of view.hull.children) {
      const mesh = object as THREE.Mesh;
      if (!scene.selected.has(mesh.userData.sourceId)) continue;
      const primitive = scene.source.construction.primitives.find((p) => p.id === mesh.userData.sourceId);
      const edges = new THREE.LineSegments(
        primitive ? primitiveOutlineGeometry(primitive) : new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false }),
      );
      edges.position.copy(mesh.position);
      edges.rotation.copy(mesh.rotation);
      view.selection.add(edges);
    }
  for (const part of scene.source.construction.equipment) {
    const entry = scene.catalog.equipment.find((entry) => entry.id === part.partId);
    if (!entry || view.equipment.has(part.id)) continue;
    const pathBounds = equipmentPathBounds(installedWallPart(entry, part), part);
    const box = new THREE.Mesh(new THREE.BoxGeometry(...pathBounds.size), new THREE.MeshBasicMaterial({ visible: false }));
    const datum = new THREE.Group();
    datum.position.set(...part.position);
    datum.rotation.y = (-part.bearingDeg * Math.PI) / 180;
    box.position.set(...pathBounds.center);
    box.userData.sourceId = part.id;
    datum.add(box);
    view.details.add(datum);
    view.pickMeshes.push(box); // Invisible pick proxy while the model loads.
  }
  if (scene.display === 'internals' && scene.source.construction.version === 2) {
    for (const module of scene.result?.definition?.modules ?? []) {
      if (module.kind !== 'magazine') continue;
      const owner = scene.source.construction.equipment.find((e) => module.id === `${e.id}-magazine`);
      if (!owner) continue;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(...module.size),
        new THREE.MeshBasicMaterial({
          color: scene.selected.has(owner.id) ? BRASS : SALMON,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
      );
      box.position.set(...module.center);
      if (module.torpedoLauncherId) {
        const local = box.position.clone().sub(new THREE.Vector3(...owner.position));
        local.applyAxisAngle(new THREE.Vector3(0, 1, 0), (-owner.bearingDeg * Math.PI) / 180);
        box.position.copy(local.add(new THREE.Vector3(...owner.position)));
        box.rotation.y = (-owner.bearingDeg * Math.PI) / 180;
      }
      box.userData.sourceId = owner.id;
      view.details.add(box);
      view.pickMeshes.push(box);
    }
  }
  for (const wall of scene.source.construction.boundaries) {
    const geometry = boundaryGeometry(scene.source.construction.primitives, wall.axis, wall.offset);
    const plane = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: invalid.has(wall.id) ? SALMON : BRASS,
        transparent: true,
        opacity: invalid.has(wall.id) ? 0.5 : scene.selected.has(wall.id) ? 0.3 : 0.09,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    plane.userData.sourceId = wall.id;
    plane.visible = invalid.has(wall.id) || scene.display === 'internals' || scene.selected.has(wall.id);
    view.details.add(plane);
    if (plane.visible) view.pickMeshes.push(plane);
    if (wall.axis === 'y') {
      plane.userData.deckTopY = wall.offset + wall.thicknessMm / 2000;
      view.deckMeshes.push(plane);
    }
  }
  const outlinedHulls = new Set<string>();
  if (nativeSurfaces)
    for (const primitive of scene.source.construction.primitives) {
      if (primitive.kind !== 'custom-hull' || !scene.selected.has(primitive.id)) continue;
      outlinedHulls.add(primitive.id);
      const edges = new THREE.LineSegments(
        primitiveOutlineGeometry(primitive),
        new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false }),
      );
      edges.position.set(...primitive.position);
      edges.rotation.copy(primitiveRotation(primitive));
      view.selection.add(edges);
    }
  for (const group of view.surfacesByKey.values()) {
    const surface = group[0],
      chosen = scene.selectedSurfaces.has(surfaceSelectionKey(surface));
    const selected = chosen || (scene.selected.has(surface.primitiveId) && !outlinedHulls.has(surface.primitiveId));
    if (!selected) continue;
    const outline: THREE.Vector3[] = [],
      thickness: THREE.Vector3[] = [];
    for (const edge of surfaceOutline(group)) {
      const normal = new THREE.Vector3(...edge.surface.normal),
        a = new THREE.Vector3(...edge.a),
        b = new THREE.Vector3(...edge.b);
      outline.push(a, b);
      if (chosen && scene.display === 'armor' && !edge.surface.open) {
        const innerA = a.clone().addScaledVector(normal, -edge.surface.thicknessMm / 1000),
          innerB = b.clone().addScaledVector(normal, -edge.surface.thicknessMm / 1000);
        thickness.push(a, innerA, innerA, innerB);
      }
    }
    view.selection.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(outline),
        new THREE.LineBasicMaterial({ color: BRASS_LIGHT, depthTest: false }),
      ),
    );
    if (thickness.length)
      view.selection.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(thickness),
          new THREE.LineBasicMaterial({ color: READY, depthTest: false }),
        ),
      );
  }
  // Mirror editing: the twins that will follow the selection's edits wear mint, as mirrored freeform corners do.
  for (const id of scene.twins.values()) {
    const primitive = scene.source.construction.primitives.find((p) => p.id === id);
    const edges = new THREE.LineSegments(
      primitive ? primitiveOutlineGeometry(primitive) : itemOutlineGeometry(view.pickMeshes, id),
      new THREE.LineBasicMaterial({ color: MINT, depthTest: false }),
    );
    if (primitive) {
      edges.position.set(...primitive.position);
      edges.rotation.copy(primitiveRotation(primitive));
    }
    view.selection.add(edges);
  }
  const loading = scene.result?.loading;
  // Gravity is tagged above its dot and buoyancy below, so the tags stay apart when the centers nearly coincide.
  if (scene.showCenters && loading)
    for (const [point, color, text, side] of [
      [loading.centerOfGravity, BRASS, 'CG', 1],
      [loading.buoyancyCenter, READY, 'CB', -1],
    ] as const) {
      const radius = Math.max(0.1, view.span / 360);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      marker.position.set(...point);
      marker.renderOrder = 10;
      view.details.add(marker);
      const tag = centerTag(text, color),
        height = radius * 5;
      tag.position.set(point[0], point[1] + side * (radius + height * 0.55), point[2]);
      tag.scale.set(height * 2, height, 1);
      tag.renderOrder = 10;
      view.details.add(tag);
    }
}

export function fillArcs(group: THREE.Group, arcs: BuilderScene['arcs']) {
  for (const arc of arcs) {
    const mesh = arcMesh(arc);
    mesh.position.set(arc.position[0], arc.position[1] + 0.08, arc.position[2]);
    group.add(mesh);
  }
}

export function fillProposals(group: THREE.Group, proposed: BuilderScene['proposed']) {
  for (const item of proposed) {
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(...item.size)),
      new THREE.LineDashedMaterial({ color: MINT, dashSize: 0.6, gapSize: 0.3, depthTest: false }),
    );
    box.computeLineDistances();
    box.position.set(...item.boundsCenter);
    const datum = new THREE.Group();
    datum.position.set(...item.position);
    datum.rotation.y = (-item.bearingDeg * Math.PI) / 180;
    datum.add(box);
    group.add(datum);
  }
}
