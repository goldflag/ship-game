import { MathUtils, Matrix4, Object3D, ShadowBaseNode, Vector3, type DirectionalLight, type DirectionalLightShadow, type Node, type PerspectiveCamera } from 'three/webgpu';
import { distance, Fn, If, mix, shadow, shadowPositionWorld, smoothstep, uniform, vec4 } from 'three/tsl';

/** A shadow-casting stand-in the renderer treats as a directional light. */
class CascadeLight extends Object3D {
  readonly target = new Object3D();
  castShadow = true;
  constructor(public shadow: DirectionalLightShadow) { super(); }
}

/** Half-width limits of the near map, in meters. */
export const NEAR_SHADOW_MIN = 12;
/** Share of the near sphere that samples the near map alone; the rest fades to the wide map. */
const BLEND_START = .8, BLEND_END = .95;
/** Distance the near map's shadow camera stands back along the light, so tall
 * masts and low sun still cast into the sphere. */
const NEAR_STANDOFF = 800;
/** The near map covers at most a few hundred meters, so 2048 texels already reach
 * centimetres; larger settings only enlarge the wide map. */
const NEAR_MAP_MAX = 2048;

const orientation = new Matrix4(), inverse = new Matrix4(), direction = new Vector3(), center = new Vector3();
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

/** Two shadow maps for one sun: a near map fitted around the camera's focus, where
 * close views need centimetre texels, and the wide map the light itself describes
 * (its position, target and shadow camera, as set by the scene) for everything else.
 * Each lit pixel samples the near map inside its sphere and fades to the wide map at
 * the edge. Map size, intensity and updates follow the light's own shadow settings. */
export class FocusShadowNode extends ShadowBaseNode {
  readonly near: CascadeLight;
  readonly wide: CascadeLight;
  private readonly focus = uniform(new Vector3());
  private readonly reach = uniform(NEAR_SHADOW_MIN);
  private radius = 0;
  private nearNode?: Node<'vec4'>;
  private wideNode?: Node<'vec4'>;
  /** Receiver offsets of the near map in texels, along the surface normal and along the
   * light. Below 1.5 and 2 the turret roofs and barrels show acne in battle views;
   * scaling with the texel keeps close-up contact shadows attached. */
  normalBiasTexels = 1.5;
  depthBiasTexels = 2;

  constructor(readonly sun: DirectionalLight) {
    super(sun);
    this.near = new CascadeLight(sun.shadow.clone());
    this.wide = new CascadeLight(sun.shadow.clone());
    this.near.name = 'Near sun shadow'; this.wide.name = 'Wide sun shadow';
    this.follow(this.wide.shadow, Infinity);
    this.follow(this.near.shadow, NEAR_MAP_MAX);
  }

  /** Centre the near map where `camera` looks, at the distance of `subject`, no wider than `maxRadius`. */
  focusOn(camera: PerspectiveCamera, subject: Vector3, maxRadius: number): void {
    this.reach.value = nearShadowFocus(camera, subject, maxRadius, this.focus.value);
  }

  setup(builder: Parameters<ShadowBaseNode['setupShadowPosition']>[0]) {
    // One shadow node per map, shared by every material: each node owns a render target
    // and renders it once per camera per frame, so per-material nodes would multiply both.
    const cascade = (light: CascadeLight) => shadow(light as never, light.shadow) as unknown as Node<'vec4'>;
    const near = this.nearNode ??= cascade(this.near), wide = this.wideNode ??= cascade(this.wide);
    return Fn(() => {
      this.setupShadowPosition(builder);
      const blend = smoothstep(this.reach.mul(BLEND_START), this.reach.mul(BLEND_END), distance(shadowPositionWorld as unknown as Node<'vec3'>, this.focus));
      // Each pixel samples one map except inside the fade band. TSL emits a node's code in
      // the first branch that uses it, so each map is read in exactly one branch.
      const nearValue = vec4(1).toVar(), wideValue = vec4(1).toVar();
      If(blend.lessThan(1), () => { nearValue.assign(near); });
      If(blend.greaterThan(0), () => { wideValue.assign(wide); });
      return mix(nearValue, wideValue, blend);
    })();
  }

  updateBefore(): undefined {
    const sun = this.sun, parent = sun.parent;
    if (!parent) return undefined;
    for (const cascade of [this.near, this.wide]) if (cascade.parent !== parent) { parent.add(cascade, cascade.target); }
    this.follow(this.wide.shadow, Infinity);
    this.follow(this.near.shadow, NEAR_MAP_MAX);
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

  /** Frees both shadow maps and detaches their stand-in lights. */
  dispose(): void {
    this.nearNode?.dispose(); this.wideNode?.dispose();
    this.nearNode = this.wideNode = undefined;
    for (const cascade of [this.near, this.wide]) { cascade.removeFromParent(); cascade.target.removeFromParent(); }
    super.dispose();
  }

  /** Map size, filter radius, intensity and update policy come from the light's shadow,
   * which the graphics settings drive. */
  private follow(cascade: DirectionalLightShadow, maxSize: number): void {
    const settings = this.sun.shadow, size = Math.min(settings.mapSize.x, maxSize);
    if (cascade.mapSize.x !== size) cascade.mapSize.set(size, size);
    cascade.radius = settings.radius;
    cascade.intensity = settings.intensity;
    cascade.autoUpdate = settings.autoUpdate;
    if (settings.needsUpdate) cascade.needsUpdate = true;
  }
}
