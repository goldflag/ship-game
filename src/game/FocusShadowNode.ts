import {
  Box3, MathUtils, Matrix4, Object3D, PCFSoftShadowMap, ShadowBaseNode, ShadowNode, Vector3,
  type DepthTexture, type DirectionalLight, type DirectionalLightShadow, type Node, type PerspectiveCamera, type RenderTarget, type Sphere,
} from 'three/webgpu';
import {
  abs, add, distance, float, fract, Fn, If, ivec2, lightShadowMatrix, max, mix, reference, renderGroup, select, shadowPositionWorld, smoothstep, texture, uniform, vec2, vec4,
} from 'three/tsl';
import type { ShadowCasterPass } from './ShadowCasterPass';

type FilterInputs = { depthTexture: DepthTexture; shadowCoord: Node<'vec3'>; depthLayer: Node<'int'> };
type ShadowFilter = (inputs: FilterInputs) => Node<'float'>;
type FilteredShadow = DirectionalLightShadow & { filterNode: ShadowFilter | null };
type Gathered = Node<'vec4'> & Record<'x' | 'y' | 'z' | 'w', Node<'float'>>;
type Gather = { depth(layer: Node): Gather; compare(z: Node): Gathered };

/** Three r185's `PCFSoftShadowFilter` over one `mapSize` uniform per map. Three's builds a new `mapSize` reference in every
 * material it compiles into, and the renderer shares a render bind group only between materials whose uniforms are the same
 * nodes: every lit material then kept its own copy of the camera, light and shadow uniforms and compared and rewrote it on
 * every draw. The same arithmetic on the same samples, so the same shader apart from uniform names. */
export function softShadowFilter(shadow: DirectionalLightShadow): ShadowFilter {
  const mapSize = (reference('mapSize', 'vec2', shadow) as unknown as { setGroup(group: Node): Node<'vec2'> }).setGroup(renderGroup);
  return Fn(({ depthTexture, shadowCoord, depthLayer }: FilterInputs) => {
    const texelSize = vec2(1).div(mapSize);
    const uv = shadowCoord.xy as unknown as Node<'vec2'> & { subAssign(value: Node<'vec2'>): void };
    const f = fract(uv.mul(mapSize).add(.5)).toConst();
    uv.subAssign(f.sub(.5).mul(texelSize));
    const gatherCompare = (offset: Node<'ivec2'>) => {
      let t = (texture(depthTexture, uv) as unknown as { offset(o: Node): { gather(): Gather } }).offset(offset).gather();
      if ((depthTexture as unknown as { isArrayTexture?: boolean }).isArrayTexture) t = t.depth(depthLayer);
      return t.compare(shadowCoord.z).toConst() as Gathered;
    };
    const c1 = gatherCompare(ivec2(-1, 1)), c2 = gatherCompare(ivec2(1, 1)), c3 = gatherCompare(ivec2(-1, -1)), c4 = gatherCompare(ivec2(1, -1));
    return add(
      mix(c1.x, c2.y, f.x).add(c1.y).add(c2.x).mul(f.y),
      mix(c1.w, c2.z, f.x).add(c1.z).add(c2.w),
      mix(c3.x, c4.y, f.x).add(c3.y).add(c4.x),
      mix(c3.w, c4.z, f.x).add(c3.z).add(c4.w).mul(f.y.oneMinus()),
    ).mul(1 / 9);
  }) as unknown as ShadowFilter;
}

/** A shadow-casting stand-in the renderer treats as a directional light. */
class CascadeLight extends Object3D {
  readonly target = new Object3D();
  castShadow = true;
  /** This map's soft filter (`softShadowFilter`), which `FocusShadowNode.setup` hands to three's shadow node. */
  readonly softFilter: ShadowFilter;
  constructor(public shadow: DirectionalLightShadow) { super(); this.softFilter = softShadowFilter(shadow); }
}

/** One map. Its draw goes through the owner's caster pass when that can take it, else three's scene pass. */
class CascadeShadowNode extends ShadowNode {
  constructor(light: CascadeLight, private readonly owner: FocusShadowNode) { super(light as never, light.shadow); }

  /** Three's `ShadowNode.renderShadow`, which its typings leave out. */
  renderShadow(frame: { scene: Object3D | null; frameId: number }): void {
    const { shadow, shadowMap, light } = this as unknown as { shadow: DirectionalLightShadow; light: CascadeLight;
      shadowMap: RenderTarget & { depthTexture: DepthTexture; setSize(width: number, height: number, depth?: number): void } };
    const casters = this.owner.casters;
    if (casters?.enabled && frame.scene) {
      shadow.updateMatrices(light as never);
      shadowMap.setSize(shadow.mapSize.width, shadow.mapSize.height, shadowMap.depth);
      if (casters.draw(frame.scene, shadow.camera, shadowMap, frame.frameId)) return;
    }
    (ShadowNode.prototype as unknown as { renderShadow(frame: object): void }).renderShadow.call(this, frame);
  }
}

