import { CustomBlending, DataTexture, HalfFloatType, LinearFilter, Matrix4, Mesh, MeshBasicNodeMaterial, OneFactor, RepeatWrapping, RGBAFormat, SrcAlphaFactor,
  StorageTexture, UnsignedByteType, Vector2, Vector3, ZeroFactor, type ComputeNode, type Node, type PerspectiveCamera, type StorageTextureNode, type TextureNode,
  type UniformNode, type WebGPURenderer } from 'three/webgpu';
import { Discard, Fn, If, cameraFar, cameraNear, cameraViewMatrix, float, instanceIndex, int, ivec2, max, min, mix, round, screenUV, select, smoothstep,
  storageTexture, texture, textureStore, uniform, uvec2, vec2, vec3, vec4, viewZToPerspectiveDepth, viewZToReversedPerspectiveDepth } from 'three/tsl';
import type { AtmospherePart, CloudPart, SkyFrame, SkyPartContext, SkyQuality, SkyScene, SkyUniforms } from '../contracts';
import { CLOUD_ORDER, fullScreenTriangle, screenCorner, viewDirection } from '../dome';
import { SKY_TIERS } from '../quality';
import { writeSceneTargets } from '../../TemporalAntialiasing';
import { createCirrus, cirrusAmount } from './cirrus';
import { createCloudField, createLayerUniforms, type CloudField, type LayerUniforms } from './field';
import { createCloudLight, gradientJitter, marchClouds, shadowTransmittance, type CloudLight, type MarchContext } from './march';
import { cirrusMap, clearDistance, clearThreshold, weatherChannels, weatherMap, CIRRUS_SIZE, CLEAR_RANGE, WEATHER_SIZE } from './model';
import { baseVolume, detailVolume, type GeneratedVolume } from './noise';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Vec3 = Node<'vec3'>;
type Vec4 = Node<'vec4'>;
type Cell = Node<'ivec2'>;

/** Weight of a freshly marched sample against its pixel's reprojected history. */
const FRESH = .25;
/** Distances (m) over which a far pixel's fresh sample is smoothed toward its neighbours'. */
const FAR_SMOOTHING = [15_000, 60_000] as const;
/** Frames after a cut that march every pixel, and the weight of their fresh samples. */
const CATCH_UP_FRAMES = 2, CATCH_UP_FRESH = .6;
/** Where a pixel met no cloud, history is reprojected as if this far away (m): the sky's own motion. */
const CLEAR_DISTANCE = 30_000;
/** Ground the cloud shadow map covers (m), around the camera. */
const SHADOW_EXTENT = 40_000;
/** Samples of the shadow map's march along the sun. */
const SHADOW_STEPS = 8;
/** The shadow map refreshes one texel in this many each frame. It is laid out in the clouds' own drifting
 * frame, so it follows the wind exactly and only the clouds' slow change of shape ages it. */
const SHADOW_SLICES = 16;
/** Share of the shadow map's half-width over which it fades to full sun at its edge. */
const SHADOW_EDGE = .15;
/** Sun heights (the sine of its elevation) over which cloud shadows fade in after sunrise: a sun on the
 * horizon lights the sea from under the clouds, not through them. */
const SHADOW_SUN = [.02, .12] as const;
/** The authored `clouds.ambient` was tuned against another model: this is the value meaning a gain of 1. */
const AUTHORED_AMBIENT = 1.1;
/** Kernels run in 8 × 8 texel tiles, so neighbouring rays share a warp and the texture cache. */
const TILE = 8;
/** Frames drawn with the per-pixel-depth composite first, so both composite pipelines compile at startup. */
const WARMUP_FRAMES = 3;
/** Metres below the base under which the camera is "under the layer": clouds then lie behind everything. */
const UNDER_MARGIN = 20;
/** Lightning. `SkyUniforms.lightningIntensity` is the irradiance, in the sea's units, the channel casts 1 km
 * away (the sun's is about 6), falling off with the square of distance. A cloud glows with `LIGHTNING_GLOW` of
 * the irradiance reaching it, dimmed over `LIGHTNING_SPREAD` metres as the light diffuses through the cloud:
 * at 150, a cloud 5 km from the strike glows about 0.4 (bright at night, visible by day), one 2 km away about
 * 4, into the bloom. Closer than `LIGHTNING_NEAREST` counts as that close. */
