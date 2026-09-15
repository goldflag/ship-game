import * as THREE from 'three/webgpu';
import { loadShipModel } from './loadShipModel';
import type { ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSurface } from '../ships/blueprint';
import { constructionVertexNormals, SMOOTH_HULL_SHAPES } from './constructionShading';
import { constructionEquipmentModelUrl, loadConstructionCatalog, prefixComponentNodeId } from '../ships/constructionEquipment';
import { CONSTRUCTION_FINISH, constructionPaintColor } from '../ships/constructionPaints';

/** Render the native exterior exactly. Triangle attribution remains a reference
 * to source faces; triangulation and material batching never become source IDs. */
export function createConstructionHull(surfaces: readonly ConstructionSurface[], primitives: readonly ConstructionPrimitive[] = []): THREE.Group {
  const group = new THREE.Group(); group.name = 'Constructed hull';
  const smooth = new Set(primitives.filter(p => SMOOTH_HULL_SHAPES.has(p.kind)).map(p => p.id));
  const normalAt = constructionVertexNormals(surfaces.filter(s => !s.open && smooth.has(s.primitiveId)).map(s => ({ ...s, group: s.primitiveId })));
  const textureSize = 128, pixels = new Uint8Array(textureSize * textureSize * 4);
  // Subtle repeatable coating grain. UVs remain in ship coordinates, so adjacent
  // primitives have neither a paint reset nor a visible block boundary.
  for (let y = 0; y < textureSize; y++) for (let x = 0; x < textureSize; x++) {
    const wave = Math.sin(x * 2 * Math.PI / textureSize * 7) * Math.cos(y * 2 * Math.PI / textureSize * 11);
    const value = Math.round(255 * (1 - CONSTRUCTION_FINISH.grain * (1 + wave)));
    const i = 4 * (y * textureSize + x); pixels[i] = pixels[i + 1] = pixels[i + 2] = value; pixels[i + 3] = 255;
  }
  const coating = new THREE.DataTexture(pixels, textureSize, textureSize);
  coating.name = 'Shared metric naval coating'; coating.wrapS = coating.wrapT = THREE.RepeatWrapping;
  coating.magFilter = THREE.LinearFilter; coating.minFilter = THREE.LinearMipmapLinearFilter; coating.generateMipmaps = true; coating.needsUpdate = true;
  const batches = new Map<string, { paint: string; deck: boolean; positions: number[]; normals: number[]; uv: number[]; faces: ConstructionSurface[] }>();
  for (const surface of surfaces) {
    if (surface.open || surface.vertices.length < 3) continue;
    const deck = surface.normal[1] > 0.7, key = `${surface.paint}:${deck}`;
    let batch = batches.get(key);
    if (!batch) batches.set(key, batch = { paint: surface.paint, deck, positions: [], normals: [], uv: [], faces: [] });
    const dominant = surface.normal.map(Math.abs).indexOf(Math.max(...surface.normal.map(Math.abs)));
    for (let i = 1; i < surface.vertices.length - 1; i++) {
      for (const point of [surface.vertices[0], surface.vertices[i], surface.vertices[i + 1]]) {
        batch.positions.push(...point); batch.normals.push(...(smooth.has(surface.primitiveId) ? normalAt(point, surface.normal, surface.primitiveId) : surface.normal));
        const a = dominant === 0 ? 2 : 0, b = dominant === 1 ? 2 : 1;
        batch.uv.push(point[a] / CONSTRUCTION_FINISH.tileMeters, point[b] / CONSTRUCTION_FINISH.tileMeters);
      }
      batch.faces.push(surface);
    }
  }
  for (const [key, batch] of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uv, 2));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color: constructionPaintColor(batch.paint), map: coating, roughness: batch.deck ? CONSTRUCTION_FINISH.deckRoughness : CONSTRUCTION_FINISH.steelRoughness, metalness: CONSTRUCTION_FINISH.metalness, side: THREE.DoubleSide });
    material.name = `construction.${key}`;
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `hull.${key}`;
    mesh.userData = { assemblyId: 'hull', nodeId: mesh.name, constructionSurfaces: batch.faces };
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }
  if (!batches.size) coating.dispose();
  return group;
}

function abort(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('Model assembly cancelled.', 'AbortError'); }

/** Production composition shared by preview and battle. No Blender/dev viewer
 * dependency. Each instance retains its own pivots and immutable asset identity. */
export async function createConstructionModel(source: ConstructionSource, result: ConstructionResult, signal?: AbortSignal): Promise<THREE.Group> {
  if (source.id !== result.sourceId || source.revision !== result.revision) throw new Error('Model and design revisions do not match.');
  abort(signal);
  const group = createConstructionHull(result.surfaces, source.construction.primitives);
  group.name = source.name;
  group.userData.definitionHash = result.contentHash;
  group.userData.constructionRevision = source.revision;
  const templates = new Map<string, THREE.Group>();
  try {
    if (source.construction.equipment.length) {
      const catalog = await loadConstructionCatalog(source.construction.catalogRevision); abort(signal);
      for (const instance of source.construction.equipment) {
        abort(signal);
        const part = catalog.equipment.find(p => p.id === instance.partId);
        if (!part) throw new Error(`Equipment unavailable: ${instance.partId}. The source design is preserved.`);
        let template = templates.get(part.id);
        if (!template) {
          const asset = await loadShipModel(constructionEquipmentModelUrl(part), undefined, part.contentHash, signal);
          template = asset.scene; templates.set(part.id, template); abort(signal);
          if (template.userData.definitionHash !== part.contentHash) throw new Error(`Equipment identity mismatch: ${part.name}.`);
        }
        const model = template.clone(true);
        const installation = new THREE.Group(); installation.name = instance.id;
        installation.position.fromArray(instance.position); installation.rotation.y = -instance.bearingDeg * Math.PI / 180;
        installation.userData = { sourceId: instance.id, assemblyId: instance.id, equipmentKind: part.kind };
        model.traverse(node => {
          node.userData.sourceId = instance.id;
          node.userData.constructionEquipmentKind = part.kind;
          for (const key of ['nodeId', 'gunCoverElevationId'] as const) if (node.userData[key]) node.userData[key] = prefixComponentNodeId(instance.id, node.userData[key]);
          if (node.userData.assemblyId) node.userData.assemblyId = node.userData.assemblyId === 'component' ? instance.id : prefixComponentNodeId(instance.id, node.userData.assemblyId);
          if (node.name.startsWith('component.')) node.name = prefixComponentNodeId(instance.id, node.name);
          if (node.userData.nodeId === `${instance.id}.yaw`) node.userData.constructionBearingDeg = instance.bearingDeg;
        });
        installation.add(model); group.add(installation);
      }
    }
    group.updateMatrixWorld(true); return group;
  } catch (error) {
    // Include templates that failed before their first instance was installed.
    for (const template of templates.values()) group.add(template);
    disposeConstructionModel(group); throw error;
  }
}

export function disposeConstructionModel(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  group.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
  group.removeFromParent(); group.clear();
}