/** A map fitted each frame around the ships in view that the wide map misses, within
 * one band of distance from the camera. Idle, it neither renders nor samples. */
interface ViewCascade {
  readonly light: CascadeLight;
  /** Farthest camera distance, in meters at 1× magnification, this band covers. */
  readonly reach: number;
  /** 1 while the map holds ships, else 0. */
  readonly on: Node<'float'> & { value: number };
  readonly bounds: Box3;
  node?: Node<'vec4'>;
  /** Sampled: drawn around ships and not since emptied. */
  active: boolean;
  /** When it was last drawn, counted in view map draws. */
  drawn: number;
}

/** Half-width limits of the near map, in meters. */
export const NEAR_SHADOW_MIN = 12;
/** Share of the near sphere that samples the near map alone; the rest fades to the wide map. */
const BLEND_START = .8, BLEND_END = .95;
/** Share of a square map's half-width that samples it alone; the rest fades to the next map. */
const EDGE_START = .9, EDGE_END = .98;
/** Distance the near map's shadow camera stands back along the light, so tall
 * masts and low sun still cast into the sphere. */
const NEAR_STANDOFF = 800;
/** The near map covers at most a few hundred meters, so 2048 texels already reach
 * centimetres; larger settings only enlarge the wide map. */
const NEAR_MAP_MAX = 2048;
/** Camera distances (m, at 1× magnification) the view maps cover beyond the wide map:
 * formation neighbours, then the enemy line. Beyond the last, a ship spans too few
 * pixels to show a shadow; binoculars stretch every band by their magnification. */
export const VIEW_SHADOW_BANDS = [1500, 6000] as const;
/** View maps hold one fleet's spread, so texels stay at or below a screen pixel with
 * 2048; larger settings would only add memory. */
const VIEW_MAP_MAX = 2048;
/** Smallest shadow setting (map edge in texels) that draws view maps. Low's 1024 texels
 * would be too coarse to hold a fleet, and Low is for machines without a pass to spare. */
const VIEW_MIN_SETTING = 2048;
/** Smallest half-width of a view map, so a lone ship does not pull it to centimetres
 * and back as others come and go. */
const VIEW_MIN_HALF = 60;
/** Slack around the casters, in meters, for the texel snap. */
const VIEW_MARGIN = 8;
/** Light-space depth kept above the casters, and below them for shadows thrown long
 * across the sea by a low sun. */
const VIEW_ABOVE = 100, VIEW_BELOW = 1200;

const orientation = new Matrix4(), inverse = new Matrix4(), direction = new Vector3(), center = new Vector3(), local = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Where the camera is looking and how much of the scene is visible there. The
 * subject is whatever the wide map follows (the player's ship, or the distant ship
 * under binoculars); the near map sits that far along the view, wide enough to
 * cover the visible frame at that depth. */
