import * as THREE from 'three/webgpu';
import { pass, renderOutput, rtt, vec4 } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WaterSystem, getPresetParams } from '../../vendor/threejs-water-pro/build/index.js';
import { SkySystem, PRESETS as SKY_PRESETS } from '../../vendor/threejs-sky-pro/build/index.js';
import { CombatSimulation } from '../simulation/combat';
import { ShipView } from './ShipView';
import { CombatEffects } from './CombatEffects';
import type { Battery, Vec3 } from '../ships/blueprint';
import type { InspectionMode } from '../ships/inspection';
import { selectedShip } from '../ships/presets';
import { InputController } from './InputController';
import { CameraRig } from './CameraRig';
import { sightAim } from './aiming';
import { createHarborBackdrop, type HarborBackdrop } from './HarborBackdrop';
import { ShipWake } from './ShipWake';
import type { GameCallbacks, GameSettings } from './types';

export const BUOYS = [
  { x: -160, z: -800, color: '#b84734' }, { x: 160, z: -800, color: '#42a789' },
  { x: 220, z: -1800, color: '#b84734' }, { x: 540, z: -1800, color: '#42a789' },
];
export type ArticulationPreview = { trainFraction: number; elevationFraction: number; recoilFraction: number };

export class Game {
  readonly definition = selectedShip;
  readonly simulation = new CombatSimulation(this.definition);
  readonly input: InputController;
  private renderer: THREE.WebGPURenderer;
  private scene = new THREE.Scene();
  private ambientLight = new THREE.HemisphereLight('#dcebf2', '#65757e', .65);
  private camera = new THREE.PerspectiveCamera(52, 1, 0.5, 60000);
  private rig: CameraRig;
  private ship = new THREE.Group();
  private playerView?: ShipView;
  private targetView?: ShipView;
  private loadedModel?: THREE.Group;
  private effects = new CombatEffects();
  battery: Battery = 'main';
  aimModule = this.definition.modules.find(m => m.kind === 'engine')?.id ?? '';
  inspecting = false;
  private manualAim = true;
  private currentAim: Vec3 = [650, .5, -550];
  chartSize = 2;
  gunneryOpen = false;
  private water?: WaterSystem;
  private sky?: SkySystem;
  private shipWake?: ShipWake;
  private pipeline?: THREE.RenderPipeline;
  private scenePass?: ReturnType<typeof pass>;
  private finalFrame?: ReturnType<typeof rtt>;
  private abort = new AbortController();
  private resizePending = true;
  private observer: ResizeObserver;
  private disposed = false;
  private paused = false;
  private inPort = false;
  private harbor?: HarborBackdrop;
  private raf = 0;
  private lastTime = 0;
  private hudTime = 0;
  private fps = 60;
  private lastTrailTick = 0;
  private trail: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  private initialization?: Promise<void>;
  private frameTask?: Promise<void>;
  private articulationOriginal?: CombatSimulation['player']['mounts'];

