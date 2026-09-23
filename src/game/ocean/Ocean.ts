import { Color, Vector3, WebGPUCoordinateSystem, type Camera, type Material, type Mesh, type Node, type Object3D, type PassNode, type Scene, type Texture, type WebGPURenderer } from 'three/webgpu';
import type { OceanApi, OceanQuality, OceanSky, WakeSampler, WaveParameters } from './contracts';
import { OCEAN_TIERS } from './quality';
import { oceanFog } from './screen/fog';
import { underwaterPost } from './stubs/screen';
import { createWakeField } from './stubs/wake';
import { createWaveField, createWaveHeightSampler } from './stubs/waves';
import { OceanGeometry } from './surface/OceanGeometry';
import { OceanSurfaceMaterial } from './surface/OceanSurfaceMaterial';

/** Wake heights are bounded to ±8 m; 10 cm more covers interpolation. */
const WAKE_BOUND = 8.1;
/** Draw order in the transparent queue: before every smoke, spray and overlay layer. */
const SURFACE_ORDER = -30;

/** True when every corner of the camera's near plane is above `height`. */
export function nearPlaneAbove(camera: Camera, height: number): boolean {
  if (!Number.isFinite(height)) return false;
  const corner = new Vector3();
  const near = camera.reversedDepth ? 1 : camera.coordinateSystem === WebGPUCoordinateSystem ? 0 : -1;
  let lowest = camera.matrixWorld.elements[13];
  for (const x of [-1, 1]) for (const y of [-1, 1]) lowest = Math.min(lowest, corner.set(x, y, near).unproject(camera).y);
  return lowest > height;
}

/** The game's ocean: wave field, wake, surface mesh and material, scene fog, sky environment
 * and floating objects behind one facade. Every parameter object is live: the game writes to
 * it and the next frame renders it. See `README.md` in this folder. */
export class Ocean implements OceanApi {
  readonly backend: 'webgpu' | 'webgl';
  readonly waves: WaveParameters;
  readonly colors = { waterColor: new Color('#2d373c'), transmissionColor: new Color('#49575e'), absorptionColor: new Color('#945b57') };
  readonly foam = {
    crest: { crestStrength: .8, windwardStrength: 1.2, decayTime: 2.8, color: new Color(1, 1, 1), opacity: .8, windStretch: .5 },
    surface: { color: new Color(1, 1, 1), opacity: .05, coverage: .18 },
    shoreline: { color: new Color('#edf9fd'), opacity: .8 },
  };
  readonly fog = { color: new Color('#8b8f92'), start: 2500, end: 16000, power: 1.4, skyBlendDistance: 10000 };
  readonly sun = { direction: new Vector3(0, 1, 0), intensity: 1, color: new Color(1, 1, 1) };
  readonly reflections: { screenSpace: boolean; maxDistance: number; readonly steps: number };
  readonly wake;
  readonly waveField;
  readonly heights;
  environmentIntensity = 1;
  time = 0;
  cameraNearSurface = true;
  private sky: OceanSky | null = null;
  private environment: Texture | null = null;
  private wakeSampler: WakeSampler | null = null;
  private shadow: Node<'float'> | null = null;
  private readonly floaters: { object: Object3D; smoothing: number }[] = [];
  private readonly geometry: OceanGeometry;
  private readonly material: OceanSurfaceMaterial;

  static async create(renderer: WebGPURenderer, scene: Scene, camera: Camera & { far: number }, { quality, seed }: { quality: OceanQuality; seed: number }): Promise<Ocean> {
    return new Ocean(renderer, scene, camera, quality, seed);
  }

