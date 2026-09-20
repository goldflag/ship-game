import { blockAngles } from '../../ships/constructionOrientation';
import { meshFaces } from '../../ships/constructionMesh';
import { shapedFaces } from '../../ships/freeformShape';
import { balconyFaces } from '../../ships/constructionBalcony';
import * as THREE from 'three';
import { cornerVertices, VERTEX_FACES } from '../../ships/constructionVertex';
import type { ConstructionEquipmentPart, ConstructionPrimitive, Vec3 } from '../../ships/blueprint';
import { CONSTRUCTION_SHAPES } from '../../ships/constructionShapes';
import { constructionVertexNormals, SMOOTH_HULL_SHAPES } from '../../game/constructionShading';
import { customHullFaces, customHullPoints, customHullPrimitive, makeHull } from '../../ships/customHullModel';

export { primitiveGeometry, primitiveRotation } from '../../game/constructionShapeGeometry';
import { primitiveGeometry, primitiveRotation } from '../../game/constructionShapeGeometry';
export type { BuilderPlacement } from './builderScene';
import type { BuilderPlacement } from './builderScene';

/** Hull and equipment ghosts; internal planes use hull-clipped boundaryGeometry. */
export function placementGeometry(piece: Exclude<BuilderPlacement, { kind: 'boundary' }>): THREE.BufferGeometry {
  if (piece.kind === 'hull') return primitiveGeometry(piece.shape, piece.size);
  return new THREE.BoxGeometry(...piece.size).translate(...piece.boundsCenter);
}

export function placementRotation(piece: BuilderPlacement): THREE.Euler {
  if (piece.kind === 'hull') return primitiveRotation(piece);
  return new THREE.Euler(0, (piece.kind === 'equipment' ? -piece.bearingDeg : 0) * Math.PI / 180, 0, 'YXZ');
}

/** Selection follows authored sections and chines, without tessellation diagonals. */
export function primitiveOutlineGeometry(p: ConstructionPrimitive): THREE.BufferGeometry {
  if (p.kind !== 'custom-hull' || !p.customHull) {
    const solid = primitiveGeometry(p.kind, p.size, p.vertices, p.customHull, p.shaping, p.balcony, p.mesh);
    const edges = new THREE.EdgesGeometry(solid, p.shaping ? 25 : 1); solid.dispose(); return edges;
  }
  const points = customHullPoints(p), n = p.customHull.stations[0].points.length, lines: number[] = [];
  for (let section = 0; section < p.customHull.stations.length; section++) {
    for (let edge = 0; edge < n; edge++) {
      lines.push(...points[section * n + edge], ...points[section * n + (edge + 1) % n]);
      if (section > 0) lines.push(...points[(section - 1) * n + edge], ...points[section * n + edge]);
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
}

/** Three adapter for the source YXZ orientation. */
