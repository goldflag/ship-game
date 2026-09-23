import { BufferAttribute, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NodeMaterial, NormalBlending, Vector2, Vector3, Vector4,
  type Node, type PerspectiveCamera } from 'three/webgpu';
import { Fn, attribute, cameraProjectionMatrix, cameraViewMatrix, exp, float, hash, int, max, normalize, positionGeometry, select, sin, smoothstep,
  sqrt, uniform, varyingProperty, vec2, vec3, vec4 } from 'three/tsl';
import { seededRandom } from './lightning';
import { skyAround, type RainLighting } from './rain';
import { element } from './screen';

/** Edge of the square of sea (m) the splashes wrap over. It lies ahead of the camera, from a little inside where the
 * bottom of the view meets the sea, and splashes fade out between the two `FAR` distances (m) from the camera. */
const REGION = 64, FAR = [100, 140] as const;
/** Splash lifetimes (s) of the four classes; 60 s holds a whole number of each, so the clock wraps there exactly. */
const PERIODS = [.5, .6, .75, 1] as const, CLOCK = 60;
/** Ring radius and crown height and width at their largest in a downpour (m). Stand-ins: a real crown is a few
 * centimetres, but these must read from a bridge 30 m up. */
const RING = .45, CROWN_HEIGHT = .26, CROWN_WIDTH = .12;
/** Share of a splash's life the crown stands. */
const CROWN_LIFE = .25;
/** Lift above the drawn sea (m): the depth-tested rings must clear the surface mesh between its vertices. */
const LIFT = .2;
/** Opacity of a fresh ring and crown. */
const RING_OPACITY = .5, CROWN_OPACITY = .9;
/** Brightness of a ring (the sky its tilted slopes mirror) and of a crown (spray lit by the sky all round), relative to
 * the sky around; crowns also catch `CROWN_GLINT` of any direct light. */
const RING_LIGHT = 1.15, CROWN_LIGHT = 1.9, CROWN_GLINT = .15;

/** Rain landing on the sea near the camera: short-lived ripple rings and crowns that ride the waves
 * (`seaHeight`), scattered afresh every life over a square of sea that wraps around the camera like the rain's
 * boxes. Each splash has a fixed place for its whole life, so none slides as the camera moves. */
export class SplashField {
  readonly mesh: Mesh<InstancedBufferGeometry, NodeMaterial>;
  readonly opacity = uniform(0);
  /** Ring and crown size, 0–1 with precipitation. */
  readonly size = uniform(1);
  readonly directShare = uniform(1);
  readonly grey = uniform(0);
  /** Per class: its clock in lifetimes (wrapped with the 60 s clock). */
  private readonly cycles = uniform(new Vector4());
  /** Region phase (x, z) in region units and the region centre relative to the camera (x, z). */
  private readonly region = uniform(new Vector4());
  private readonly cameraHeight = uniform(0);
  private readonly cameraXZ = uniform(new Vector2());
  private readonly forward = new Vector3();
  private clock = 0;

