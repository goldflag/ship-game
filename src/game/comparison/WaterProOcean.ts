import { Camera, Color, Mesh, Vector3, type BufferAttribute, type Node, type Object3D, type PassNode, type PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
import { int, mix, vec3 } from 'three/tsl';
import { getPresetParams, MAX_SAMPLE_POINTS, QUALITY_LEVELS, WaterSurfaceMaterial, WaterSystem, WaveSampler, type WakeSystem } from '../../../vendor/threejs-water-pro/build/index.js';
import type { SkyProvider } from '../../../vendor/threejs-water-pro/build/components/sky/SkyProvider';
import type { IWaveSampler } from '../../../vendor/threejs-water-pro/build/simulation/waves/IWaveSampler';
import type { WebGPUWaveSimulation } from '../../../vendor/threejs-water-pro/build/simulation/waves/webgpu/WebGPUWaveSimulation';
import type { IWakeFieldSampler } from '../../../vendor/threejs-water-pro/build/simulation/waves/wake/IWakeFieldSampler';
import type { CrestFoamParameters, OceanApi, OceanQuality, OceanRealism, OceanSky, WakeFieldApi, WakeGeneratorOptions, WakeSampler } from '../ocean/contracts';
import type { WaveCascadeInfo, WaveField, WaveHeightSampler, WaveParameters, WaveSurfaceSample } from '../ocean/contracts';
import { nearPlaneMayBeSubmerged } from '../ocean/screen/underwater';
import { WATER_PRO_BREAK_SCALE, waterProAmplitude, waterProCrestFoam, waterProSurfaceFoam } from './waterProSea';

/** The vendored Water Pro 3.5.1 behind the game's ocean facade, driven through its public API as the game drove it
 * before its own ocean replaced it (master 6b60ac454), so the two can be compared in the real game. Developer
 * comparison only: `Game` imports this module dynamically, so the default game never downloads the library.
 *
 * Clean-room rule (see `src/game/ocean/README.md`): the library's licence forbids reverse engineering its bundle.
 * Use only its declarations (`vendor/threejs-water-pro/build/**\/*.d.ts`) and the game's former integration code in
 * git history; never open or search `vendor/threejs-water-pro/build/index.js`.
 *
 * Every facade object is live as on `Ocean`: `update` hands the values to the library each frame. Where a value
 * means something else to Water Pro it is translated (`waterProSea.ts`): the metric significant height becomes the
 * FFT gain the game measured per map; surface foam and the wake's breaking slope take the values the game gave the
 * library. Its seed stays the 1 the game always used (`waves.seed` is ignored); the realism switches stay off, since
 * Water Pro is the look they compare against, and the library itself never reads them; a wake sampler's `slick`
 * has no counterpart; `waveField` offers heights and displacement only, since the library shades its own surface. */
export class WaterProOcean implements OceanApi {
  readonly realism: OceanRealism = { seaState: false, reflections: false, waterColor: false, wake: false };
  readonly waves: WaveParameters = { significantHeight: 1.8, windSpeed: 9, windDirection: 35 * Math.PI / 180, peakWavelength: 32,
    choppiness: 1.2, gamma: 2.2, directionalSharpness: .8, seed: 1, dirty: true };
  readonly colors: OceanApi['colors'];
  readonly foam: OceanApi['foam'];
  readonly fog: OceanApi['fog'];
  readonly sun: OceanApi['sun'];
  readonly reflections: OceanApi['reflections'];
  readonly wake: WaterProWake;
  readonly waveField: WaveField;
  readonly heights: WaterProHeights;
  cameraNearSurface = true;
  private readonly buoyancySampler: VisualWaveSampler;
  private readonly underwaterEnabled: boolean;
  private wakeSampler: IWakeFieldSampler | null = null;
  private shadow: Node<'float'> | null = null;
  /** The values last handed to Water Pro's colour setters, so unchanged colours are not re-sent every frame. */
  private readonly sent = new Map<string, Color>();
  /** Upper bound on the surface height from the spectrum Water Pro generated, plus the wake; Infinity until read back. */
  private bound = Infinity;
  private boundGeneration = 0;
  private boundSampled?: { cascade: Cascade; scale: number }[];
  private boundPending?: Promise<void>;
  private disposed = false;

  static async create(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, { quality }: { quality: OceanQuality }): Promise<WaterProOcean> {
    // Water Pro 3.5.1 combines seed * 100000 + cellIndex in float32: large seeds (the game ocean's 1941) collapse
    // adjacent inputs into repeated arcs, so the library keeps the small seed the game always gave it.
    const water = await WaterSystem.create(renderer, scene, camera, quality, { seed: 1, refractionEnabled: false, surfaceTransmissionEnabled: true });
    return new WaterProOcean(renderer, scene, camera, quality, water);
  }

  private constructor(private readonly renderer: WebGPURenderer, private readonly scene: Scene, private readonly camera: PerspectiveCamera,
    readonly quality: OceanQuality, readonly water: WaterSystem) {
    // Water Pro builds its own sun light into lit shaders while it is created. The game lights meshes with its own
    // sun, which carries the near and wide shadow maps; the sea shades from the library's sun uniforms (`sun`).
    scene.remove(water.lighting.sunLight);
    // Buoys must not stall a frame on a GPU readback: reuse the last result while one is in flight.
    this.buoyancySampler = new VisualWaveSampler(water.buoyancy.getSampler());
    water.buoyancy.setSampler(this.buoyancySampler);
    const params = getPresetParams('blackFlag');
    params.oceanFloor.enabled = false;
    params.oceanFloor.depth = 200;
    params.fog.fadeStart = 2500;
    params.fog.fadeEnd = 16000;
    params.fog.skyBlendDistance = 10000;
    params.fog.fadePower = 1.4;
    // VisualEnvironment trims sky light on meshes with the sun; the sea ignores it.
    params.environment.intensity = 1;
    params.clipmap.baseSize = 256;
    params.clipmap.levels = 6;
    params.foam.surface.opacity = 0.13;
    params.foam.waves.opacity = 0.45;
    // A broader directional spectrum breaks up parallel ripples into the
    // small crossing waves of the supplied naval-game water references.
    params.waves.fft.spectralSharpness = .8;
    params.postProcessing.underwaterParticles.enabled = false;
    params.spray.enabled = false;
    water.loadPreset(params);
    water.underwaterDistortion.enabled = false;
    water.waves.jonswapGamma.value = 2.2;
    // The game always sent custom colours; the pigment and foam are emitted radiance it pre-scales for night.
    water.color.mode = 'custom';
    this.underwaterEnabled = water.underwater.enabled;

    // The facade starts from the library's own state, so values the game never writes keep the preset's.
    const { color, foam, fog, lighting } = water;
    this.colors = { waterColor: color.waterColor.clone(), transmissionColor: color.transmissionColor.clone(), absorptionColor: color.absorptionColor.clone() };
    const crest: CrestFoamParameters = { coverageScale: foam.waves.opacity / .8, lifetime: .55,
      color: foam.waves.color.clone(), opacity: 1, windStretch: foam.waves.windStretch };
    this.foam = { crest, surface: { color: foam.surface.color.clone(), opacity: foam.surface.opacity, coverage: foam.surface.coverage },
      shoreline: { color: foam.shoreline.color.clone(), opacity: foam.shoreline.opacity } };
    this.fog = { color: fog.color.clone(), start: fog.fadeStart, end: fog.fadeEnd, power: fog.fadePower, skyBlendDistance: fog.skyBlendDistance };
    this.sun = { direction: lighting.sun.direction.value.clone(), intensity: lighting.sun.intensity.value, color: lighting.sun.color.clone() };
    // Water Pro copies its sky provider's sun into these uniforms on every step; the game's celestial light wins.
    lighting.addSunSyncListener(() => this.applySun());
    const tier = QUALITY_LEVELS[quality];
    this.reflections = {
      get screenSpace() { return water.ssr.enabled; }, set screenSpace(value) { water.ssr.enabled = value; },
      get maxDistance() { return water.ssr.maxDistance; }, set maxDistance(value) { water.ssr.maxDistance = value; },
      steps: tier.features.ssr ? tier.ssrStepCount : 0,
    };
    this.wake = new WaterProWake(water.wake);
    this.heights = new WaterProHeights(water, renderer);
    this.waveField = this.createWaveField();
  }

  get environmentIntensity(): number { return this.water.environment.intensity; }
  set environmentIntensity(value: number) { this.water.environment.intensity = value; }

  /** Wave time in seconds. Setting it holds Water Pro on the nearest fixed step, where `update(0)` keeps it. The library
   * evaluates its waves only inside a step, so the surface shows a new time after the next `update` with `dt` > 0. */
  get time(): number { return this.water.simulationTime; }
  set time(seconds: number) {
    this.water.deterministic = true;
    this.water.syncToTick(Math.round(seconds / this.water.stepSize));
  }

  get meshSpacing(): number {
    const mesh = this.water.getGeometryConfig();
    return mesh.baseSize / mesh.segments;
  }

  /** Water Pro steps asynchronously, then renders its capture passes; the frame awaits both before it renders. */
  async update(dt: number): Promise<void> {
    this.sync();
    this.wake.step(this.renderer, dt);
    this.updateUnderwater();
    // Fixed-step mode with zero delta renders without stepping waves, foam or the wake's integrators;
    // host-clock mode steps once per frame with the frame's delta.
    this.water.deterministic = dt === 0;
    await this.water.update(dt);
    this.captureBound();
  }

  setSky(sky: OceanSky | null): void {
    // Sky Pro's provider is the object Water Pro always took; the facade types only the members the game's ocean reads.
    this.water.setSky(sky as unknown as SkyProvider | null);
  }

  setWakeSampler(sampler: WakeSampler | null): void {
    // Water Pro's material reads the wake through its own sampler shape; the game composes its foam on top of the field's.
    this.wakeSampler = sampler && {
      sample: (x, z) => ({ height: sampler.height(x as Node<'float'>, z as Node<'float'>) }),
      sampleNormal: (x, z) => sampler.normal(x as Node<'float'>, z as Node<'float'>),
      sampleFoamEnergy: (x, z) => sampler.foam(x as Node<'float'>, z as Node<'float'>),
    };
    const bound = this.wakeSampler ?? this.water.wake.getSampler();
    this.surfaceMaterials().forEach(material => material.setWakeFieldSampler(bound));
  }

  setShadowNode(node: Node<'float'> | null): void {
    if (node === this.shadow) return;
    this.shadow = node;
    this.surfaceMaterials().forEach(material => material.setSunShadowNode(node));
  }

  postProcess(scenePass: PassNode, color: Node<'vec4'>): Node<'vec4'> {
    return this.water.postProcessing.buildNode(scenePass, color) as Node<'vec4'>;
  }

  /** Water Pro sizes its horizon ring when the geometry is built; grow it once the map raises `camera.far`. */
  ensureHorizon(far: number): void {
    if (this.water.getGeometryConfig().infinityRingExtent >= far * .95) return;
    this.water.rebuildGeometry({});
    // Keep the game's wake and shadow bindings on whatever surface the rebuild left.
    if (this.wakeSampler) this.surfaceMaterials().forEach(material => material.setWakeFieldSampler(this.wakeSampler));
    if (this.shadow) this.surfaceMaterials().forEach(material => material.setSunShadowNode(this.shadow));
  }

  addFloater(object: Object3D, { smoothing = .6 }: { smoothing?: number } = {}): void {
    this.water.buoyancy.addObject(object as Mesh, { multiPoint: false, heightSmoothing: smoothing });
  }

  resize(width: number, height: number): void { this.water.resize(width, height); }

  /** Drains GPU readbacks before the library releases the buffers they read. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.boundGeneration++;
    await Promise.all([this.buoyancySampler.drain(), this.heights.drain(), this.boundPending]);
    this.heights.dispose();
    this.water.dispose();
  }

  /** Every Water Pro surface material in the scene: the clipmap's, and the horizon's if it has its own. */
  private surfaceMaterials(): Set<WaterSurfaceMaterial> {
    const materials = new Set<WaterSurfaceMaterial>();
    this.scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof WaterSurfaceMaterial) materials.add(material);
      }
    });
    return materials;
  }

  /** Hand the facade's values to the library, translating those it measures differently. */
  private sync(): void {
    const { water, waves } = this;
    if (waves.dirty) {
      const uniforms = water.waves;
      uniforms.amplitude.value = waterProAmplitude(waves.significantHeight, waves.windSpeed);
      uniforms.windSpeed.value = waves.windSpeed;
      uniforms.windDirection.value = waves.windDirection;
      uniforms.peakWavelength.value = waves.peakWavelength;
      uniforms.choppiness.value = waves.choppiness;
      uniforms.jonswapGamma.value = waves.gamma;
      uniforms.spectralSharpness.value = waves.directionalSharpness;
      uniforms.dirty = true;
      waves.dirty = false;
      Object.assign(water.foam.surface, waterProSurfaceFoam(waves.windSpeed));
    }
    const { crest, surface, shoreline } = this.foam, foam = water.foam;
    this.send('waterColor', this.colors.waterColor, value => { water.color.waterColor = value; });
    this.send('transmissionColor', this.colors.transmissionColor, value => { water.color.transmissionColor = value; });
    this.send('absorptionColor', this.colors.absorptionColor, value => { water.color.absorptionColor = value; });
    this.send('crest', crest.color, value => { foam.waves.color = value; });
    this.send('surface', surface.color, value => { foam.surface.color = value; });
    this.send('shoreline', shoreline.color, value => { foam.shoreline.color = value; });
    this.send('fog', this.fog.color, value => { water.fog.color = value; });
    const { opacity, ...persistence } = waterProCrestFoam(waves.windSpeed, crest.coverageScale);
    foam.waves.opacity = opacity * crest.opacity;
    foam.waves.windStretch = crest.windStretch;
    Object.assign(foam.waves.persistence, persistence);
    foam.shoreline.opacity = shoreline.opacity;
    Object.assign(water.fog, { fadeStart: this.fog.start, fadeEnd: this.fog.end, fadePower: this.fog.power, skyBlendDistance: this.fog.skyBlendDistance });
    // Paused frames do not step, so the sync listener alone would miss a changed light.
    this.applySun();
  }

  private send(key: string, value: Color, apply: (value: Color) => void): void {
    const sent = this.sent.get(key);
    if (sent?.equals(value)) return;
    apply(value.clone());
    if (sent) sent.copy(value); else this.sent.set(key, value.clone());
  }

  private applySun(): void {
    const sun = this.water.lighting.sun;
    sun.direction.value.copy(this.sun.direction);
    sun.intensity.value = this.sun.intensity;
    sun.color.copy(this.sun.color);
  }

  /** Water Pro's cascades as the game's former underwater culling read them. */
  private cascades(): Cascade[] | undefined {
    return (this.water as unknown as { oceanSim?: { cascades?: Cascade[] } }).oceanSim?.cascades;
  }

  /** Skip the underwater passes while the whole near plane is certainly above the highest possible crest.
   * Unknown spectra and pending readbacks keep them. Visual only; combat never reads GPU waves. */
  private updateUnderwater(): void {
    const cascades = this.cascades(), sampled = this.boundSampled;
    if (this.water.waves.dirty || sampled && (!cascades || cascades.length !== sampled.length ||
      sampled.some((sample, i) => sample.cascade !== cascades[i] || sample.scale !== cascades[i].scale || !cascades[i].initialized))) {
      this.bound = Infinity; this.boundSampled = undefined; this.boundGeneration++;
    }
    this.cameraNearSurface = nearPlaneMayBeSubmerged(this.camera, this.bound);
    this.water.underwater.enabled = this.underwaterEnabled && this.cameraNearSurface;
  }

  /** After an update has submitted a new spectrum, read its coefficients back once to bound the surface height. */
  private captureBound(): void {
    const cascades = this.cascades();
    if (!this.underwaterEnabled || this.disposed || this.boundPending || this.boundSampled || this.water.waves.dirty ||
      !cascades?.length || cascades.some(cascade => !cascade.initialized || !cascade.h0Buffer?.value)) return;
    const generation = this.boundGeneration;
    const sampled = cascades.map(cascade => ({ cascade, scale: cascade.scale }));
    const amplitude = Math.abs(this.water.waves.amplitude.value);
    const evolution = Math.max(1, Math.abs(1 - this.water.waves.standingWaveRatio.value));
    this.boundPending = Promise.all(cascades.map(cascade => this.renderer.getArrayBufferAsync(cascade.h0Buffer.value))).then(buffers => {
      if (this.disposed || generation !== this.boundGeneration) return;
      const fft = buffers.reduce((sum, buffer) => sum + spectrumHeightBound(new Float32Array(buffer)), 0) * amplitude * evolution;
      // Water Pro's wake integrator holds heights within ±8 m; 1% and 10 cm more cover FFT and interpolation roundoff.
      this.bound = fft * 1.01 + 8.1;
      this.boundSampled = sampled;
    }).catch(() => { this.bound = Infinity; }).finally(() => { this.boundPending = undefined; });
  }

  /** Heights and displacement from Water Pro's public displacement buffers, sampled as the library's cascades
   * nest (each finer cascade read where the coarser ones moved the point), as the game's torpedo overlay did. */
  private createWaveField(): WaveField {
    const ocean = this, simulation = this.water.simulation;
    const displacement = (xz: Node<'vec2'>): Node<'vec3'> => {
      let sum: Node<'vec3'> = vec3(0);
      for (let i = 0; i < simulation.getCascadeCount(); i++) {
        const buffer = simulation.getDisplacementBuffer(i)!;
        const resolution = simulation.getResolution(i), scale = simulation.getScale(i);
        const x = xz.x.add(sum.x).div(scale).add(.5).mul(resolution);
        const z = xz.y.add(sum.z).div(scale).add(.5).mul(resolution);
        const ix = x.floor().toInt().mod(int(resolution)).add(int(resolution)).mod(int(resolution));
        const iz = z.floor().toInt().mod(int(resolution)).add(int(resolution)).mod(int(resolution));
        const nx = ix.add(1).mod(int(resolution)), nz = iz.add(1).mod(int(resolution));
        const at = (a: Node<'int'>, b: Node<'int'>): Node<'vec3'> => buffer.element(b.mul(int(resolution)).add(a)).xyz;
        sum = sum.add(mix(mix(at(ix, iz), at(nx, iz), x.fract()), mix(at(ix, nz), at(nx, nz), x.fract()), z.fract()));
      }
      return sum;
    };
    return {
      params: this.waves,
      // Water Pro draws the sea it is given; the realism switches are the game ocean's.
      sea: this.waves,
      foamParams: this.foam.crest,
      get cascades(): WaveCascadeInfo[] {
        return Array.from({ length: simulation.getCascadeCount() }, (_, i) => ({ size: simulation.getScale(i), resolution: simulation.getResolution(i) }));
      },
      get maxHeight() { return Number.isFinite(ocean.bound) ? ocean.bound - 8.1 : Infinity; },
      maxHorizontalDisplacement: Infinity,
      displacement,
      heightAt: xz => displacement(xz).y,
      surface(): WaveSurfaceSample { throw new Error('Water Pro shades its own surface; only the game ocean\'s material reads surface().'); },
      // Water Pro steps its waves inside WaterSystem.update; here the time only moves.
      update(_renderer, time) { ocean.time = time; },
      dispose() {},
    };
  }
}

