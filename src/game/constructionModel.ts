import { paintConstructionFitting } from './constructionFittingPaint';
import { paintedHullFace } from '../ships/constructionHullPaint';
import * as THREE from 'three/webgpu';
import { loadShipModel } from './loadShipModel';
import { createConstructionPathModel } from './constructionPathModel';
import { createConstructionPropellerSupports } from './constructionPropellerModel';
import type { ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSurface } from '../ships/blueprint';
import { constructionVertexNormals, SMOOTH_HULL_SHAPES } from './constructionShading';
import { constructionEquipmentModelUrl, loadConstructionCatalog, prefixComponentNodeId } from '../ships/constructionEquipment';
import { CONSTRUCTION_FINISH, constructionPaintColor } from '../ships/constructionPaints';

/** Render the native exterior exactly. Triangle attribution remains a reference
 * to source faces; triangulation and material batching never become source IDs. */
export function createConstructionHull(surfaces: readonly ConstructionSurface[], primitives: readonly ConstructionPrimitive[] = []): THREE.Group {
  const group = new THREE.Group(); group.name = 'Constructed hull';
  const smooth = new Map(primitives.filter(p => p.smoothGroup || (p.shaping?.style === 'round' && p.shaping.radius > 0 && p.shaping.edges.length > 0) || SMOOTH_HULL_SHAPES.has(p.kind)).map(p => [p.id, p.smoothGroup ? 'joined:' + p.smoothGroup : p.id]));
  const normalAt = constructionVertexNormals(surfaces.filter(s => !s.open && smooth.has(s.primitiveId)).map(s => ({ ...s, group: smooth.get(s.primitiveId)! })));
  const custom = new Set(primitives.filter(p => p.kind === 'custom-hull').map(p => p.id));
  const customGroup = (surface: ConstructionSurface) => surface.panelId ? `${surface.primitiveId}:${surface.panelId.split('@')[0]}` : surface.id;
  const customNormalAt = constructionVertexNormals(surfaces.filter(s => !s.open && custom.has(s.primitiveId)).map(s => ({ ...s, group: customGroup(s) })), -1);
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
  // Original metric timber finish: 16 cm planks, 3.4 m staggered butt joints.
  // Source paint selects the substrate explicitly; steel roofs keep their coating.
  let timber: THREE.DataTexture | undefined;
  const timberTexture = () => {
    if (timber) return timber;
    const size = 512, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const across = x / size * 8, along = y / size * 8;
      const plank = Math.floor(across / .16);
      const seam = across % .16 < .003 || (along + (plank % 4) * .85) % 3.4 < .003;
      const value = seam ? 135 : Math.round(239 + 5 * Math.sin(plank * 13.7) + 3 * Math.sin(across * 390 + Math.sin(along * 5)));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
    }
    timber = new THREE.DataTexture(data, size, size);
    timber.name = 'Original metric timber planking';
    timber.wrapS = timber.wrapT = THREE.RepeatWrapping;
    timber.magFilter = THREE.LinearFilter; timber.minFilter = THREE.LinearMipmapLinearFilter;
    timber.generateMipmaps = true; timber.needsUpdate = true;
    return timber;
  };
  const batches = new Map<string, { paint: string; deck: boolean; positions: number[]; normals: number[]; uv: number[]; faces: ConstructionSurface[] }>();
  const primitiveById = new Map(primitives.map(p => [p.id, p]));
  for (const surface of surfaces) {
    if (surface.open || surface.vertices.length < 3) continue;
    const normals = surface.vertices.map(point => custom.has(surface.primitiveId) ? customNormalAt(point, surface.normal, customGroup(surface)) : smooth.has(surface.primitiveId) ? normalAt(point, surface.normal, smooth.get(surface.primitiveId)!) : surface.normal);
    for (const painted of paintedHullFace(surface, primitiveById.get(surface.primitiveId), normals)) {
      const deck = surface.normal[1] > 0.7, key = `${painted.paint}:${deck}`;
      let batch = batches.get(key);
      if (!batch) batches.set(key, batch = { paint: painted.paint, deck, positions: [], normals: [], uv: [], faces: [] });
      const dominant = surface.normal.map(Math.abs).indexOf(Math.max(...surface.normal.map(Math.abs)));
      for (let i = 1; i < painted.vertices.length - 1; i++) {
        for (const index of [0, i, i + 1]) {
          const point = painted.vertices[index];
          batch.positions.push(...point); batch.normals.push(...painted.normals[index]);
          const a = dominant === 0 ? 2 : 0, b = dominant === 1 ? 2 : 1;
          batch.uv.push(point[a] / CONSTRUCTION_FINISH.tileMeters, point[b] / CONSTRUCTION_FINISH.tileMeters);
        }
        batch.faces.push(surface);
      }
    }
  }
  for (const [key, batch] of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uv, 2));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const wood = batch.paint === 'teak-natural';
    const material = new THREE.MeshStandardMaterial({ color: constructionPaintColor(batch.paint), map: wood ? timberTexture() : coating, roughness: batch.deck ? CONSTRUCTION_FINISH.deckRoughness : CONSTRUCTION_FINISH.steelRoughness, metalness: CONSTRUCTION_FINISH.metalness, side: THREE.DoubleSide });
    if (wood) material.userData = { deckSubstrate: 'timber', deckCoating: 'bare' };
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
        if (part.path) {
          const model = createConstructionPathModel(part, instance.path);
          paintConstructionFitting(model, instance.paint, false);
          model.position.fromArray(instance.position); model.rotation.y = -instance.bearingDeg * Math.PI / 180;
          model.traverse(node => { node.userData.sourceId = instance.id; node.userData.assemblyId = instance.id; node.userData.constructionEquipmentKind = part.kind; });
          group.add(model); continue;
        }
        let template = templates.get(part.id);
        if (!template) {
          const asset = await loadShipModel(constructionEquipmentModelUrl(part), undefined, part.contentHash, signal);
          template = asset.scene; templates.set(part.id, template); abort(signal);
          if (template.userData.definitionHash !== part.contentHash) throw new Error(`Equipment identity mismatch: ${part.name}.`);
        }
        const model = template.clone(true);
        paintConstructionFitting(model, instance.paint);
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
    group.updateMatrixWorld(true);
    const supports = createConstructionPropellerSupports(result.propellerSupports);
    for (const assembly of [...supports.children]) {
      const id = assembly.userData.assemblyId;
      const installation = group.getObjectByName(id);
      if (installation) installation.attach(assembly);
      else group.add(assembly);
    }
    // A wholly painted component may leave its template's original materials unused.
    // Release those materials only; their textures and geometry are still borrowed.
    const used = new Set<THREE.Material>();
    group.traverse(node => { if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) used.add(material); });
    const unused = new Set<THREE.Material>();
    for (const template of templates.values()) template.traverse(node => { if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (!used.has(material)) unused.add(material); });
    unused.forEach(material => material.dispose());
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
    if (!(node instanceof THREE.Mesh) && !(node instanceof THREE.Line)) return;
    if (node instanceof THREE.InstancedMesh) node.dispose();
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
  group.removeFromParent(); group.clear();
}