  constructor(readonly capacity: number, lighting: RainLighting, seaHeight?: (x: Node<'float'>, z: Node<'float'>) => Node<'float'>) {
    const geometry = new InstancedBufferGeometry();
    // Corners (x, y, part): part 0 is the ring lying on the water, part 1 the crown standing on it.
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([
      -1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0,
      -1, 0, 1, 1, 0, 1, -1, 1, 1, 1, 1, 1]), 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
    const random = seededRandom(4217), splashes = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) splashes.set([random(), random(), random(), Math.floor(random() * PERIODS.length) + random() * .999], i * 4);
    geometry.setAttribute('rainSplash', new InstancedBufferAttribute(splashes, 4));
    geometry.instanceCount = 0;
    const material = new NodeMaterial();
    material.name = 'Rain splashes';
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.blending = NormalBlending;
    material.depthWrite = false;
    material.side = DoubleSide;
    material.forceSinglePass = true;
    material.toneMapped = false;
    this.build(material, lighting, seaHeight);
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'Rain splashes';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.userData.temporalResponse = 1;
  }

  set count(count: number) { this.mesh.geometry.instanceCount = Math.max(0, Math.min(this.capacity, Math.round(count))); }
  get count(): number { return this.mesh.geometry.instanceCount; }

  update(camera: PerspectiveCamera, dt: number): void {
    if (dt > 0) this.clock = (this.clock + dt) % CLOCK;
    this.cycles.value.set(this.clock / PERIODS[0], this.clock / PERIODS[1], this.clock / PERIODS[2], this.clock / PERIODS[3]);
    const { x, y, z } = camera.position;
    this.forward.set(0, 0, -1).transformDirection(camera.matrixWorld).setY(0);
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, 1);
    // A level camera sees the sea from height / tan(half the vertical field) ahead.
    const nearest = Math.max(0, y) * camera.projectionMatrix.elements[5];
    this.forward.normalize().multiplyScalar(Math.min(FAR[0], Math.max(REGION * .3, nearest * .8 + REGION * .4)));
    const wrap = (value: number) => value - Math.floor(value);
    this.region.value.set(wrap((x + this.forward.x) / REGION + .5), wrap((z + this.forward.z) / REGION + .5), this.forward.x, this.forward.z);
    this.cameraHeight.value = y;
    this.cameraXZ.value.set(x, z);
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }

  private build(material: NodeMaterial, lighting: RainLighting, seaHeight?: (x: Node<'float'>, z: Node<'float'>) => Node<'float'>): void {
    const local = varyingProperty('vec2', 'vSplashLocal'), part = varyingProperty('float', 'vSplashPart');
    const age = varyingProperty('float', 'vSplashAge'), fade = varyingProperty('float', 'vSplashFade');
    const water = varyingProperty('vec3', 'vSplashWater'), spray = varyingProperty('vec3', 'vSplashSpray');
    material.vertexNode = Fn(() => {
      const splash = attribute<'vec4'>('rainSplash', 'vec4');
      const k = int(splash.w), seed = splash.w.fract();
      const cycle = element<'float'>(this.cycles, k).add(splash.z), progress = cycle.fract();
      // Every life lands somewhere new: the wrapped seed moves by a hash of the life's number, counted within the
      // clock's cycle so the splash in mid-life when the clock wraps keeps its place.
      const life = cycle.floor().mod(element<'float'>(vec4(...PERIODS.map(period => CLOCK / period)), k));
      const key = life.mul(7919).add(seed.mul(65536).floor());
      const scatter = vec2(hash(key), hash(key.add(104729)));
      const q = splash.xy.add(scatter).add(this.region.xy).fract().sub(.5);
      const edge = max(q.x.abs(), q.y.abs());
      const xz = this.region.zw.add(q.mul(REGION));
      const world = this.cameraXZ.add(xz);
      const surface = seaHeight ? seaHeight(world.x, world.y) : float(0);
      const base = vec3(xz.x, surface.sub(this.cameraHeight).add(LIFT), xz.y).toVar();
      const corner = positionGeometry, crown = corner.z.greaterThan(.5);
      const radius = sqrt(progress).mul(.85).add(.15).mul(RING).mul(this.size);
      const view = normalize(base);
      const side = normalize(vec3(view.z.negate(), 0, view.x).add(vec3(1e-5, 0, 0)));
      const rise = sin(progress.div(CROWN_LIFE).min(1).mul(Math.PI)).mul(CROWN_HEIGHT).mul(this.size);
      const ring = base.add(vec3(corner.x.mul(radius), 0, corner.y.mul(radius)));
      const standing = base.add(side.mul(corner.x.mul(CROWN_WIDTH).mul(this.size))).add(vec3(0, corner.y.mul(rise), 0));
      const position = select(crown, standing, ring);
      local.assign(corner.xy);
      part.assign(corner.z);
      age.assign(progress);
      fade.assign(float(1).sub(smoothstep(.36, .5, edge)).mul(float(1).sub(smoothstep(FAR[0], FAR[1], base.length()))).mul(this.opacity));
      // Rings mirror the sky at a grazing angle; crowns are white water lit by it and by any direct light.
      const sky = skyAround(lighting, view, this.grey).mul(lighting.flash.add(1));
      water.assign(sky.mul(RING_LIGHT));
      spray.assign(sky.mul(CROWN_LIGHT).add(lighting.lightColor.mul(this.directShare).mul(CROWN_GLINT)));
      return cameraProjectionMatrix.mul(vec4(cameraViewMatrix.mul(vec4(position, 0)).xyz, 1));
    })();
    material.colorNode = Fn(() => {
      const ringShape = exp(local.length().sub(.8).div(.14).pow(2).negate()).mul(float(1).sub(age).pow(2)).mul(RING_OPACITY);
      const crownAge = age.div(CROWN_LIFE);
      // A narrow sheet of spray, densest low and at its centre.
      const crownShape = float(1).sub(local.x.mul(local.x)).pow(2).mul(smoothstep(0, .15, local.y)).mul(float(1).sub(local.y).sqrt())
        .mul(float(1).sub(smoothstep(.6, 1, crownAge))).mul(select(crownAge.lessThan(1), float(CROWN_OPACITY), float(0)));
      const isCrown = part.greaterThan(.5);
      return vec4(select(isCrown, spray, water), select(isCrown, crownShape, ringShape).mul(fade));
    })();
  }
}
