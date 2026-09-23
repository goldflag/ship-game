import { Color, CustomBlending, DataTexture, HalfFloatType, LinearFilter, Matrix4, Mesh, MeshBasicNodeMaterial, NearestFilter, NoBlending, NodeMaterial, OneFactor,
  QuadMesh, RenderTarget, RedFormat, RepeatWrapping, RGBAFormat, SrcAlphaFactor, UnsignedByteType, Vector2, Vector3, ZeroFactor,
  type Node, type PerspectiveCamera, type Texture, type TextureNode, type WebGPURenderer } from 'three/webgpu';
import { Discard, Fn, If, property, cameraFar, cameraNear, cameraViewMatrix, clamp, float, ivec2, max, min, mix, mrt, screenCoordinate, screenUV, select, smoothstep, texture,
  uniform, vec2, vec3, vec4, viewZToPerspectiveDepth, viewZToReversedPerspectiveDepth } from 'three/tsl';
import type { AtmospherePart, CloudPart, SkyFrame, SkyPartContext, SkyQuality, SkyScene, SkyUniforms } from '../contracts';
import { CLOUD_ORDER, fullScreenTriangle, screenCorner, viewDirection } from '../dome';
import { SKY_TIERS } from '../quality';
import { writeSceneTargets } from '../../TemporalAntialiasing';
import { createCirrus, cirrusAmount } from './cirrus';
import { createCloudField, createLayerUniforms, type CloudField, type LayerUniforms } from './field';
import { createCloudLight, gradientJitter, marchClouds, packMarch, shadowTransmittance, type CloudLight, type MarchContext } from './march';
import { cirrusMap, weatherMap, CIRRUS_SIZE, WEATHER_SIZE } from './model';
import { baseVolume, detailVolume, type GeneratedVolume } from './noise';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Vec3 = Node<'vec3'>;
type Vec4 = Node<'vec4'>;

/** Weight of a freshly marched sample against its pixel's reprojected history. */
const FRESH = .25;
/** Where a pixel met no cloud, history is reprojected as if this far away (m): the sky's own motion. */
const CLEAR_DISTANCE = 30_000;
/** Ground covered by the cloud shadow map (m), centred on the camera. */
const SHADOW_EXTENT = 40_000;
/** Samples of the shadow map's march along the sun. */
const SHADOW_STEPS = 10;
/** Share of the shadow map's half-width over which it fades to full sun at its edge. */
const SHADOW_EDGE = .15;
/** Sun elevations (radians' sine) over which cloud shadows fade in after sunrise: a sun on the horizon
 * lights the sea under a sky it shines beneath, not through. */
const SHADOW_SUN = [.02, .12] as const;
/** Light steps of the environment bake's march: its clouds are blurred into the sea's reflection. */
const BAKE_LIGHT_STEPS = 2;
/** The authored `clouds.ambient` and `baseShadow` were tuned against another model: these map them onto
 * ours (1.1 is the scene default and means a gain of 1). */
const AUTHORED_AMBIENT = 1.1;

/** Visit order of the pixels of an n × n block, spread so consecutive frames march far-apart pixels. */
const BLOCK_ORDER: Record<number, readonly (readonly [number, number])[]> = {
  1: [[0, 0]],
  2: [[0, 0], [1, 1], [1, 0], [0, 1]],
  4: [[0, 0], [2, 2], [2, 0], [0, 2], [1, 1], [3, 3], [3, 1], [1, 3], [1, 0], [3, 2], [3, 0], [1, 2], [0, 1], [2, 3], [2, 1], [0, 3]],
};

function pass(output: Node): QuadMesh {
  const material = new NodeMaterial();
  material.fragmentNode = output;
  material.depthTest = material.depthWrite = false;
  material.blending = NoBlending; material.toneMapped = false; material.fog = false;
  return new QuadMesh(material);
}

/** Two half-float RGBA attachments, `color` and `depth` (the MRT output names), filtered or texel-exact. */
function pairTarget(width: number, height: number, filter: typeof LinearFilter | typeof NearestFilter): RenderTarget {
  const target = new RenderTarget(width, height, { count: 2, type: HalfFloatType, format: RGBAFormat, minFilter: filter, magFilter: filter, depthBuffer: false, generateMipmaps: false });
  target.textures[0].name = 'color'; target.textures[1].name = 'depth';
  return target;
}