type Cascade = { initialized: boolean; scale: number; h0Buffer: { value: BufferAttribute } };

/** An unnormalised inverse FFT is bounded by the sum of its coefficients. Time evolution adds h0(k) and the
 * conjugate h0(-k). Bilinear sampling and the nested cascade coordinates cannot exceed the sum of these bounds. */
export function spectrumHeightBound(coefficients: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < coefficients.length; i += 4) sum += 2 * Math.hypot(coefficients[i], coefficients[i + 1]);
  return Number.isFinite(sum) ? sum : Infinity;
}

/** Water Pro's wake field behind the game's `WakeFieldApi`. The library centres the field on a camera, so an
 * anchor camera follows `setCenter`; it steps the field inside `WaterSystem.update`. */
class WaterProWake implements WakeFieldApi {
  private readonly anchor = new Camera();
  private breakThreshold: number;
  private lifetime = 9;

  constructor(private readonly system: WakeSystem) {
    this.anchor.rotation.x = -Math.PI / 2;
    this.setCenter(0, 0);
    system.setCamera(this.anchor);
    this.breakThreshold = system.foamBreakThreshold / WATER_PRO_BREAK_SCALE;
    system.foamPersistence = Math.exp(-(1 / 60) / this.lifetime);
  }

  get enabled(): boolean { return this.system.enabled; }
  set enabled(value: boolean) { this.system.enabled = value; }
  get resolution(): number { return this.system.resolution; }
  get worldSize(): number { return this.system.worldSize; }
  set worldSize(value: number) { this.system.worldSize = value; }
  get friction(): number { return this.system.friction; }
  set friction(value: number) { this.system.friction = value; }
  get foamStrength(): number { return this.system.foamStrength; }
  set foamStrength(value: number) { this.system.foamStrength = value; }
  /** The game's breaking slope; Water Pro gets it on its own scale (`WATER_PRO_BREAK_SCALE`). */
  get foamBreakThreshold(): number { return this.breakThreshold; }
  set foamBreakThreshold(value: number) { this.breakThreshold = value; this.system.foamBreakThreshold = value * WATER_PRO_BREAK_SCALE; }
  /** Water Pro decays wake foam by a factor per step; each frame's factor follows from this lifetime. */
  get foamLifetime(): number { return this.lifetime; }
  set foamLifetime(value: number) { this.lifetime = value; }

