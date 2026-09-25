import * as THREE from 'three/webgpu';
import { attribute, materialColor, materialEmissive, materialMetalness, materialRoughness, vec4 } from 'three/tsl';
import { applyShipSurfaceDetail, deckPlanks, isPlatedPaint, isPlateSized, setShipSurfaceDetail, shipSurfaceMode } from './ShipSurfaceDetail';
import { mountArmour } from './constructionWear';

/** The `shipSurface` vertex attribute. `apply` below is its only writer; every channel is taken:
 * - `x`: the source paint's roughness, or glass's for glazing (`GLAZING`). Read here and by ShipSurfaceDetail (plate roughness).
 * - `y`: the source paint's metalness; none for glazing. Read here.
 * - `z`: plated paint, 1 or 0 (`isPlatedPaint` and `isPlateSized`, not a mount's armour, with surface detail on). Read by ShipSurfaceDetail
 *   for plating relief, plate roughness and the construction finish's seams and plate shades.
 * - `w`: the hull's rest wet-band height in metres (`wetBandHeight`). Read by HullWetBand.
 * A new per-vertex value needs its own attribute, as `shipWear` (written by constructionWear) did. */
const surface = attribute<'vec4'>('shipSurface', 'vec4');
const roughness = materialRoughness.mul(surface.x), metalness = materialMetalness.mul(surface.y);
/** Rest height of a hull's wet band above the sea, in metres, by hull length; the sea state adds to it. */
export const wetBandHeight = (length: number) => Math.max(.3, Math.min(.9, .2 + .0025 * length));
/** Albedo (`dry`) and roughness (`gloss`) multipliers weathering lays over a paint. */
export interface WetResponse { dry: THREE.Node<'float'>; gloss: THREE.Node<'float'> }
/** Fire damage over every shared paint (ShipScorch): its colour over the paint's colour node, which three then multiplies by
 * the paint's vertex colour, its roughness over the paint's, and the radiance of embers. */
export interface PaintScorch {
  color(paint: THREE.Node<'vec3'>): THREE.Node<'vec3'>;
  roughness(paint: THREE.Node<'float'>): THREE.Node<'float'>;
  readonly glow: THREE.Node<'vec3'>;
}
/** Visual-only changes every shared paint receives: the wet band at the waterline and rain (ShipWeather) multiply colour
 * (`dry`) and roughness (`gloss`) over any fire damage (`scorch`). `timber`, where given, is timber decking's own response:
 * porous wood darkens more when wet than paint does. */
export interface PaintWeathering extends WetResponse { timber?: WetResponse; scorch?: PaintScorch }

/** Glazing: window and porthole glass and the lenses of directors, rangefinders and searchlights. Recipes and the catalog
 * model it as opaque paint, a dark tint and mostly a matte finish (premade `… glass` and `Bridge glazing` materials, the
 * catalog's `glass` role, which player-built windows and portholes install black). The palette draws all of it as glass
 * instead: a smooth dielectric (F0 0.04, no metal), so the sky and sea reflect from it by Fresnel and the sun glints off it
 * under the paint's own mesh light shares, over a body that is the dim room or instrument behind the pane, the authored tint
 * at no more than `body` luminance. `roughness` spreads the point sun over about the width of its disc. Nothing lights it
 * from within, so it goes as dark as the sky it reflects. Per-vertex values like any paint's: no program, texture or draw. */
export const GLAZING = { roughness: .1, body: .02 } as const;
const GLAZING_NAME = /(^|[\s.])(glass|glazing)$/i;
/** Whether a source material is glazing: the catalog's `glass` role, or, without a role, a material named for glass. */
export function isGlazing(material: THREE.MeshStandardMaterial): boolean {
  const role = material.userData.componentMaterialRole;
  return typeof role === 'string' ? role === 'glass' : GLAZING_NAME.test(material.name);
}
/** The linear colour, roughness and metalness a paint draws with: its own, or glass for glazing. */
function finishOf(material: THREE.MeshStandardMaterial): { color: THREE.Color; roughness: number; metalness: number } {
  if (!isGlazing(material)) return { color: material.color, roughness: material.roughness, metalness: material.metalness };
  const color = material.color.clone(), luminance = .2126 * color.r + .7152 * color.g + .0722 * color.b;
  if (luminance > GLAZING.body) color.multiplyScalar(GLAZING.body / luminance);
  return { color, roughness: GLAZING.roughness, metalness: 0 };
}

/** Encode constant paint in derived vertex colors so otherwise identical PBR
 * materials can share draws, including across different ship definitions. */
