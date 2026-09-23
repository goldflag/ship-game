import { BufferAttribute, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NodeMaterial, NormalBlending, Vector3, Vector4,
  type Node, type PerspectiveCamera } from 'three/webgpu';
import { Fn, attribute, cameraProjectionMatrix, cameraViewMatrix, cos, dot, float, int, max, min, mix, normalize, positionGeometry, screenSize, select,
  sin, smoothstep, uniform, uniformArray, varyingProperty, vec2, vec3, vec4 } from 'three/tsl';
import { seededRandom } from './lightning';
import { focalPixels } from './screen';

/** Drops live in four nested boxes, each wrapping on its own period: few, large near drops and many thin far
 * ones, so a fixed budget fills the view at every distance. `size` is the box edge (m), `share` of the drops,
 * `fall` the terminal speed (m/s) in a downpour; drizzle falls slower. */
export const RAIN_CLASSES = [
  { size: 6, share: .14, fall: 8.8 },
  { size: 14, share: .36, fall: 9.3 },
  { size: 30, share: .34, fall: 8.4 },
  { size: 64, share: .16, fall: 9.6 },
] as const;
/** Each box sits ahead of the camera by this share of its half-edge (times the magnification), so most of
 * its drops fall inside the view; drops fade out near its faces, where they wrap. */
const FORWARD_SHIFT = .8;
/** Share of each box's half-edge over which drops fade in from its faces. */
const EDGE_FADE = .08;
/** Exposure (s) a streak integrates, and the longest streak a fast camera may draw (m). */
const EXPOSURE = 1 / 60, MAX_STREAK = 1.2;
/** Drops nearer than these (m) are not drawn, then fade in: a drop at the lens would cover the screen. */
const NEAR_CULL = .6, NEAR_FULL = 1.6;
/** Visible drop diameter (m) in a downpour and in drizzle. */
const DIAMETER = { heavy: .003, light: .0012 };
/** Each streak stands in for many drops: its time-averaged coverage is scaled by this, up to `MAX_ALPHA`. */
const DENSITY_GAIN = 500, MAX_ALPHA = .8;
/** Narrowest line drawn (px); thinner drops fade by their coverage instead. The line's antialiased margin (px): the
 * scene's multisampling smooths the rest. Every pixel of a blended multisampled line costs, so streaks longer than
 * `MAX_PIXELS` are cut behind the head, and drops fainter than `ALPHA_CULL` are not drawn. */
const MIN_WIDTH = 1, MARGIN = .35, MAX_PIXELS = 110, ALPHA_CULL = .004;
/** Sideways wander of a falling drop (m), and how many wanders it makes crossing a box per 8 m of height. */
const SWAY = .07, SWAY_PER = 8;
/** Horizontal wind the drops take near the sea, as a share of the cloud drift the scene gives. */
export const SURFACE_WIND = .75;
/** Camera velocity smoothing (s): a hull's heave and roll must not shake the streaks. */
const VELOCITY_SMOOTHING = .12, MAX_CAMERA_SPEED = 250;
/** Forward-scattering asymmetry of a backlit drop (Henyey–Greenstein g) and its brightness. Raindrops throw
 * most of the light they catch forward, which is why rain sparkles against a low sun. */
const GLINT_G = .8, GLINT = 1;
/** Lightning scattered through the drops toward the camera (Henyey–Greenstein g, a flat floor, and a gain: the
 * flash lasts a millisecond, the frame far longer). */
const BOLT_G = .55, BOLT_FLOOR = .03, BOLT_GAIN = .15;
/** A drop refracts a shrunken, inverted view of its surroundings: its core shows the sky around the drop and the
 * sea below it averaged (`CORE` of the sky), its edges reflect the sky at grazing incidence (`RIM`). So rain is a
 * little darker than the sky behind it and brighter than a hull or the sea. */
const CORE = .7, RIM = 1.6;
/** Lowest elevation (as the direction's height) of the sky a drop is lit by: never the sea-level haze band. */
const SKY_ELEVATION = .15;

export interface RainLighting {
  /** Sky radiance along a world direction (the atmosphere's dome, sun and moon discs excluded). */
  sky: (direction: Node<'vec3'>) => Node<'vec3'>;
  /** Diffuse irradiance from below at the camera's altitude: the sea's bounce (the atmosphere's `ambient`). */
  below: Node<'vec3'>;
  /** Toward the active celestial light, and its colour × intensity at the sea. */
  lightDirection: Node<'vec3'>;
  lightColor: Node<'vec3'>;
}