  setCenter(x: number, z: number): void {
    this.anchor.position.set(x, 1, z);
    this.anchor.updateMatrixWorld();
  }
  addGenerator(object: Object3D, options?: WakeGeneratorOptions): number { return this.system.addGenerator(object, options); }
  updateGenerator(id: number, options: WakeGeneratorOptions): boolean { return this.system.updateGenerator(id, options); }
  removeGenerator(id: number): boolean { return this.system.removeGenerator(id); }

  /** Clear the displacement even when the move is below the solver's teleport threshold, and restart every generator. */
  reset(): void {
    const enabled = this.system.enabled;
    this.system.enabled = false;
    this.system.enabled = enabled;
    for (const generator of this.system.getGenerators().values()) generator.isFirstFrame = true;
  }

  get sampler(): WakeSampler {
    const native = this.system.getSampler();
    return {
      height: (x, z) => native.sample(x, z).height as Node<'float'>,
      normal: (x, z) => native.sampleNormal(x, z) as Node<'vec3'>,
      foam: (x, z) => native.sampleFoamEnergy(x, z) as Node<'float'>,
    };
  }

  /** The field itself steps inside `WaterSystem.update`; a paused frame keeps its foam. */
  step(_renderer: WebGPURenderer, dt: number): void {
    if (dt > 0) this.system.foamPersistence = Math.exp(-dt / this.lifetime);
  }