export function nearShadowFocus(camera: PerspectiveCamera, subject: Vector3, maxRadius: number, out: Vector3): number {
  const distance = Math.max(1, camera.position.distanceTo(subject));
  camera.getWorldDirection(out).multiplyScalar(distance).add(camera.position);
  const tanV = Math.tan(MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
  const radius = distance * Math.max(tanV, tanV * camera.aspect) * 1.1;
  // Quarter-octave steps keep the texel size fixed while the view settles.
  const stepped = 2 ** (Math.round(Math.log2(radius) * 4) / 4);
  return MathUtils.clamp(stepped, NEAR_SHADOW_MIN, maxRadius);
}

/** Rounds a half-width up to a quarter octave, so texels change size in steps rather than every frame. */
const stepUp = (half: number) => 2 ** (Math.ceil(Math.log2(Math.max(half, VIEW_MIN_HALF)) * 4) / 4);

/** Shadow maps for one sun: a near map fitted around the camera's focus, where close
 * views need centimetre texels; the wide map the light itself describes (its position,
 * target and shadow camera, as set by the scene); and view maps fitted each frame
 * around the ships in view beyond the wide map, so escorts and the enemy line cast
 * shadows too. Each lit pixel samples the first map that covers it and fades to the
 * next at that map's edge. Map size, intensity and updates follow the light's own
 * shadow settings. */
export class FocusShadowNode extends ShadowBaseNode {
  /** Off: each map's soft filter is three's own, which gives every lit material its own render bind group. For comparison;
   * read when the maps' shadow nodes are first built. */
  static sharedMapSize = true;
  readonly near: CascadeLight;
  readonly wide: CascadeLight;
  readonly views: readonly ViewCascade[];
  private readonly focus = uniform(new Vector3());
  private readonly reach = uniform(NEAR_SHADOW_MIN);
  private radius = 0;
  private drawCount = 0;
  private nearNode?: Node<'vec4'>;
  private wideNode?: Node<'vec4'>;
  /** Receiver offsets of the near map in texels, along the surface normal and along the
   * light. Below 1.5 and 2 the turret roofs and barrels show acne in battle views;
   * scaling with the texel keeps close-up contact shadows attached. */
  normalBiasTexels = 1.5;
  depthBiasTexels = 2;
  /** Receiver offsets of the view maps in texels. Their texels are a metre or more, so
   * the near map's offsets would lift whole superstructure shadows off the deck. */
  viewNormalBiasTexels = .75;
  viewDepthBiasTexels = 2;
  /** Off, only the near and wide maps render: for comparisons and cost measurement. */
  viewShadows = true;
  /** Sun transmittance through the clouds at a world position, multiplied into every map's
   * visibility. Set before the first lit material compiles. */
  cloud?: (position: Node<'vec3'>) => Node<'float'>;
  /** Draws the maps' casters directly; unset, three renders every map as a scene pass. */
  casters?: ShadowCasterPass;

  constructor(readonly sun: DirectionalLight) {
    super(sun);
    this.near = new CascadeLight(sun.shadow.clone());
    this.wide = new CascadeLight(sun.shadow.clone());
    this.near.name = 'Near sun shadow'; this.wide.name = 'Wide sun shadow';
    this.follow(this.wide.shadow, Infinity);
    this.follow(this.near.shadow, NEAR_MAP_MAX);
    this.views = VIEW_SHADOW_BANDS.map((reach, index) => {
      const light = new CascadeLight(sun.shadow.clone());
      light.name = `View sun shadow ${index + 1}`;
      light.shadow.needsUpdate = true;
      return { light, reach, on: uniform(0) as unknown as ViewCascade['on'], bounds: new Box3(), active: false, drawn: -1 };
    });
    // Sized before the first draw, like the near and wide maps: shrinking a view map after it
    // has drawn destroys a texture that queued work still reads.
    for (const view of this.views) this.follow(view.light.shadow, sun.shadow.mapSize.x >= VIEW_MIN_SETTING ? VIEW_MAP_MAX : 1);
  }

  /** Centre the near map where `camera` looks, at the distance of `subject`, no wider than `maxRadius`. */
  focusOn(camera: PerspectiveCamera, subject: Vector3, maxRadius: number): void {
    this.reach.value = nearShadowFocus(camera, subject, maxRadius, this.focus.value);
  }

  /** Fit the view maps around `casters`, the bounds of the ships in view. Ships the wide
   * map already holds are left to it; the rest go to the band of their distance from
   * the camera, which `lens` (the optical magnification) divides. Call after the sun and
   * camera have moved for the frame, before anything reads the view maps' frusta. */
  fitView(camera: PerspectiveCamera, casters: Iterable<Sphere>, lens = 1): void {
    const sun = this.sun;
    for (const view of this.views) view.bounds.makeEmpty();
    if (this.viewShadows && sun.castShadow && sun.shadow.intensity > 0 && sun.shadow.mapSize.x >= VIEW_MIN_SETTING) {
      orientation.lookAt(sun.position, sun.target.position, UP);
      inverse.copy(orientation).invert();
      const wideCenter = center.copy(sun.target.position).applyMatrix4(inverse);
      const wideInner = sun.shadow.camera.right * EDGE_START;
      for (const { center: position, radius } of casters) {
        local.copy(position).applyMatrix4(inverse);
        if (Math.abs(local.x - wideCenter.x) + radius <= wideInner && Math.abs(local.y - wideCenter.y) + radius <= wideInner) continue;
        const range = (camera.position.distanceTo(position) - radius) / lens;
        const view = this.views.find(band => range <= band.reach);
        if (!view) continue;
        view.bounds.expandByPoint(local.addScalar(radius)).expandByPoint(local.addScalar(-2 * radius)); // both corners of the sphere's box
      }
    }
    // A band that lost its ships stops sampling at once. Of the rest, only the one drawn
    // longest ago is refitted and drawn this frame, so the view maps together cost one
    // shadow pass a frame. The others keep the fit they were drawn with, which ships at
    // their distance outrun by well under a texel.
    let due: ViewCascade | undefined;
    for (const view of this.views) {
      if (view.bounds.isEmpty()) { view.active = false; view.on.value = 0; }
      else if (!due || view.drawn < due.drawn) due = view;
    }
    if (due) this.place(due);
  }

  /** Fit `view`'s map to its bounds and draw it this frame. */
  private place(view: ViewCascade): void {
    const { min: low, max: high } = view.bounds, shadow = view.light.shadow, camera = shadow.camera;
    const halfX = stepUp((high.x - low.x) / 2 + VIEW_MARGIN), halfY = stepUp((high.y - low.y) / 2 + VIEW_MARGIN);
    const depth = VIEW_ABOVE + (high.z - low.z) + VIEW_BELOW;
    if (camera.right !== halfX || camera.top !== halfY || camera.far !== depth) {
      Object.assign(camera, { left: -halfX, right: halfX, bottom: -halfY, top: halfY, near: 1, far: depth });
      camera.updateProjectionMatrix();
    }
    // Snap to the texel grid in light space so shadow edges hold still as ships move.
    const size = Math.min(this.sun.shadow.mapSize.x, VIEW_MAP_MAX), texelX = 2 * halfX / size, texelY = 2 * halfY / size;
    local.set(Math.floor((low.x + high.x) / 2 / texelX) * texelX, Math.floor((low.y + high.y) / 2 / texelY) * texelY, high.z + VIEW_ABOVE).applyMatrix4(orientation);
    direction.subVectors(this.sun.target.position, this.sun.position).normalize();
    view.light.position.copy(local);
    view.light.target.position.copy(local).add(direction);
    const texel = Math.max(texelX, texelY);
    shadow.normalBias = this.viewNormalBiasTexels * texel;
    shadow.bias = -this.viewDepthBiasTexels * texel / (depth - 1);
    shadow.needsUpdate = true;
    view.drawn = ++this.drawCount;
    view.active = true; view.on.value = 1;
  }

  /** The view maps now covering ships, for consumers that must follow every map in use. */
  get activeViews(): CascadeLight[] { return this.views.filter(view => view.active).map(view => view.light); }

  setup(builder: Parameters<ShadowBaseNode['setupShadowPosition']>[0]) {
    // One shadow node per map, shared by every material: each node owns a render target
    // and renders it once per camera per frame, so per-material nodes would multiply both.
    const cascade = (light: CascadeLight) => new CascadeShadowNode(light, this) as unknown as Node<'vec4'>;
    const near = this.nearNode ??= cascade(this.near), wide = this.wideNode ??= cascade(this.wide);
    const views = this.views.map(view => view.node ??= cascade(view.light));
    // Three reads a shadow's filter when it builds that map's node, and again after the shadow type changes.
    const soft = FocusShadowNode.sharedMapSize && builder.renderer.shadowMap.type === PCFSoftShadowMap;
    for (const light of [this.near, this.wide, ...this.views.map(view => view.light)]) (light.shadow as FilteredShadow).filterNode = soft ? light.softFilter : null;
    return Fn(() => {
      this.setupShadowPosition(builder);
      const position = shadowPositionWorld as unknown as Node<'vec3'>;
      // How fully a square map holds this pixel: 1 inside, fading to 0 at its edge and
      // outside its depth range.
      const cover = (light: CascadeLight) => {
        const projected = lightShadowMatrix(light as never).mul(vec4(position, 1));
        const coord = projected.xyz.div(projected.w).toVar();
        const edge = max(abs(coord.x.sub(.5)), abs(coord.y.sub(.5))).mul(2);
        const depth = select(coord.z.greaterThanEqual(0).and(coord.z.lessThanEqual(1)), float(1), float(0));
        return smoothstep(EDGE_START, EDGE_END, edge).oneMinus().mul(depth);
      };
      // Weights of each map in order of preference; what no map covers is lit.
      const nearBlend = smoothstep(this.reach.mul(BLEND_START), this.reach.mul(BLEND_END), distance(position, this.focus));
      const weights: Node<'float'>[] = [nearBlend.oneMinus()];
      let rest: Node<'float'> = nearBlend;
      for (const [light, on] of [[this.wide, float(1)], ...this.views.map(view => [view.light, view.on] as const)] as const) {
        const share = cover(light).mul(on).toVar();
        weights.push(rest.mul(share).toVar());
        rest = rest.mul(share.oneMinus()).toVar();
      }
      // Each pixel samples one map except inside a fade band. TSL emits a node's code in
      // the first branch that uses it, so each map is read in exactly one branch.
      let result: Node<'vec4'> = vec4(rest);
      [near, wide, ...views].forEach((map, index) => {
        const value = vec4(1).toVar(), weight = weights[index]!;
        If(weight.greaterThan(0), () => { value.assign(map); });
        result = result.add(value.mul(weight));
      });
      return this.cloud ? result.mul(this.cloud(position)) : result;
    })();
  }

  updateBefore(): undefined {
    const sun = this.sun, parent = sun.parent;
    if (!parent) return undefined;
    for (const cascade of [this.near, this.wide, ...this.views.map(view => view.light)]) if (cascade.parent !== parent) { parent.add(cascade, cascade.target); }
    this.follow(this.wide.shadow, Infinity);
    this.follow(this.near.shadow, NEAR_MAP_MAX);
    // Below Medium the view maps never draw, so they shrink to one texel.
    const viewSize = sun.shadow.mapSize.x >= VIEW_MIN_SETTING ? VIEW_MAP_MAX : 1;
    for (const view of this.views) {
      const resized = this.follow(view.light.shadow, viewSize);
      // View maps draw only when `fitView` places them, and also on the first frame and
      // after a resize, which is when three creates their texture: materials bound to the
      // placeholder would otherwise submit a destroyed texture.
      view.light.shadow.autoUpdate = false;
      if (resized) view.light.shadow.needsUpdate = true;
    }
    sun.shadow.needsUpdate = false;

    // Wide: exactly the light's own map.
    this.wide.position.copy(sun.position); this.wide.target.position.copy(sun.target.position);
    this.wide.shadow.normalBias = sun.shadow.normalBias; this.wide.shadow.bias = sun.shadow.bias;
    const wideCamera = this.wide.shadow.camera, source = sun.shadow.camera;
    if (wideCamera.left !== source.left || wideCamera.top !== source.top || wideCamera.far !== source.far) {
      Object.assign(wideCamera, { left: source.left, right: source.right, top: source.top, bottom: source.bottom, near: source.near, far: source.far });
      wideCamera.updateProjectionMatrix();
    }

    // Near: a square of half-width `reach` around the focus, snapped to its texel grid
    // in light space so the shadow edges hold still while the camera moves.
    const radius = this.reach.value, size = this.near.shadow.mapSize.x;
    const nearCamera = this.near.shadow.camera;
    if (radius !== this.radius || nearCamera.far !== NEAR_STANDOFF + radius) {
      this.radius = radius;
      Object.assign(nearCamera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 1, far: NEAR_STANDOFF + radius });
      nearCamera.updateProjectionMatrix();
    }
    const texel = 2 * radius / size;
    this.near.shadow.normalBias = this.normalBiasTexels * texel;
    this.near.shadow.bias = -this.depthBiasTexels * texel / (nearCamera.far - nearCamera.near);
    direction.subVectors(sun.target.position, sun.position).normalize();
    orientation.lookAt(sun.position, sun.target.position, UP);
    inverse.copy(orientation).invert();
    center.copy(this.focus.value).applyMatrix4(inverse);
    center.x = Math.floor(center.x / texel) * texel;
    center.y = Math.floor(center.y / texel) * texel;
    center.applyMatrix4(orientation);
    this.near.target.position.copy(center);
    this.near.position.copy(center).addScaledVector(direction, -NEAR_STANDOFF);
    return undefined;
  }

  /** Frees every shadow map and detaches their stand-in lights. */
  dispose(): void {
    this.nearNode?.dispose(); this.wideNode?.dispose();
    this.nearNode = this.wideNode = undefined;
    for (const view of this.views) { view.node?.dispose(); view.node = undefined; }
    for (const cascade of [this.near, this.wide, ...this.views.map(view => view.light)]) { cascade.removeFromParent(); cascade.target.removeFromParent(); }
    super.dispose();
  }

  /** Map size, filter radius, intensity and update policy come from the light's shadow,
   * which the graphics settings drive. Reports whether the map size changed. */
  private follow(cascade: DirectionalLightShadow, maxSize: number): boolean {
    const settings = this.sun.shadow, size = Math.min(settings.mapSize.x, maxSize), resized = cascade.mapSize.x !== size;
    if (resized) cascade.mapSize.set(size, size);
    cascade.radius = settings.radius;
    cascade.intensity = settings.intensity;
    cascade.autoUpdate = settings.autoUpdate;
    if (settings.needsUpdate) cascade.needsUpdate = true;
    return resized;
  }
}