export class ShipMaterialPalette {
  /** `surfaceDetail` adds metric plating, paint roughness and teak detail (ships, not aircraft);
   * `weathering` darkens and glosses every paint, such as the wet band at the waterline and rain. */
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
   * shared per response and base node, so equal paints still compile to one program. */
  private readonly weatheredNodes = new Map<WetResponse, Map<THREE.Node, THREE.Node>>();
  /** Wrapper → the node it weathers, so weathering a material twice never darkens it twice. */
  private readonly weatheredBases = new Map<THREE.Node, THREE.Node>();
  private weather(material: THREE.MeshStandardNodeMaterial): void {
    const weathering = this.options.weathering;
    if (!weathering) return;
    const teak = material.userData.shipSurfaceMode === 'teak', response = teak && weathering.timber || weathering;
    const shared = <T extends THREE.Node>(base: THREE.Node, make: () => T): T => {
      let nodes = this.weatheredNodes.get(response);
      if (!nodes) this.weatheredNodes.set(response, nodes = new Map());
      let node = nodes.get(base) as T | undefined;
      if (!node) { nodes.set(base, node = make()); this.weatheredBases.set(node, base); }
      return node;
    };
    const unwrap = (node: THREE.Node | null) => node && (this.weatheredBases.get(node) ?? node);
    const color = unwrap(material.colorNode) ?? materialColor, scorch = weathering.scorch;
    // Paint scales its whole colour, alpha included, as it always has; teak keeps its opaque planks. Fire damage
    // changes only the colour, and the wet band and rain darken damaged paint too.
    const rgb = (c: THREE.Node<'vec4'>) => scorch ? scorch.color(c.rgb) : c.rgb;
    material.colorNode = color === materialColor || !teak
      ? shared(color, () => scorch ? vec4(rgb(color as THREE.Node<'vec4'>), (color as THREE.Node<'vec4'>).a).mul(response.dry) : (color as THREE.Node<'vec4'>).mul(response.dry))
      : shared(color, () => vec4(rgb(color as THREE.Node<'vec4'>).mul(response.dry), (color as THREE.Node<'vec4'>).a));
    const rough = unwrap(material.roughnessNode) ?? roughness;
    material.roughnessNode = shared(rough, () => (scorch ? scorch.roughness(rough as THREE.Node<'float'>) : rough as THREE.Node<'float'>).mul(response.gloss));
    // Embers glow over whatever the paint emits itself.
    if (scorch) material.emissiveNode = this.embers ??= materialEmissive.add(scorch.glow);
  }
  private embers?: THREE.Node<'vec3'>;

  apply(root: THREE.Object3D): void {
    if (this.options.surfaceDetail) root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    const band = wetBandHeight(Math.max(size.x, size.z) || 0);
    const derived = new Map<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>(), armour = mountArmour(root);
    const retiredGeometry = new Set<THREE.BufferGeometry>(), retiredMaterials = new Set<THREE.Material>();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      const material = object.material;
      if (!(material instanceof THREE.MeshStandardMaterial) || material.type !== 'MeshStandardMaterial' ||
        material.transparent || material.vertexColors || material.clippingPlanes || object.morphTargetInfluences?.length ||
        material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ||
        material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) return;
      const mode = this.options.surfaceDetail ? shipSurfaceMode(material) : undefined;
      // Decks of different plank sizes draw different planks (userData stays out of the material key).
      const planks = mode === 'teak' ? Object.values(deckPlanks(material)).join(':') : '';
      const key = `${mode ?? ''}${planks}${this.materialKey(material)}`;
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
      // Plated paint is a per-vertex class: materials that share one palette entry keep their own. Turret armour is a few
      // large plates, not welded strakes (`mountArmour`).
      const plated = this.options.surfaceDetail && isPlatedPaint(material) && isPlateSized(object) && !armour(object) ? 1 : 0;
      const finish = finishOf(material), source = object.geometry, colorKey = [...finish.color.toArray(), finish.roughness, finish.metalness, plated].join(',');
      let colors = derived.get(source);
      if (!colors) derived.set(source, colors = new Map());
      let geometry = colors.get(colorKey);
      if (!geometry) {
        const colored: THREE.BufferGeometry = source.clone();
        const color = new Float32Array(source.getAttribute('position').count * 3);
        const surface = new Float32Array(source.getAttribute('position').count * 4);
        const { r, g, b } = finish.color;
        for (let i = 0; i < color.length; i += 3) { color[i] = r; color[i + 1] = g; color[i + 2] = b; }
        for (let i = 0; i < surface.length; i += 4) { surface[i] = finish.roughness; surface[i + 1] = finish.metalness; surface[i + 2] = plated; surface[i + 3] = band; }
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