const LIGHTNING_GLOW = .25, LIGHTNING_SPREAD = 6_000, LIGHTNING_NEAREST = 300;
const LIGHTNING_TINT = [.8, .85, 1] as const;

/** Visit order of the pixels of an n × n block, spread so consecutive frames march far-apart pixels. */
const BLOCK_ORDER: Record<number, readonly (readonly [number, number])[]> = {
  1: [[0, 0]],
  2: [[0, 0], [1, 1], [1, 0], [0, 1]],
  4: [[0, 0], [2, 2], [2, 0], [0, 2], [1, 1], [3, 3], [3, 1], [1, 3], [1, 0], [3, 2], [3, 0], [1, 2], [0, 1], [2, 3], [2, 1], [0, 3]],
};

function makeStorage(width: number, height: number, type: typeof HalfFloatType | typeof UnsignedByteType = HalfFloatType): StorageTexture {
  const map = new StorageTexture(width, height);
  map.type = type; map.format = RGBAFormat;
  map.minFilter = map.magFilter = LinearFilter;
  map.generateMipmaps = false;
  return map;
}

/** A read that skips three's UV transform (every clone of a texture node re-enables it). */
function direct(node: TextureNode): TextureNode {
  node.updateMatrix = false;
  return node;
}

/** The texel a kernel invocation covers: invocations run in `TILE`² tiles, row after row of tiles. */
function tiled(tilesX: UniformNode<'int', number>): Cell {
  const i = int(instanceIndex), tile = i.div(TILE * TILE), within = i.mod(TILE * TILE);
  return ivec2(tile.mod(tilesX).mul(TILE).add(within.mod(TILE)), tile.div(tilesX).mul(TILE).add(within.div(TILE)));
}
const tiles = (width: number, height: number) => ({ x: Math.ceil(width / TILE), count: Math.ceil(width / TILE) * Math.ceil(height / TILE) * TILE * TILE });
/** Component-wise integer min and max (three's typings accept only float vectors). */
const cellMin = (a: Cell, b: Cell) => min(a as unknown as Vec2, b as unknown as Vec2) as unknown as Cell;
const cellMax = (a: Cell, b: Cell) => max(a as unknown as Vec2, b as unknown as Vec2) as unknown as Cell;
const within = (cell: Cell, size: Node<'vec2'>) => cell.x.lessThan(int(size.x)).and(cell.y.lessThan(int(size.y)));

interface Pair { color: StorageTexture; depth: StorageTexture }

/** The volumetric cloud layer (see `README.md` in the sky folder). Each frame is one compute submission:
 * the march of one pixel in every interleave block, the temporal reconstruction of the cloud buffer, and a
 * slice of the cloud shadow map. The composite draws the reconstruction over the scene. */
