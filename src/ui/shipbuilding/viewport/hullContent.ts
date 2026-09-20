import * as THREE from 'three';
import type { ConstructionSurface } from '../../../ships/blueprint';
import { armorThicknessColor } from '../../../ships/inspection';
import { surfaceSelectionKey } from '../../../ships/constructionEditor';
import { constructionHullBasePaint, paintedHullFace } from '../../../ships/constructionHullPaint';
import { constructionPaintColor, constructionShipPaint } from '../../../ships/constructionPaints';
import type { BuilderScene } from '../builderScene';
import { primitiveGeometry, primitiveRotation } from '../primitiveGeometry';
import { surfaceCreases } from '../surfaceOutline';
import { SALMON, fan } from './resources';

export interface HullContent {
  /** Hull fills and crease lines, in drawing order. */
  objects: THREE.Object3D[];
  /** The fills alone: the hull's pick targets. */
  meshes: THREE.Object3D[];
  /** The source surface of each drawn triangle of the combined hull mesh. */
  surfaceTriangles: ConstructionSurface[];
  /** The drawn faces by selection key: the hull's logical faces, for outlines and sweep previews. */
  surfacesByKey: Map<string, ConstructionSurface[]>;
}

/** The hull as drawn in the editor: native surfaces when a compile (or carried faces) exists, source primitives otherwise. */
export function buildHullContent(
  scene: BuilderScene,
  nativeSurfaces: ConstructionSurface[] | undefined,
  invalid: Set<string>,
): HullContent {
  const objects: THREE.Object3D[] = [],
    meshes: THREE.Object3D[] = [],
    surfaceTriangles: ConstructionSurface[] = [];
  const surfacesByKey = new Map<string, ConstructionSurface[]>();
  const vertices: number[] = [],
    colors: number[] = [];
  const armorGroups: { start: number; count: number; materialIndex: number }[] = [];
  const basePaint = constructionHullBasePaint(scene.source.construction);
  for (const surface of nativeSurfaces ?? []) {
    if (surface.open && scene.display === 'paint') continue;
    const color = new THREE.Color(
      invalid.has(surface.primitiveId)
        ? SALMON
        : scene.display === 'armor'
          ? armorThicknessColor(surface.thicknessMm, scene.armorScale)
          : constructionPaintColor(surface.paint),
    );
    const primitive = scene.source.construction.primitives.find((p) => p.id === surface.primitiveId);
    const painted =
      scene.display === 'armor'
        ? [{ vertices: surface.vertices, paint: surface.paint }]
        : paintedHullFace(surface, primitive, undefined, basePaint(surface));
    for (const face of painted) {
      fan(
        { ...surface, vertices: face.vertices },
        vertices,
        colors,
        scene.display === 'armor' || invalid.has(surface.primitiveId) ? color : new THREE.Color(constructionPaintColor(face.paint)),
      );
      for (let i = 1; i < face.vertices.length - 1; i++) surfaceTriangles.push(surface);
    }
    if (scene.display === 'armor') {
      const count = Math.max(0, surface.vertices.length - 2) * 3;
      const materialIndex = surface.open ? 1 : 0;
      const previous = armorGroups.at(-1);
      if (previous?.materialIndex === materialIndex) previous.count += count;
      else armorGroups.push({ start: vertices.length / 3 - count, count, materialIndex });
    }
    const selectionKey = surfaceSelectionKey(surface),
      group = surfacesByKey.get(selectionKey);
    if (group) group.push(surface);
    else surfacesByKey.set(selectionKey, [surface]);
  }
  if (nativeSurfaces) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    if (scene.display === 'armor') for (const group of armorGroups) geometry.addGroup(group.start, group.count, group.materialIndex);
    const mesh = new THREE.Mesh(
      geometry,
      scene.display === 'armor'
        ? [
            new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
            new THREE.MeshBasicMaterial({
              vertexColors: true,
              side: THREE.DoubleSide,
              transparent: true,
              opacity: 0.12,
              depthWrite: false,
            }),
          ]
        : new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.78,
            metalness: 0,
            side: THREE.DoubleSide,
            transparent: scene.display === 'internals',
            opacity: scene.display === 'internals' ? 0.15 : 1,
            depthWrite: scene.display !== 'internals',
          }),
    );
    // Bias only rasterized depth: edge positions must stay on the physical hull.
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = 1;
      material.polygonOffsetUnits = 1;
    }
    mesh.userData.hull = true;
    objects.push(mesh);
    meshes.push(mesh);
    // Draw physical creases across the combined exterior, not source-block seams.
    {
      const points: THREE.Vector3[] = [];
      for (const edge of surfaceCreases(nativeSurfaces.filter((surface) => !surface.open))) {
        if (edge.surface.open || (scene.display === 'armor' && edge.surface.material !== 'armor-steel')) continue;
        points.push(new THREE.Vector3(...edge.a), new THREE.Vector3(...edge.b));
      }
      if (points.length)
        objects.push(
          new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({
              color: '#142a31',
              transparent: true,
              opacity: scene.display === 'internals' ? 0.35 : 0.9,
              depthWrite: false,
            }),
          ),
        );
    }
  } else
    for (const primitive of scene.source.construction.primitives) {
      const mesh = new THREE.Mesh(
        primitiveGeometry(
          primitive.kind,
          primitive.size,
          primitive.vertices,
          primitive.customHull,
          primitive.shaping,
          primitive.balcony,
          primitive.mesh,
        ),
        new THREE.MeshStandardMaterial({
          color: invalid.has(primitive.id) ? SALMON : constructionPaintColor(constructionShipPaint(scene.source)),
          roughness: 0.78,
          side: THREE.DoubleSide,
          transparent: scene.display !== 'paint',
          opacity: scene.display !== 'paint' ? 0.12 : 1,
          depthWrite: scene.display === 'paint',
        }),
      );
      mesh.position.set(...primitive.position);
      mesh.rotation.copy(primitiveRotation(primitive));
      mesh.userData.sourceId = primitive.id;
      objects.push(mesh);
      meshes.push(mesh);
      mesh.material.polygonOffset = true;
      mesh.material.polygonOffsetFactor = 1;
      mesh.material.polygonOffsetUnits = 1;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 20),
        new THREE.LineBasicMaterial({
          color: '#142a31',
          transparent: true,
          opacity: scene.display === 'internals' ? 0.35 : 0.9,
          depthWrite: false,
        }),
      );
      edges.position.copy(mesh.position);
      edges.rotation.copy(mesh.rotation);
      objects.push(edges);
    }
  return { objects, meshes, surfaceTriangles, surfacesByKey };
}