  private constructor(private readonly renderer: WebGPURenderer, private readonly scene: Scene, private readonly camera: Camera & { far: number },
    readonly quality: OceanQuality, seed: number) {
    const tier = OCEAN_TIERS[quality];
    this.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl';
    this.waves = { significantHeight: 1.8, windSpeed: 9, windDirection: 35 * Math.PI / 180, peakWavelength: 32, choppiness: 1.2, gamma: 2.6, directionalSharpness: .8, seed, dirty: true };
    // A screen-space ray may travel about a battleship's length and a half before it gives up;
    // WaterViewFocus stretches it for a hull seen through the lens.
    this.reflections = { screenSpace: tier.reflectionSteps > 0, maxDistance: 400, steps: tier.reflectionSteps };
    this.waveField = createWaveField(renderer, tier.cascades, this.waves, this.foam.crest);
    this.heights = createWaveHeightSampler(renderer, this.waveField);
    this.wake = createWakeField(renderer, tier.wakeResolution);
    this.geometry = new OceanGeometry(tier.segments, camera.far);
    this.material = new OceanSurfaceMaterial({ waves: this.waveField, geometry: this.geometry, colors: this.colors, foam: this.foam, sun: this.sun, reflections: this.reflections }, this.bindings());
    this.geometry.mesh.material = this.material;
    this.geometry.mesh.renderOrder = SURFACE_ORDER;
    scene.add(this.geometry.mesh);
    scene.fogNode = oceanFog(this.fog, null);
  }

  update(dt: number): void {
    if (dt > 0) this.time += dt;
    this.geometry.update(this.camera);
    this.sky?.followCamera(this.camera);
    this.cameraNearSurface = !nearPlaneAbove(this.camera, this.waveField.maxHeight + WAKE_BOUND);
    this.waveField.update(this.renderer, this.time, dt);
    this.wake.step(this.renderer, dt);
    const environment = this.sky?.getEnvironmentTexture() ?? null;
    if (environment !== this.environment) { this.environment = this.scene.environment = environment; this.material.bind(this.bindings()); }
    this.scene.environmentIntensity = this.environmentIntensity;
    this.material.update();
    if (!this.floaters.length) return;
    this.heights.request();
    if (dt > 0) this.floaters.forEach(({ object, smoothing }, i) => {
      const height = this.heights.heights[i];
      if (Number.isFinite(height)) object.position.y += (height - object.position.y) * (1 - Math.exp(-dt / Math.max(smoothing, 1e-3)));
    });
  }

  setSky(sky: OceanSky | null): void {
    this.sky = sky;
    // Sky backdrops are the fog's own colour source; fogging them would darken the horizon twice.
    for (const mesh of sky?.getMeshes() ?? []) {
      const materials = (mesh as Mesh).material;
      for (const material of Array.isArray(materials) ? materials : materials ? [materials] : []) (material as Material & { fog: boolean }).fog = false;
    }
    this.scene.fogNode = oceanFog(this.fog, sky);
    this.environment = this.scene.environment = sky?.getEnvironmentTexture() ?? null;
    this.material.bind(this.bindings());
  }

  setWakeSampler(sampler: WakeSampler | null): void {
    this.wakeSampler = sampler;
    this.material.bind(this.bindings());
  }

  setShadowNode(node: Node<'float'> | null): void {
    if (node === this.shadow) return;
    this.shadow = node;
    this.material.bind(this.bindings());
  }

  postProcess(scenePass: PassNode, color: Node<'vec4'>): Node<'vec4'> { return underwaterPost(this, scenePass, color); }

  ensureHorizon(far: number): void { this.geometry.ensureHorizon(far); }

  addFloater(object: Object3D, { smoothing = .6 }: { smoothing?: number } = {}): void {
    this.floaters.push({ object, smoothing });
    this.heights.setPositions(this.floaters.map(({ object }) => ({ x: object.position.x, z: object.position.z })));
  }

  /** Nothing to resize yet: three sizes the viewport copies from the drawing buffer. */
  resize(_width: number, _height: number): void {}

  dispose(): void {
    this.geometry.mesh.removeFromParent();
    if (this.scene.fogNode) this.scene.fogNode = null;
    this.geometry.dispose(); this.material.dispose();
    this.heights.dispose(); this.wake.dispose(); this.waveField.dispose();
  }

  private bindings() {
    return { environment: this.environment, wake: this.wakeSampler ?? this.wake.sampler, shadow: this.shadow };
  }
}