export class CloudLayer implements CloudPart {
  readonly composite: Mesh;
  readonly screenTransmittance: TextureNode;
  private readonly layer: LayerUniforms;
  private readonly light: CloudLight;
  private readonly field: CloudField;
  private readonly context: MarchContext;
  private readonly volumes: GeneratedVolume[];
  private readonly weather: DataTexture;
  private readonly weatherChannels: Float32Array[];
  /** The clear-air threshold the weather map's distances were built for. */
  private clearFor = NaN;
  private readonly cirrusTexture: DataTexture;
  private readonly cirrusStrength = uniform(0);
  /** The clouds' drift heading as a unit XZ vector. */
  private readonly windAxis = uniform(new Vector2(0, 1));
  private readonly cirrusFn: (direction: Vec3, behind: Vec3) => Vec3;
  private readonly u = {
    steps: uniform(64, 'int'), bakeSteps: uniform(16, 'int'),
    frame: uniform(0), offset: uniform(new Vector2(), 'ivec2'), interleave: uniform(2, 'int'),
    cloudSize: uniform(new Vector2(1, 1)), marchSize: uniform(new Vector2(1, 1)), cloudTiles: uniform(1, 'int'), marchTiles: uniform(1, 'int'),
    projectionInverse: uniform(new Matrix4()), cameraWorld: uniform(new Matrix4()), previousViewProjection: uniform(new Matrix4()),
    windShift: uniform(new Vector3()), history: uniform(0), fresh: uniform(FRESH), pixelAngle: uniform(.003),
    shadowSize: uniform(256, 'int'), shadowSlice: uniform(0, 'int'), shadowStrength: uniform(0),
    ambient: uniform(1), baseShadow: uniform(.2), precipitation: uniform(0),
  };
  private readonly march: Pair;
  private readonly history: [Pair, Pair];
  private shadowMap: StorageTexture;
  private readonly marchColor: TextureNode;
  private readonly marchDepth: TextureNode;
  private readonly readColor: [TextureNode, TextureNode];
  private readonly readDepth: [TextureNode, TextureNode];
  private readonly latestColor: TextureNode;
  private readonly latestDepth: TextureNode;
  private readonly shadowRead: TextureNode;
  private readonly shadowStore: StorageTextureNode;
  /** One march per light-sample count a tier asks for: the count is unrolled into the shader. */
  private readonly marchKernels = new Map<number, ComputeNode>();
  private readonly resolveKernels: [ComputeNode, ComputeNode];
  private readonly shadowKernels: { slice: ComputeNode; full: ComputeNode };
  /** Persistent submission lists (three keys per-call state by the array): per march, [history parity][shadow: none, slice, full]. */
  private readonly submissions = new Map<ComputeNode, ComputeNode[][][]>();
  private compiled = false;
  private readonly fastMaterial: MeshBasicNodeMaterial;
  private readonly depthMaterial: MeshBasicNodeMaterial;
  private quality: SkyQuality;
  private width = 0;
  private height = 0;
  private current = 0;
  private frameIndex = 0;
  private hasHistory = false;
  private catchUp = 0;
  private shadowStale = true;
  private active = true;
  private readonly previousViewProjection = new Matrix4();
  private readonly viewProjection = new Matrix4();
  private readonly previousWind = new Vector3();

  constructor(renderer: WebGPURenderer, private readonly sky: SkyUniforms, atmosphere: AtmospherePart, quality: SkyQuality, reversedDepth: boolean) {
    this.quality = quality;
    this.volumes = [baseVolume(renderer), detailVolume(renderer)];
    this.weatherChannels = weatherChannels();
    this.weather = mapTexture(weatherMap(this.weatherChannels, clearDistance(this.weatherChannels[0], 2)), WEATHER_SIZE, 'Cloud weather');
    this.cirrusTexture = mapTexture(cirrusMap(), CIRRUS_SIZE, 'Cirrus');
    this.layer = createLayerUniforms();
    this.light = createCloudLight();
    this.field = createCloudField(sky, this.layer, { weather: this.weather, base: this.volumes[0].map, detail: this.volumes[1].map });
    this.context = { sky, atmosphere, field: this.field, light: this.light, ambient: this.u.ambient, baseShadow: this.u.baseShadow };
    this.cirrusFn = createCirrus(sky, atmosphere, this.light, this.cirrusTexture, this.cirrusStrength, this.windAxis);
    this.march = { color: makeStorage(1, 1), depth: makeStorage(1, 1) };
    this.history = [{ color: makeStorage(1, 1), depth: makeStorage(1, 1) }, { color: makeStorage(1, 1), depth: makeStorage(1, 1) }];
    this.shadowMap = this.makeShadowMap(SKY_TIERS[quality].cloudShadowSize);
    this.marchColor = texture(this.march.color);
    this.marchDepth = texture(this.march.depth);
    this.readColor = [texture(this.history[0].color), texture(this.history[1].color)];
    this.readDepth = [texture(this.history[0].depth), texture(this.history[1].depth)];
    this.latestColor = texture(this.history[0].color);
    this.latestDepth = texture(this.history[0].depth);
    this.screenTransmittance = texture(this.history[0].depth);
    this.shadowRead = texture(this.shadowMap);
    this.shadowStore = storageTexture(this.shadowMap);
    this.resolveKernels = [this.buildResolve(0), this.buildResolve(1)];
    this.shadowKernels = { slice: this.buildShadow(SHADOW_SLICES), full: this.buildShadow(1) };
    for (const tier of Object.values(SKY_TIERS)) {
      if (this.marchKernels.has(tier.cloudLightSteps)) continue;
      const march = this.buildMarch(tier.cloudLightSteps);
      this.marchKernels.set(tier.cloudLightSteps, march);
      this.submissions.set(march, this.resolveKernels.map(resolve => [[march, resolve], [march, resolve, this.shadowKernels.slice], [march, resolve, this.shadowKernels.full]]));
    }
    this.fastMaterial = this.buildComposite(reversedDepth, false);
    this.depthMaterial = this.buildComposite(reversedDepth, true);
    this.composite = new Mesh(fullScreenTriangle(), this.depthMaterial);
    this.composite.name = 'Cloud composite';
    this.composite.frustumCulled = false;
    this.composite.renderOrder = CLOUD_ORDER;
    this.composite.matrixAutoUpdate = false;
    this.setQuality(quality);
  }