/** A read that skips three's UV transform (every clone of a texture node re-enables it). */
function direct(node: TextureNode): TextureNode {
  node.updateMatrix = false;
  return node;
}

/** The volumetric cloud layer (see `README.md` in the sky folder): noise volumes and a weather map, a
 * reduced-resolution interleaved march, temporal reconstruction, a depth-tested composite, cirrus, the
 * cloud shadow map and the environment bake's march. */
export class CloudLayer implements CloudPart {
  readonly composite: Mesh;
  readonly screenTransmittance: TextureNode;
  private readonly layer: LayerUniforms;
  private readonly light: CloudLight;
  private readonly field: CloudField;
  private readonly context: MarchContext;
  private readonly volumes: GeneratedVolume[];
  private readonly weather: DataTexture;
  private readonly cirrusTexture: DataTexture;
  private readonly cirrusStrength = uniform(0);
  /** The clouds' drift heading as a unit XZ vector. */
  private readonly windAxis = uniform(new Vector2(0, 1));
  private readonly cirrusFn: (direction: Vec3, behind: Vec3) => Vec3;
  private readonly u = {
    steps: uniform(64, 'int'), lightSteps: uniform(5, 'int'), bakeSteps: uniform(16, 'int'),
    frame: uniform(0), offset: uniform(new Vector2(), 'ivec2'), interleave: uniform(2, 'int'),
    cloudSize: uniform(new Vector2(1, 1)), marchSize: uniform(new Vector2(1, 1)),
    projectionInverse: uniform(new Matrix4()), cameraWorld: uniform(new Matrix4()), previousViewProjection: uniform(new Matrix4()),
    windShift: uniform(new Vector3()), history: uniform(0), pixelAngle: uniform(.003),
    shadowCentre: uniform(new Vector2()), shadowSize: uniform(new Vector2(1, 1)), shadowStrength: uniform(0),
    ambient: uniform(1), baseShadow: uniform(.2), precipitation: uniform(0),
  };
  private march!: RenderTarget;
  private history!: [RenderTarget, RenderTarget];
  private shadowTarget: RenderTarget;
  private current = 0;
  private readonly marchColor: TextureNode;
  private readonly marchDepth: TextureNode;
  private readonly historyColor: TextureNode;
  private readonly historyDepth: TextureNode;
  private readonly latestColor: TextureNode;
  private readonly latestDepth: TextureNode;
  private readonly shadowMap: TextureNode;
  private readonly marchPass: QuadMesh;
  private readonly resolvePass: QuadMesh;
  private readonly shadowPass: QuadMesh;
  private quality: SkyQuality;
  private width = 0;
  private height = 0;
  private frameIndex = 0;
  private hasHistory = false;
  private active = true;
  private readonly previousViewProjection = new Matrix4();
  private readonly viewProjection = new Matrix4();
  private readonly previousWind = new Vector3();
  private readonly savedClear = new Color();

