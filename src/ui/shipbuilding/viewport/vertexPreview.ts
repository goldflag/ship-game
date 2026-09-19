import * as THREE from 'three';
import type { ConstructionPrimitive, ConstructionSource } from '../../../ships/blueprint';
import { constructionPaintColor, constructionShipPaint } from '../../../ships/constructionPaints';
import { primitiveGeometry, primitiveOutlineGeometry, primitiveRotation } from '../primitiveGeometry';
import { BRASS_LIGHT, MINT } from './resources';

/** Every block redrawn from source with `map`'s replacements: brass edges on the shaped blocks, mint on their twins. */
export function fillVertexPreview(group: THREE.Group, source: ConstructionSource, map: Map<string, ConstructionPrimitive>, shaped: Set<string>) {
  for (const original of source.construction.primitives) {
    const p = map.get(original.id) ?? original;
    const geometry = primitiveGeometry(p.kind, p.size, p.vertices, p.customHull, p.shaping, p.balcony, p.mesh);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: constructionPaintColor(constructionShipPaint(source)),
        roughness: 0.78,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(...p.position);
    mesh.rotation.copy(primitiveRotation(p));
    group.add(mesh);
    mesh.material.polygonOffset = true;
    mesh.material.polygonOffsetFactor = 1;
    mesh.material.polygonOffsetUnits = 1;
    const edges = new THREE.LineSegments(
      primitiveOutlineGeometry(p),
      new THREE.LineBasicMaterial({ color: shaped.has(p.id) ? BRASS_LIGHT : map.has(p.id) ? MINT : '#142a31', depthWrite: false }),
    );
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    group.add(edges);
  }
}
