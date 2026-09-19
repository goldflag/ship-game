import * as THREE from 'three';
import { isAccessKind } from '../../../../assets/parts/construction/access_geometry';
import { createConstructionPathModel } from '../../../game/constructionPathModel';
import type { ConstructionEquipment, ConstructionSurface, Vec3 } from '../../../ships/blueprint';
import { surfaceSelectionKey } from '../../../ships/constructionEditor';
import type { BuilderPick, BuilderScene } from '../builderScene';
import { pathAnchor, pathEquipment } from '../pathDrawing';
import { DEFAULT_SNAPPING, SHIP_AXES, type SnapFeature } from '../snapping';
import { BRASS_LIGHT } from './resources';

type PathDraft = NonNullable<BuilderScene['pathDraft']>;

/** The route point under the pointer, and the support axis when smart alignment placed it. */
export function pathPoint(
  scene: BuilderScene,
  pick: (targets: BuilderScene['pickTargets']) => BuilderPick | undefined,
  snap: (context: string, raw: Vec3, grid: Vec3, directions: Vec3[], moving: SnapFeature[]) => Vec3,
): { point?: Vec3; axis?: number } {
  const draft = scene.pathDraft;
  if (!draft) return {};
  const hit = pick(
    draft.part.path?.kind === 'railing' || draft.part.path?.kind === 'ladder' || isAccessKind(draft.part.path?.kind) ? 'hull' : 'all',
  );
  if (!hit) return {};
  if (
    draft.part.path?.kind === 'ladder' &&
    (!hit.surface || !scene.result?.surfaces.some((s) => surfaceSelectionKey(s) === hit.surface && !s.open))
  )
    return {};
  const settings = scene.snapping ?? DEFAULT_SNAPPING;
  const raw = pathAnchor(draft.part, scene.source, scene.catalog, hit, null);
  const grid = pathAnchor(
    draft.part,
    scene.source,
    scene.catalog,
    hit,
    settings.enabled && settings.grid ? scene.gridStep : null,
  );
  if (!raw || !grid || scene.source.construction.equipment.some((p) => p.id === hit.id)) return { point: grid };
  const point = snap(
    'path',
    raw,
    grid,
    SHIP_AXES.filter((_, k) => k !== hit.axis),
    [
      { id: 'path:center', owner: 'path', point: [0, 0, 0], kind: 'center' },
      { id: 'path:corner', owner: 'path', point: [0, 0, 0], kind: 'corner' },
    ],
  );
  const normal = hit.normal ?? [0, 1, 0];
  point[hit.axis] -= point.reduce((sum, v, k) => sum + (v - raw[k]) * normal[k], 0) / normal[hit.axis];
  return { point, axis: hit.axis };
}

/** The pending route as its finished model (mirrored when the draft is), with a brass marker on every point. */
export function fillPathPreview(group: THREE.Group, draft: PathDraft, points: Vec3[], surfaces: ConstructionSurface[]) {
  if (points.length > 1 && (draft.part.path?.kind === 'ladder' || isAccessKind(draft.part.path?.kind))) {
    const item = pathEquipment('preview', draft.part.id, points, 0, draft.bearingDeg);
    const add = (item: ConstructionEquipment) => {
      const model = createConstructionPathModel(draft.part, item.path, true, { item, surfaces: surfaces });
      model.position.fromArray(item.position);
      model.rotation.y = (-item.bearingDeg * Math.PI) / 180;
      group.add(model);
    };
    add(item);
    if (draft.mirror)
      add({
        ...item,
        position: [-item.position[0], item.position[1], item.position[2]],
        bearingDeg: -item.bearingDeg,
        path: { points: item.path!.points.map((p) => [-p[0], p[1], p[2]]) },
      });
  } else if (points.length > 1) {
    group.add(
      createConstructionPathModel(draft.part, { points, slackM: draft.slackM, heightM: draft.heightM, railCount: draft.railCount }, true),
    );
    if (draft.mirror && points.some((p) => Math.abs(p[0]) > 1e-6))
      group.add(
        createConstructionPathModel(
          draft.part,
          { points: points.map((p) => [-p[0], p[1], p[2]]), slackM: draft.slackM, heightM: draft.heightM, railCount: draft.railCount },
          true,
        ),
      );
  }
  const geometry = new THREE.SphereGeometry(0.075, 8, 6),
    material = new THREE.MeshBasicMaterial({ color: BRASS_LIGHT, depthTest: false });
  for (const p of points) {
    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(...p);
    marker.renderOrder = 30;
    group.add(marker);
  }
}