  constructor(private readonly renderer: WebGPURenderer, private readonly sky: SkyUniforms, atmosphere: AtmospherePart, quality: SkyQuality, reversedDepth: boolean) {
    this.quality = quality;
    this.volumes = [baseVolume(renderer), detailVolume(renderer)];
    this.weather = mapTexture(weatherMap(), WEATHER_SIZE, 'Cloud weather');
    this.cirrusTexture = mapTexture(cirrusMap(), CIRRUS_SIZE, 'Cirrus');
    this.layer = createLayerUniforms();
    this.light = createCloudLight();
    this.field = createCloudField(sky, this.layer, { weather: this.weather, base: this.volumes[0].map, detail: this.volumes[1].map });
    this.context = { sky, atmosphere, field: this.field, light: this.light, ambient: this.u.ambient, baseShadow: this.u.baseShadow };
    this.cirrusFn = createCirrus(sky, atmosphere, this.light, this.cirrusTexture, this.cirrusStrength, this.windAxis);
    this.resizeTargets(1, 1);
    this.shadowTarget = this.makeShadowTarget(SKY_TIERS[quality].cloudShadowSize);
    this.marchColor = texture(this.march.textures[0]);
    this.marchDepth = texture(this.march.textures[1]);
    this.historyColor = texture(this.history[1].textures[0]);
    this.historyDepth = texture(this.history[1].textures[1]);
    this.latestColor = texture(this.history[0].textures[0]);
    this.latestDepth = texture(this.history[0].textures[1]);
    this.screenTransmittance = texture(this.history[0].textures[1]);
    this.shadowMap = texture(this.shadowTarget.texture);
    this.marchPass = pass(this.buildMarch());
    this.resolvePass = pass(this.buildResolve());
    this.shadowPass = pass(this.buildShadow());
    this.composite = this.buildComposite(reversedDepth);
    this.setQuality(quality);
    this.clearShadow();
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
    this.u.ambient.value = clouds.ambient / AUTHORED_AMBIENT;
    this.u.baseShadow.value = Math.min(Math.max(clouds.baseShadow, 0), 1);
    this.u.precipitation.value = scene.weather.precipitation;
    this.cirrusStrength.value = cirrusAmount(clouds.coverage, clouds.windHeading + scene.sun.azimuth);
    const heading = clouds.windHeading * Math.PI / 180;
    this.windAxis.value.set(Math.sin(heading), Math.cos(heading));
    this.hasHistory = false;
  }

  cirrus(direction: Vec3, behind: Vec3): Vec3 { return this.cirrusFn(direction, behind); }

  bake(origin: Vec3, direction: Vec3): Vec4 {
    return Fn(() => {
      const result = marchClouds(this.context, origin, this.field.altitude(origin), direction,
        { steps: this.u.bakeSteps, lightSteps: BAKE_LIGHT_STEPS, jitter: .5 });
      return vec4(result.radiance, result.transmittance);
    })();
  }

  shadow(position: Vec3): Float {
    const sun = this.sky.sunDirection;
    // Down the sun's rays to the sea: the map holds the transmittance above each sea-level point.
    const ground = position.xz.sub(sun.xz.mul(position.y.div(max(sun.y, .02))));
    const uv = ground.sub(this.u.shadowCentre).div(SHADOW_EXTENT).add(.5);
    const edge = max(uv.x.sub(.5).abs(), uv.y.sub(.5).abs()).mul(2);
    const inside = smoothstep(1, 1 - SHADOW_EDGE, edge);
    const read = direct(this.shadowMap.sample(uv)).r;
    return mix(float(1), read, this.u.shadowStrength.mul(inside).mul(this.layer.enabled));
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.resizeTargets(width, height);
  }

  setQuality(quality: SkyQuality): void {
    this.quality = quality;
    const tier = SKY_TIERS[quality];
    this.u.steps.value = tier.cloudSteps;
    this.u.lightSteps.value = tier.cloudLightSteps;
    this.u.bakeSteps.value = tier.environmentSteps;
    this.u.interleave.value = tier.cloudInterleave;
    if (this.shadowTarget.width !== tier.cloudShadowSize) {
      this.shadowTarget.dispose();
      this.shadowTarget = this.makeShadowTarget(tier.cloudShadowSize);
      this.shadowMap.value = this.shadowTarget.texture;
      this.clearShadow();
    }
    if (this.width) this.resizeTargets(this.width, this.height);
  }