  get enabled(): boolean { return this.active; }
  set enabled(value: boolean) {
    this.active = value;
    this.layer.enabled.value = value ? 1 : 0;
    this.hasHistory = false;
  }

  apply(scene: SkyScene): void {
    const { clouds } = scene, layer = this.layer;
    layer.base.value = clouds.altitude;
    layer.thickness.value = Math.max(clouds.thickness, 100);
    layer.coverage.value = Math.min(Math.max(clouds.coverage, 0), 1);
    layer.horizon.value = clouds.horizonCoverage;
    this.updateClearDistance(clearThreshold(layer.coverage.value, clouds.horizonCoverage));
    this.u.ambient.value = clouds.ambient / AUTHORED_AMBIENT;
    this.u.baseShadow.value = Math.min(Math.max(clouds.baseShadow, 0), 1);
    this.u.precipitation.value = scene.weather.precipitation;
    this.cirrusStrength.value = cirrusAmount(clouds.coverage, clouds.windHeading + scene.sun.azimuth);
    const heading = clouds.windHeading * Math.PI / 180;
    this.windAxis.value.set(Math.sin(heading), Math.cos(heading));
    this.hasHistory = false;
    this.shadowStale = true;
  }

  cirrus(direction: Vec3, behind: Vec3): Vec3 { return this.cirrusFn(direction, behind); }

  bake(origin: Vec3, direction: Vec3): Vec4 {
    return Fn(() => {
      const result = marchClouds(this.context, origin, this.field.altitude(origin), direction,
        { steps: this.u.bakeSteps, lightSteps: 0, jitter: .5 });
      return vec4(result.radiance, result.transmittance);
    })();
  }

  shadow(position: Vec3): Float { return this.shadowAt(position, false); }

  /** The cloud shadow at a world position; `explicit` reads level 0 (compute shaders have no derivatives). */
  private shadowAt(position: Vec3, explicit: boolean): Float {
    const sun = this.sky.sunDirection, wind = this.sky.windOffset, camera = this.sky.cameraPosition;
    // Down the sun's rays to the sea, then into the clouds' drifting frame the map is laid out in.
    const ground = position.xz.sub(sun.xz.mul(position.y.div(max(sun.y, .02))));
    const edge = max(ground.x.sub(camera.x).abs(), ground.y.sub(camera.z).abs()).div(SHADOW_EXTENT / 2);
    const read = this.shadowRead.sample(ground.sub(wind.xz).div(SHADOW_EXTENT));
    const value = direct(explicit ? read.level(float(0)) : read).r;
    return mix(float(1), value, this.u.shadowStrength.mul(smoothstep(1, 1 - SHADOW_EDGE, edge)).mul(this.layer.enabled));
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.resizeTargets();
  }

  setQuality(quality: SkyQuality): void {
    this.quality = quality;
    const tier = SKY_TIERS[quality];
    this.u.steps.value = tier.cloudSteps;
    this.u.bakeSteps.value = tier.environmentSteps;
    this.u.interleave.value = tier.cloudInterleave;
    if (this.u.shadowSize.value !== tier.cloudShadowSize) {
      this.shadowMap.dispose();
      this.shadowMap = this.makeShadowMap(tier.cloudShadowSize);
      this.shadowRead.value = this.shadowMap;
      this.shadowStore.value = this.shadowMap;
      this.shadowStale = true;
    }
    const size = this.u.shadowSize.value;
    this.shadowKernels.slice.count = size * size / SHADOW_SLICES;
    this.shadowKernels.full.count = size * size;
    this.resizeTargets();
  }

