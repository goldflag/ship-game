import { CustomBlending, DataTexture, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, MeshBasicNodeMaterial, OneFactor, RepeatWrapping, RGBAFormat, SrcAlphaFactor,
  StorageTexture, UnsignedByteType, Vector2, Vector3, ZeroFactor, type ComputeNode, type Node, type PerspectiveCamera, type StorageTextureNode, type TextureNode,
  type UniformNode, type WebGPURenderer } from 'three/webgpu';
import { Discard, Fn, If, cameraFar, cameraNear, cameraViewMatrix, dot, float, instanceIndex, int, ivec2, max, min, mix, round, screenUV, select, smoothstep,
  storageTexture, texture, textureStore, uniform, uvec2, vec2, vec3, vec4, viewZToPerspectiveDepth, viewZToReversedPerspectiveDepth } from 'three/tsl';
import { CLOUD_SHADOW_FLOOR, type AtmospherePart, type CloudPart, type SkyFrame, type SkyPartContext, type SkyQuality, type SkyScene, type SkyUniforms } from '../contracts';
import { CLOUD_ORDER, fullScreenTriangle, screenCorner, viewDirection } from '../dome';
import { SKY_TIERS } from '../quality';
import { writeSceneTargets } from '../../TemporalAntialiasing';
import { CIRRUS_TABLE, cirrusAmount, cirrusLight, cirrusTableDirection, createCirrus } from './cirrus';
import { FARTHEST, createCloudField, createLayerUniforms, type CloudField, type LayerUniforms } from './field';
import { afterglow, cloudLightAt, createCloudLight, gradientJitter, marchClouds, shadowTransmittance, type CloudLight, type MarchContext } from './march';
import { cirrusMap, clearDistance, clearThreshold, weatherChannels, weatherMap, CIRRUS_SIZE, CLEAR_RANGE, PLANET_RADIUS, WEATHER_SIZE } from './model';
import { baseVolume, detailVolume, type GeneratedVolume } from './noise';
import { catmullRom, sharpBilinear } from './sampling';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Vec3 = Node<'vec3'>;
type Vec4 = Node<'vec4'>;
type Cell = Node<'ivec2'>;

/** Weight of a pixel's reprojected history against a fresh ray marched right on it (1); rays marched a pixel or
 * more away weigh less, by a Gaussian of `SPLAT` cloud-buffer pixels while the view moves (they fill in what the
 * history lacks) and of `SPLAT_STILL` while it holds still (the history is right, and wider it would blur). */
const HISTORY_WEIGHT = 4, SPLAT = .7, SPLAT_STILL = .42;
/** Frames after a cut that march every pixel, and their history weight. */
const CATCH_UP_FRAMES = 2, CATCH_UP_WEIGHT = 1;
/** Reprojection motion (cloud-buffer pixels per frame) over which history goes from unclamped to clamped. */
const CLAMP_MOTION = [.3, 2] as const;
/** Where a pixel met no cloud, history is reprojected as if this far away (m): the sky's own motion. */
const CLEAR_DISTANCE = 30_000;
/** Ground the cloud shadow map covers (m), around the camera. */
const SHADOW_EXTENT = 40_000;
/** Samples of the shadow map's march along the sun. */
const SHADOW_STEPS = 8;
/** Texels of the shadow map refreshed each frame, in interleaved slices. The map is laid out in the clouds'
 * own drifting frame, so it follows the wind exactly and only the clouds' slow change of shape ages it. */
const SHADOW_TEXELS_PER_FRAME = 4096;
/** Share of the shadow map's half-width over which it fades to full sun at its edge. */
const SHADOW_EDGE = .15;
/** Sun heights (the sine of its elevation) over which cloud shadows fade in after sunrise: a sun on the
 * horizon lights the sea from under the clouds, not through them. */
const SHADOW_SUN = [.02, .12] as const;
/** The authored `clouds.ambient` was tuned against another model: this is the value meaning a gain of 1. */
const AUTHORED_AMBIENT = 1.1;
/** Texels of the light table (`buildLightTable`) along the light's heading, across ±`FARTHEST`, and up through
 * the layer. The planet's shadow edge spans about 60 km of the one and a kilometre of the other. */
const LIGHT_ALONG = 64, LIGHT_UP = 32;
/** Kernels run in 8 × 8 texel tiles, so neighbouring rays share a warp and the texture cache. */
const TILE = 8;
/** Coverage over which the layer comes to shade the air and sea under it, and the share of their light it takes
 * at full cover (`MarchContext.deckShade`). */