  update(frame: SkyFrame): void {
    const { renderer, camera } = frame, tier = SKY_TIERS[this.quality];
    this.syncSize(renderer);
    this.updateLight();
    const u = this.u;
    camera.updateMatrixWorld();
    u.projectionInverse.value.copy(camera.projectionMatrixInverse);
    // Angle one cloud-buffer pixel spans: the detail fades where a pixel's footprint cannot resolve it.
    u.pixelAngle.value = 2 * Math.tan(camera.getEffectiveFOV() * Math.PI / 360) / u.cloudSize.value.y;
    u.cameraWorld.value.copy(camera.matrixWorld);
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const wind = this.sky.windOffset.value;
    u.windShift.value.subVectors(wind, this.previousWind);
    u.previousViewProjection.value.copy(this.hasHistory ? this.previousViewProjection : this.viewProjection);
    u.history.value = this.hasHistory && !frame.cut ? 1 : 0;
    const n = tier.cloudInterleave, order = BLOCK_ORDER[n] ?? BLOCK_ORDER[1];
    const [ox, oy] = order[this.frameIndex % order.length];
    u.offset.value.set(ox, oy);
    u.frame.value = this.frameIndex % 1024;
    this.frameIndex++;
    this.updateShadowCentre(camera);
    if (this.active) {
      const target = renderer.getRenderTarget(), mrtState = renderer.getMRT(), autoClear = renderer.autoClear;
      try {
        renderer.setMRT(null);
        renderer.autoClear = false;
        renderer.setRenderTarget(this.march);
        this.marchPass.render(renderer);
        const next = 1 - this.current;
        this.historyColor.value = this.history[this.current].textures[0];
        this.historyDepth.value = this.history[this.current].textures[1];
        renderer.setRenderTarget(this.history[next]);
        this.resolvePass.render(renderer);
        this.current = next;
        this.latestColor.value = this.history[next].textures[0];
        this.latestDepth.value = this.history[next].textures[1];
        this.screenTransmittance.value = this.history[next].textures[1];
        if (u.shadowStrength.value > 0) { renderer.setRenderTarget(this.shadowTarget); this.shadowPass.render(renderer); }
      } finally {
        renderer.setRenderTarget(target); renderer.setMRT(mrtState); renderer.autoClear = autoClear;
      }
      this.hasHistory = true;
    }
    this.previousViewProjection.copy(this.viewProjection);
    this.previousWind.copy(wind);
  }

  dispose(): void {
    this.march.dispose();
    for (const target of this.history) target.dispose();
    this.shadowTarget.dispose();
    for (const quad of [this.marchPass, this.resolvePass, this.shadowPass]) (quad.material as NodeMaterial).dispose();
    (this.composite.material as MeshBasicNodeMaterial).dispose();
    this.composite.geometry.dispose();
    for (const volume of this.volumes) volume.dispose();
    this.weather.dispose();
    this.cirrusTexture.dispose();
  }

  /** The sun lights the clouds until it is low enough that even their tops stand in the planet's shadow;
   * then the moon does. The atmosphere's transmittance darkens the sun long before the switch. */
  private updateLight(): void {
    const sun = this.sky.sunDirection.value, night = sun.y < Math.sin(-5 * Math.PI / 180);
    this.light.night.value = night ? 1 : 0;
    this.light.direction.value.copy(night ? this.sky.moonDirection.value : sun);
    this.u.shadowStrength.value = smooth(sun.y, SHADOW_SUN[0], SHADOW_SUN[1]);
  }

  private updateShadowCentre(camera: PerspectiveCamera): void {
    const texel = SHADOW_EXTENT / this.shadowTarget.width;
    this.u.shadowCentre.value.set(Math.round(camera.position.x / texel) * texel, Math.round(camera.position.z / texel) * texel);
  }

  private syncSize(renderer: WebGPURenderer): void {
    const size = renderer.getDrawingBufferSize(scratch);
    if (size.x !== this.width || size.y !== this.height) this.resize(size.x, size.y);
  }

  private resizeTargets(width: number, height: number): void {
    const tier = SKY_TIERS[this.quality], n = tier.cloudInterleave;
    const cw = Math.max(1, Math.ceil(width / tier.cloudScale)), ch = Math.max(1, Math.ceil(height / tier.cloudScale));
    const mw = Math.ceil(cw / n), mh = Math.ceil(ch / n);
    this.u.cloudSize.value.set(cw, ch);
    this.u.marchSize.value.set(mw, mh);
    if (this.march) { this.march.setSize(mw, mh); for (const target of this.history) target.setSize(cw, ch); }
    else {
      this.march = pairTarget(mw, mh, LinearFilter);
      this.history = [pairTarget(cw, ch, LinearFilter), pairTarget(cw, ch, LinearFilter)];
    }
    this.hasHistory = false;
  }