  update(frame: SkyFrame): void {
    const { renderer, camera } = frame, tier = SKY_TIERS[this.quality], u = this.u;
    const size = renderer.getDrawingBufferSize(scratch);
    if (size.x !== this.width || size.y !== this.height) this.resize(size.x, size.y);
    this.updateLight();
    camera.updateMatrixWorld();
    u.projectionInverse.value.copy(camera.projectionMatrixInverse);
    u.cameraWorld.value.copy(camera.matrixWorld);
    // Angle one cloud-buffer pixel spans: the detail fades where a pixel's footprint cannot resolve it.
    u.pixelAngle.value = 2 * Math.tan(camera.getEffectiveFOV() * Math.PI / 360) / u.cloudSize.value.y;
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const wind = this.sky.windOffset.value;
    u.windShift.value.subVectors(wind, this.previousWind);
    u.previousViewProjection.value.copy(this.hasHistory ? this.previousViewProjection : this.viewProjection);
    u.history.value = this.hasHistory && !frame.cut ? 1 : 0;
    // After a cut every pixel is marched for a couple of frames, so the new view starts clean at full
    // resolution rather than converging from an upsampled first frame over the whole interleave cycle.
    if (!this.hasHistory || frame.cut) this.catchUp = CATCH_UP_FRAMES;
    this.interleave(this.catchUp > 0 ? 1 : tier.cloudInterleave);
    u.fresh.value = this.catchUp > 0 ? CATCH_UP_FRESH : FRESH;
    if (this.catchUp > 0) this.catchUp--;
    const order = BLOCK_ORDER[u.interleave.value] ?? BLOCK_ORDER[1];
    const [ox, oy] = order[this.frameIndex % order.length];
    u.offset.value.set(ox, oy);
    u.frame.value = this.frameIndex % 1024;
    u.shadowSlice.value = this.frameIndex % SHADOW_SLICES;
    this.frameIndex++;
    this.chooseComposite(camera);
    if (!this.compiled) {
      // Every tier's march compiles now, under the loading screen: a later tier change must not hitch.
      for (const kernel of this.marchKernels.values()) {
        const count = kernel.count;
        kernel.count = 0;
        renderer.compute(kernel);
        kernel.count = count;
      }
      this.compiled = true;
    }
    if (this.active) {
      const shadows = u.shadowStrength.value > 0 ? (this.shadowStale || frame.cut ? 2 : 1) : 0;
      renderer.compute(this.submissions.get(this.marchKernels.get(tier.cloudLightSteps)!)![this.current][shadows]);
      if (shadows === 2) this.shadowStale = false;
      // The reconstruction wrote the other history; everything downstream reads it from now on.
      this.current = 1 - this.current;
      const latest = this.history[this.current];
      this.latestColor.value = latest.color;
      this.latestDepth.value = latest.depth;
      this.screenTransmittance.value = latest.depth;
      this.hasHistory = true;
    }
    this.previousViewProjection.copy(this.viewProjection);
    this.previousWind.copy(wind);
  }

  dispose(): void {
    for (const map of [this.march.color, this.march.depth, ...this.history.flatMap(h => [h.color, h.depth]), this.shadowMap]) map.dispose();
    for (const kernel of [...this.marchKernels.values(), ...this.resolveKernels, this.shadowKernels.slice, this.shadowKernels.full]) kernel.dispose();
    this.fastMaterial.dispose();
    this.depthMaterial.dispose();
    this.composite.geometry.dispose();
    for (const volume of this.volumes) volume.dispose();
    this.weather.dispose();
    this.cirrusTexture.dispose();
  }

  /** Rebuild the weather map's clear-air distances (a few milliseconds) when the coverage moves its threshold. */
  private updateClearDistance(threshold: number): void {
    if (Math.abs(threshold - this.clearFor) < 1e-3) return;
    this.clearFor = threshold;
    const clear = clearDistance(this.weatherChannels[0], threshold), bytes = this.weather.image.data as Uint8Array;
    for (let k = 0; k < clear.length; k++) bytes[k * 4 + 3] = Math.round(Math.min(clear[k] / CLEAR_RANGE, 1) * 255);
    this.weather.needsUpdate = true;
  }