  constructor(private host: HTMLElement, private settings: GameSettings, private callbacks: GameCallbacks) {
    this.renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.domElement.setAttribute('aria-label', `${this.definition.name} ocean scene. Drag to orbit; scroll to zoom.`);
    this.renderer.domElement.tabIndex = 0;
    this.host.appendChild(this.renderer.domElement);
    this.rig = new CameraRig(this.camera, this.renderer.domElement, this.definition.viewpoints?.bridge, {
      pause: () => this.setPaused(true), aim: () => { this.manualAim = true; }, optics: () => this.toggleBinoculars(),
    });
    this.input = new InputController({
      pause: () => { if (!this.inPort) this.setPaused(!this.paused); },
      camera: () => this.cycleCamera(), recenter: () => this.recenter(),
      hud: () => { if (!this.inPort) callbacks.hud(); }, fullscreen: () => this.fullscreen(),
      optics: () => this.toggleBinoculars(), battery: battery => { this.battery = battery; },
      cursor: released => { if (released) this.rig.releasePointer(); else if (!document.querySelector('dialog[open]')) this.rig.capturePointer(); },
      chartSize: direction => this.resizeChart(direction), gunnery: () => this.setGunneryOpen(!this.gunneryOpen),
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
    this.callbacks.progress(`Launching ${this.definition.name}`, 0.2);
    const gltf = await new GLTFLoader().loadAsync(this.definition.modelUrl);
    this.loadedModel = gltf.scene;
    this.assertActive();
    if (gltf.scene.userData.definitionHash !== this.definition.contentHash) throw new Error('The ship model and definition have different versions. Rebuild the ship assets and reload.');
    this.playerView = new ShipView(gltf.scene, this.definition, this.simulation.player);
    this.targetView = new ShipView(gltf.scene.clone(true), this.definition, this.simulation.target);
    this.ship = this.playerView.root;
    this.targetView.root.visible = !this.inPort;
    this.scene.add(this.ship, this.targetView.root, this.effects.root);
    this.scene.add(this.ambientLight);

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
    this.updateSeaState();

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
    this.updatePortLighting();
    this.water.setSky(this.sky.createSkyProvider({ envMap: { width: 384, cloudMarchSteps: 16, skipFrames: 8 } }));
    const sunlight = this.water.lighting.sunLight;
    const shadowSize = this.settings.quality === 'medium' ? 1024 : this.settings.quality === 'ultra' ? 4096 : 2048;
    sunlight.shadow.mapSize.set(shadowSize, shadowSize);
    Object.assign(sunlight.shadow.camera, { left: -380, right: 380, top: 380, bottom: -380, near: 1, far: 1800 });
    sunlight.shadow.camera.updateProjectionMatrix();
    sunlight.shadow.normalBias = 0.1;
    this.scene.add(sunlight.target);
    this.water.lighting.addSunSyncListener(() => {
      sunlight.target.position.copy(this.ship.position);
      if (this.inPort) sunlight.target.position.x -= 160;
      sunlight.position.copy(this.sky!.sun.direction.value).multiplyScalar(this.inPort ? 800 : 500).add(sunlight.target.position);
      sunlight.target.updateMatrixWorld();
    });

    // Combat hulls use the shared simulation pose. GPU wave sampling remains visual
    // ocean detail and buoy motion; it cannot move ship hitboxes or muzzle positions.
    this.shipWake = new ShipWake(this.water.wake, this.ship, this.scene);
    for (const buoy of BUOYS) this.addBuoy(buoy);
    this.callbacks.progress('Building the naval anchorage', 0.72);
    this.harbor = await createHarborBackdrop(this.settings.quality);
    this.harbor.visible = this.inPort;
    this.scene.add(this.harbor);
    this.assertActive();

    this.callbacks.progress('Compiling ocean shaders', 0.82);
    this.scenePass = pass(this.scene, this.camera);
    const sceneColor = this.scenePass.getTextureNode('output');
    const waterColor = this.water.postProcessing.buildNode(this.scenePass, sceneColor);
    const output = vec4(this.sky.applyTo(waterColor, this.scenePass));
    // FXAA detects edges in display space, after tone mapping and sRGB conversion.
    this.finalFrame = rtt(renderOutput(vec4(output.rgb.mul(this.sky.atmosphere.exposure), output.a), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace));
    this.pipeline = new THREE.RenderPipeline(this.renderer, fxaa(this.finalFrame));
    this.pipeline.outputColorTransform = false;
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
      const state = this.simulation.ship;
      const focus = this.inspecting ? this.simulation.target.motion : state;
      this.rig.update(focus, focus.y, realDt);
      const aim = this.manualAim ? this.inspecting ? this.currentAim : this.readSightAim() : this.simulation.aimAt(this.aimModule, this.battery);
      this.currentAim = aim;
      if (!this.inPort) this.simulation.advance(dt, this.input.sample(), { aim, fire: this.input.firing || this.rig.firing, battery: this.battery });
      this.playerView!.update(); this.targetView!.update(); this.effects.update(this.simulation, dt);
      this.playerView!.root.visible = !this.rig.binoculars;
      this.harbor?.update(dt, this.camera);
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
          binoculars: this.rig.binoculars, magnification: this.rig.magnification, pointerLocked: this.rig.pointerLocked,
          viewBearing: this.rig.bearing, chartSize: this.chartSize, gunneryOpen: this.gunneryOpen,
          fps: Math.round(this.fps), backend: this.water!.backend, trail: [...this.trail],
          combat: this.simulation.telemetry(this.battery, aim), inspecting: this.inspecting, aimModule: this.manualAim ? 'point' : this.aimModule,
          aimMarker: this.projectAim(aim) });
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
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.input.setEnabled(!paused && !this.inPort && !!this.water);
    this.rig.setEnabled(!paused);
    this.callbacks.pause(paused);
  }
  capturePointer(): void { this.rig.capturePointer(); }
  resizeChart(direction: number): void { this.chartSize = THREE.MathUtils.clamp(this.chartSize + direction, 0, 4); }
  setGunneryOpen(open: boolean): void {
    this.gunneryOpen = open;
    if (open) this.rig.releasePointer();
    else if (!this.inspecting) this.rig.capturePointer();
  }
  toggleBinoculars(): void {
    if (this.paused || this.inPort || this.inspecting) return;
    this.rig.toggleBinoculars(this.manualAim ? this.readSightAim() : this.currentAim, this.simulation.ship);
  }
  private readSightAim(): Vec3 {
    return sightAim(this.camera.position.toArray(), this.camera.getWorldDirection(new THREE.Vector3()).toArray(), {
      pose: this.simulation.target.motion, armor: this.definition.armor,
    });
  }
  setInPort(inPort: boolean): void {
    if (this.articulationOriginal) this.restoreArticulation();
    const leavingPort = this.inPort && !inPort;
    this.inPort = inPort;
    // The garage camera stays at least 90 m from its target. A suitable near
    // plane preserves depth precision on the town's distant architectural trim.
    this.camera.near = inPort ? 3 : .5;
    this.camera.updateProjectionMatrix();
    this.rig.setInPort(inPort);
    if (this.harbor) this.harbor.visible = inPort;
    if (this.targetView) this.targetView.root.visible = !inPort;
    this.inspecting = false; this.targetView?.inspect(false); this.playerView?.inspect(false);
    this.manualAim = true;
    this.gunneryOpen = false;
    this.updateSeaState();
    this.updatePortLighting();
    this.input.setOrder(1); this.input.setRudder(0);
    if (inPort) {
      this.simulation.reset();
      this.simulation.ship.x = 240;
      this.shipWake?.reset();
      this.trail = [{ x: this.simulation.ship.x, z: 0 }]; this.lastTrailTick = 0;
    }
    if (leavingPort) {
      this.simulation.ship.x = 0;
      this.trail = [{ x: 0, z: 0 }];
    }
    this.setPaused(false);
    if (leavingPort) {
      this.currentAim = this.simulation.aimAt(this.aimModule, this.battery);
      this.rig.aimAt(this.currentAim, this.simulation.ship);
      this.rig.capturePointer();
    }
    this.renderer.domElement.setAttribute('aria-label', `${this.definition.name} ocean scene. ${inPort ? 'Drag to orbit; scroll to zoom.' : 'Click to capture mouse. Mouse to aim; left mouse to fire; Shift for binoculars; Control for cursor; Escape to pause.'}`);
  }
  fire(): void { if (!this.paused && !this.inPort && this.playerView) this.simulation.requestFire(); }
  setPortInspection(mode: InspectionMode, selectedId?: string): void {
    if (this.inPort) this.playerView?.setInspection(mode, selectedId);
  }
  selectAim(moduleId: string): void { this.manualAim = moduleId === 'point'; this.aimModule = moduleId; }
  inspectTarget(): void {
    this.inspecting = !this.inspecting;
    this.targetView?.inspect(this.inspecting);
    this.rig.setInspecting(this.inspecting);
    if (!this.inspecting) this.rig.aimAt(this.currentAim, this.simulation.ship);
  }
  resetTarget(): void { if (!this.paused) this.simulation.resetTarget(); }
  private restoreArticulation(): void {
    if (this.articulationOriginal) {
      this.simulation.player.mounts.forEach((m, i) => Object.assign(m, this.articulationOriginal![i]));
      this.articulationOriginal = undefined;
      this.playerView?.update();
    }
  }
  /** Development-only port inspection of the loaded model at catalog joint limits. */
  previewArticulation(pose: ArticulationPreview | null) {
    if (!import.meta.env.DEV || !this.inPort || !this.playerView) throw new Error('Articulation review requires a loaded ship in the development port.');
    if (pose === null) this.restoreArticulation();
    else {
      if (![pose.trainFraction, pose.elevationFraction, pose.recoilFraction].every(Number.isFinite)) throw new Error('Review fractions must be finite.');
      this.articulationOriginal ??= structuredClone(this.simulation.player.mounts);
      this.simulation.player.mounts.forEach((state, i) => {
        const w = this.definition.mounts[i].weapon;
        state.train = THREE.MathUtils.clamp(pose.trainFraction, -1, 1) * w.traverseDeg * Math.PI / 180;
        state.elevation = (w.elevationMinDeg + THREE.MathUtils.clamp(pose.elevationFraction, 0, 1) * (w.elevationMaxDeg - w.elevationMinDeg)) * Math.PI / 180;
        state.recoil = THREE.MathUtils.clamp(pose.recoilFraction, 0, 1);
      });
      this.playerView.update();
    }
    return this.diagnostics();
  }
  diagnostics() {
    return { shipId: this.definition.id, contentHash: this.definition.contentHash, backend: this.water?.backend,
      camera: { mode: this.rig.mode, binoculars: this.rig.binoculars, magnification: this.rig.magnification, fov: this.camera.fov,
        pointerLocked: this.rig.pointerLocked, position: this.camera.position.toArray(), aim: this.currentAim, manualAim: this.manualAim,
        projectionMatrix: this.camera.projectionMatrix.toArray(), matrixWorldInverse: this.camera.matrixWorldInverse.toArray() },
      tick: this.simulation.tick, paused: this.paused, fps: this.fps, inspecting: this.inspecting, inPort: this.inPort,
      portInspection: this.playerView?.inspection.mode, selectedVolume: this.playerView?.inspection.selectedId,
      maxMuzzleErrorM: Math.max(0, ...this.playerView?.muzzleErrors() ?? [], ...this.targetView?.muzzleErrors() ?? []),
      combat: this.simulation.telemetry(this.battery, this.currentAim),
      events: this.simulation.events.slice(-20) };
  }
  private projectAim(aim: Vec3): { x: number; y: number; visible: boolean } {
    const point = new THREE.Vector3(...aim).project(this.camera);
    return { x: (point.x + 1) * 50, y: (1 - point.y) * 50, visible: point.z > -1 && point.z < 1 && Math.abs(point.x) < .94 && Math.abs(point.y) < .85 };
  }
  private updateSeaState(): void {
    if (!this.water) return;
    // Breakwaters shelter the anchorage. Sailing restores the selected sea conditions.
    this.water.waves.amplitude.value = this.inPort ? .18 : this.settings.sea === 'Fair' ? .35 : this.settings.sea === 'Heavy' ? 1.4 : .75;
    this.water.waves.windSpeed.value = this.inPort ? 4 : this.settings.sea === 'Fair' ? 5 : this.settings.sea === 'Heavy' ? 16 : 9;
  }
  private updatePortLighting(): void {
    if(!this.sky)return;
    this.sky.sun.setFromAngles(this.inPort ? 36 : 48, this.inPort ? 58 : 235);
    this.sky.sun.peakIntensity=this.inPort ? 3.8 : 6.6;
    this.sky.clouds.shape.coverage.value=this.inPort ? .48 : .64;
    this.ambientLight.intensity = this.inPort ? 1.1 : .65;
    this.sky.atmosphere.turbidity.value = this.inPort ? 3.2 : 1;
    this.sky.atmosphere.rayleigh.value = this.inPort ? .9 : .41;
    this.sky.atmosphere.mieScatteringStrength.value = this.inPort ? .65 : .19;
    // Water Pro owns scene.fogNode, including the water/sky horizon blend.
    // Its live uniforms must change with the scene; THREE.Fog is overridden.
    if (this.water) {
      this.water.fog.color = this.inPort ? '#819aa5' : '#8b8f92';
      this.water.fog.fadeStart = this.inPort ? 650 : 2500;
      this.water.fog.fadeEnd = this.inPort ? 5600 : 16000;
      this.water.fog.fadePower = this.inPort ? .85 : 1.4;
      this.water.fog.skyBlendDistance = this.inPort ? 2600 : 10000;
    }
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
    this.finalFrame?.renderTarget?.dispose();
    this.scenePass?.dispose();
    this.shipWake?.dispose();
    this.water?.dispose();
    this.sky?.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.harbor?.ownedTextures.forEach(texture => textures.add(texture));
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    // A model loaded after unmount may not have reached scene.add yet.
    (this.loadedModel ?? this.ship).traverse(object => {
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
