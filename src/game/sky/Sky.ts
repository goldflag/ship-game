import { Matrix4, Vector3, type Mesh, type Node, type Object3D, type PassNode, type PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { OceanSky } from '../ocean/contracts';
import type { AtmospherePart, CelestialPart, CloudPart, EnvironmentPart, EnvironmentSources, SkyApi, SkyFrame, SkyPartContext, SkyQuality, SkyScene, WeatherPart } from './contracts';
import { createDome } from './dome';
import { SkyState } from './state';
import { createAtmosphere } from './atmosphere';
import { createCelestial } from './celestial';
import { createClouds } from './clouds';
import { createWeather, type WeatherOptions } from './weather';
import { createEnvironment } from './environment';

/** A camera that moves farther than this in one frame (m) or turns more (radians) has cut. */
const CUT_DISTANCE = 250, CUT_TURN = .5;

interface Parts { atmosphere: AtmospherePart; celestial: CelestialPart; clouds: CloudPart; weather: WeatherPart; environment: EnvironmentPart }

/** The game's sky. See `README.md` in this folder. */
export class Sky implements SkyApi {
  readonly renderer = 'game' as const;
  readonly exposure = uniform(1);
  onThunder?: SkyApi['onThunder'];
  private readonly dome: Mesh;
  private cut = true;
  private readonly lastPosition = new Vector3();
  private readonly lastForward = new Vector3();
  private readonly lastProjection = new Matrix4();
  private qualityLevel: SkyQuality;

  static async create(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, options: { quality: SkyQuality; weather?: WeatherOptions }): Promise<Sky> {
    const state = new SkyState();
    const context: SkyPartContext = { renderer, uniforms: state.uniforms, quality: options.quality, reversedDepth: renderer.reversedDepthBuffer };
    const atmosphere = await createAtmosphere(context);
    const celestial = await createCelestial(context);
    const clouds = await createClouds(context, atmosphere);
    const weather = await createWeather(context, atmosphere, options.weather);
    const meshes: Object3D[] = [];
    // The bake sees the sky from sea level; its sun disc and stars stay out (the sea draws its own glints).
    const sources: EnvironmentSources = {
      dome: direction => clouds.cirrus(direction, atmosphere.sky(direction, true)
        .add(atmosphere.transmittanceToSpace(direction, true).mul(celestial.diffuseRadiance(direction)))),
      fog: direction => atmosphere.sky(direction),
      clouds,
      meshes: () => meshes,
    };
    const environment = await createEnvironment(context, sources);
    const sky = new Sky(renderer, scene, camera, state, { atmosphere, celestial, clouds, weather, environment }, options.quality);
    meshes.push(...sky.meshes());
    return sky;
  }

  private constructor(private readonly gpu: WebGPURenderer, private readonly scene: Scene, private readonly camera: PerspectiveCamera,
    readonly state: SkyState, private readonly parts: Parts, quality: SkyQuality) {
    this.qualityLevel = quality;
    const { atmosphere, celestial, clouds, weather } = parts;
    this.dome = createDome(direction => clouds.cirrus(direction, atmosphere.sky(direction)
      .add(atmosphere.transmittanceToSpace(direction).mul(celestial.radiance(direction)))), gpu.reversedDepthBuffer);
    weather.onThunder = strike => this.onThunder?.(strike);
    scene.add(this.dome, clouds.composite, ...weather.meshes);
    this.apply(state.scene);
  }

  get quality(): SkyQuality { return this.qualityLevel; }
  get light() { return this.state.light; }
  get sun() { return this.state.sun; }
  get moon() { return this.state.moon; }
  get coverage(): number { return this.state.scene.clouds.coverage; }
  get cloudsEnabled(): boolean { return this.parts.clouds.enabled; }
  set cloudsEnabled(enabled: boolean) { this.parts.clouds.enabled = enabled; this.parts.clouds.composite.visible = enabled; }
  get oceanSky(): OceanSky { return this.parts.environment.oceanSky; }

  apply(scene: SkyScene): void {
    this.state.apply(scene);
    this.parts.atmosphere.apply(scene);
    this.parts.clouds.apply(scene);
    this.parts.weather.apply(scene);
    this.state.chooseLight(this.parts.atmosphere.seaLevel, this.parts.weather.flash);
  }

  update(dt: number): void {
    const { state, camera, parts } = this, uniforms = state.uniforms;
    camera.updateMatrixWorld();
    const forward = new Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    const cut = this.cut || camera.position.distanceTo(this.lastPosition) > CUT_DISTANCE || forward.angleTo(this.lastForward) > CUT_TURN
      || Math.abs(camera.projectionMatrix.elements[5] / this.lastProjection.elements[5] - 1) > .2;
    this.cut = false;
    this.lastPosition.copy(camera.position); this.lastForward.copy(forward); this.lastProjection.copy(camera.projectionMatrix);
    state.advance(dt, camera.position);
    const frame: SkyFrame = { renderer: this.gpu, camera, dt, cut };
    parts.atmosphere.update(frame);
    parts.celestial.update(frame);
    parts.weather.update(frame);
    const strike = parts.weather.strike;
    uniforms.lightningIntensity.value = strike?.intensity ?? 0;
    if (strike) uniforms.lightningPosition.value.copy(strike.position);
    parts.clouds.update(frame);
    parts.environment.followCamera(camera);
    parts.environment.update(frame);
    state.chooseLight(parts.atmosphere.seaLevel, parts.weather.flash);
  }

  postProcess(scenePass: PassNode, color: Node<'vec4'>): Node<'vec4'> {
    const { celestial, clouds, weather } = this.parts;
    return weather.postProcess(scenePass, celestial.shafts(scenePass, color, clouds.screenTransmittance));
  }

  cloudShadow(position: Node<'vec3'>): Node<'float'> { return this.parts.clouds.shadow(position); }

  meshes(): Object3D[] { return [this.dome, this.parts.clouds.composite, ...this.parts.weather.meshes]; }

  resetHistory(): void { this.cut = true; }

  resize(width: number, height: number): void {
    const ratio = this.gpu.getPixelRatio(), w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
    for (const part of Object.values(this.parts) as { resize?(w: number, h: number): void }[]) part.resize?.(w, h);
    this.cut = true;
  }

  async setQuality(quality: SkyQuality): Promise<void> {
    this.qualityLevel = quality;
    await Promise.all(Object.values(this.parts).map(part => (part as { setQuality(q: SkyQuality): void | Promise<void> }).setQuality(quality)));
    this.cut = true;
  }

  diagnostics(): Record<string, unknown> {
    const { light } = this.state;
    return { renderer: this.renderer, quality: this.qualityLevel, scene: this.state.scene, sun: this.sun, moon: this.moon,
      light: { direction: light.direction.toArray(), color: light.color.toArray(), intensity: light.intensity, night: light.night, flash: light.flash } };
  }

  dispose(): void {
    this.scene.remove(...this.meshes());
    this.dome.geometry.dispose();
    (this.dome.material as { dispose(): void }).dispose();
    for (const part of Object.values(this.parts)) (part as { dispose(): void }).dispose();
  }
}
