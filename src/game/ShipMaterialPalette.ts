import * as THREE from 'three/webgpu';
import { attribute, materialColor, materialMetalness, materialRoughness } from 'three/tsl';

/** Per-vertex roughness and metalness, and the hull's rest wet-band height in metres. */
const surface = attribute<'vec3'>('shipSurface', 'vec3');
const roughness = materialRoughness.mul(surface.x), metalness = materialMetalness.mul(surface.y);
/** Rest height of a hull's wet band above the sea, in metres, by hull length; the sea state adds to it. */
export const wetBandHeight = (length: number) => Math.max(.3, Math.min(.9, .2 + .0025 * length));
/** Visual-only multipliers every shared paint receives, such as the wet band at the waterline. */
export interface PaintWeathering { dry: THREE.Node<'float'>; gloss: THREE.Node<'float'> }

/** Encode constant paint in derived vertex colors so otherwise identical PBR
 * materials can share draws, including across different ship definitions. */
export class ShipMaterialPalette {
  private readonly materials = new Map<string, THREE.MeshStandardNodeMaterial>();
  /** Shared by every material, so weathering adds no node graph per paint. */
  private weathered?: { color: THREE.Node<'vec3'>; roughness: THREE.Node<'float'> };
  /** One serialization scratchpad for every material: three caches images and textures
   * inside it, so a texture is described once instead of once per material. */
  private readonly meta = { textures: {}, images: {}, geometries: {}, materials: {}, shapes: {}, skeletons: {}, animations: {}, nodes: {} } as Parameters<THREE.Material['toJSON']>[0] & { images: Record<string, { uuid: string; url: string }> };

  /** Distinguishing key for a paintable material. Only the image UUID reaches the key, so
   * seed the image cache first: left to itself three re-encodes every texture to a base64
   * PNG through a 2D canvas, which costs seconds per fleet and is discarded immediately. */
  private materialKey(material: THREE.MeshStandardMaterial): string {
    for (const value of Object.values(material)) {
      const source = (value as THREE.Texture | null)?.isTexture ? (value as THREE.Texture).source : undefined;
      if (source) this.meta.images[source.uuid] ??= { uuid: source.uuid, url: '' };
    }
    const { metadata: _metadata, uuid: _uuid, name: _name, color: _color, roughness: _roughness, metalness: _metalness, userData: _userData, ...data } = material.toJSON(this.meta);
    return JSON.stringify(data);
  }

  /** The shared paint outlives the hulls that used it; a palette kept across fleets must
   * keep its materials out of the disposal sweep or the next reuse hands back a dead one. */
  sharedMaterials(): Iterable<THREE.Material> { return this.materials.values(); }

  /** Ship views clone the shared paint, so weathering is fixed before the first hull is painted. */
  constructor(weathering?: PaintWeathering) {
    if (weathering) this.weathered = { color: materialColor.mul(weathering.dry), roughness: roughness.mul(weathering.gloss) };
  }

  private finish(material: THREE.MeshStandardNodeMaterial): void {
    material.colorNode = this.weathered?.color ?? null;
    material.roughnessNode = this.weathered?.roughness ?? roughness;
    material.metalnessNode = metalness;
  }

  apply(root: THREE.Object3D): void {
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    const band = wetBandHeight(Math.max(size.x, size.z) || 0);
    const derived = new Map<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();
    const retiredGeometry = new Set<THREE.BufferGeometry>(), retiredMaterials = new Set<THREE.Material>();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      const material = object.material;
      if (!(material instanceof THREE.MeshStandardMaterial) || material.type !== 'MeshStandardMaterial' ||
        material.transparent || material.vertexColors || material.clippingPlanes || object.morphTargetInfluences?.length ||
        material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ||
        material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) return;
      const key = this.materialKey(material);
      let shared = this.materials.get(key);
      if (!shared) {
        shared = new THREE.MeshStandardNodeMaterial().copy(material as unknown as THREE.MeshStandardNodeMaterial);
        shared.color.setRGB(1, 1, 1); shared.vertexColors = true;
        shared.roughness = 1; shared.metalness = 1;
        this.finish(shared);
        shared.name = 'Shared naval paint'; this.materials.set(key, shared);
      }
      const source = object.geometry, colorKey = [...material.color.toArray(), material.roughness, material.metalness].join(',');
      let colors = derived.get(source);
      if (!colors) derived.set(source, colors = new Map());
      let geometry = colors.get(colorKey);
      if (!geometry) {
        const colored: THREE.BufferGeometry = source.clone();
        const color = new Float32Array(source.getAttribute('position').count * 3);
        const surface = new Float32Array(source.getAttribute('position').count * 3);
        const { r, g, b } = material.color;
        for (let i = 0; i < color.length; i += 3) { color[i] = r; color[i + 1] = g; color[i + 2] = b; }
        for (let i = 0; i < surface.length; i += 3) { surface[i] = material.roughness; surface[i + 1] = material.metalness; surface[i + 2] = band; }
        colored.setAttribute('color', new THREE.BufferAttribute(color, 3));
        colored.setAttribute('shipSurface', new THREE.BufferAttribute(surface, 3));
        colors.set(colorKey, colored); geometry = colored;
      }
      object.geometry = geometry; object.material = shared;
      retiredGeometry.add(source); retiredMaterials.add(material);
    });
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      retiredGeometry.delete(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) retiredMaterials.delete(material);
    });
    retiredGeometry.forEach(geometry => geometry.dispose());
    retiredMaterials.forEach(material => material.dispose());
  }
}
