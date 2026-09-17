import * as THREE from 'three';
import type { ConstructionSource, ConstructionSurface, ShipDefinition } from '../../ships/blueprint';
import { runtimeProjection } from '../../ships/runtimeProjection';
import { encodeRuntimeDefinition } from '../../ships/runtimeEncoding';

export const SHARED_MODEL = '$shared';
export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const modelMB = (bytes: number) => bytes > 0 && bytes < 1000 ? '<0.001' : (bytes / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** Attribute only explicitly identified records. Anonymous collision cells and
 * ship-wide data stay shared rather than inventing a per-part allocation. */
export function simulationMemory(definition: ShipDefinition, ids: string[]) {
  const projected = JSON.parse(JSON.stringify(runtimeProjection(definition)));
  const owners = [...ids].sort((a, b) => b.length - a.length);
  const parts: Record<string, number> = Object.create(null);
  const ownerOf = (record: Record<string, unknown>) => {
    for (const key of ['primitiveId', 'equipmentId', 'sourceId', 'mountId', 'moduleId', 'id']) {
      const value = record[key];
      if (typeof value !== 'string') continue;
      const id = owners.find(id => value === id || value.startsWith(id + '.') || value.startsWith(id + '-') || value.startsWith('equipment:' + id + ':') || value === 'equipment:' + id);
      if (id) return id;
    }
  };
  const add = (id: string, bytes: number) => { parts[id] = (parts[id] ?? 0) + bytes; };
  function visit(value: unknown, owner = SHARED_MODEL) {
    if (!value || typeof value !== 'object') { add(owner, jsonBytes(value)); return; }
    if (Array.isArray(value)) {
      add(owner, 2 + Math.max(0, value.length - 1));
      value.forEach(item => visit(item, owner)); return;
    }
    const record = value as Record<string, unknown>, entries = Object.entries(record);
    owner = ownerOf(record) ?? owner;
    add(owner, 2 + Math.max(0, entries.length - 1));
    for (const [key, item] of entries) { add(owner, jsonBytes(key) + 1); visit(item, owner); }
  }
  visit(projected);
  return {
    json: jsonBytes(projected), encoded: encodeRuntimeDefinition(projected).byteLength, parts,
    sections: Object.entries(projected).map(([name, value]) => ({ name, bytes: jsonBytes(value) })).sort((a, b) => b.bytes - a.bytes),
  };
}

export interface VisualPartMemory { geometry: number; textures: number; triangles: number; meshes: number }
export interface VisualMemory {
  geometry: number; textures: number; triangles: number; meshes: number; materials: number;
  parts: Record<string, VisualPartMemory>; missing: string[]; hullReady: boolean;
  sourceId: string; revision: string;
}
type Resource = { bytes: number; owners: Map<string, number> };
const emptyPart = (): VisualPartMemory => ({ geometry: 0, textures: 0, triangles: 0, meshes: 0 });

/** Retained geometry buffers (one copy) plus an RGBA8 texture allocation estimate.
 * Shared resources are counted once and split among their referencing parts. */
export function visualMemory(roots: THREE.Object3D[], source: ConstructionSource, hullReady: boolean): VisualMemory {
  const parts: Record<string, VisualPartMemory> = Object.create(null), buffers = new Map<object, Resource>(), textures = new Map<object, Resource>();
  const materials = new Set<THREE.Material>(), seen = new Set<THREE.Object3D>(), loaded = new Set<string>();
  const ids = new Set([...source.construction.primitives, ...source.construction.equipment].map(p => p.id));
  const part = (id: string) => parts[id] ??= emptyPart();
  const register = (map: Map<object, Resource>, key: object, bytes: number, weights: Map<string, number>) => {
    let resource = map.get(key);
    if (!resource) map.set(key, resource = { bytes, owners: new Map() });
    for (const [id, weight] of weights) resource.owners.set(id, (resource.owners.get(id) ?? 0) + weight);
  };
  for (const root of roots) root.traverse(node => {
    if (seen.has(node)) return; seen.add(node);
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    let id: string | undefined;
    for (let parent: THREE.Object3D | null = node; parent && !id; parent = parent.parent) {
      if (ids.has(parent.userData.sourceId)) id = parent.userData.sourceId;
    }
    const surfaces = mesh.userData.constructionSurfaces as ConstructionSurface[] | undefined;
    const weights = new Map<string, number>();
    const triangles = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0) / 3 * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1);
    if (surfaces?.length) for (const surface of surfaces) {
      const sourceId = surface.primitiveId.startsWith('equipment:') ? surface.primitiveId.slice('equipment:'.length) : surface.primitiveId;
      const owner = ids.has(sourceId) ? sourceId : SHARED_MODEL;
      weights.set(owner, (weights.get(owner) ?? 0) + 1 / surfaces.length);
    }
    else weights.set(id ?? SHARED_MODEL, 1);
    for (const [owner, weight] of weights) {
      const row = part(owner); row.triangles += triangles * weight; row.meshes += weight; loaded.add(owner);
    }
    const meshBuffers = new Set<object>(), meshTextures = new Set<object>();
    const attribute = (value: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
      const array = 'isInterleavedBufferAttribute' in value ? value.data.array : value.array;
      if (!meshBuffers.has(array.buffer)) register(buffers, array.buffer, array.buffer.byteLength, weights);
      meshBuffers.add(array.buffer);
    };
    Object.values(mesh.geometry.attributes).forEach(attribute);
    Object.values(mesh.geometry.morphAttributes).forEach(values => values?.forEach(attribute));
    if (mesh.geometry.index) attribute(mesh.geometry.index);
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      attribute((mesh as THREE.InstancedMesh).instanceMatrix);
      const color = (mesh as THREE.InstancedMesh).instanceColor; if (color) attribute(color);
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) {
        const texture = value as THREE.Texture;
        const image = texture.image as { width?: number; height?: number } | undefined;
        let width = image?.width ?? 0, height = image?.height ?? 0, bytes = width * height * 4;
        if (texture.generateMipmaps) while (width > 1 || height > 1) {
          width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2)); bytes += width * height * 4;
        }
        if (!meshTextures.has(texture)) register(textures, texture, bytes, weights);
        meshTextures.add(texture);
      }
    }
  });
  const allocate = (map: Map<object, Resource>, key: 'geometry' | 'textures') => {
    let total = 0;
    for (const resource of map.values()) {
      total += resource.bytes;
      const weight = [...resource.owners.values()].reduce((a, b) => a + b, 0);
      for (const [id, share] of resource.owners) part(id)[key] += resource.bytes * share / weight;
    }
    return total;
  };
  const geometry = allocate(buffers, 'geometry'), textureBytes = allocate(textures, 'textures');
  return { geometry, textures: textureBytes, triangles: Object.values(parts).reduce((n, p) => n + p.triangles, 0), meshes: seen.size ? Object.values(parts).reduce((n, p) => n + p.meshes, 0) : 0,
    materials: materials.size, parts, missing: source.construction.equipment.filter(p => !loaded.has(p.id)).map(p => p.id), hullReady,
    sourceId: source.id, revision: source.revision };
}