  private makeShadowTarget(size: number): RenderTarget {
    const target = new RenderTarget(size, size, { type: UnsignedByteType, format: RedFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, generateMipmaps: false });
    target.texture.name = 'Cloud shadow';
    this.u.shadowSize.value.set(size, size);
    return target;
  }

  /** Full sun until the first shadow pass: an empty map would read as a black sky over the sea. */
  private clearShadow(): void {
    const renderer = this.renderer, target = renderer.getRenderTarget(), alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.savedClear);
    try { renderer.setClearColor(0xffffff, 1); renderer.setRenderTarget(this.shadowTarget); renderer.clear(); }
    finally { renderer.setRenderTarget(target); renderer.setClearColor(this.savedClear, alpha); }
  }

  /** The unit world ray through a point of the cloud buffer (uv, y down), from the game camera. */
  private ray(uv: Vec2): Vec3 {
    const u = this.u, ndc = vec4(uv.x.mul(2).sub(1), uv.y.mul(-2).add(1), .5, 1);
    const view = u.projectionInverse.mul(ndc);
    return u.cameraWorld.mul(vec4(view.xyz.div(view.w), 0)).xyz.normalize();
  }

  /** One pixel of every interleave block per frame, at the cloud buffer's resolution. */
  private buildMarch(): Node {
    const u = this.u, depth = property('vec4', 'cloudMarchDepth');
    // An MRT output must be the fragment node itself; the second target is carried out of the march's Fn.
    const color = Fn(() => {
      const pixel = ivec2(screenCoordinate.xy).mul(u.interleave).add(u.offset);
      const cell = cellMin(pixel, ivec2(u.cloudSize).sub(1));
      const uv = vec2(cell).add(.5).div(u.cloudSize);
      const direction = this.ray(uv).toVar();
      const jitter = gradientJitter(vec2(cell), u.frame);
      const origin = this.sky.cameraPosition;
      const result = marchClouds(this.context, origin, origin.y, direction, { steps: u.steps, lightSteps: u.lightSteps, jitter, pixelAngle: u.pixelAngle, lightning: true });
      const packed = packMarch(result);
      depth.assign(packed.depth);
      return packed.color;
    })();
    return mrt({ color, depth });
  }

  /** Temporal reconstruction at the cloud buffer's resolution: every pixel reprojects its history by the
   * clouds' depth (and the wind's drift since the last frame), clamps it to the fresh samples around it,
   * and the pixel marched this frame blends in its new sample. `depth` holds (transmittance, depth in km ×
   * coverage) so the composite's bilinear reads weight depth by cover. */
  private buildResolve(): Node {
    const u = this.u, depthOut = property('vec4', 'cloudResolveDepth');
    const resolved = Fn(() => {
      const c = ivec2(screenCoordinate.xy), n = u.interleave, last = ivec2(u.marchSize).sub(1);
      const block = c.div(n), own = c.sub(block.mul(n));
      const fresh = own.x.equal(u.offset.x).and(own.y.equal(u.offset.y));
      const load = (map: TextureNode, at: Node<'ivec2'>) => direct(map.load(cellMax(cellMin(at, last), ivec2(0, 0)))) as unknown as Vec4;
      const centre = load(this.marchColor, block).toVar();
      const lo = centre.toVar(), hi = centre.toVar();
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        const v = load(this.marchColor, block.add(ivec2(dx, dy)));
        lo.assign(min(lo, v)); hi.assign(max(hi, v));
      }
      const depthKm = load(this.marchDepth, block).x;
      const uv = vec2(c).add(.5).div(u.cloudSize);
      const distance = select(centre.w.lessThan(.999), depthKm.mul(1000), float(CLEAR_DISTANCE));
      const world = this.sky.cameraPosition.add(this.ray(uv).mul(distance)).sub(u.windShift);
      const clip = u.previousViewProjection.mul(vec4(world, 1));
      const previous = clip.xy.div(clip.w).mul(vec2(.5, -.5)).add(.5);
      const valid = u.history.greaterThan(0).and(clip.w.greaterThan(0))
        .and(previous.x.greaterThanEqual(0)).and(previous.x.lessThanEqual(1)).and(previous.y.greaterThanEqual(0)).and(previous.y.lessThanEqual(1));
      const color = vec4(0).toVar(), weightedDepth = float(0).toVar();
      If(valid, () => {
        const history = clamp(direct(this.historyColor.sample(previous)) as unknown as Vec4, lo, hi);
        const historyDepth = (direct(this.historyDepth.sample(previous)) as unknown as Vec4).y;
        color.assign(select(fresh, mix(history, centre, FRESH), history));
        weightedDepth.assign(select(fresh, mix(historyDepth, depthKm.mul(centre.w.oneMinus()), FRESH), historyDepth));
      }).Else(() => {
        // No history: the fresh sample here, else the march buffer upsampled around this pixel.
        const at = vec2(c).sub(vec2(u.offset)).div(vec2(n, n)).add(.5).div(u.marchSize);
        const upsampled = direct(this.marchColor.sample(at)) as unknown as Vec4;
        color.assign(select(fresh, centre, upsampled));
        weightedDepth.assign(depthKm.mul(color.w.oneMinus()));
      });
      depthOut.assign(vec4(color.w, weightedDepth, 0, 1));
      return color;
    })();
    return mrt({ color: resolved, depth: depthOut });
  }

  /** The cloud shadow map: sun transmittance through the shell above each sea-level texel around the camera. */
  private buildShadow(): Node {
    const u = this.u;
    return Fn(() => {
      const xz = screenCoordinate.xy.div(u.shadowSize).sub(.5).mul(SHADOW_EXTENT).add(u.shadowCentre);
      return vec4(shadowTransmittance(this.context, vec3(xz.x, 0, xz.y), this.sky.sunDirection, SHADOW_STEPS), 0, 0, 1);
    })();
  }

  /** The full-screen composite: premultiplied cloud radiance over what the scene drew (`dst = src + dst ×
   * transmittance`), depth-tested at the clouds' own distance so ships and islands hide them. */
  private buildComposite(reversedDepth: boolean): Mesh {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: false });
    material.name = 'Cloud composite';
    material.fog = false;
    material.toneMapped = false;
    material.blending = CustomBlending;
    material.blendSrc = OneFactor; material.blendDst = SrcAlphaFactor;
    material.blendSrcAlpha = ZeroFactor; material.blendDstAlpha = OneFactor;
    const color = direct(this.latestColor.sample(screenUV)) as unknown as Vec4;
    const cover = color.w.oneMinus();
    const depthKm = (direct(this.latestDepth.sample(screenUV)) as unknown as Vec4).y.div(max(cover, 1e-4));
    const direction = viewDirection();
    const forward = cameraViewMatrix.mul(vec4(direction, 0)).z;
    const viewZ = depthKm.mul(1000).mul(forward);
    const projected = reversedDepth ? viewZToReversedPerspectiveDepth(viewZ, cameraNear, cameraFar) : viewZToPerspectiveDepth(viewZ, cameraNear, cameraFar);
    material.depthNode = reversedDepth ? max(projected, 1e-10) : min(projected, 1 - 1e-7);
    material.fragmentNode = Fn(() => {
      If(cover.lessThan(5e-4), () => { Discard(); });
      return vec4(color.xyz, color.w);
    })();
    writeSceneTargets(material);
    // The fragment depth replaces this one; mid-range keeps the triangle clear of both clip planes.
    material.vertexNode = screenCorner(float(.5));
    const mesh = new Mesh(fullScreenTriangle(), material);
    mesh.name = 'Cloud composite';
    mesh.frustumCulled = false;
    mesh.renderOrder = CLOUD_ORDER;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

const scratch = new Vector2();
/** Component-wise integer min and max (three's typings accept only float vectors). */
const cellMin = (a: Node<'ivec2'>, b: Node<'ivec2'>) => min(a as unknown as Vec2, b as unknown as Vec2) as unknown as Node<'ivec2'>;
const cellMax = (a: Node<'ivec2'>, b: Node<'ivec2'>) => max(a as unknown as Vec2, b as unknown as Vec2) as unknown as Node<'ivec2'>;
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