const DECK_SHADE = [.55, 1, .6] as const;
/** Updates a held sky (`hold`) marches a still view before it stops: past every tier's interleave cycle and the history's
 * memory, so what it keeps is converged. */
const HOLD_UPDATES = 48;
/** Frames drawn with the per-pixel-depth composite first, so both composite pipelines compile at startup. */
const WARMUP_FRAMES = 3;
/** Sun elevation (degrees) below which the moon lights the clouds instead. */
const NIGHT_BELOW = -10;
/** Twilight (sun elevations in degrees): the afterglow lights the clouds from as the sun sets to fully a degree
 * after, and fades before the moon takes over. The clouds' light direction follows the sun until its light leaves
 * the layer's tops, then turns up to the glow's height over the horizon. */
const GLOW_ON = [2, -1] as const, GLOW_OFF = [NIGHT_BELOW + 1.5, NIGHT_BELOW] as const, SWING = [-1.5, -4] as const, GLOW_ELEVATION = 5;
/** Finest the march's distance-proportional steps get under magnification (a share of their normal length). */
const ZOOMED_STEPS = .25;
/** Metres below the base under which the camera is "under the layer": clouds then lie behind everything. */
const UNDER_MARGIN = 20;
/** Lightning, in the weather part's convention: `SkyUniforms.lightningIntensity` is the irradiance, in the sea's
 * units, the channel casts 1 km away (the sun's is about 6; a stroke peaks at 40), falling off with the square of
 * distance, here softened inside `core` metres (the cloud around the channel diffuses it rather than
 * showing a point). A cloud glows with `glow` of the irradiance reaching it, dimmed over `spread` metres as
 * the light works through the cloud down to a `tail` of it that the deck carries on: the struck cell lights up,
 * its neighbours less, the rest of the deck faintly, and every cloud lifts by `lift` of itself with the scene's
 * flash (`SkyUniforms.flash`, a multiple of the ambient). At a peak of 40, cloud half a kilometre from the channel
 * glows about 2.2 (a flash into the bloom), 1 km away 0.7, 2 km away 0.12, 3 km away 0.04, 5 km away 0.01 (a
 * moonlit cloud is about 0.1). */