/** The sky light around a drop seen along `view`: the dome toward it, at least `SKY_ELEVATION` up, greyed as a
 * cloud deck scatters it (`grey` 0 clear … 1 overcast). */
export function skyAround(lighting: RainLighting, view: Node<'vec3'>, grey: Node<'float'>): Node<'vec3'> {
  const sky = lighting.sky(normalize(vec3(view.x, view.y.max(SKY_ELEVATION), view.z)));
  return mix(sky, vec3(dot(sky, vec3(.2126, .7152, .0722))), grey);
}

/** Henyey–Greenstein phase for a scattering angle's cosine. */
function phase(cosine: Node<'float'>, g: number): Node<'float'> {
  return float((1 - g * g) / (4 * Math.PI)).div(float(1 + g * g).sub(cosine.mul(2 * g)).max(1e-4).pow(1.5));
}

/** Near-camera rain: instanced streaks in boxes that wrap around the camera (a drop's world position never
 * jumps, so moving and turning never pop drops in or out), falling at terminal speed, carried by the wind,
 * wandering a little, and drawn as the streak its motion relative to the camera paints over an exposure.
 * Lines narrower than a pixel keep a pixel's width and fade by their coverage. Transparent and refractive:
 * each drop shows the diffuse light around it (grey against the sky, bright against dark hulls and night
 * sea), sparkles when backlit, and flares with lightning. */
export class RainField {
  readonly mesh: Mesh<InstancedBufferGeometry, NodeMaterial>;
  /** Streak opacity: precipitation, altitude and shelter; 0 hides the mesh. */
  readonly opacity = uniform(0);
  /** Gain on every streak's coverage: a tier with fewer drops draws each a little bolder. */
  readonly density = uniform(1);
  readonly diameter = uniform(DIAMETER.heavy);
  /** Share of the celestial light reaching the drops directly (not behind the cloud deck). */
  readonly directShare = uniform(1);
  /** Lightning at the camera: irradiance, direction toward the flash, and the scene flash (a multiple of the ambient). */
  readonly boltIrradiance = uniform(0);
  readonly boltDirection = uniform(new Vector3(0, 1, 0));
  readonly flash = uniform(0);
  /** How grey the sky light filling the drops is: 0 clear blue, 1 under a solid deck. */
  readonly grey = uniform(0);
  private readonly cameraVelocity = uniform(new Vector3());
  private readonly wind = uniform(new Vector3());
  /** Per class: (phase x, y, z, box edge) and (box centre relative to the camera, fall speed). */
  private readonly boxes = Array.from({ length: RAIN_CLASSES.length * 2 }, () => new Vector4());
  private readonly boxArray = uniformArray<'vec4'>(this.boxes, 'vec4');
  /** Integrated drift of each class in box units, wrapped to [0, 1): exact however long the game runs. */
  private readonly drift = RAIN_CLASSES.map(() => new Vector3());
  private readonly velocity = new Vector3();
  private readonly lastPosition = new Vector3();
  private readonly forward = new Vector3();
  private readonly centre = new Vector3();
  private readonly scratch = new Vector3();
  private hasPosition = false;
  private fallScale = 1;

  constructor(readonly capacity: number, lighting: RainLighting) {
    const geometry = new InstancedBufferGeometry();
    // Corners: x across the streak (−1, 1), y along it (0 tail, 1 head).
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    const random = seededRandom(7331), drops = new Float32Array(capacity * 4);
    const cumulative = RAIN_CLASSES.map((_, i) => RAIN_CLASSES.slice(0, i + 1).reduce((sum, c) => sum + c.share, 0));
    for (let i = 0; i < capacity; i++) {
      const pick = random() * cumulative[cumulative.length - 1];
      const k = cumulative.findIndex(edge => pick < edge);
      drops.set([random(), random(), random(), Math.max(0, k) + random() * .999], i * 4);
    }
    geometry.setAttribute('rainDrop', new InstancedBufferAttribute(drops, 4));
    geometry.instanceCount = 0;
    const material = new NodeMaterial();
    material.name = 'Rain';
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.blending = NormalBlending;
    material.depthWrite = false;
    material.side = DoubleSide;
    material.forceSinglePass = true;
    material.toneMapped = false;
    this.build(material, lighting);
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'Rain';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    // Temporal AA takes no history under the streaks: every drop moves on its own.
    this.mesh.userData.temporalResponse = 1;
  }

  /** Drops drawn this frame. */
  set count(count: number) { this.mesh.geometry.instanceCount = Math.max(0, Math.min(this.capacity, Math.round(count))); }
  get count(): number { return this.mesh.geometry.instanceCount; }