  dispose(): void {}
}

/** Height readback at the game's points through a Water Pro wave sampler of its own, one query in flight at a time.
 * The buoys keep the library's buoyancy sampler. Presentation only. */
class WaterProHeights implements WaveHeightSampler {
  heights = new Float32Array(0);
  normals = new Float32Array(0);
  private points: Vector3[] = [];
  private sampler?: WaveSampler;
  private pending?: Promise<void>;
  private stopped = false;

  constructor(private readonly water: WaterSystem, private readonly renderer: WebGPURenderer) {}

  setPositions(points: readonly { x: number; z: number }[]): void {
    this.points = points.slice(0, MAX_SAMPLE_POINTS).map(point => new Vector3(point.x, 0, point.z));
    if (this.heights.length !== points.length) {
      this.heights = new Float32Array(points.length).fill(NaN);
      this.normals = new Float32Array(points.length * 3);
    }
  }
  request(): void {
    if (this.pending || this.stopped) return;
    this.pending = this.query().finally(() => { this.pending = undefined; });
  }
  async refresh(): Promise<void> {
    await this.pending;
    if (!this.stopped) await this.query();
  }
  async drain(): Promise<void> { this.stopped = true; await this.pending; }
  dispose(): void { this.stopped = true; this.sampler?.dispose(); }