export const lightning = { glow: uniform(.045), spread: uniform(1_000), core: uniform(600), tail: uniform(.15), lift: uniform(.6) };
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
  /** The scene's cirrus (`cirrusAmount`), drawn at tiers that draw cirrus. */
  private cirrusAmount = 0;
  /** The clouds' drift heading as a unit XZ vector. */
  private readonly windAxis = uniform(new Vector2(0, 1));
  private readonly cirrusFn: (direction: Vec3, behind: Vec3) => Vec3;
  /** The cirrus lighting table (`cirrus.ts`), refreshed every frame. */
  private readonly cirrusTable: StorageTexture;
  private readonly cirrusKernel: ComputeNode;
  /** The light's colour through the layer (`buildLightTable`), refreshed every frame. */
  private readonly lightTable: StorageTexture;
  private readonly lightKernel: ComputeNode;
  /** The light's heading as a unit XZ vector (any unit vector while it stands overhead). */
  private readonly lightHeading = uniform(new Vector2(1, 0));
  /** The tables alone, for frames without a cloud update. */
  private readonly tablesOnly: ComputeNode[];
  private readonly u = {
    steps: uniform(64, 'int'), bakeSteps: uniform(16, 'int'),
    frame: uniform(0), offset: uniform(new Vector2(), 'ivec2'), interleave: uniform(2, 'int'),
    cloudSize: uniform(new Vector2(1, 1)), marchSize: uniform(new Vector2(1, 1)), cloudTiles: uniform(1, 'int'), marchTiles: uniform(1, 'int'),
    projectionInverse: uniform(new Matrix4()), cameraWorld: uniform(new Matrix4()), previousViewProjection: uniform(new Matrix4()),
    windShift: uniform(new Vector3()), history: uniform(0), latestViewProjection: uniform(new Matrix4()), stepScale: uniform(1), historyWeight: uniform(HISTORY_WEIGHT), pixelAngle: uniform(.003),
    shadowSize: uniform(256, 'int'), shadowSlice: uniform(0, 'int'), shadowSlices: uniform(1, 'int'), shadowStrength: uniform(0),
    ambient: uniform(1), baseShadow: uniform(.2), deckShade: uniform(1), under: uniform(1), precipitation: uniform(0),
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
  /** Cloud updates run, and frames since the last. */
  private updates = 0;
  private sinceUpdate = 0;
  private hasHistory = false;
  private catchUp = 0;
  private shadowStale = true;
  private active = true;
  private readonly previousViewProjection = new Matrix4();
  private readonly viewProjection = new Matrix4();
  private readonly previousWind = new Vector3();
  /** Held (`hold`): updates marched since the view last changed, and that view. */
  private held = false;
  private heldUpdates = 0;
  private readonly heldView = new Matrix4();

  constructor(renderer: WebGPURenderer, private readonly sky: SkyUniforms, atmosphere: AtmospherePart, quality: SkyQuality, reversedDepth: boolean) {
    this.quality = quality;
    this.volumes = [baseVolume(renderer), detailVolume(renderer)];
    this.weatherChannels = weatherChannels();
    this.weather = mapTexture(weatherMap(this.weatherChannels, clearDistance(this.weatherChannels[0], 2)), WEATHER_SIZE, 'Cloud weather');
    this.cirrusTexture = mapTexture(cirrusMap(), CIRRUS_SIZE, 'Cirrus', true);
    this.layer = createLayerUniforms();
    this.light = createCloudLight();
    this.field = createCloudField(sky, this.layer, { weather: this.weather, base: this.volumes[0].map, detail: this.volumes[1].map });
    this.lightTable = makeStorage(LIGHT_ALONG, LIGHT_UP);
    const lightRead = texture(this.lightTable);
    this.context = {
      sky, atmosphere, field: this.field, light: this.light, ambient: this.u.ambient, baseShadow: this.u.baseShadow, deckShade: this.u.deckShade,
      lightAt: (p, height) => {
        const along = dot(p.xz.sub(sky.cameraPosition.xz), this.lightHeading).div(2 * FARTHEST).add(.5);
        const read = lightRead.sample(vec2(along, height.clamp(0, 1))).level(float(0));
        read.updateMatrix = false;
        return (read as unknown as Vec4).xyz;
      },
    };
    this.cirrusTable = makeStorage(CIRRUS_TABLE, CIRRUS_TABLE);
    this.cirrusFn = createCirrus(sky, this.cirrusTexture, texture(this.cirrusTable), this.cirrusStrength, this.windAxis);
    this.cirrusKernel = this.buildCirrusTable(atmosphere);
    this.lightKernel = this.buildLightTable(atmosphere);
    this.tablesOnly = [this.lightKernel, this.cirrusKernel];
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
    this.shadowKernels = { slice: this.buildShadow(true), full: this.buildShadow(false) };
    for (const tier of Object.values(SKY_TIERS)) {
      if (this.marchKernels.has(tier.cloudLightSteps)) continue;
      const march = this.buildMarch(tier.cloudLightSteps);
      this.marchKernels.set(tier.cloudLightSteps, march);
      const shadow = this.shadowKernels, cirrus = this.cirrusKernel, light = this.lightKernel;
      this.submissions.set(march, this.resolveKernels.map(resolve =>
        [[light, march, resolve, cirrus], [light, march, resolve, shadow.slice, cirrus], [light, march, resolve, shadow.full, cirrus]]));
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
    this.u.deckShade.value = 1 - smooth(layer.coverage.value, DECK_SHADE[0], DECK_SHADE[1]) * DECK_SHADE[2];
    this.u.precipitation.value = scene.weather.precipitation;
    this.cirrusAmount = cirrusAmount(clouds.coverage, clouds.windHeading + scene.sun.azimuth);
    this.cirrusStrength.value = SKY_TIERS[this.quality].cloudCirrus ? this.cirrusAmount : 0;
    const heading = clouds.windHeading * Math.PI / 180;
    this.windAxis.value.set(Math.sin(heading), Math.cos(heading));
    this.hasHistory = false;
    this.shadowStale = true;
  }

  cirrus(direction: Vec3, behind: Vec3): Vec3 { return this.cirrusFn(direction, behind); }

  bake(origin: Vec3, direction: Vec3): Vec4 {
    return Fn(() => {
      const result = marchClouds(this.context, origin, this.field.altitude(origin), direction,
        { steps: this.u.bakeSteps, lightSteps: 0, jitter: .5, fromSea: true, under: 1 });
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
    const uv = ground.sub(wind.xz).div(SHADOW_EXTENT);
    // The scene reads a cubic B-spline (four bilinear reads): the map's texels are 80–160 m, and a bilinear
    // read draws their grid into a shadow's edge. Compute passes (the rain) make do with one read.
    const value = explicit ? direct(this.shadowRead.sample(uv).level(float(0))).r : this.smoothShadow(uv);
    const shade = mix(float(CLOUD_SHADOW_FLOOR), float(1), value);
    return mix(float(1), shade, this.u.shadowStrength.mul(smoothstep(1, 1 - SHADOW_EDGE, edge)).mul(this.layer.enabled));
  }

  /** Cubic B-spline filtered read of the shadow map at `uv`, as four bilinear reads (Sigg & Hadwiger 2005). */
  private smoothShadow(uv: Vec2): Float {
    const size = float(this.u.shadowSize), coord = uv.mul(size).sub(.5), base = coord.floor(), f = coord.sub(base);
    const f2 = f.mul(f), f3 = f2.mul(f);
    const w0 = f.oneMinus().pow(3).div(6), w1 = f3.mul(3).sub(f2.mul(6)).add(4).div(6);
    const w2 = f3.mul(-3).add(f2.mul(3)).add(f.mul(3)).add(1).div(6), w3 = f3.div(6);
    const g0 = w0.add(w1), g1 = w2.add(w3);
    const p0 = base.sub(.5).add(w1.div(g0)).div(size), p1 = base.add(1.5).add(w3.div(g1)).div(size);
    const read = (x: Float, y: Float) => direct(this.shadowRead.sample(vec2(x, y))).r;
    return mix(mix(read(p1.x, p1.y), read(p0.x, p1.y), g0.x), mix(read(p1.x, p0.y), read(p0.x, p0.y), g0.x), g0.y);
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
    this.cirrusStrength.value = tier.cloudCirrus ? this.cirrusAmount : 0;
    if (this.u.shadowSize.value !== tier.cloudShadowSize) {
      this.shadowMap.dispose();
      this.shadowMap = this.makeShadowMap(tier.cloudShadowSize);
      this.shadowRead.value = this.shadowMap;
      this.shadowStore.value = this.shadowMap;
      this.shadowStale = true;
    }
    const size = this.u.shadowSize.value;
    this.u.shadowSlices.value = Math.max(1, Math.ceil(size * size / SHADOW_TEXELS_PER_FRAME));
    this.shadowKernels.slice.count = Math.ceil(size * size / this.u.shadowSlices.value);
    this.shadowKernels.full.count = size * size;
    this.resizeTargets();
  }

  update(frame: SkyFrame): void {
    const { renderer, camera } = frame, tier = SKY_TIERS[this.quality], u = this.u;
    const size = renderer.getDrawingBufferSize(scratch);
    if (size.x !== this.width || size.y !== this.height) this.resize(size.x, size.y);
    this.updateLight();
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // Held, every new view starts afresh (no history, no drift since the last march) and marches the same jitter
    // sequence from its start, then stands still: what it keeps owes nothing to the frames before.
    if (this.held && (frame.cut || !sameView(this.viewProjection, this.heldView))) {
      this.heldView.copy(this.viewProjection); this.heldUpdates = this.updates = 0;
      this.hasHistory = false; this.shadowStale = true; this.current = 0; this.previousWind.copy(this.sky.windOffset.value);
    }
    const converged = this.held && this.heldUpdates >= HOLD_UPDATES;
    // After a cut every pixel is marched for a couple of frames, so the new view starts clean at full
    // resolution rather than converging from an upsampled first frame over the whole interleave cycle.
    if (!this.hasHistory || frame.cut) this.catchUp = CATCH_UP_FRAMES;
    // Under the layer the clouds are kilometres away and a tier may update them every few frames: the
    // composite turns the last update to the current view in between. Nearer (inside or above the layer)
    // their parallax needs every frame.
    const under = camera.position.y < this.layer.base.value - UNDER_MARGIN;
    const due = this.catchUp > 0 || ++this.sinceUpdate >= (under ? tier.cloudUpdateInterval : 1);
    this.chooseComposite(camera);
    if (!this.compiled) {
      // Every tier's march compiles now, under the loading screen: a later tier change must not hitch. One
      // workgroup runs with a count of zero, so the kernel's bounds check returns before anything is written.
      for (const kernel of this.marchKernels.values()) {
        const count = kernel.count;
        kernel.count = 0;
        renderer.compute(kernel, [1, 1, 1]);
        kernel.count = count;
      }
      this.compiled = true;
    }
    if (!this.active || !due || converged) {
      renderer.compute(this.tablesOnly);
      return;
    }
    this.sinceUpdate = 0;
    u.projectionInverse.value.copy(camera.projectionMatrixInverse);
    u.cameraWorld.value.copy(camera.matrixWorld);
    u.under.value = under ? 1 : 0;
    // Angle one cloud-buffer pixel spans: the detail fades where a pixel's footprint cannot resolve it.
    u.pixelAngle.value = 2 * Math.tan(camera.getEffectiveFOV() * Math.PI / 360) / u.cloudSize.value.y;
    // Magnified (binoculars), far clouds fill the view: their steps shrink with the view's angle.
    u.stepScale.value = Math.min(1, Math.max(ZOOMED_STEPS, Math.tan(camera.getEffectiveFOV() * Math.PI / 360) / Math.tan(Math.PI / 6)));
    const wind = this.sky.windOffset.value;
    u.windShift.value.subVectors(wind, this.previousWind);
    u.previousViewProjection.value.copy(this.hasHistory ? this.previousViewProjection : this.viewProjection);
    u.history.value = this.hasHistory && !frame.cut ? 1 : 0;
    this.interleave(this.catchUp > 0 ? 1 : tier.cloudInterleave);
    u.historyWeight.value = this.catchUp > 0 ? CATCH_UP_WEIGHT : HISTORY_WEIGHT;
    if (this.catchUp > 0) this.catchUp--;
    const order = BLOCK_ORDER[u.interleave.value] ?? BLOCK_ORDER[1];
    const [ox, oy] = order[this.updates % order.length];
    u.offset.value.set(ox, oy);
    u.frame.value = this.updates % 1024;
    u.shadowSlice.value = this.updates % u.shadowSlices.value;
    this.updates++;
    if (this.held) this.heldUpdates++;
    const shadows = u.shadowStrength.value > 0 ? (this.shadowStale || frame.cut ? 2 : 1) : 0;
    renderer.compute(this.submissions.get(this.marchKernels.get(tier.cloudLightSteps)!)![this.current][shadows]);
    if (shadows === 2) this.shadowStale = false;
    // The reconstruction wrote the other history; everything downstream reads it from now on, in this view.
    this.current = 1 - this.current;
    const latest = this.history[this.current];
    this.latestColor.value = latest.color;
    this.latestDepth.value = latest.depth;
    this.screenTransmittance.value = latest.depth;
    u.latestViewProjection.value.copy(this.viewProjection);
    this.hasHistory = true;
    this.previousViewProjection.copy(this.viewProjection);
    this.previousWind.copy(wind);
  }

  hold(held: boolean): void { this.held = held; this.heldUpdates = this.updates = 0; }

  dispose(): void {
    for (const map of [this.march.color, this.march.depth, ...this.history.flatMap(h => [h.color, h.depth]), this.shadowMap, this.cirrusTable, this.lightTable]) {
      map.dispose();
    }
    for (const kernel of [...this.marchKernels.values(), ...this.resolveKernels, this.shadowKernels.slice, this.shadowKernels.full, this.cirrusKernel,
      this.lightKernel]) kernel.dispose();
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

  /** The sun lights the clouds until it is well below the horizon, then the moon does. Through twilight the
   * atmosphere's sun transmittance (with its dusk lift, above 1 on purpose) makes the clouds glow against the
   * brightened sky while the planet's shadow climbs them; by the switch the sun's light on them is spent. */
  private updateLight(): void {
    const sun = this.sky.sunDirection.value, night = sun.y < Math.sin(NIGHT_BELOW * Math.PI / 180);
    const elevation = Math.asin(Math.min(1, Math.max(-1, sun.y))) * 180 / Math.PI;
    this.light.night.value = night ? 1 : 0;
    this.light.glow.value = night ? 0 : smooth(elevation, GLOW_ON[0], GLOW_ON[1]) * smooth(elevation, GLOW_OFF[1], GLOW_OFF[0]);
    const direction = this.light.direction.value.copy(night ? this.sky.moonDirection.value : sun);
    const level = Math.hypot(direction.x, direction.z);
    if (level > 1e-4) this.lightHeading.value.set(direction.x / level, direction.z / level);
    if (!night && elevation < SWING[0]) {
      const lifted = (elevation + (GLOW_ELEVATION - elevation) * smooth(elevation, SWING[0], SWING[1])) * Math.PI / 180;
      direction.set(this.lightHeading.value.x * Math.cos(lifted), Math.sin(lifted), this.lightHeading.value.y * Math.cos(lifted));
    }
    this.u.shadowStrength.value = smooth(sun.y, SHADOW_SUN[0], SHADOW_SUN[1]);
  }

  /** Under the layer every cloud lies behind whatever the scene drew (ships and the sea stand below the base),
   * so the composite sits at the far plane and the depth test skips those pixels before shading them. From
   * inside or above the layer clouds can be in front, and each pixel is tested at the clouds' own depth. */
  private chooseComposite(camera: PerspectiveCamera): void {
    // Rain shafts hang in front of the sea and ships, so a raining sky always tests depth.
    const under = camera.position.y < this.layer.base.value - UNDER_MARGIN && this.u.precipitation.value <= 0 && ++this.frameIndex > WARMUP_FRAMES;
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
  /** The light's colour through the layer (`MarchContext.lightAt`): a table over the distance along the light's
   * heading from the camera (±`FARTHEST`) and the height through the layer. The light's transmittance, the
   * planet's shadow included, depends on a point's altitude and on how far toward the light it lies (its zenith
   * turns with the planet's curve), hardly at all on its offset across: one read replaces the atmosphere's
   * tables at every lit sample, and at dusk the shadow's edge climbs through the layer as it does in the sky. */
  private buildLightTable(atmosphere: AtmospherePart): ComputeNode {
    return Fn(() => {
      const i = int(instanceIndex), texel = ivec2(i.mod(LIGHT_ALONG), i.div(LIGHT_ALONG));
      const along = float(texel.x).add(.5).div(LIGHT_ALONG).mul(2).sub(1).mul(FARTHEST);
      const altitude = this.layer.base.add(float(texel.y).add(.5).div(LIGHT_UP).mul(this.layer.thickness));
      // The world point at that altitude above the curved sea (the flat world's height drops with distance).
      const r = altitude.add(PLANET_RADIUS), height = altitude.sub(along.mul(along).div(r.add(r.mul(r).sub(along.mul(along)).max(0).sqrt())));
      const camera = this.sky.cameraPosition;
      const point = vec3(camera.x.add(this.lightHeading.x.mul(along)), height, camera.z.add(this.lightHeading.y.mul(along)));
      const light = cloudLightAt(this.sky, atmosphere, this.light, point).add(afterglow(atmosphere, this.light));
      textureStore(this.lightTable, uvec2(texel), vec4(light, 1));
    })().compute(LIGHT_ALONG * LIGHT_UP, [64]);
  }

  /** The cirrus lighting table: what the sheet sends toward the viewer along each direction above the horizon. */
  private buildCirrusTable(atmosphere: AtmospherePart): ComputeNode {
    return Fn(() => {
      const i = int(instanceIndex), texel = ivec2(i.mod(CIRRUS_TABLE), i.div(CIRRUS_TABLE));
      const direction = cirrusTableDirection(vec2(texel).add(.5).div(CIRRUS_TABLE));
      textureStore(this.cirrusTable, uvec2(texel), vec4(cirrusLight(this.sky, atmosphere, this.light, direction), 1));
    })().compute(CIRRUS_TABLE * CIRRUS_TABLE, [64]);
  }

  private buildMarch(lightSteps: number): ComputeNode {
    const u = this.u;
    return Fn(() => {
      const m = tiled(u.marchTiles);
      If(within(m, u.marchSize), () => {
        const cell = cellMin(m.mul(u.interleave).add(u.offset), ivec2(u.cloudSize).sub(1));
        const uv = vec2(cell).add(.5).div(u.cloudSize);
        const direction = this.ray(uv).toVar();
        const origin = this.sky.cameraPosition;
        // The jitter spreads over neighbouring rays of this update (the march texels), as interleaved gradient
        // noise is made to; read at interleaved pixels it would stripe, most of all the rain's long steps.
        const result = marchClouds(this.context, origin, origin.y, direction,
          { steps: u.steps, lightSteps, jitter: gradientJitter(vec2(m), u.frame), pixelAngle: u.pixelAngle, stepScale: u.stepScale, under: u.under,
            rain: { uniforms: { precipitation: u.precipitation, drift: this.windAxis }, detail: this.volumes[1].map, shadow: p => this.shadowAt(p, true) } });
        textureStore(this.march.color, uvec2(m), vec4(result.radiance, result.transmittance));
        textureStore(this.march.depth, uvec2(m), vec4(result.depth.div(1000), 0, 0, 1));
      });
    })().compute(1, [TILE * TILE]);
  }

  /** Temporal reconstruction into history `1 − from` (temporal upsampling): every pixel reprojects its history,
   * by the depth the nearest fresh rays found and the wind's drift since the last frame, and blends in this
   * frame's four nearest fresh rays, each weighted by how close to the pixel it was marched. Over one interleave
   * cycle every pixel is marched once and neighbours fill in between, so the buffer converges smoothly with no
   * block pattern. `depth` holds (transmittance, depth in km × cover), so bilinear reads weight depth by cover. */
  private buildResolve(from: 0 | 1): ComputeNode {
    const u = this.u, target = this.history[1 - from];
    return Fn(() => {
      const c = tiled(u.cloudTiles);
      If(within(c, u.cloudSize), () => {
        const n = float(u.interleave), last = ivec2(u.marchSize).sub(1);
        const load = (map: TextureNode, at: Cell) => direct(map.load(cellMax(cellMin(at, last), ivec2(0, 0)))) as unknown as Vec4;
        // The four march texels around this pixel, and where in the cloud buffer each was marched.
        const place = vec2(c).sub(vec2(u.offset)).div(n), corner = ivec2(place.floor());
        const sum = vec4(0).toVar(), depthSum = float(0).toVar(), weights = float(0).toVar();
        const still = vec4(0).toVar(), stillDepth = float(0).toVar(), stillWeights = float(0).toVar();
        const lo = vec4(1e9).toVar(), hi = vec4(-1e9).toVar(), nearest = float(1e9).toVar(), nearestDepth = float(0).toVar();
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const texel = corner.add(ivec2(dx, dy)), sample = load(this.marchColor, texel).toVar(), depth = load(this.marchDepth, texel).x;
          const offset = vec2(texel).mul(n).add(vec2(u.offset)).sub(vec2(c)), d2 = offset.dot(offset);
          const w = d2.mul(-.5 / (SPLAT * SPLAT)).exp(), v = d2.mul(-.5 / (SPLAT_STILL * SPLAT_STILL)).exp();
          const covered = depth.mul(sample.w.oneMinus());
          sum.addAssign(sample.mul(w)); depthSum.addAssign(covered.mul(w)); weights.addAssign(w);
          still.addAssign(sample.mul(v)); stillDepth.addAssign(covered.mul(v)); stillWeights.addAssign(v);
          lo.assign(min(lo, sample)); hi.assign(max(hi, sample));
          If(d2.lessThan(nearest), () => { nearest.assign(d2); nearestDepth.assign(select(sample.w.lessThan(.999), depth.mul(1000), float(CLEAR_DISTANCE))); });
        }
        const uv = vec2(c).add(.5).div(u.cloudSize);
        const world = this.sky.cameraPosition.add(this.ray(uv).mul(nearestDepth)).sub(u.windShift);
        const clip = u.previousViewProjection.mul(vec4(world, 1));
        const previous = clip.xy.div(clip.w).mul(vec2(.5, -.5)).add(.5);
        const valid = u.history.greaterThan(0).and(clip.w.greaterThan(0))
          .and(previous.x.greaterThanEqual(0)).and(previous.x.lessThanEqual(1)).and(previous.y.greaterThanEqual(0)).and(previous.y.lessThanEqual(1));
        const color = vec4(0).toVar(), weightedDepth = float(0).toVar();
        If(valid, () => {
          // Clamp to the fresh rays around only as far as the view moved: on a still view the history is right.
          const moved = previous.sub(uv).mul(u.cloudSize).length(), motion = smoothstep(CLAMP_MOTION[0], CLAMP_MOTION[1], moved);
          // Bicubic: a bilinear read of the history, repeated every frame as the clouds drift, would blur them.
          const reprojected = catmullRom(this.readColor[from], previous, u.cloudSize, true);
          const history = mix(reprojected, reprojected.clamp(lo, hi), motion);
          const historyDepth = (direct(this.readDepth[from].sample(previous).level(float(0))) as unknown as Vec4).y;
          const keep = u.historyWeight, fresh = mix(still, sum, motion), freshWeights = mix(stillWeights, weights, motion);
          color.assign(history.mul(keep).add(fresh).div(keep.add(freshWeights)));
          weightedDepth.assign(historyDepth.mul(keep).add(mix(stillDepth, depthSum, motion)).div(keep.add(freshWeights)));
        }).Else(() => {
          color.assign(sum.div(max(weights, 1e-4)));
          weightedDepth.assign(depthSum.div(max(weights, 1e-4)));
        });
        textureStore(target.color, uvec2(c), color);
        textureStore(target.depth, uvec2(c), vec4(color.w, weightedDepth, 0, 1));
      });
    })().compute(1, [TILE * TILE]);
  }

  /** The cloud shadow map, one texel in `slices` per run: the sun's transmittance through the shell above
   * each sea-level texel near the camera. Texels are laid out in the clouds' drifting frame, wrapping: each
   * holds whichever cell of that frame lies within half the map of the camera. */
  private buildShadow(sliced: boolean): ComputeNode {
    const u = this.u, wind = this.sky.windOffset, camera = this.sky.cameraPosition;
    return Fn(() => {
      const index = sliced ? int(instanceIndex).mul(u.shadowSlices).add(u.shadowSlice) : int(instanceIndex);
      If(index.lessThan(u.shadowSize.mul(u.shadowSize)), () => {
        const texel = ivec2(index.mod(u.shadowSize), index.div(u.shadowSize));
        const cell = vec2(texel).add(.5).div(float(u.shadowSize));
        const centre = camera.xz.sub(wind.xz).div(SHADOW_EXTENT);
        const drifted = round(centre.sub(cell)).add(cell).mul(SHADOW_EXTENT);
        const point = vec3(drifted.x.add(wind.x), 0, drifted.y.add(wind.z));
        textureStore(this.shadowStore, uvec2(texel), vec4(shadowTransmittance(this.context, point, this.sky.sunDirection, SHADOW_STEPS), 0, 0, 1));
      });
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
    // Where this pixel's direction lay in the view of the last update (a tier may update every few frames):
    // clouds are far enough that turning the view is all that moved them.
    const direction = viewDirection(), clip = this.u.latestViewProjection.mul(vec4(direction, 0));
    const at = select(clip.w.greaterThan(1e-6), clip.xy.div(clip.w).mul(vec2(.5, -.5)).add(.5), screenUV).toVar();
    // Up from the cloud buffer by an eased bilinear read: a plain one would soften every cloud edge by a buffer pixel.
    const color = sharpBilinear(this.latestColor, at, this.u.cloudSize);
    if (depthTested) {
      const cover = color.w.oneMinus();
      const depthKm = (direct(this.latestDepth.sample(at)) as unknown as Vec4).y.div(max(cover, 1e-4));
      const forward = cameraViewMatrix.mul(vec4(direction, 0)).z;
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
      // The scene's flash lifts every cloud a little; the channel lights its own cell (below).
      const radiance = color.xyz.mul(sky.flash.mul(lightning.lift).add(1)).toVar();
      // Lightning lights the cloud the pixel shows, from inside: here rather than in the march, so a flash
      // shows at once over the whole cloud instead of one pixel in sixteen a frame, and costs nothing else.
      If(sky.lightningIntensity.greaterThan(0), () => {
        const cover = color.w.oneMinus();
        const depth = (direct(this.latestDepth.sample(at)) as unknown as Vec4).y.div(max(cover, 1e-4)).mul(1000);
        const toward = sky.cameraPosition.add(direction.mul(depth)).sub(sky.lightningPosition);
        const distance = toward.length();
        const irradiance = sky.lightningIntensity.mul(1e6).div(distance.mul(distance).add(lightning.core.mul(lightning.core)));
        radiance.addAssign(vec3(LIGHTNING_TINT[0], LIGHTNING_TINT[1], LIGHTNING_TINT[2])
          .mul(irradiance.mul(lightning.glow).mul(distance.div(lightning.spread.negate()).exp().add(lightning.tail)).mul(cover)));
      });
      return vec4(radiance, color.w);
    })();
    writeSceneTargets(material);
    return material;
  }
}

const scratch = new Vector2();
const smooth = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A map built on the CPU. `mipmapped` for one the dome reads at grazing angles (the cirrus toward the horizon),
 * which a single level would draw as beaded lines. */
function mapTexture(bytes: Uint8Array, size: number, name: string, mipmapped = false): DataTexture {
  const map = new DataTexture(bytes, size, size, RGBAFormat, UnsignedByteType);
  map.name = name;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.minFilter = mipmapped ? LinearMipmapLinearFilter : LinearFilter;
  map.magFilter = LinearFilter;
  map.generateMipmaps = mipmapped;
  map.anisotropy = mipmapped ? 8 : 1;
  map.needsUpdate = true;
  return map;
}

/** Creates the cloud part for the sky facade. */
export function createCloudLayer(context: SkyPartContext, atmosphere: AtmospherePart): CloudLayer {
  return new CloudLayer(context.renderer, context.uniforms, atmosphere, context.quality, context.reversedDepth);
}

/** Two view-projections equal to float noise: a camera eased onto a fixed point still wobbles in its last bits. */
function sameView(a: Matrix4, b: Matrix4): boolean {
  return a.elements.every((value, i) => Math.abs(value - b.elements[i]) <= 1e-6 * (1 + Math.abs(value)));
}
