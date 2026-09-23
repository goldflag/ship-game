import * as THREE from 'three/webgpu';
import { attribute, materialColor, materialMetalness, materialRoughness, vec4 } from 'three/tsl';
import { applyShipSurfaceDetail, isPlatedPaint, isPlateSized, setShipSurfaceDetail, shipSurfaceMode } from './ShipSurfaceDetail';

/** The `shipSurface` vertex attribute. `apply` below is its only writer; every channel is taken:
 * - `x`: the source paint's roughness. Read here and by ShipSurfaceDetail (plate roughness).
 * - `y`: the source paint's metalness. Read here.
 * - `z`: plated paint, 1 or 0 (`isPlatedPaint` and `isPlateSized`, with surface detail on). Read by ShipSurfaceDetail
 *   for plating relief, plate roughness and the construction finish's seams and plate shades.
 * - `w`: the hull's rest wet-band height in metres (`wetBandHeight`). Read by HullWetBand.
 * A new per-vertex value needs its own attribute, as `shipWear` (written by constructionWear) did. */
const surface = attribute<'vec4'>('shipSurface', 'vec4');
const roughness = materialRoughness.mul(surface.x), metalness = materialMetalness.mul(surface.y);
/** Rest height of a hull's wet band above the sea, in metres, by hull length; the sea state adds to it. */
export const wetBandHeight = (length: number) => Math.max(.3, Math.min(.9, .2 + .0025 * length));
/** Visual-only multipliers every shared paint receives, such as the wet band at the waterline. */
export interface PaintWeathering { dry: THREE.Node<'float'>; gloss: THREE.Node<'float'> }

/** Encode constant paint in derived vertex colors so otherwise identical PBR
 * materials can share draws, including across different ship definitions. */
export class ShipMaterialPalette {
  /** `surfaceDetail` adds metric plating, paint roughness and teak detail (ships, not aircraft);
   * `weathering` darkens and glosses every paint, such as the wet band at the waterline. */
  constructor(private readonly options: { surfaceDetail?: boolean; weathering?: PaintWeathering } = {}) {}
  private readonly materials = new Map<string, THREE.MeshStandardNodeMaterial>();
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

  /** Switch surface detail under `root` and keep the weathering layered over it. */
  setSurfaceDetail(root: THREE.Object3D, on: boolean): void { setShipSurfaceDetail(root, on, material => this.weather(material)); }

  /** Weathering composes over whatever colour and roughness the paint already has; wrappers are
   * shared per base node, so equal paints still compile to one program. */
  private readonly weatheredNodes = new Map<THREE.Node, THREE.Node>();
  /** Wrapper → the node it weathers, so weathering a material twice never darkens it twice. */
  private readonly weatheredBases = new Map<THREE.Node, THREE.Node>();
  private weather(material: THREE.MeshStandardNodeMaterial): void {
    const weathering = this.options.weathering;
    if (!weathering) return;
    const shared = <T extends THREE.Node>(base: THREE.Node, make: () => T): T => {
      let node = this.weatheredNodes.get(base) as T | undefined;
      if (!node) { this.weatheredNodes.set(base, node = make()); this.weatheredBases.set(node, base); }
      return node;
    };
    const unwrap = (node: THREE.Node | null) => node && (this.weatheredBases.get(node) ?? node);
    const color = unwrap(material.colorNode) ?? materialColor;
    // Paint scales its whole colour, alpha included, as it always has; teak keeps its opaque planks.
    material.colorNode = color === materialColor || material.userData.shipSurfaceMode !== 'teak'
      ? shared(color, () => (color as THREE.Node<'vec4'>).mul(weathering.dry))
      : shared(color, () => vec4((color as THREE.Node<'vec4'>).rgb.mul(weathering.dry), (color as THREE.Node<'vec4'>).a));
    const rough = unwrap(material.roughnessNode) ?? roughness;
    material.roughnessNode = shared(rough, () => (rough as THREE.Node<'float'>).mul(weathering.gloss));
  }

  apply(root: THREE.Object3D): void {
    if (this.options.surfaceDetail) root.updateMatrixWorld(true);
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
      const mode = this.options.surfaceDetail ? shipSurfaceMode(material) : undefined;
      const key = `${mode ?? ''}${this.materialKey(material)}`;
      let shared = this.materials.get(key);
      if (!shared) {
        shared = new THREE.MeshStandardNodeMaterial().copy(material as unknown as THREE.MeshStandardNodeMaterial);
        shared.color.setRGB(1, 1, 1); shared.vertexColors = true;
        shared.roughness = 1; shared.metalness = 1;
        shared.roughnessNode = roughness;
        shared.metalnessNode = metalness;
        if (mode) applyShipSurfaceDetail(shared, mode);
        this.weather(shared);
        shared.name = 'Shared naval paint'; this.materials.set(key, shared);
      }
      // Plated paint is a per-vertex class: materials that share one palette entry keep their own.
      const plated = this.options.surfaceDetail && isPlatedPaint(material) && isPlateSized(object) ? 1 : 0;
      const source = object.geometry, colorKey = [...material.color.toArray(), material.roughness, material.metalness, plated].join(',');
      let colors = derived.get(source);
      if (!colors) derived.set(source, colors = new Map());
      let geometry = colors.get(colorKey);
      if (!geometry) {
        const colored: THREE.BufferGeometry = source.clone();
        const color = new Float32Array(source.getAttribute('position').count * 3);
        const surface = new Float32Array(source.getAttribute('position').count * 4);
        const { r, g, b } = material.color;
        for (let i = 0; i < color.length; i += 3) { color[i] = r; color[i + 1] = g; color[i + 2] = b; }
        for (let i = 0; i < surface.length; i += 4) { surface[i] = material.roughness; surface[i + 1] = material.metalness; surface[i + 2] = plated; surface[i + 3] = band; }
        colored.setAttribute('color', new THREE.BufferAttribute(color, 3));
        colored.setAttribute('shipSurface', new THREE.BufferAttribute(surface, 4));
        // Construction ships measure their wear when assembled (constructionWear); every other paint wears none,
        // with the same layout so its draws still batch and each paint keeps one program.
        if (this.options.surfaceDetail && !colored.hasAttribute('shipWear')) colored.setAttribute('shipWear', new THREE.BufferAttribute(new Float32Array(surface.length), 4));
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