  private async query(): Promise<void> {
    const sampler = this.sampler ??= new WaveSampler(this.water.simulation as WebGPUWaveSimulation, this.renderer);
    const points = this.points;
    sampler.updateCascadeUniforms();
    sampler.setPositions(points);
    await sampler.update();
    points.forEach((_, i) => {
      if (i >= this.heights.length) return;
      const { height, normal } = sampler.getSample(i);
      this.heights[i] = height;
      this.normals.set([normal.x, normal.y, normal.z], i * 3);
    });
  }
}

/** Presentation-only sampling for Water Pro's buoyancy: reuse the latest completed GPU result while one readback
 * is pending, so a busy GPU cannot stall a frame for buoy heights. The library's sampler owns the query. */
class VisualWaveSampler implements IWaveSampler {
  private positions: Vector3[] = [];
  private pending?: Promise<void>;
  private failure?: unknown;
  private stopped = false;
  constructor(private readonly sampler: IWaveSampler) {}
  setPositions(positions: Parameters<IWaveSampler['setPositions']>[0]): void {
    this.positions.length = positions.length;
    positions.forEach((p, i) => {
      this.positions[i] ??= new Vector3();
      this.positions[i].set(p.x, 'z' in p ? p.y : 0, 'z' in p ? p.z : p.y);
    });
  }
  private start(): void {
    if (this.pending || this.stopped) return;
    this.sampler.setPositions(this.positions);
    this.pending = this.sampler.update().catch(error => { this.failure = error; }).finally(() => { this.pending = undefined; });
  }
  async updateLowLatency(): Promise<void> {
    if (this.failure) throw this.failure;
    this.start();
  }
  /** Explicit fresh-data callers keep the blocking contract. */
  async update(): Promise<void> {
    await this.pending;
    if (this.failure) throw this.failure;
    this.start(); await this.pending;
    if (this.failure) throw this.failure;
  }
  getSample(index: number) { return this.sampler.getSample(index); }
  getSamples() { return this.sampler.getSamples(); }
  getSampleCount() { return this.sampler.getSampleCount(); }
  updateCascadeUniforms() { this.sampler.updateCascadeUniforms(); }
  /** Drain before disposing the renderer or its GPU resources. */
  async drain(): Promise<void> { this.stopped = true; await this.pending; }
  dispose(): void {
    this.stopped = true;
    if (this.pending) void this.pending.then(() => this.sampler.dispose());
    else this.sampler.dispose();
  }
}