  /** The sun lights the clouds until it is low enough that even their tops stand in the planet's shadow;
   * then the moon does. The atmosphere's transmittance darkens the sun long before the switch. */
  private updateLight(): void {
    const sun = this.sky.sunDirection.value, night = sun.y < Math.sin(-5 * Math.PI / 180);
    this.light.night.value = night ? 1 : 0;
    this.light.direction.value.copy(night ? this.sky.moonDirection.value : sun);
    this.u.shadowStrength.value = smooth(sun.y, SHADOW_SUN[0], SHADOW_SUN[1]);
  }

  /** Under the layer every cloud lies behind whatever the scene drew (ships and the sea stand below the base),
   * so the composite sits at the far plane and the depth test skips those pixels before shading them. From
   * inside or above the layer clouds can be in front, and each pixel is tested at the clouds' own depth. */
  private chooseComposite(camera: PerspectiveCamera): void {
    // Rain shafts hang in front of the sea and ships, so a raining sky always tests depth.
    const under = camera.position.y < this.layer.base.value - UNDER_MARGIN && this.u.precipitation.value <= 0 && this.frameIndex > WARMUP_FRAMES;
    this.composite.material = under ? this.fastMaterial : this.depthMaterial;
  }

  private resizeTargets(): void {
    if (!this.width) return;
    const tier = SKY_TIERS[this.quality], u = this.u;
    const cw = Math.max(1, Math.ceil(this.width / tier.cloudScale)), ch = Math.max(1, Math.ceil(this.height / tier.cloudScale));
    u.cloudSize.value.set(cw, ch);
    const cloud = tiles(cw, ch);
    u.cloudTiles.value = cloud.x;
    for (const kernel of this.resolveKernels) kernel.count = cloud.count;
    // The march buffer holds a whole cloud buffer: catch-up frames march every pixel.
    for (const map of [this.march.color, this.march.depth, ...this.history.flatMap(h => [h.color, h.depth])]) map.setSize(cw, ch, 1);
    this.interleave(tier.cloudInterleave);
    this.hasHistory = false;
  }

  /** March one pixel in every `n` × `n` block this frame. */
  private interleave(n: number): void {
    const u = this.u, size = u.cloudSize.value, mw = Math.ceil(size.x / n), mh = Math.ceil(size.y / n), march = tiles(mw, mh);
    u.interleave.value = n;
    u.marchSize.value.set(mw, mh);
    u.marchTiles.value = march.x;
    for (const kernel of this.marchKernels.values()) kernel.count = march.count;
  }

  private makeShadowMap(size: number): StorageTexture {
    const map = makeStorage(size, size, UnsignedByteType);
    map.name = 'Cloud shadow';
    map.wrapS = map.wrapT = RepeatWrapping;
    this.u.shadowSize.value = size;
    return map;
  }

  /** The unit world ray through a point of the cloud buffer (uv, y down), from the game camera. */
  private ray(uv: Vec2): Vec3 {
    const u = this.u, ndc = vec4(uv.x.mul(2).sub(1), uv.y.mul(-2).add(1), .5, 1);
    const view = u.projectionInverse.mul(ndc);
    return u.cameraWorld.mul(vec4(view.xyz.div(view.w), 0)).xyz.normalize();
  }

  /** One ray in every interleave block of the cloud buffer: its (radiance, transmittance) and (depth km). */
  private buildMarch(lightSteps: number): ComputeNode {
    const u = this.u;
    return Fn(() => {
      const m = tiled(u.marchTiles);
      If(within(m, u.marchSize), () => {
        const cell = cellMin(m.mul(u.interleave).add(u.offset), ivec2(u.cloudSize).sub(1));
        const uv = vec2(cell).add(.5).div(u.cloudSize);
        const direction = this.ray(uv).toVar();
        const origin = this.sky.cameraPosition;
        const result = marchClouds(this.context, origin, origin.y, direction,
          { steps: u.steps, lightSteps, jitter: gradientJitter(vec2(cell), u.frame), pixelAngle: u.pixelAngle,
            rain: { uniforms: { precipitation: u.precipitation, drift: this.windAxis }, detail: this.volumes[1].map, shadow: p => this.shadowAt(p, true) } });
        textureStore(this.march.color, uvec2(m), vec4(result.radiance, result.transmittance));
        textureStore(this.march.depth, uvec2(m), vec4(result.depth.div(1000), 0, 0, 1));
      });
    })().compute(1, [TILE * TILE]);
  }