  /** Rain's look for a precipitation (0–1): drizzle is finer and falls slower than a downpour. */
  setPrecipitation(precipitation: number): void {
    const heavy = Math.min(1, Math.max(0, precipitation) / .6);
    this.diameter.value = DIAMETER.light + (DIAMETER.heavy - DIAMETER.light) * Math.sqrt(heavy);
    this.fallScale = .55 + .45 * heavy;
  }

  /** The cloud wind (m/s, compass heading it blows toward); drops take `SURFACE_WIND` of it. */
  setWind(speed: number, headingDeg: number): void {
    const heading = headingDeg * Math.PI / 180;
    this.wind.value.set(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(speed * SURFACE_WIND);
  }

  /** Advance the drops by `dt` (0 holds them), follow the camera and estimate its velocity. */
  update(camera: PerspectiveCamera, dt: number, cut: boolean): void {
    const position = camera.position;
    if (cut || !this.hasPosition) this.velocity.set(0, 0, 0);
    else if (dt > 0) {
      const raw = this.scratch.subVectors(position, this.lastPosition).divideScalar(dt);
      if (raw.length() > MAX_CAMERA_SPEED) raw.setLength(MAX_CAMERA_SPEED);
      this.velocity.lerp(raw, 1 - Math.exp(-dt / VELOCITY_SMOOTHING));
    }
    this.lastPosition.copy(position); this.hasPosition = true;
    this.cameraVelocity.value.copy(this.velocity);
    // Zoomed optics look past the near drops (they are out of focus): every box moves out along the view, by the
    // magnification over the game's normal 52° field.
    const magnification = Math.max(1, camera.projectionMatrix.elements[5] * Math.tan(26 * Math.PI / 180));
    this.forward.set(0, 0, -1).transformDirection(camera.matrixWorld);
    const wind = this.wind.value;
    RAIN_CLASSES.forEach(({ size, fall }, k) => {
      const speed = fall * this.fallScale, drift = this.drift[k];
      if (dt > 0) drift.set(wrap(drift.x + wind.x * dt / size), wrap(drift.y - speed * dt / size), wrap(drift.z + wind.z * dt / size));
      const offset = this.centre.copy(this.forward).multiplyScalar(FORWARD_SHIFT * size / 2 * magnification);
      // Box-unit phase of the drops about the box centre: fract(seed + phase) − ½ is a drop's place in the box.
      const x = wrap(drift.x - (position.x + offset.x) / size + .5), y = wrap(drift.y - (position.y + offset.y) / size + .5),
        z = wrap(drift.z - (position.z + offset.z) / size + .5);
      this.boxes[k * 2].set(x, y, z, size);
      this.boxes[k * 2 + 1].set(offset.x, offset.y, offset.z, speed);
    });
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }

  private build(material: NodeMaterial, lighting: RainLighting): void {
    const across = varyingProperty('float', 'vRainAcross'), along = varyingProperty('float', 'vRainAlong');
    const half = varyingProperty('float', 'vRainHalf'), length = varyingProperty('float', 'vRainLength');
    const alpha = varyingProperty('float', 'vRainAlpha');
    const core = varyingProperty('vec3', 'vRainCore'), rim = varyingProperty('vec3', 'vRainRim'), glint = varyingProperty('vec3', 'vRainGlint');
    material.vertexNode = Fn(() => {
      const drop = attribute<'vec4'>('rainDrop', 'vec4');
      const k = int(drop.w), seed = drop.w.fract();
      const box = this.boxArray.element(k.mul(2)), place = this.boxArray.element(k.mul(2).add(1));
      const q = drop.xyz.add(box.xyz).fract().sub(.5).toVar();
      const edge = max(q.x.abs(), max(q.y.abs(), q.z.abs()));
      // A few wanders per crossing of the box: whole cycles, so a drop wrapping from bottom to top continues smoothly.
      const cycles = max(float(1), box.w.div(SWAY_PER).round()), turn = q.y.mul(cycles).add(seed).mul(2 * Math.PI);
      const turnRate = place.w.div(box.w).mul(cycles).mul(-2 * Math.PI);
      const sway = vec3(sin(turn), 0, cos(turn.mul(2).add(seed.mul(5)))).mul(SWAY);
      const swayVelocity = vec3(cos(turn), 0, sin(turn.mul(2).add(seed.mul(5))).mul(-2)).mul(turnRate.mul(SWAY));
      const head = place.xyz.add(q.mul(box.w)).add(sway).toVar();
      const velocity = vec3(this.wind.x, place.w.negate(), this.wind.z).add(swayVelocity).sub(this.cameraVelocity);
      const streak = velocity.mul(EXPOSURE), streakLength = streak.length();
      const tail = head.sub(streak.mul(min(1, float(MAX_STREAK).div(streakLength.max(1e-5)))));
      const viewHead = cameraViewMatrix.mul(vec4(head, 0)).xyz, viewTail = cameraViewMatrix.mul(vec4(tail, 0)).xyz;
      const depth = viewHead.z.negate();
      const clipHead = cameraProjectionMatrix.mul(vec4(viewHead, 1)).toVar(), clipFull = cameraProjectionMatrix.mul(vec4(viewTail, 1));
      const halfScreen = screenSize.mul(.5);
      const pixelHead = clipHead.xy.div(clipHead.w).mul(halfScreen);
      const cut = min(1, float(MAX_PIXELS).div(pixelHead.sub(clipFull.xy.div(clipFull.w).mul(halfScreen)).length().max(1e-3)));
      const clipTail = mix(clipHead, clipFull, cut).toVar(), tailDepth = clipTail.w;
      const pixelTail = clipTail.xy.div(clipTail.w).mul(halfScreen);
      const delta = pixelHead.sub(pixelTail), pixels = delta.length().toVar();
      const direction = select(pixels.greaterThan(1e-3), delta.div(pixels.max(1e-3)), vec2(0, 1));
      const normal = vec2(direction.y.negate(), direction.x);
      const focal = focalPixels();
      const width = this.diameter.mul(focal).div(depth.max(NEAR_CULL)), drawn = width.max(MIN_WIDTH);
      const halfWidth = drawn.mul(.5).add(MARGIN);
      const corner = positionGeometry.xy;
      const pixel = mix(pixelTail, pixelHead, corner.y).add(normal.mul(corner.x.mul(halfWidth))).add(direction.mul(corner.y.mul(2).sub(1).mul(halfWidth)));
      const end = mix(clipTail, clipHead, corner.y);
      // Time-averaged coverage: a drop `width` wide smeared over `pixels` covers width² / (pixels + width) of a line `drawn` wide.
      const coverage = width.mul(width).div(pixels.add(width).mul(drawn));
      const faded = coverage.mul(this.density.mul(DENSITY_GAIN)).min(MAX_ALPHA).mul(smoothstep(NEAR_CULL, NEAR_FULL, depth))
        .mul(float(1).sub(smoothstep(.5 - EDGE_FADE / 2, .5, edge))).mul(this.opacity).toVar();
      const visible = depth.greaterThan(NEAR_CULL).and(tailDepth.greaterThan(NEAR_CULL * .5)).and(faded.greaterThan(ALPHA_CULL));
      across.assign(corner.x.mul(halfWidth));
      along.assign(corner.y.mul(pixels).add(corner.y.mul(2).sub(1).mul(halfWidth)));
      half.assign(drawn.mul(.5));
      length.assign(pixels);
      alpha.assign(select(visible, faded, float(0)));
      // Light: the diffuse sky and sea around the drop, a forward glint of the celestial light and the lightning.
      const view = normalize(head);
      const sky = skyAround(lighting, view, this.grey), below = lighting.below.div(Math.PI);
      const lift = this.flash.add(1);
      core.assign(mix(below, sky, CORE).mul(lift));
      rim.assign(sky.mul(RIM).mul(lift));
      glint.assign(lighting.lightColor.mul(this.directShare).mul(phase(dot(view, lighting.lightDirection), GLINT_G)).mul(GLINT)
        .add(vec3(.8, .87, 1).mul(this.boltIrradiance.mul(phase(dot(view, this.boltDirection), BOLT_G).add(BOLT_FLOOR)).mul(BOLT_GAIN))));
      return select(visible, vec4(pixel.div(halfScreen).mul(end.w), end.z, end.w), vec4(0, 0, 2, 1));
    })();
    material.colorNode = Fn(() => {
      // A flat-topped line with antialiased edges and soft ends; its edges catch the sky.
      const offset = across.abs();
      const profile = float(1).sub(smoothstep(half.sub(MARGIN), half.add(MARGIN), offset));
      const ends = smoothstep(half.negate(), half.mul(.5), along).mul(float(1).sub(smoothstep(length.sub(half.mul(.5)), length.add(half), along)));
      const edgeLight = offset.div(half.max(.5)).min(1);
      const radiance = mix(core, rim, edgeLight.mul(edgeLight)).add(glint);
      return vec4(radiance, alpha.mul(profile).mul(ends));
    })();
  }
}

/** Wrap to [0, 1). */
function wrap(value: number): number { return value - Math.floor(value); }
