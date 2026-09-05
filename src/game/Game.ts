import * as THREE from 'three/webgpu';
import { pass, vec4 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WaterSystem, getPresetParams } from '../../vendor/threejs-water-pro/build/index.js';
import { SkySystem, PRESETS as SKY_PRESETS } from '../../vendor/threejs-sky-pro/build/index.js';
import { SingleplayerSimulation } from '../simulation/ship';
import { InputController } from './InputController';
import { CameraRig } from './CameraRig';
import { createHarborBackdrop } from './HarborBackdrop';
import { ShipWake } from './ShipWake';
import { SHIP_MODEL } from './shipModel';
import type { GameCallbacks, GameSettings } from './types';

export const BUOYS = [
  { x: -160, z: -800, color: '#b84734' }, { x: 160, z: -800, color: '#42a789' },
  { x: 220, z: -1800, color: '#b84734' }, { x: 540, z: -1800, color: '#42a789' },
];

export class Game {
  readonly simulation = new SingleplayerSimulation();
  readonly input: InputController;
  private renderer: THREE.WebGPURenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(52, 1, 0.5, 60000);
  private rig: CameraRig;
  // Buoyancy's public API accepts Mesh; keep the transform carrier non-rendering
  // while retaining valid geometry for shader compilation and scene traversal.
  private ship = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial({ visible: false }));
  private water?: WaterSystem;
  private sky?: SkySystem;
  private shipWake?: ShipWake;
  private pipeline?: THREE.RenderPipeline;
  private scenePass?: ReturnType<typeof pass>;
  private buoyancyId?: number;
  private rotationOffset = new THREE.Euler(0, 0, 0, 'YXZ');
  private abort = new AbortController();
  private resizePending = true;
  private observer: ResizeObserver;
  private disposed = false;
  private paused = false;
  private inPort = false;
  private harbor?: THREE.Group;
  private raf = 0;
  private lastTime = 0;
  private hudTime = 0;
  private fps = 60;
  private lastTrailTick = 0;
  private trail: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  private initialization?: Promise<void>;
  private frameTask?: Promise<void>;

  constructor(private host: HTMLElement, private settings: GameSettings, private callbacks: GameCallbacks) {
    this.renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.domElement.setAttribute('aria-label', 'Bismarck ocean scene. Drag to orbit; scroll to zoom.');
    this.renderer.domElement.tabIndex = 0;
    this.host.appendChild(this.renderer.domElement);
    this.rig = new CameraRig(this.camera, this.renderer.domElement);
    this.input = new InputController({
      pause: () => { if (!this.inPort) this.setPaused(!this.paused); },
      camera: () => this.rig.cycle(), recenter: () => this.rig.recenter(),
      hud: () => { if (!this.inPort) callbacks.hud(); }, fullscreen: () => this.fullscreen(),
    });
    this.input.setEnabled(false);
    this.observer = new ResizeObserver(() => { this.resizePending = true; });
    this.observer.observe(host);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.inPort) this.setPaused(true);
      this.lastTime = performance.now();
    }, { signal: this.abort.signal });
    window.addEventListener('blur', () => { if (!this.inPort) this.setPaused(true); }, { signal: this.abort.signal });
  }

  start(): void {
    this.initialization = this.initialize().catch(error => {
      if (!this.disposed) this.callbacks.error(error instanceof Error ? error.message : String(error));
    });
  }

  private assertActive(): void { if (this.disposed) throw new Error('Game disposed'); }

  private async initialize(): Promise<void> {
    this.callbacks.progress('Starting the renderer', 0.08);
    this.resize();
    await this.renderer.init();
    this.assertActive();
    this.rig.update(this.simulation.ship, 0, 0, true);
    this.callbacks.progress('Launching Bismarck', 0.2);
    const gltf = await new GLTFLoader().loadAsync(SHIP_MODEL.url);
    this.ship.add(gltf.scene);
    this.assertActive();
    // Blender export: bow +X, up +Y. Our simulation uses bow -Z.
    gltf.scene.rotation.y = Math.PI / 2;
    gltf.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material instanceof THREE.MeshStandardMaterial && material.map) material.map.anisotropy = 8;
        }
      }
    });
    this.ship.name = 'Bismarck';
    this.scene.add(this.ship);
    this.scene.add(new THREE.HemisphereLight('#dcebf2', '#65757e', 0.65));

    this.callbacks.progress('Building the Atlantic', 0.37);
    // Water Pro 3.5.1 combines seed * 100000 + cellIndex in float32.
    // Large seeds (e.g. 1941) collapse adjacent inputs, creating repeated arcs.
    // Keep the library's small, deterministic seed until its hash input is fixed.
    this.water = await WaterSystem.create(this.renderer, this.scene, this.camera, this.settings.quality, { seed: 1 });
    this.assertActive();
    const params = getPresetParams('blackFlag');
    params.oceanFloor.enabled = false;
    params.oceanFloor.depth = 200;
    params.fog.fadeStart = 2500;
    params.fog.fadeEnd = 16000;
    params.fog.skyBlendDistance = 10000;
    params.fog.fadePower = 1.4;
    // Full sky illumination keeps the shaded hull readable in daylight.
    params.environment.intensity = 1;
    params.clipmap.baseSize = 256;
    params.clipmap.levels = 6;
    params.foam.surface.opacity = 0.13;
    params.foam.waves.opacity = 0.45;
    params.postProcessing.underwaterParticles.enabled = false;
    params.spray.enabled = false;
    params.waves.fft.amplitude = this.settings.sea === 'Fair' ? 0.35 : this.settings.sea === 'Heavy' ? 1.4 : 0.75;
    params.waves.fft.windSpeed = this.settings.sea === 'Fair' ? 5 : this.settings.sea === 'Heavy' ? 16 : 9;
    params.waves.fft.peakWavelength = this.settings.sea === 'Heavy' ? 100 : 65;
    params.waves.fft.choppiness = 1.05;
    this.water.loadPreset(params);

    this.callbacks.progress('Lighting the sky', 0.59);
    this.sky = await SkySystem.create({ renderer: this.renderer, camera: this.camera, scene: this.scene,
      quality: this.settings.quality === 'ultra' ? 'high' : 'medium', cloudRenderingMode: 'dynamic', godRays: false });
    this.assertActive();
    await this.sky.applyPreset(SKY_PRESETS.partlyCloudy);
    this.assertActive();
    // A high daytime sun, at Sky Pro's nominal daytime intensity. Keep
    // exposure neutral; fix the illumination rather than lifting black levels.
    this.sky.sun.setFromAngles(48, 235);
    this.sky.sun.peakIntensity = 6.6;
    this.sky.godRays.enabled = false;
    this.sky.clouds.shape.coverage.value = 0.64;
    this.sky.clouds.shape.altitude.value = 1700;
    this.sky.clouds.shape.thickness.value = 3200;
    // Cloud volumes use their own ambient fill, independently of scene lights.
    // Soften the extra base darkening and lift the preset's near-black bounce.
    this.sky.clouds.lighting.baseShadowStrength.value = 0.2;
    this.sky.clouds.lighting.ambientIntensity.value = 1.1;
    this.sky.clouds.lighting.groundBounceAlbedo.value.setRGB(0.09, 0.105, 0.12);
    this.sky.clouds.wind.speed = 12;
    this.sky.atmosphere.fogDensity.value = 0.7;
    this.water.setSky(this.sky.createSkyProvider({ envMap: { width: 384, cloudMarchSteps: 16, skipFrames: 8 } }));
    const sunlight = this.water.lighting.sunLight;
    sunlight.shadow.mapSize.set(this.settings.quality === 'medium' ? 1024 : 2048, this.settings.quality === 'medium' ? 1024 : 2048);
    Object.assign(sunlight.shadow.camera, { left: -190, right: 190, top: 190, bottom: -190, near: 1, far: 1300 });
    sunlight.shadow.camera.updateProjectionMatrix();
    sunlight.shadow.normalBias = 0.1;
    this.scene.add(sunlight.target);
    this.water.lighting.addSunSyncListener(() => {
      sunlight.position.copy(this.sky!.sun.direction.value).multiplyScalar(500).add(this.ship.position);
      sunlight.target.position.copy(this.ship.position);
      sunlight.target.updateMatrixWorld();
    });

    this.buoyancyId = this.water.buoyancy.addObject(this.ship, {
      multiPoint: true, useBoundingBox: false, sampleLength: 190, sampleWidth: 28,
      heightOffset: 0, heightSmoothing: 1.8, rotationSmoothing: 1.8, rotationInfluence: 0.45,
    });
    this.shipWake = new ShipWake(this.water.wake, this.ship, this.scene);
    for (const buoy of BUOYS) this.addBuoy(buoy);
    this.harbor = createHarborBackdrop();
    this.harbor.visible = this.inPort;
    this.scene.add(this.harbor);

    this.callbacks.progress('Compiling ocean shaders', 0.82);
    this.scenePass = pass(this.scene, this.camera);
    const sceneColor = this.scenePass.getTextureNode('output');
    const waterColor = this.water.postProcessing.buildNode(this.scenePass, sceneColor);
    const output = vec4(this.sky.applyTo(waterColor, this.scenePass));
    this.pipeline = new THREE.RenderPipeline(this.renderer, vec4(output.rgb.mul(this.sky.atmosphere.exposure), output.a));
    await this.renderer.compileAsync(this.scene, this.camera);
    this.assertActive();
    this.sky.update(1 / 60);
    await this.water.update(1 / 60);
    this.assertActive();
    this.pipeline.render();
    this.callbacks.progress('Ready to get underway', 1);
    this.callbacks.ready();
    this.input.setEnabled(!this.paused && !this.inPort);
    this.lastTime = performance.now();
    this.scheduleFrame();
  }

  private addBuoy(buoy: typeof BUOYS[number]): void {
    const group = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial({ visible: false }));
    const paint = new THREE.MeshStandardMaterial({ color: buoy.color, roughness: 0.65 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2, 3.3, 3.5, 12), paint);
    base.position.y = 0.9;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 7, 8), paint);
    stem.position.y = 4.5;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2, 8), paint);
    cap.position.y = 8.8;
    group.add(base, stem, cap);
    group.position.set(buoy.x, 0, buoy.z);
    this.scene.add(group);
    this.water!.buoyancy.addObject(group, { multiPoint: false, heightSmoothing: 0.6 });
  }

  private scheduleFrame(): void {
    if (!this.disposed) this.raf = requestAnimationFrame(time => { this.frameTask = this.frame(time); });
  }

  private async frame(time: number): Promise<void> {
    if (this.disposed) return;
    const realDt = Math.min(Math.max((time - this.lastTime) / 1000, 0.001), 0.1);
    this.lastTime = time;
    const dt = this.paused ? 0 : realDt;
    try {
      if (this.resizePending) this.resize();
      if (!this.inPort) this.simulation.advance(dt, this.input.sample());
      const state = this.simulation.ship;
      this.ship.position.x = state.x;
      this.ship.position.z = state.z;
      this.rotationOffset.y = -state.heading;
      this.water!.buoyancy.updateObjectConfig(this.buoyancyId!, { rotationOffset: this.rotationOffset });
      this.rig.update(state, this.ship.position.y, realDt);
      this.shipWake!.update(state, dt);
      this.sky!.update(dt);
      // Fixed-step mode with zero delta renders without stepping the wake's
      // leapfrog/foam integrators. Host-clock update(0) would still step them.
      this.water!.deterministic = this.paused;
      await this.water!.update(dt);
      if (this.disposed) return;
      this.pipeline!.render();
      this.fps += (1 / realDt - this.fps) * 0.04;
      if (state.tick - this.lastTrailTick >= 120) {
        this.trail.push({ x: state.x, z: state.z });
        if (this.trail.length > 240) this.trail.shift();
        this.lastTrailTick = state.tick;
      }
      if (time - this.hudTime > 100) {
        this.hudTime = time;
        this.callbacks.telemetry({ ship: { ...state }, order: this.input.order, camera: this.rig.mode,
          fps: Math.round(this.fps), backend: this.water!.backend, trail: [...this.trail] });
      }
      this.scheduleFrame();
    } catch (error) {
      if (!this.disposed) this.callbacks.error(error instanceof Error ? error.message : String(error));
    }
  }

  private resize(): void {
    const width = Math.max(this.host.clientWidth, 1), height = Math.max(this.host.clientHeight, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * this.settings.resolution);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.water?.resize(width, height);
    this.sky?.resize(width, height);
    this.resizePending = false;
  }
  setPaused(paused: boolean): void { this.paused = paused; this.input.setEnabled(!paused && !this.inPort && !!this.water); this.callbacks.pause(paused); }
  setInPort(inPort: boolean): void {
    this.inPort = inPort;
    this.rig.setInPort(inPort);
    if (this.harbor) this.harbor.visible = this.inPort;
    this.input.setOrder(1);
    this.input.setRudder(0);
    if (this.inPort) {
      this.simulation.reset();
      this.shipWake?.reset();
      this.trail = [{ x: 0, z: 0 }];
      this.lastTrailTick = 0;
    }
    this.setPaused(false);
  }
  cycleCamera(): void { this.rig.cycle(); }
  recenter(): void { this.rig.recenter(); }
  fullscreen(): void {
    const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    action?.catch(() => { /* Browsers may decline fullscreen; sailing remains available. */ });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.abort.abort(); this.observer.disconnect(); this.input.dispose(); this.rig.dispose();
    await this.initialization;
    await this.frameTask;
    this.pipeline?.dispose();
    this.scenePass?.dispose();
    this.shipWake?.dispose();
    this.water?.dispose();
    this.sky?.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    // A model loaded after unmount may not have reached scene.add yet.
    this.ship.traverse(object => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    });
    textures.forEach(texture => texture.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