  /** Temporal reconstruction into history `1 − from`: every pixel reprojects its history (by the depth its
   * block's fresh ray found, and the wind's drift since the last frame), clamped to the fresh rays around it;
   * the pixel marched this frame blends its new sample in. `depth` holds (transmittance, depth in km ×
   * cover), so bilinear reads weight depth by cover. */
  private buildResolve(from: 0 | 1): ComputeNode {
    const u = this.u, target = this.history[1 - from];
    return Fn(() => {
      const c = tiled(u.cloudTiles);
      If(within(c, u.cloudSize), () => {
        const n = u.interleave, last = ivec2(u.marchSize).sub(1);
        const block = c.div(n), inBlock = c.sub(block.mul(n));
        const fresh = inBlock.x.equal(u.offset.x).and(inBlock.y.equal(u.offset.y));
        const load = (map: TextureNode, at: Cell) => direct(map.load(cellMax(cellMin(at, last), ivec2(0, 0)))) as unknown as Vec4;
        const own = load(this.marchColor, block).toVar();
        const lo = own.toVar(), hi = own.toVar(), sum = own.toVar();
        for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
          const v = load(this.marchColor, block.add(ivec2(dx, dy))).toVar();
          lo.assign(min(lo, v)); hi.assign(max(hi, v)); sum.addAssign(v);
        }
        const depthKm = load(this.marchDepth, block).x;
        // Far clouds are marched in long, jittered steps: their fresh samples are smoothed with the neighbours
        // (a pixel there spans more cloud than the jitter resolves); near ones keep their own detail.
        const centre = mix(own, sum.div(9), smoothstep(FAR_SMOOTHING[0], FAR_SMOOTHING[1], depthKm.mul(1000))).toVar();
        const uv = vec2(c).add(.5).div(u.cloudSize);
        const distance = select(centre.w.lessThan(.999), depthKm.mul(1000), float(CLEAR_DISTANCE));
        const world = this.sky.cameraPosition.add(this.ray(uv).mul(distance)).sub(u.windShift);
        const clip = u.previousViewProjection.mul(vec4(world, 1));
        const previous = clip.xy.div(clip.w).mul(vec2(.5, -.5)).add(.5);
        const valid = u.history.greaterThan(0).and(clip.w.greaterThan(0))
          .and(previous.x.greaterThanEqual(0)).and(previous.x.lessThanEqual(1)).and(previous.y.greaterThanEqual(0)).and(previous.y.lessThanEqual(1));
        const color = vec4(0).toVar(), weightedDepth = float(0).toVar();
        If(valid, () => {
          const history = (direct(this.readColor[from].sample(previous).level(float(0))) as unknown as Vec4).clamp(lo, hi);
          const historyDepth = (direct(this.readDepth[from].sample(previous).level(float(0))) as unknown as Vec4).y;
          color.assign(select(fresh, mix(history, centre, u.fresh), history));
          weightedDepth.assign(select(fresh, mix(historyDepth, depthKm.mul(centre.w.oneMinus()), u.fresh), historyDepth));
        }).Else(() => {
          // No history: the fresh sample here, else the march buffer upsampled around this pixel.
          const at = vec2(c).sub(vec2(u.offset)).div(vec2(n, n)).add(.5).div(u.marchSize);
          const upsampled = direct(this.marchColor.sample(at).level(float(0))) as unknown as Vec4;
          color.assign(select(fresh, centre, upsampled));
          weightedDepth.assign(depthKm.mul(color.w.oneMinus()));
        });
        textureStore(target.color, uvec2(c), color);
        textureStore(target.depth, uvec2(c), vec4(color.w, weightedDepth, 0, 1));
      });
    })().compute(1, [TILE * TILE]);
  }

  /** The cloud shadow map, one texel in `slices` per run: the sun's transmittance through the shell above
   * each sea-level texel near the camera. Texels are laid out in the clouds' drifting frame, wrapping: each
   * holds whichever cell of that frame lies within half the map of the camera. */
  private buildShadow(slices: number): ComputeNode {
    const u = this.u, wind = this.sky.windOffset, camera = this.sky.cameraPosition;
    return Fn(() => {
      const index = int(instanceIndex).mul(slices).add(slices > 1 ? u.shadowSlice : int(0));
      const texel = ivec2(index.mod(u.shadowSize), index.div(u.shadowSize));
      const cell = vec2(texel).add(.5).div(float(u.shadowSize));
      const centre = camera.xz.sub(wind.xz).div(SHADOW_EXTENT);
      const drifted = round(centre.sub(cell)).add(cell).mul(SHADOW_EXTENT);
      const point = vec3(drifted.x.add(wind.x), 0, drifted.y.add(wind.z));
      textureStore(this.shadowStore, uvec2(texel), vec4(shadowTransmittance(this.context, point, this.sky.sunDirection, SHADOW_STEPS), 0, 0, 1));
    })().compute(1, [64]);
  }

  /** The full-screen composite: premultiplied cloud radiance over what the scene drew (`dst = src + dst ×
   * transmittance`). `depthTested`: each pixel at the clouds' own depth (ships and islands hide them, they
   * hide the sea from above); otherwise at the far plane, behind everything. */
  private buildComposite(reversedDepth: boolean, depthTested: boolean): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: false });
    material.name = depthTested ? 'Cloud composite (depth)' : 'Cloud composite';
    material.fog = false;
    material.toneMapped = false;
    material.blending = CustomBlending;
    material.blendSrc = OneFactor; material.blendDst = SrcAlphaFactor;
    material.blendSrcAlpha = ZeroFactor; material.blendDstAlpha = OneFactor;
    const color = direct(this.latestColor.sample(screenUV)) as unknown as Vec4;
    if (depthTested) {
      const cover = color.w.oneMinus();
      const depthKm = (direct(this.latestDepth.sample(screenUV)) as unknown as Vec4).y.div(max(cover, 1e-4));
      const forward = cameraViewMatrix.mul(vec4(viewDirection(), 0)).z;
      const viewZ = depthKm.mul(1000).mul(forward);
      const projected = reversedDepth ? viewZToReversedPerspectiveDepth(viewZ, cameraNear, cameraFar) : viewZToPerspectiveDepth(viewZ, cameraNear, cameraFar);
      material.depthNode = reversedDepth ? max(projected, 1e-10) : min(projected, 1 - 1e-7);
      // The fragment depth replaces the vertex's; mid-range keeps the triangle clear of both clip planes.
      material.vertexNode = screenCorner(float(.5));
    } else {
      material.vertexNode = screenCorner(float(reversedDepth ? 0 : 1));
    }
    const sky = this.sky;
    material.fragmentNode = Fn(() => {
      If(color.w.greaterThan(.9995), () => { Discard(); });
      const radiance = color.xyz.toVar();
      // Lightning lights the cloud the pixel shows, from inside: here rather than in the march, so a flash
      // shows at once over the whole cloud instead of one pixel in sixteen a frame, and costs nothing else.
      If(sky.lightningIntensity.greaterThan(0), () => {
        const cover = color.w.oneMinus();
        const depth = (direct(this.latestDepth.sample(screenUV)) as unknown as Vec4).y.div(max(cover, 1e-4)).mul(1000);
        const toward = sky.cameraPosition.add(viewDirection().mul(depth)).sub(sky.lightningPosition);
        const distance = max(toward.length(), LIGHTNING_NEAREST);
        const irradiance = sky.lightningIntensity.mul(float(1000).div(distance).pow(2));
        radiance.addAssign(vec3(LIGHTNING_TINT[0], LIGHTNING_TINT[1], LIGHTNING_TINT[2])
          .mul(irradiance.mul(LIGHTNING_GLOW).mul(distance.div(-LIGHTNING_SPREAD).exp()).mul(cover)));
      });
      return vec4(radiance, color.w);
    })();
    writeSceneTargets(material);
    return material;
  }
}

const scratch = new Vector2();
const smooth = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function mapTexture(bytes: Uint8Array, size: number, name: string): DataTexture {
  const map = new DataTexture(bytes, size, size, RGBAFormat, UnsignedByteType);
  map.name = name;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.minFilter = map.magFilter = LinearFilter;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  return map;
}

/** Creates the cloud part for the sky facade. */
export function createCloudLayer(context: SkyPartContext, atmosphere: AtmospherePart): CloudLayer {
  return new CloudLayer(context.renderer, context.uniforms, atmosphere, context.quality, context.reversedDepth);
}
