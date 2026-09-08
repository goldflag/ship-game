import { weaponGroups, selectedWeapon } from '../ships/weaponGroups';
import { hullDepth } from '../simulation/ship';
import { assetUrl } from '../assetUrl';
import { BattlefieldCamera } from './BattlefieldCamera';
import { airWingTelemetry } from '../simulation/airTelemetry';
import { projectShipLabel } from './ShipLabels';
import { projectAirMapPath } from './AirMapProjection';
import { squadronFlights, airborne, onFlightDeck, type AirOrder } from '../simulation/aircraft';
import { aircraftFollowView } from './AircraftFollow';
import { AircraftView } from './AircraftView';
import { oceanMap, DEFAULT_MAP, landHeight } from '../maps/catalog';
import { battleEnvironment, type BattleConditions, type TimeOfDayId, type WeatherId } from '../maps/conditions';
import { createBattleLandscape, disposeBattleLandscape } from './BattleLandscape';
import type { ControlPriority } from '../simulation/damageControl';
import * as THREE from 'three/webgpu';
import { Fn, float, max, mix, pass, renderOutput, rtt, vec4 } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { VisualWaveSampler } from './VisualWaveSampler';
import { UnderwaterPassVisibility } from './UnderwaterPassVisibility';
import { FrameScene } from './FrameScene';
import { FleetShipDraws } from './FleetShipDraws';
import { batchShipModel } from './ShipBatching';
import { prepareShipDetail } from './ShipDetail';
import { ShipMaterialPalette } from './ShipMaterialPalette';
import { loadShipModel } from './loadShipModel';
import { WaterSystem, getPresetParams } from '../../vendor/threejs-water-pro/build/index.js';
import { SkySystem, PRESETS as SKY_PRESETS } from '../../vendor/threejs-sky-pro/build/index.js';
import { CombatSimulation } from '../simulation/combat';
import { availableAmmunition } from '../simulation/weapons';
import { ShipView } from './ShipView';
import { ArmorOverlay } from './ArmorOverlay';
import { InspectionHover, type InspectionHoverInfo } from './InspectionHover';
import { ShipLabels } from './ShipLabels';
import { HitLabels } from './HitLabels';
import { TorpedoPreview } from './TorpedoPreview';
import { HullDamageFeedback } from './HullDamageFeedback';
import { ENGINE_ORDERS, FIXED_DT } from '../simulation/ship';
import { DEPTH_STEP_M, orderDepth } from '../simulation/submarine';
import { GunAimIndicators } from './GunAimIndicators';
import { HitDirectionIndicators } from './HitDirectionIndicators';
import { disposeObjects } from './disposeObjects';
import { CombatEffects } from './CombatEffects';
import { configureRenderOrder } from './renderOrder';
import type { GameAudio } from './GameAudio';
import type { Ammunition, Battery, Vec3 } from '../ships/blueprint';
import type { InspectionMode } from '../ships/inspection';
import { selectedShip, shipPreset, shipPresets } from '../ships/presets';
import { resolveBattleFleet, validateBattleSetup, type BattleSetup } from '../simulation/battle';
import { InputController } from './InputController';
import { CameraRig } from './CameraRig';
import { ShellFollow } from './ShellFollow';
import { sightAim, torpedoCourseAim } from './aiming';
import { createHarborBackdrop, type HarborBackdrop } from './HarborBackdrop';
import { ShipWake } from './ShipWake';
import { ShipFunnelSmoke } from './ShipFunnelSmoke';
import type { GameCallbacks, GameSettings } from './types';

export const BUOYS = [
  { x: -160, z: -800, color: '#b84734' }, { x: 160, z: -800, color: '#42a789' },
  { x: 220, z: -1800, color: '#b84734' }, { x: 540, z: -1800, color: '#42a789' },
];
export type ArticulationPreview = { trainFraction: number; elevationFraction: number; recoilFraction: number };
/** Battle preparation stages, reported as a label with a completion fraction in [0, 1). */
export type BattleProgress = (label: string, fraction: number) => void;

export class Game {
  definition: typeof selectedShip;
  simulation: CombatSimulation;
  readonly input: InputController;
  private renderer: THREE.WebGPURenderer;
  private scene = new FrameScene();
  private underwaterPassVisibility?: UnderwaterPassVisibility;
  private ambientLight = new THREE.HemisphereLight('#dcebf2', '#65757e', .65);
  private camera = new THREE.PerspectiveCamera(52, 1, 0.5, 60000);
  private rig: CameraRig;
  private battlefieldCamera = new BattlefieldCamera(this.camera);
  private shellFollow = new ShellFollow();
  private followedAircraftId?: string;
  spectatedShipId?: string;
  // Stable motion anchor for the wake and sunlight, independent of the loaded hull.
  private ship = new THREE.Group();
  private playerView?: ShipView;
  private targetView?: ShipView;
  private fleetViews: ShipView[] = [];
  private fleetDraws?: FleetShipDraws;
  private visualWaveSampler?: VisualWaveSampler;
  private fleetModels: THREE.Group[] = [];
  private shipLabels: ShipLabels;
  private hitLabels: HitLabels;
  private torpedoPreview = new TorpedoPreview();
  private playerDamageFeedback: HullDamageFeedback;
  private damageFeedbackShipId?: string;
  private gunAim: GunAimIndicators;
  private hitDirections: HitDirectionIndicators;
  private hudScale = 1;
  private loadedModel?: THREE.Group;
  private effects = new CombatEffects();
  private funnelSmoke = new ShipFunnelSmoke();
  private aircraftView = new AircraftView();
  controlPriority: ControlPriority = 'balanced';
  controlFocus = '';
  ammunition: Record<string, Ammunition> = { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' };
  private selectedBattery: Battery = 'main';
  private selectedWeaponGroupId?: string;
  private weaponGroupDefinition?: typeof this.definition;
  private fittedWeaponGroups = [] as ReturnType<typeof weaponGroups>;
  get weaponGroups() {
    if (this.weaponGroupDefinition !== this.definition) {
      this.fittedWeaponGroups = weaponGroups(this.definition);
      this.weaponGroupDefinition = this.definition;
    }
    return this.fittedWeaponGroups;
  }
  get weaponGroupId(): string | undefined {
    return this.weaponGroups.find(g => g.id === this.selectedWeaponGroupId)?.id
      ?? this.weaponGroups.find(g => g.battery === this.battery)?.id;
  }
  get selectedAmmunition(): Ammunition { return this.ammunition[this.weaponGroupId ?? this.battery] ?? 'ap'; }
  selectWeaponGroup(id: string): void {
    const group = this.weaponGroups.find(g => g.id === id);
    if (!group) return;
    if (this.weaponGroupId !== group.id) this.lastShellPress = undefined;
    this.selectedBattery = group.battery;
    this.selectedWeaponGroupId = group.id;
  }
  selectWeaponSlot(index: number): void {
    const group = this.weaponGroups[index];
    if (group) this.selectWeaponGroup(group.id);
  }
  get battery(): Battery { return this.selectedBattery; }
  set battery(value: Battery) {
    if (value === 'torpedo' && !this.definition.torpedoTubes?.length) return;
    if (value === 'depth-charge' && !this.definition.depthChargeLaunchers?.length) return;
    if (this.selectedBattery !== value) this.lastShellPress = undefined;
    this.selectedBattery = value;
    this.selectedWeaponGroupId = this.weaponGroups.find(g => g.battery === value)?.id;
  }
  aimModule: string;
  inspecting = false;
  private manualAim = true;
  private currentAim: Vec3 = [650, .5, -550];
  chartSize = 2;
  airOperationsOpen = false;
  private cameraFrameListeners = new Set<() => void>();
  onCameraFrame(listener: () => void): () => void {
    this.cameraFrameListeners.add(listener);
    return () => { this.cameraFrameListeners.delete(listener); };
  }
  selectedFlightId?: string;
  private water?: WaterSystem;
  private landscape?: THREE.Group;
  private battleTimeOfDay?: TimeOfDayId;
  private battleWeather?: WeatherId;
  private battleConditions?: BattleConditions;
  private surfaceWaterAbsorption = new THREE.Color();
  private surfaceWaterDistortion = 0;
  private sky?: SkySystem;
  private shipWake?: ShipWake;
  private pipeline?: THREE.RenderPipeline;
  private scenePass?: ReturnType<typeof pass>;
  private finalFrame?: ReturnType<typeof rtt>;
  private armorOverlay?: ArmorOverlay;
  private inspectionHover: InspectionHover;
  private abort = new AbortController();
  private resizePending = true;
  private observer: ResizeObserver;
  private disposed = false;
  private switchingShip = false;
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
  private frameWaiters: (() => void)[] = [];
  private articulationOriginal?: CombatSimulation['player']['mounts'];
  private articulationLaunchers?: CombatSimulation['player']['torpedoLaunchers'];

  constructor(private host: HTMLElement, private settings: GameSettings, private callbacks: GameCallbacks, definition = selectedShip, readonly audio?: GameAudio) {
    this.definition = definition;
    this.battery = definition.torpedoTubes?.length ? 'torpedo' : 'main';
    this.simulation = new CombatSimulation(definition);
    this.playerDamageFeedback = new HullDamageFeedback(this.simulation.player.damage.integrity);
    this.aimModule = definition.modules.find(m => m.kind === 'engine')?.id ?? '';
    // Centimeter-scale fittings must remain distinct at 20 km, even with the
    // close near plane needed by bridge and shell-follow views. The scene pass
    // uses floating-point reversed depth; TSL's depth readers use the same mapping.
    this.renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance', reversedDepthBuffer: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.domElement.setAttribute('aria-label', `${this.definition.name} ocean scene. Drag to orbit; scroll to zoom.`);
    this.renderer.domElement.tabIndex = 0;
    this.host.appendChild(this.renderer.domElement);
    this.shipLabels = new ShipLabels(this.host);
    this.hitLabels = new HitLabels(this.host);
    this.gunAim = new GunAimIndicators(this.host);
    this.hitDirections = new HitDirectionIndicators(this.host.parentElement ?? this.host);
    this.rig = new CameraRig(this.camera, this.renderer.domElement, this.definition.viewpoints?.bridge, {
      pause: () => this.setPaused(true), aim: () => { this.manualAim = true; }, optics: () => this.toggleBinoculars(),
    });
    this.inspectionHover = new InspectionHover(this.renderer.domElement, this.camera);
    this.rig.setHullLength(definition.hull.length);
    this.input = new InputController({
      pause: () => { if (this.airOperationsOpen && !this.paused) this.setAirOperationsOpen(false); else if (!this.inPort) this.setPaused(!this.paused); },
      camera: () => this.cycleCamera(), recenter: () => this.recenter(),
      hud: () => { if (!this.inPort) callbacks.hud(); }, fullscreen: () => this.fullscreen(),
      optics: () => this.toggleBinoculars(), weaponGroup: index => this.selectWeaponSlot(index),
      cursor: released => { if (released) this.rig.releasePointer(); else if (!this.airOperationsOpen && !document.querySelector('dialog[open]')) this.rig.capturePointer(); },
      chartSize: direction => this.resizeChart(direction),
      shellFollow: () => this.toggleShellFollow(),
      shellType: () => this.cycleAmmunition(),
      isSpectating: () => !this.inPort && this.simulation.isBattle && this.simulation.player.damage.sunk,
      cycleSpectator: direction => this.cycleSpectator(direction),
      airOperations: () => this.setAirOperationsOpen(!this.airOperationsOpen),
      depth: direction => this.setDepth((this.simulation.player.submarine?.targetDepthM ?? 0) + direction * DEPTH_STEP_M),
      depthPreset: depthM => this.setDepth(depthM),
      emergencyBlow: () => this.setDepth(0, true),
      periscope: () => this.togglePeriscope(),
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
    this.callbacks.progress('Starting graphics', 0.08);
    this.resize();
    await this.renderer.init();
    configureRenderOrder(this.renderer);
    this.assertActive();
    this.rig.update(this.simulation.ship, 0, 0, true);
    this.callbacks.progress(`Loading ${this.definition.name}`, 0.2);
    const gltf = await loadShipModel(assetUrl(this.definition.modelUrl));
    new ShipMaterialPalette().apply(gltf.scene);
    batchShipModel(gltf.scene);
    await prepareShipDetail(gltf.scene);
    this.loadedModel = gltf.scene;
    this.assertActive();
    if (gltf.scene.userData.definitionHash !== this.definition.contentHash) throw new Error('The ship model and definition have different versions. Rebuild the ship assets and reload.');
    this.playerView = new ShipView(gltf.scene.clone(true), this.definition, this.simulation.player, this.renderer.reversedDepthBuffer);
    this.targetView = new ShipView(gltf.scene.clone(true), this.definition, this.simulation.target, this.renderer.reversedDepthBuffer);
    this.fleetViews = [this.playerView, this.targetView];
    this.fleetDraws = new FleetShipDraws(this.fleetViews);
    this.scene.add(this.fleetDraws.root);
    this.fleetModels = [gltf.scene];
    this.shipLabels.setFleet(this.fleetViews, this.simulation.actors);
    this.ship.position.copy(this.playerView.root.position);
    this.targetView.root.visible = !this.inPort;
    if (this.definition.airWing) {
      this.callbacks.progress('Loading aircraft', 0.32);
      await this.aircraftView.load(this.definition.airWing.squadrons.map(s => s.modelId));
    }
    this.assertActive();
    this.scene.add(this.playerView.root, this.targetView.root, this.effects.root, this.funnelSmoke.root, this.aircraftView.root, this.torpedoPreview.root);
    this.scene.add(this.ambientLight);

    this.callbacks.progress('Building the Atlantic', 0.37);
    // Water Pro 3.5.1 combines seed * 100000 + cellIndex in float32.
    // Large seeds (e.g. 1941) collapse adjacent inputs, creating repeated arcs.
    // Keep the library's small, deterministic seed until its hash input is fixed.
    this.water = await WaterSystem.create(this.renderer, this.scene, this.camera, this.settings.quality, { seed: 1 });
    this.visualWaveSampler = new VisualWaveSampler(this.water.buoyancy.getSampler());
    this.water.buoyancy.setSampler(this.visualWaveSampler);
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
    // A broader directional spectrum breaks up parallel ripples into the
    // small crossing waves of the supplied naval-game water references.
    params.waves.fft.spectralSharpness = .8;
    params.postProcessing.underwaterParticles.enabled = false;
    params.spray.enabled = false;
    this.water.loadPreset(params);
    this.water.waves.jonswapGamma.value = 2.2;
    this.underwaterPassVisibility = new UnderwaterPassVisibility(this.water, this.renderer);
    this.torpedoPreview.setWater(this.water);
    this.surfaceWaterAbsorption.copy(this.water.color.absorptionColor);
    this.surfaceWaterDistortion = this.water.underwaterDistortion.intensity;
    this.updateSeaState();

    this.callbacks.progress('Lighting the sky', 0.59);
    this.sky = await SkySystem.create({ renderer: this.renderer, camera: this.camera, scene: this.scene,
      quality: this.settings.quality === 'ultra' ? 'high' : 'medium', cloudRenderingMode: 'dynamic', godRays: false });
    this.assertActive();
    // Sky Pro's background shaders hard-code far depth as 1. Match the active
    // backend's depth convention so cirrus cannot paint over opaque ships.
    // Volumetric clouds already project their hit distance through the camera.
    const skyDepth = float(this.renderer.reversedDepthBuffer ? 0 : 1);
    this.sky.pipeline.sky.material.depthNode = skyDepth;
    this.sky.pipeline.cirrus.material.depthNode = skyDepth;
    await this.sky.applyPreset(SKY_PRESETS.partlyCloudy);
    this.assertActive();
    // Shared cloud shape; updatePortLighting supplies each scene's daylight.
    // Keep exposure neutral so the hull retains its daylight contrast.
    this.sky.godRays.enabled = false;
    this.sky.clouds.shape.altitude.value = 1700;
    this.sky.clouds.shape.thickness.value = 2400;
    this.sky.clouds.shape.horizonCoverageAmount.value = 0.06;
    // Cloud volumes use their own ambient fill, independently of scene lights.
    // Soften the extra base darkening and lift the preset's near-black bounce.
    this.sky.clouds.lighting.baseShadowStrength.value = 0.2;
    this.sky.clouds.lighting.ambientIntensity.value = 1.1;
    this.sky.clouds.lighting.groundBounceAlbedo.value.setRGB(0.09, 0.105, 0.12);
    this.sky.clouds.wind.speed = 12;
    this.sky.timeOfDay.moonPhase.value = .5;
    this.updatePortLighting();
    const skyProvider = this.sky.createSkyProvider({ envMap: { width: 384, cloudMarchSteps: 16, skipFrames: 8 } });
    const daylightFog = skyProvider.createFogSampler(), moon = this.sky.timeOfDay;
    // Sky Pro's provider fog is sun-only. Preserve its moon ambient in Water
    // Pro's far-distance blend so the night backdrop is not fogged to black.
    skyProvider.createFogSampler = () => Fn(([direction]: [THREE.Node]) => daylightFog(direction).add(
      moon.moonColor.mul(moon.moonIntensity).mul(moon.moonAmbient).mul(moon.moonPhaseIllumination)
        .mul(max(0, moon.moonDirection.y)).mul(moon.skyDarkness)));
    this.water.setSky(skyProvider);
    const sunlight = this.water.lighting.sunLight;
    const shadowSize = this.settings.quality === 'medium' ? 1024 : this.settings.quality === 'ultra' ? 4096 : 2048;
    sunlight.shadow.mapSize.set(shadowSize, shadowSize);
    Object.assign(sunlight.shadow.camera, { left: -380, right: 380, top: 380, bottom: -380, near: 1, far: 1800 });
    sunlight.shadow.camera.updateProjectionMatrix();
    // Keep the receiver offset proportional to a shadow texel in world meters.
    // A fixed 10 cm offset leaves diagonal self-shadow bands on broad hulls at
    // Medium's 1024px resolution; finer maps need proportionally less offset.
    sunlight.shadow.normalBias = 0.75 * (sunlight.shadow.camera.right - sunlight.shadow.camera.left) / shadowSize;
    this.scene.add(sunlight.target);
    this.water.lighting.addSunSyncListener(() => {
      sunlight.target.position.copy(this.ship.position);
      if (this.inPort) sunlight.target.position.x -= 160;
      const lightDirection = this.sky!.timeOfDay.skyDarkness.value > .5 ? this.sky!.timeOfDay.moonDirection.value : this.sky!.sun.direction.value;
      if (this.sky!.timeOfDay.skyDarkness.value > .5) {
        sunlight.intensity = .35 * this.sky!.timeOfDay.moonIntensity.value * this.sky!.timeOfDay.moonPhaseIllumination.value;
        sunlight.color.copy(this.sky!.timeOfDay.moonColor.value);
      }
      sunlight.position.copy(lightDirection).multiplyScalar(this.inPort ? 800 : 500).add(sunlight.target.position);
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

    this.callbacks.progress('Preparing ocean effects and lighting', 0.82);
    this.scenePass = pass(this.scene, this.camera);
    const sceneColor = this.scenePass.getTextureNode('output');
    const waterColor = this.water.postProcessing.buildNode(this.scenePass, sceneColor);
    // Water Pro's scene.fogNode already fogs each material at its own distance.
    // Sky's depth-based post fog sees the distant sea behind transparent smoke,
    // erasing a horizontal band of nearby gas at the horizon's far-fade distance.
    const output = waterColor as THREE.Node<'vec4'>;
    // FXAA detects edges in display space, after tone mapping and sRGB conversion.
    const sceneDisplay = renderOutput(vec4(output.rgb.mul(this.sky.atmosphere.exposure), output.a), THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
    this.armorOverlay = new ArmorOverlay();
    const armorDisplay = renderOutput(this.armorOverlay.color, THREE.NoToneMapping, THREE.SRGBColorSpace);
    this.finalFrame = rtt(vec4(mix(sceneDisplay.rgb, armorDisplay.rgb, armorDisplay.a.mul(this.armorOverlay.enabled)), sceneDisplay.a));
    this.pipeline = new THREE.RenderPipeline(this.renderer, fxaa(this.finalFrame));
    this.pipeline.outputColorTransform = false;
    await this.warmupRendering();
    this.callbacks.progress('Ready to get underway', 1);
    this.callbacks.ready();
    this.input.setEnabled(!this.paused && !this.inPort);
    this.lastTime = performance.now();
    this.scheduleFrame();
  }

  private async warmupRendering(): Promise<void> {
    // Exercise the actual ship batches, ocean captures and post-processing targets.
    // Compiling the scene against the canvas misses those pipeline variants.
    // Twelve frames also cover the sky reflection's nine-frame update cycle and
    // both ping-pong targets, including the asynchronous underwater visibility bound.
    // Prepare scenery behind the initial camera too, before the first port drag.
    const culled: THREE.Object3D[] = [];
    this.scene.traverse(object => {
      if (object.frustumCulled) { culled.push(object); object.frustumCulled = false; }
    });
    try {
      for (let frame = 0; frame < 12; frame++) {
        this.callbacks.progress('Preparing the harbor view', .84 + frame / 12 * .14);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        this.assertActive();
        await this.frame(performance.now(), true);
      }
    } finally {
      culled.forEach(object => { object.frustumCulled = true; });
    }
    await this.frame(performance.now(), true);
    // A submitted frame is not necessarily finished on the GPU. A tiny readback
    // drains the startup work on both WebGPU and the WebGL compatibility backend.
    await this.renderer.readRenderTargetPixelsAsync(this.finalFrame!.renderTarget!, 0, 0, 1, 1);
    this.assertActive();
  }

  /** Replace only ship-owned resources; the harbor, ocean, renderer and camera stay alive. */
  async switchShip(definition: typeof selectedShip): Promise<void> {
    if (this.disposed || !this.inPort || !this.playerView || this.switchingShip) throw new Error('Ship switching requires an idle, loaded port.');
    if (definition.id === this.definition.id) return;
    this.switchingShip = true;
    try {
      const simulation = new CombatSimulation(definition);
      Object.assign(simulation.ship, this.simulation.ship);
      await this.replaceFleet(simulation, definition);
    } finally { this.switchingShip = false; }
  }

  /** Load and validate the complete fleet before replacing the current port scene. */
  async prepareBattle(setup: BattleSetup, progress?: BattleProgress): Promise<void> {
    if (this.disposed || !this.inPort || !this.playerView || this.switchingShip) throw new Error('Battle setup requires an idle, loaded port.');
    validateBattleSetup(setup, Object.keys(shipPresets));
    this.switchingShip = true;
    try {
      progress?.(`Charting ${oceanMap(setup.mapId ?? DEFAULT_MAP).name}`, 0.04);
      const definition = shipPreset(setup.playerShipId);
      const simulation = new CombatSimulation(definition, { ...resolveBattleFleet(setup, shipPreset),
        seed: crypto.getRandomValues(new Uint32Array(1))[0] });
      await this.replaceFleet(simulation, definition, progress);
      this.battleTimeOfDay = setup.timeOfDay ?? 'map';
      this.battleWeather = setup.weather ?? 'map';
      this.battleConditions = { timeHours: setup.timeHours, cloudCover: setup.cloudCover, windSpeed: setup.windSpeed };
      progress?.('Forming the battle lines', 0.9);
    } finally { this.switchingShip = false; }
  }

  /** Resolve once the next frame has been rendered, so a scene change is on screen. */
  nextFrame(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return new Promise(resolve => this.frameWaiters.push(resolve));
  }

  private async replaceFleet(simulation: CombatSimulation, definition: typeof selectedShip, progress?: BattleProgress): Promise<void> {
    this.inspectionHover?.clear();
    const definitions = [...new Map(simulation.actors.map(actor => [actor.definition.id, actor.definition])).values()];
    const models = new Map<string, THREE.Group>();
    const palette = new ShipMaterialPalette();
    const views: ShipView[] = [];
    const clones: THREE.Group[] = [];
    let draws: FleetShipDraws | undefined;
    try {
      // Parsing, painting, batching and LOD generation all allocate large temporary
      // buffers. Finish one model before fetching the next to bound peak memory.
      let loaded = 0;
      const hullShare = 0.6 / definitions.length;
      progress?.(`Loading ${definitions[0].name}`, 0.08);
      for (const def of definitions) {
        this.assertActive();
        const model = (await loadShipModel(assetUrl(def.modelUrl))).scene;
        models.set(def.id, model);
        this.assertActive();
        const hash = 'contentHash' in def ? def.contentHash : undefined;
        if (!hash || model.userData.definitionHash !== hash) throw new Error('The ship model and definition have different versions. Rebuild the ship assets and reload.');
        palette.apply(model);
        batchShipModel(model);
        await prepareShipDetail(model);
        loaded += 1;
        const next = definitions.find(d => !models.has(d.id));
        progress?.(next ? `Loading ${next.name}` : `${def.name} aboard`, 0.08 + hullShare * loaded);
      }
      if (simulation.actors.some(a => a.definition.airWing)) { progress?.('Spotting the air wing', 0.7); await this.aircraftView.load(simulation.actors.flatMap(a => a.definition.airWing?.squadrons.map(s => s.modelId) ?? [])); }
      this.assertActive();
      if (!this.inPort) throw new Error('Return to port before changing fleets.');
      progress?.('Mustering the fleets', 0.78);
      for (const actor of simulation.actors) {
        const clone = models.get(actor.definition.id)!.clone(true);
        clones.push(clone);
        const view = new ShipView(clone, actor.definition, actor, this.renderer.reversedDepthBuffer);
        view.root.visible = actor === simulation.player;
        views.push(view);
      }
      draws = new FleetShipDraws(views);
      const previous = [...this.fleetModels, ...this.fleetViews.map(view => view.root)];
      this.fleetDraws?.dispose();
      this.fleetViews.forEach(view => { view.impactMarks.dispose(); view.rig.dispose(); view.root.removeFromParent(); });
      this.scene.add(...views.map(view => view.root), this.aircraftView.root);
      this.definition = definition; this.simulation = simulation;
      this.playerDamageFeedback = new HullDamageFeedback(simulation.player.damage.integrity);
      this.audio?.reset(simulation);
      this.fleetModels = [...models.values()]; this.loadedModel = models.get(definition.id);
      this.fleetViews = views; this.playerView = views[0];
      this.shipWake?.reset();
      this.fleetDraws = draws;
      this.scene.add(this.fleetDraws.root);
      this.targetView = views.find(view => view.actor === simulation.target);
      this.shipLabels.setFleet(views, simulation.actors);
      this.articulationOriginal = undefined;
      this.controlPriority = 'balanced'; this.controlFocus = '';
      this.lastShellPress = undefined;
      this.ammunition = { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' };
      this.battery = definition.torpedoTubes?.length ? 'torpedo' : 'main'; this.manualAim = true; this.inspecting = false;
      this.airOperationsOpen = false; this.selectedFlightId = undefined; this.effects.reset();
      this.currentAim = simulation.aimAt(undefined, this.battery, this.weaponGroupId);
      this.aimModule = simulation.target.definition.modules.find(m => m.kind === 'engine')?.id ?? '';
      this.rig.setBridge(definition.viewpoints?.bridge);
      this.rig.setHullLength(definition.hull.length);
      this.renderer.domElement.setAttribute('aria-label', `${definition.name} ocean scene. Drag to orbit; scroll to zoom.`);
      disposeObjects(...previous);
    } catch (error) {
      draws?.dispose();
      views.forEach(view => { view.impactMarks.dispose(); view.rig.dispose(); });
      disposeObjects(...models.values(), ...clones, ...views.map(view => view.root));
      throw error;
    }
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

  private async frame(time: number, warmingUp = false): Promise<void> {
    if (this.disposed) return;
    const realDt = warmingUp ? 1 / 60 : Math.min(Math.max((time - this.lastTime) / 1000, 0.001), 0.1);
    this.lastTime = time;
    const dt = this.paused ? 0 : realDt;
    try {
      if (this.resizePending) this.resize();
      const state = this.simulation.ship;
      this.updateSpectator();
      const focusView = this.cameraShipView;
      const focus = focusView.motion;
      this.rig.setSubmarine(focusView.definition.submarine);
      // Apply mouse aim before sampling the sight; follow the new rendered pose
      // after stepping, with camera damping applied only once per frame.
      this.rig.update(focus, focus.y, 0);
      const aim = this.manualAim ? this.simulation.player.damage.sunk || this.airOperationsOpen || this.battlefieldCamera.transitioning || this.inspecting || this.shellFollow.view || this.followedAircraftId ? this.currentAim : this.readSightAim() : this.simulation.aimAt(this.aimModule, this.battery, this.weaponGroupId);
      this.currentAim = aim;
      if (!this.inPort && !warmingUp) this.simulation.advance(dt, this.input.sample(), { aim, fire: !this.simulation.player.damage.sunk && !this.airOperationsOpen && !this.battlefieldCamera.transitioning && (this.input.firing || this.rig.firing), battery: this.battery, weaponGroupId: this.weaponGroupId, ammunition: this.selectedAmmunition, controlPriority: this.controlPriority, controlFocus: this.controlFocus }, () => {
        this.fleetViews.forEach(view => view.capturePreviousPose());
      });
      const alpha = this.inPort ? 1 : this.simulation.interpolationAlpha;
      this.fleetViews.forEach(view => view.update(alpha));
      // A salvo must not synchronously project scars onto every struck hull.
      // Share the budget across the fleet and rotate which hull gets first use.
      const impactBudget = { remainingMs: 2 };
      for (let i = 0; i < this.fleetViews.length; i++) {
        const view = this.fleetViews[(i + this.simulation.tick) % this.fleetViews.length];
        view.impactMarks.update(this.simulation.events, view.actor.motion.id, impactBudget);
      }
      this.ship.position.copy(this.playerView!.root.position);
      this.ship.quaternion.copy(this.playerView!.root.quaternion);
      this.shellFollow.update(this.simulation.shells, this.simulation.events, state.id, dt);
      const followedPlane = this.simulation.aircraft.find(p => p.id === this.followedAircraftId && p.phase !== 'lost');
      const carrierView = followedPlane && this.fleetViews.find(v => v.actor.motion.id === followedPlane.ownerId);
      const planeView = followedPlane && carrierView
        ? aircraftFollowView(followedPlane, this.simulation.player, carrierView.motion, alpha) : undefined;
      if (this.followedAircraftId && !planeView) this.stopShellFollow();
      this.rig.setShellView(planeView ?? this.shellFollow.view);
      if (this.simulation.player.damage.sunk) this.rig.exitBinoculars();
      if (this.airOperationsOpen) this.battlefieldCamera.update();
      else {
        this.updateSpectator();
        const pose = this.cameraShipView.motion;
        this.rig.update(pose, pose.y, realDt);
      }
      this.battlefieldCamera.applyTransition(realDt);
      this.cameraFrameListeners.forEach(listener => listener());
      const showGunAim = !this.airOperationsOpen && !this.battlefieldCamera.transitioning && !this.inPort && !this.inspecting && !this.shellFollow.view && !this.followedAircraftId && !this.simulation.player.damage.sunk;
      this.gunAim.update(showGunAim ? this.playerView!.gunAimPoints(this.battery, aim, this.weaponGroupId) : [], this.camera, showGunAim);
      this.hitDirections.update(this.simulation, this.camera, !this.inPort);
      this.torpedoPreview.update(this.simulation.player, this.playerView!.motion, aim, showGunAim && this.battery === 'torpedo' && this.host?.dataset.shipLabels !== 'false', this.weaponGroupId);
      this.inspectionHover?.update(this.inPort && !this.paused && !this.switchingShip ? this.playerView?.inspection : undefined);
      this.fleetViews.forEach(view => {
        view.rig.update(dt, this.water!.waves.windSpeed.value, this.water!.waves.windDirection.value,
          view.root, view.motion, view.actor.damage.sunk, this.camera, !this.inPort);
        view.updateRenderMatrices();
      });
      this.aircraftView.update(this.simulation, this.camera, !this.inspecting && (!this.inPort || this.playerView?.inspection.mode === 'exterior'), this.inPort, new Map(this.fleetViews.map(view => [view.actor.motion.id, view.root])));
      this.effects.update(this.simulation, dt, this.camera, this.rig.binoculars && !this.shellFollow.view);
      this.funnelSmoke.root.visible = !this.inspecting && (!this.inPort || this.playerView!.inspection.mode === 'exterior');
      this.funnelSmoke.update(this.inPort ? [this.playerView!] : this.fleetViews, dt, this.camera,
        this.rig.binoculars && !this.shellFollow.view ? this.simulation.player.motion.id : undefined);
      if (!warmingUp) this.audio?.update(this.simulation, this.input.order, this.battery,
        this.camera.position.toArray(), new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).toArray(), this.weaponGroupId);
      this.playerView!.root.visible = this.airOperationsOpen || this.battlefieldCamera.transitioning || !this.rig.binoculars;
      this.harbor?.update(dt, this.camera);
      this.shipWake!.update(this.inPort ? [this.playerView!] : this.fleetViews, dt, this.simulation.events, this.camera);
      this.sky!.update(dt);
      this.updateEffectsLighting();
      // Black Flag's absorption loses >99% of green/blue light over 50 m,
      // hiding even our own submarine. Ease to a 20× longer visibility range
      // over the first 2 m of camera submersion; keep distant water hazy and
      // restore the exact surface preset when the camera comes back up.
      const submergedView = THREE.MathUtils.smoothstep(-this.camera.position.y, 0, 2);
      this.water!.color.absorptionColor.copy(this.surfaceWaterAbsorption)
        .multiplyScalar(THREE.MathUtils.lerp(1, .05, submergedView));
      // Keep surface-looking-in refraction; soften the full-screen underwater wobble.
      this.water!.underwaterDistortion.intensity = this.surfaceWaterDistortion
        * THREE.MathUtils.lerp(1, .15, submergedView);
      // Fixed-step mode with zero delta renders without stepping the wake's
      // leapfrog/foam integrators. Host-clock update(0) would still step them.
      this.water!.deterministic = this.paused;
      // Water captures ship depth/color too, so publish batch poses before its passes.
      this.fleetDraws?.update(this.camera, this.renderer.domElement.height);
      this.underwaterPassVisibility?.update(this.camera);
      this.scene.beginFrame();
      try {
        await this.water!.update(dt);
        this.underwaterPassVisibility?.capture();
        if (this.disposed) return;
        this.renderFrame();
        if (this.frameWaiters.length) { const waiters = this.frameWaiters; this.frameWaiters = []; waiters.forEach(resolve => resolve()); }
      } finally { this.scene.endFrame(); }
      const combatTime = this.simulation.tick * FIXED_DT;
      this.shipLabels.update(this.camera, combatTime);
      this.hitLabels.update(this.simulation, this.fleetViews, this.camera, !this.inPort && !this.inspecting);
      const damageSubject = this.simulation.actors.find(actor => actor.motion.id === this.spectatedShipId) ?? this.simulation.player;
      if (this.damageFeedbackShipId !== damageSubject.motion.id) {
        this.damageFeedbackShipId = damageSubject.motion.id;
        this.playerDamageFeedback = new HullDamageFeedback(damageSubject.damage.integrity);
      }
      const playerDamage = this.playerDamageFeedback.update(damageSubject.damage.integrity, combatTime);
      this.fps += (1 / realDt - this.fps) * 0.04;
      if (state.tick - this.lastTrailTick >= 120) {
        this.trail.push({ x: state.x, z: state.z });
        if (this.trail.length > 240) this.trail.shift();
        this.lastTrailTick = state.tick;
      }
      if (!warmingUp && time - this.hudTime > 100) {
        this.hudTime = time;
        const hud = this.shipTelemetry(aim);
        this.callbacks.telemetry({ ...hud, camera: this.rig.mode,
          binoculars: this.rig.binoculars, magnification: this.rig.magnification, pointerLocked: this.rig.pointerLocked,
          viewBearing: this.rig.bearing, chartSize: this.chartSize, airOperationsOpen: this.airOperationsOpen, selectedFlightId: this.selectedFlightId,
          airMap: this.airOperationsOpen ? { ...this.battlefieldCamera.view } : undefined,
          squadronMarkers: this.simulation.actors.flatMap(actor => (airWingTelemetry(actor, this.simulation.actors)?.groups ?? [])
            .filter(f => f.airborne > 0).map(f => {
              const point = projectShipLabel(new THREE.Vector3(...f.position).add(new THREE.Vector3(0, 24, 0)), this.camera, this.host.clientWidth / this.hudScale, this.host.clientHeight / this.hudScale);
              return { ...f, team: actor.team, ownerId: actor.motion.id, screen: point };
            })),
          shellFollow: this.shellFollow.phase, followedAircraftId: this.followedAircraftId, spectatedShipId: this.spectatedShipId,
          playerDamage,
          mapId: this.simulation.mapId, islands: this.simulation.islands, fps: Math.round(this.fps), backend: this.water!.backend, trail: this.spectatedShipId ? [] : [...this.trail], inspecting: this.inspecting, aimModule: this.manualAim ? 'point' : this.aimModule,
          aimMarker: this.projectAim(aim) });
      }
      if (!warmingUp) this.scheduleFrame();
    } catch (error) {
      if (warmingUp) throw error;
      if (!this.disposed) this.callbacks.error(error instanceof Error ? error.message : String(error));
    }
  }

  setHudScale(scale: number): void {
    this.hudScale = scale;
    this.resizeHudOverlays();
  }

  private resizeHudOverlays(): void {
    // Overlay projection and collision placement use the same logical space as CSS.
    const width = Math.max(this.host.clientWidth, 1) / this.hudScale;
    const height = Math.max(this.host.clientHeight, 1) / this.hudScale;
    this.shipLabels.resize(width, height);
    this.hitLabels.resize(width, height);
    this.gunAim.resize(width, height);
  }

  private resize(): void {
    const width = Math.max(this.host.clientWidth, 1), height = Math.max(this.host.clientHeight, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * this.settings.resolution);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.water?.resize(width, height);
    this.resizeHudOverlays();
    this.aircraftView.resize(height);
    this.sky?.resize(width, height);
    this.resizePending = false;
  }
  private renderFrame(): void {
    const inspection = this.inPort ? this.playerView?.inspection : undefined;
    if (!this.armorOverlay || inspection?.mode !== 'armor' || !inspection.root.visible) {
      if (this.armorOverlay) this.armorOverlay.enabled.value = 0;
      this.pipeline!.render();
      return;
    }
    this.armorOverlay.render(this.renderer, this.camera, inspection.root);
    // Keep the opaque armor out of the ocean/sky pass; composite it once afterward.
    inspection.root.visible = false;
    try { this.pipeline!.render(); }
    finally { inspection.root.visible = true; }
  }
  setPaused(paused: boolean): void {
    if (paused) this.inspectionHover?.clear();
    this.lastShellPress = undefined;
    this.paused = paused;
    this.audio?.setScene(this.inPort, paused);
    this.input.setEnabled(!paused && !this.inPort && !!this.water);
    this.rig.setEnabled(!paused && !this.airOperationsOpen);
    this.callbacks.pause(paused);
  }
  capturePointer(): void { if (!this.airOperationsOpen) this.rig.capturePointer(); }
  launchAircraft(squadronId: string): void {
    if (!this.inPort && !this.paused && this.simulation.launchAircraft(squadronId)) this.selectedFlightId = this.simulation.player.airWing!.flights.at(-1)!.id;
  }
  selectFlight(id: string): void {
    if (squadronFlights(this.simulation.player).some(f => f.id === id)) this.selectedFlightId = this.selectedFlightId === id ? undefined : id;
  }
  orderFlight(id: string, order: AirOrder): boolean { return !this.inPort && !this.paused && this.simulation.orderFlight(id, order); }
  commandSquadron(id: string, order: AirOrder): boolean { return !this.inPort && !this.paused && this.simulation.commandSquadron(id, order); }
  panAirMap(dx: number, dy: number, x?: number, y?: number): void { this.battlefieldCamera.pan(dx, dy, this.host.clientWidth, this.host.clientHeight, x, y); }
  projectAirMap(x: number, z: number, altitude = 0): [number, number] {
    const p = new THREE.Vector3(x, altitude, z).project(this.camera);
    // Map SVG and HTML tags live inside the scaled HUD, unlike pointer input.
    return [(p.x + 1) * this.host.clientWidth / (2 * this.hudScale), (1 - p.y) * this.host.clientHeight / (2 * this.hudScale)];
  }
  projectAirMapPath(points: Vec3[], closed = false): string {
    return projectAirMapPath(points, this.camera, this.host.clientWidth / this.hudScale, this.host.clientHeight / this.hudScale, closed);
  }
  projectSquadron(ownerId: string, flightId: string): { x: number; y: number } | null {
    const actor = this.simulation.actors.find(a => a.motion.id === ownerId);
    const planes = actor?.airWing?.planes.filter(p => p.flightId === flightId && airborne(p)) ?? [];
    if (!planes.length) return null;
    const anchor = new THREE.Vector3();
    for (const plane of planes) {
      anchor.add(new THREE.Vector3(...plane.previousPosition).lerp(new THREE.Vector3(...plane.position), this.simulation.interpolationAlpha));
    }
    anchor.divideScalar(planes.length).y += 24;
    return projectShipLabel(anchor, this.camera, this.host.clientWidth / this.hudScale, this.host.clientHeight / this.hudScale);
  }
  airMapWater(x: number, y: number): [number, number] | undefined {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x / this.host.clientWidth * 2 - 1, 1 - y / this.host.clientHeight * 2), this.camera);
    const p = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return p ? [p.x, p.z] : undefined;
  }
  zoomAirMap(delta: number, x = this.host.clientWidth / 2, y = this.host.clientHeight / 2): void {
    this.battlefieldCamera.zoom(delta, x, y, this.host.clientWidth, this.host.clientHeight);
  }
  fitAirMap(): void { this.battlefieldCamera.fit(this.simulation.actors.map(a => a.motion), this.host.clientWidth, this.host.clientHeight); }
  centerAirMap(): void { this.battlefieldCamera.view.x = this.simulation.ship.x; this.battlefieldCamera.view.z = this.simulation.ship.z; }
  orbitAirMap(dx: number, dy: number): void { this.battlefieldCamera.orbit(dx, dy); }
  setAirMapTilt(degrees: number): void { this.battlefieldCamera.setTilt(degrees * Math.PI / 180); }
  resetAirMapAngle(): void { this.battlefieldCamera.resetAngle(); }
  setAirOperationsOpen(open: boolean): void {
    if (this.inPort || (open && (this.simulation.player.damage.sunk || this.paused)) || !this.simulation.player.airWing) return;
    if (open === this.airOperationsOpen) return;
    this.battlefieldCamera.beginTransition(typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    this.airOperationsOpen = open;
    this.input.clear();
    if (open) {
      if (this.inspecting) this.inspectTarget();
      this.stopShellFollow(); this.rig.setEnabled(false);
      this.battlefieldCamera.enter(this.simulation.actors.map(a => a.motion), this.host.clientWidth, this.host.clientHeight);
      this.selectedFlightId ??= squadronFlights(this.simulation.player)[0]?.id;
      if (this.water) {
        // Water Pro sizes its horizon ring when geometry is built, before the map
        // increases camera.far. Grow it once and retain it for subsequent map visits.
        if (this.water.getGeometryConfig().infinityRingExtent < this.camera.far * .95) this.water.rebuildGeometry({});
        this.water.fog.fadeStart = 400000; this.water.fog.fadeEnd = 900000;
      }
    } else {
      this.battlefieldCamera.exit();
      const { fog } = battleEnvironment(oceanMap(this.simulation.mapId), this.battleTimeOfDay, this.battleWeather, this.battleConditions);
      if (this.water) { this.water.fog.fadeStart = fog.start; this.water.fog.fadeEnd = fog.end; }
      this.rig.update(this.playerView?.motion ?? this.simulation.ship, this.simulation.ship.y, 0, true);
      this.rig.setEnabled(true); this.rig.capturePointer();
    }
    this.battlefieldCamera.applyTransition(0);
  }
  followAircraft(id: string): void {
    if (this.simulation.player.damage.sunk || this.inPort || this.inspecting || !this.simulation.player.airWing?.planes.some(p => p.id === id && p.phase !== 'lost' && (airborne(p) || onFlightDeck(p)))) return;
    this.stopShellFollow();
    if (this.airOperationsOpen) this.setAirOperationsOpen(false);
    this.followedAircraftId = id;
  }
  /** Instruments follow the spectator without transferring control of the actor. */
  private shipTelemetry(aim: Vec3) {
    const subject = this.spectatedShipId
      ? this.simulation.actors.find(actor => actor.motion.id === this.spectatedShipId) ?? this.simulation.player
      : this.simulation.player;
    const spectating = subject !== this.simulation.player;
    const group = spectating ? weaponGroups(subject.definition)[0] : undefined;
    const orders = ENGINE_ORDERS;
    const throttle = subject.helm?.throttle ?? 0;
    const order = orders.reduce<number>((best, value, index) => Math.abs(value - throttle) < Math.abs(orders[best] - throttle) ? index : best, 1);
    return {
      ship: { ...subject.motion }, shipDefinition: subject.definition,
      order: spectating ? order : this.input.order,
      rudderOrder: spectating ? subject.helm?.rudder ?? 0 : this.input.rudderOrder,
      combat: this.simulation.telemetry(spectating ? group?.battery ?? 'main' : this.battery,
        aim, spectating ? group?.id : this.weaponGroupId, subject),
    };
  }
  private get cameraShipView(): ShipView {
    return this.fleetViews.find(view => view.actor.motion.id === this.spectatedShipId)
      ?? (this.inspecting ? this.targetView! : this.playerView!);
  }
  private get spectatorCandidates(): ShipView[] {
    if (this.inPort || !this.simulation.isBattle || !this.simulation.player.damage.sunk) return [];
    return this.fleetViews.filter(({ actor }) => actor !== this.simulation.player && this.simulation.actors.find(a => a === actor)?.team === this.simulation.player.team
      && !actor.damage.sunk && !actor.damage.stability.combatLost);
  }
  private updateSpectator(): void {
    const candidates = this.spectatorCandidates;
    if (candidates.some(view => view.actor.motion.id === this.spectatedShipId)) return;
    const next = candidates[0];
    if (next) this.spectateTeammate(next.actor.motion.id);
    else if (this.spectatedShipId) {
      this.spectatedShipId = undefined;
      this.rig.setBridge(this.definition.viewpoints?.bridge);
      this.rig.setHullLength(this.definition.hull.length);
      this.rig.setSubmarine(this.definition.submarine);
    }
  }
  spectateTeammate(id: string): void {
    const view = this.spectatorCandidates.find(view => view.actor.motion.id === id);
    if (!view) return;
    if (this.airOperationsOpen) this.setAirOperationsOpen(false);
    this.battlefieldCamera.cancelTransition();
    if (this.inspecting) this.inspectTarget();
    this.stopShellFollow();
    this.spectatedShipId = id;
    this.input.clear();
    this.rig.setInspecting(false);
    this.rig.mode = 'Chase';
    this.rig.setBridge(view.definition.viewpoints?.bridge);
    this.rig.setHullLength(view.definition.hull.length);
    this.rig.setSubmarine(view.definition.submarine);
    this.rig.update(view.motion, view.motion.y, 0, true);
    this.rig.releasePointer();
  }
  cycleSpectator(direction: number): void {
    const candidates = this.spectatorCandidates;
    if (!candidates.length) return;
    const index = candidates.findIndex(view => view.actor.motion.id === this.spectatedShipId);
    this.spectateTeammate(candidates[(Math.max(0, index) + (direction < 0 ? -1 : 1) + candidates.length) % candidates.length].actor.motion.id);
  }
  returnToShip(): void { this.stopShellFollow(); }
  private lastShellPress?: { time: number; group: string; type: Ammunition };
  cycleAmmunition(now = performance.now()): void {
    if (this.inPort || this.paused || this.airOperationsOpen || this.simulation.player.damage.sunk ||
      (this.battery !== 'main' && this.battery !== 'secondary')) { this.lastShellPress = undefined; return; }
    const last = this.lastShellPress;
    const immediate = !!last && last.group === (this.weaponGroupId ?? this.battery) && now - last.time >= 0 && now - last.time <= 300;
    const type = immediate ? last!.type : this.selectedAmmunition === 'ap' ? 'he' : 'ap';
    this.selectAmmunition(type, immediate);
    this.lastShellPress = !immediate && this.selectedAmmunition === type ? { time: now, group: this.weaponGroupId ?? this.battery, type } : undefined;
  }
  selectAmmunition(type: Ammunition, immediate = false): void {
    this.lastShellPress = undefined;
    if (this.inPort || this.paused || this.airOperationsOpen || this.simulation.player.damage.sunk ||
      (this.battery !== 'main' && this.battery !== 'secondary')) return;
    const available = this.definition.mounts.some((mount, i) => selectedWeapon(mount.battery, mount.weapon, this.battery, this.weaponGroupId) &&
      (type === 'ap' || mount.weapon.he) && availableAmmunition(this.simulation.player.mounts[i], type) >= (mount.weapon.barrelCount ?? 2));
    if (!available) return;
    this.ammunition[this.weaponGroupId ?? this.battery] = type;
    this.simulation.orderAmmunition(this.battery, type, immediate, this.weaponGroupId);
  }
  recallAircraft(flightId?: string): void { if (!this.inPort && !this.paused) this.simulation.recallAircraft(flightId); }
  setDepth(depthM: number, emergency = false): void {
    if (this.inPort || this.paused || this.simulation.player.damage.sunk) return;
    orderDepth(this.simulation.player, this.definition, depthM, emergency);
  }
  resizeChart(direction: number): void { if (this.airOperationsOpen) { this.zoomAirMap(-direction * 220); return; } this.chartSize = THREE.MathUtils.clamp(this.chartSize + direction, 0, 4); }
  togglePeriscope(): void {
    if (!this.definition.submarine || this.simulation.player.damage.sunk) return;
    this.toggleBinoculars();
  }
  toggleBinoculars(): void {
    if (this.simulation.player.damage.sunk || this.paused || this.inPort || this.inspecting || this.airOperationsOpen) return;
    if (this.shellFollow.view || this.followedAircraftId) { this.stopShellFollow(); return; }
    const ship = this.simulation.ship;
    let aim = this.manualAim ? this.readSightAim() : this.currentAim;
    if (!this.rig.binoculars && this.definition.submarine && hullDepth(ship) > .5) {
      const bearing = this.rig.bearing;
      const ahead = (aim[0] - ship.x) * Math.sin(bearing) - (aim[2] - ship.z) * Math.cos(bearing);
      // During a shallow dive the chase sight can meet the sea over our own
      // stern. Moving to the scope would turn around to keep that point in view.
      // Continue along the viewing bearing, including deliberate stern aiming.
      if (ahead < this.definition.hull.length) {
        const range = (this.definition.torpedoTubes?.[0]?.weapon.rangeM ?? 5000) * .98;
        aim = [ship.x + Math.sin(bearing) * range, .5, ship.z - Math.cos(bearing) * range];
      }
    }
    this.rig.toggleBinoculars(aim, ship);
  }
  private readSightAim(): Vec3 {
    const aim = sightAim(this.camera.position.toArray(), this.camera.getWorldDirection(new THREE.Vector3()).toArray(),
      this.simulation.actors.filter(actor => actor !== this.simulation.player && actor.motion.y > -40).map(actor => ({ pose: actor.motion, armor: actor.definition.armor, definition: actor.definition, trains: actor.mounts.map(m => m.train) })));
    const tube = this.definition.torpedoTubes?.find(t => selectedWeapon('torpedo', t.weapon, this.battery, this.weaponGroupId));
    return this.battery === 'torpedo' && tube && this.camera.position.y < 0 ? torpedoCourseAim(aim, this.simulation.ship, tube.weapon.rangeM) : aim;
  }
  setInPort(inPort: boolean): void {
    this.inspectionHover?.clear();
    if (this.articulationOriginal) this.restoreArticulation();
    if (!inPort && this.switchingShip) return;
    this.stopShellFollow();
    const leavingPort = this.inPort && !inPort;
    this.inPort = inPort;
    this.spectatedShipId = undefined;
    this.rig.setBridge(this.definition.viewpoints?.bridge);
    // A suitable near plane preserves depth precision on the town's distant trim.
    this.camera.near = inPort ? 3 : .5;
    this.camera.updateProjectionMatrix();
    this.rig.setHullLength(this.definition.hull.length);
    this.battlefieldCamera.cancelTransition();
    this.battlefieldCamera.exit();
    this.rig.setInPort(inPort);
    if (!inPort) this.refreshLandscape();
    if (this.landscape) this.landscape.visible = !inPort;
    if (this.harbor) this.harbor.visible = inPort;
    this.fleetViews.forEach(view => { view.root.visible = view === this.playerView || !inPort; view.inspect(false); });
    this.inspecting = false; this.targetView?.inspect(false); this.playerView?.inspect(false);
    this.rig.setInspecting(false);
    this.manualAim = true;
    this.airOperationsOpen = false; this.selectedFlightId = undefined;
    this.updateSeaState();
    this.updatePortLighting();
    this.input.setOrder(1); this.input.setRudder(0);
    if (inPort) {
      this.simulation.reset();
      this.lastShellPress = undefined;
      this.ammunition = { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' };
      this.audio?.reset(this.simulation);
      this.targetView = this.fleetViews.find(view => view.actor === this.simulation.target);
      this.effects.reset();
      this.simulation.ship.x = 240; this.simulation.ship.z = 0; this.simulation.ship.heading = 0;
      this.shipWake?.reset();
      this.trail = [{ x: this.simulation.ship.x, z: 0 }]; this.lastTrailTick = 0;
    }
    if (leavingPort) {
      this.simulation.ship.x = 0;
      this.trail = [{ x: 0, z: 0 }];
    }
    this.fleetViews.forEach(view => view.snap());
    this.setPaused(false);
    if (leavingPort) {
      this.audio?.departure();
      this.currentAim = this.simulation.aimAt(this.aimModule, this.battery, this.weaponGroupId);
      this.rig.aimAt(this.currentAim, this.simulation.ship);
      this.rig.capturePointer();
    }
    this.renderer.domElement.setAttribute('aria-label', `${this.definition.name} ocean scene. ${inPort ? 'Drag to orbit; scroll to zoom.' : 'Click to capture mouse. Mouse to aim; left mouse to fire; Shift for binoculars; Control for cursor; Escape to pause.'}`);
  }
  fire(): void { if (!this.simulation.player.damage.sunk && !this.paused && !this.inPort && !this.airOperationsOpen && !this.battlefieldCamera.transitioning && this.playerView) this.simulation.requestFire(); }
  toggleShellFollow(): void {
    if (this.simulation.player.damage.sunk || this.paused || this.inPort || this.inspecting || this.airOperationsOpen) return;
    if (this.shellFollow.enabled) { this.stopShellFollow(); return; }
    this.stopShellFollow();
    this.shellFollow.setEnabled(true);
  }
  private stopShellFollow(): void {
    this.followedAircraftId = undefined;
    this.shellFollow.setEnabled(false);
    this.rig.setShellView();
    const focus = this.cameraShipView?.motion;
    if (focus) this.rig.update(focus, focus.y, 0, true);
  }
  setPortInspection(mode: InspectionMode, selectedId?: string): void {
    this.inspectionHover?.clear();
    if (this.inPort) this.playerView?.setInspection(mode, selectedId);
  }
  subscribeInspectionHover(listener: (hover: InspectionHoverInfo | null) => void): () => void {
    return this.inspectionHover.subscribe(listener);
  }
  selectAim(moduleId: string): void { this.stopShellFollow(); this.manualAim = moduleId === 'point'; this.aimModule = moduleId; }
  inspectTarget(): void {
    if (this.simulation.player.damage.sunk && !this.inspecting) return;
    this.stopShellFollow();
    this.inspecting = !this.inspecting;
    this.targetView?.inspect(this.inspecting);
    this.rig.setHullLength((this.inspecting ? this.simulation.target.definition : this.definition).hull.length);
    this.rig.setInspecting(this.inspecting);
    if (!this.inspecting && !this.simulation.player.damage.sunk) this.rig.aimAt(this.currentAim, this.simulation.ship);
  }
  selectTarget(id: string): void {
    if (!this.simulation.selectTarget(id)) return;
    this.stopShellFollow();
    this.targetView?.inspect(false);
    this.targetView = this.fleetViews.find(view => view.actor === this.simulation.target);
    this.targetView?.inspect(this.inspecting);
    if (this.inspecting) this.rig.setHullLength(this.simulation.target.definition.hull.length);
    this.aimModule = ''; this.manualAim = false;
    this.currentAim = this.simulation.aimAt('', this.battery, this.weaponGroupId);
    if (!this.inspecting && !this.simulation.player.damage.sunk) this.rig.aimAt(this.currentAim, this.simulation.ship);
  }
  private restoreArticulation(): void {
    if (this.articulationOriginal) {
      this.simulation.player.mounts.forEach((m, i) => Object.assign(m, this.articulationOriginal![i]));
      this.simulation.player.torpedoLaunchers?.forEach((l, i) => Object.assign(l, this.articulationLaunchers?.[i]));
      this.articulationLaunchers = undefined;
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
      this.articulationLaunchers ??= structuredClone(this.simulation.player.torpedoLaunchers);
      this.simulation.player.torpedoLaunchers?.forEach(l => { l.train = THREE.MathUtils.clamp(pose.trainFraction, -1, 1) * 140 * Math.PI / 180; });
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
    return { mapId: this.simulation.mapId ?? DEFAULT_MAP,
      waves: this.water ? { amplitude: this.water.waves.amplitude.value, windSpeed: this.water.waves.windSpeed.value,
        peakWavelength: this.water.waves.peakWavelength.value } : undefined,
      ...this.battleConditions, timeOfDay: this.battleTimeOfDay ?? 'map', weather: this.battleWeather ?? 'map',
      environment: this.sky ? { sunElevation: this.sky.sun.elevationDeg, sunAzimuth: this.sky.sun.azimuthDeg,
        sunIntensity: this.sky.sun.peakIntensity, ambient: this.ambientLight.intensity,
        cloudCoverage: this.sky.clouds.shape.coverage.value, cloudWind: this.sky.clouds.wind.speed,
        cloudAmbient: this.sky.clouds.lighting.ambientIntensity.value, fogEnd: this.water?.fog.fadeEnd } : undefined,
      islands: this.simulation.islands, shipId: this.definition.id, contentHash: this.definition.contentHash, backend: this.water?.backend,
      camera: { mode: this.rig.mode, binoculars: this.rig.binoculars, magnification: this.rig.magnification, fov: this.camera.fov,
        shellFollow: this.shellFollow.phase, followedAircraftId: this.followedAircraftId, spectatedShipId: this.spectatedShipId, followedShellId: this.shellFollow.shellId,
        pointerLocked: this.rig.pointerLocked, position: this.camera.position.toArray(), aim: this.currentAim, manualAim: this.manualAim,
        projectionMatrix: this.camera.projectionMatrix.toArray(), matrixWorldInverse: this.camera.matrixWorldInverse.toArray() },
      tick: this.simulation.tick, battleSeed: this.simulation.seed, paused: this.paused, fps: this.fps, inspecting: this.inspecting, inPort: this.inPort,
      effects: this.effects.diagnostics(),
      funnelSmoke: this.funnelSmoke.diagnostics(),
      shipRigs: this.fleetViews.map(view => ({ shipId: view.actor.motion.id, ...view.rig.diagnostics() })),
      audio: this.audio?.diagnostics(),
      portInspection: this.playerView?.inspection.mode, selectedVolume: this.playerView?.inspection.selectedId, hoveredVolume: this.playerView?.inspection.hoveredId,
      maxMuzzleErrorM: Math.max(0, ...this.fleetViews.flatMap(view => view.muzzleErrors())),
      maxTorpedoMuzzleErrorM: Math.max(0, ...this.fleetViews.flatMap(view => view.torpedoMuzzleErrors())),
      torpedoLaunchers: this.simulation.player.torpedoLaunchers,
      depthCharges: this.simulation.depthCharges.map(c => ({ id: c.id, ownerId: c.ownerId, position: [...c.position], submerged: c.submerged, detonationDepthM: c.weapon.detonationDepthM })),
      combat: this.simulation.telemetry(this.battery, this.currentAim, this.weaponGroupId),
      fleet: this.simulation.actors.map(actor => ({ id: actor.motion.id, definitionId: actor.definition.id, team: actor.team, controller: actor.controller, aiLevel: actor.bot?.aiLevel, targetId: actor.targetId, motion: { ...actor.motion }, submarine: actor.submarine ? { ...actor.submarine } : undefined, ammo: actor.mounts.reduce((n, m) => n + m.ammo, 0), integrity: actor.damage.integrity })),
      renderedShips: this.fleetViews.map(view => ({ id: view.actor.motion.id, visible: view.root.visible,
        impactMarks: view.impactMarks.count, impactDrawCalls: view.impactMarks.drawCalls })),
      renderedAircraft: this.aircraftView.diagnostics(),
      aircraft: this.simulation.aircraft.map(p => ({ ...p, position: [...p.position] })),
      airReleases: this.simulation.airReleases.map(p => ({ ...p })),
      torpedoes: this.simulation.torpedoes.map(t => ({ id: t.id, ownerId: t.ownerId, tubeId: t.tubeId, position: [...t.position], distance: t.distance, armed: t.distance >= t.weapon.armingDistanceM })),
      events: this.simulation.events.slice(-20) };
  }
  /** Bounded fixed-tick rehearsal for development review on slow render hosts. */
  previewAdvance(seconds: number): void {
    if (!import.meta.env.DEV || this.inPort || this.paused || !Number.isFinite(seconds) || seconds <= 0 || seconds > 120) return;
    for (let i = 0; i < Math.floor(seconds / FIXED_DT); i++) {
      this.simulation.step(this.input.sample(), { aim: this.currentAim, fire: false, battery: this.battery, weaponGroupId: this.weaponGroupId, ammunition: this.selectedAmmunition });
    }
    this.fleetViews.forEach(view => view.snap());
  }
  private projectAim(aim: Vec3): { x: number; y: number; visible: boolean } {
    const point = new THREE.Vector3(...aim).project(this.camera);
    return { x: (point.x + 1) * 50, y: (1 - point.y) * 50, visible: point.z > -1 && point.z < 1 && Math.abs(point.x) < .94 && Math.abs(point.y) < .85 };
  }
  private refreshLandscape(): void {
    const mapId = this.simulation.mapId ?? DEFAULT_MAP;
    const islands = this.simulation.islands ?? [];
    const key = JSON.stringify([mapId, islands]);
    if (this.landscape?.userData.mapKey === key) return;
    if (this.landscape) { disposeBattleLandscape(this.landscape); this.landscape = undefined; }
    if (islands.length) {
      this.landscape = createBattleLandscape(oceanMap(mapId), islands, this.settings.quality);
      this.landscape.userData.mapKey = key; this.scene.add(this.landscape);
    }
    this.rig.setBattleTerrain((x, z) => landHeight(islands, x, z));
  }
  private updateSeaState(): void {
    if (!this.water) return;
    const map = oceanMap(this.simulation.mapId ?? DEFAULT_MAP);
    const { waves } = battleEnvironment(map, this.battleTimeOfDay, this.battleWeather, this.battleConditions);
    // Retain the smaller wave scale across all oceans; port stays sheltered.
    this.water.waves.amplitude.value = this.inPort ? .12 : waves.amplitude;
    this.water.waves.windSpeed.value = this.inPort ? 4 : waves.windSpeed;
    this.water.waves.peakWavelength.value = this.inPort ? 14 : waves.peakWavelength;
    this.water.waves.choppiness.value = .65;
    this.water.waves.windDirection.value = (this.inPort ? 35 : map.water.windDirection) * Math.PI / 180;
    this.water.waves.dirty = true;
    const colors = this.inPort ? oceanMap(DEFAULT_MAP).water : map.water;
    this.water.color.update({ waterColor: colors.waterColor, transmissionColor: colors.transmissionColor, absorptionColor: colors.absorptionColor });
    this.surfaceWaterAbsorption.copy(this.water.color.absorptionColor);
    this.water.foam.waves.opacity = this.inPort ? .45 : map.water.foam;
    this.effects.setWind(this.water.waves.windSpeed.value, this.water.waves.windDirection.value);
    this.funnelSmoke.setWind(this.water.waves.windSpeed.value, this.water.waves.windDirection.value);
  }
  private updateEffectsLighting(): void {
    if (!this.sky) return;
    // Water skips fixed simulation steps while paused. Read the live sky after
    // its zero-delta update, so a conditions change still reaches frozen smoke.
    const { sun, timeOfDay: moon } = this.sky, night = moon.skyDarkness.value > .5;
    this.effects.setSun(night ? moon.moonDirection.value : sun.direction.value,
      this.inPort ? 1 : Math.min(1, night ? .18 + this.ambientLight.intensity * .5
        : this.ambientLight.intensity * .45 + sun.peakIntensity * .09));
    this.effects.setIllumination(night ? moon.moonColor.value : sun.color.value,
      night ? .35 * moon.moonIntensity.value * moon.moonPhaseIllumination.value : sun.intensity.value,
      this.ambientLight.intensity);
  }
  private updatePortLighting(): void {
    if(!this.sky)return;
    const map = oceanMap(this.simulation.mapId ?? DEFAULT_MAP);
    const environment = battleEnvironment(map, this.battleTimeOfDay, this.battleWeather, this.battleConditions), sky = environment.sky;
    const elevation = this.inPort ? 36 : sky.elevation, azimuth = this.inPort ? 58 : sky.azimuth;
    // Freeze the celestial clock at an arc endpoint matching the authored angles.
    // This keeps SunDriver's moon opposite the sun without advancing battle time.
    this.sky.timeOfDay.applyParams({ autoAdvanceSecondsPerDay: 0, time: elevation < 0 ? 0 : .5,
      latitude: 90 - Math.abs(elevation), azimuth: elevation < 0 ? azimuth : azimuth - 180 });
    this.sky.sun.setFromAngles(elevation, azimuth);
    this.sky.sun.peakIntensity=this.inPort ? 5.8 : sky.intensity;
    this.sky.clouds.shape.altitude.value = this.inPort ? 1700 : sky.altitude;
    this.sky.clouds.shape.thickness.value = this.inPort ? 2400 : sky.thickness;
    this.sky.clouds.shape.coverage.value=this.inPort ? .38 : sky.coverage;
    this.sky.clouds.shape.horizonCoverageAmount.value = this.inPort ? .06 : environment.horizonCoverage;
    this.sky.clouds.wind.speed = this.inPort ? 12 : environment.cloudWind;
    this.sky.clouds.lighting.ambientIntensity.value = this.inPort ? 1.1 : environment.cloudAmbient;
    this.sky.clouds.lighting.baseShadowStrength.value = this.inPort ? .2 : environment.cloudShadow;
    // Lift shaded hulls and harbor buildings without raising sea/sky exposure.
    this.ambientLight.intensity = this.inPort ? 1.75 : sky.ambient;
    // Diffuse fill softens the dark blue dome toward the hills. Keep the port's
    // forward sun haze restrained so it cannot wash out the sky and reflections.
    this.sky.atmosphere.turbidity.value = this.inPort ? 3.2 : sky.turbidity;
    this.sky.atmosphere.rayleigh.value = this.inPort ? .42 : sky.rayleigh;
    this.sky.atmosphere.mieScatteringStrength.value = this.inPort ? .25 : sky.mie;
    this.sky.atmosphere.mieDirectionalG.value = this.inPort ? .6 : sky.mieG;
    this.sky.atmosphere.skyMultipleScattering.value = this.inPort ? 1.4 : sky.multiple;
    // Water Pro owns scene.fogNode, including the water/sky horizon blend.
    // Its live uniforms must change with the scene; THREE.Fog is overridden.
    if (this.water) {
      this.water.fog.color = this.inPort ? '#819aa5' : environment.fog.color;
      this.water.fog.fadeStart = this.inPort ? 650 : environment.fog.start;
      this.water.fog.fadeEnd = this.inPort ? 5600 : environment.fog.end;
      this.water.fog.fadePower = this.inPort ? .85 : 1.4;
      this.water.fog.skyBlendDistance = this.inPort ? 2600 : environment.fog.skyBlend;
    }
  }
  cycleCamera(): void { if (this.airOperationsOpen) { this.setAirOperationsOpen(false); return; } const aircraft = !!this.followedAircraftId; this.stopShellFollow(); if (!aircraft) this.rig.cycle(); }
  recenter(): void { if (this.airOperationsOpen) { this.centerAirMap(); return; } this.stopShellFollow(); this.rig.recenter(); }
  fullscreen(): void {
    const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    action?.catch(() => { /* Browsers may decline fullscreen; sailing remains available. */ });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.underwaterPassVisibility?.dispose();
    this.audio?.dispose();
    cancelAnimationFrame(this.raf);
    const waiters = this.frameWaiters; this.frameWaiters = []; waiters.forEach(resolve => resolve());
    this.abort.abort(); this.observer.disconnect(); this.input.dispose(); this.rig.dispose();
    this.inspectionHover.dispose();
    this.shipLabels.dispose();
    this.hitLabels.dispose();
    this.torpedoPreview.dispose();
    this.gunAim.dispose();
    this.hitDirections.dispose();
    await this.initialization;
    await this.frameTask;
    this.fleetDraws?.dispose();
    this.fleetViews.forEach(view => { view.impactMarks.dispose(); view.rig.dispose(); });
    this.pipeline?.dispose();
    this.finalFrame?.renderTarget?.dispose();
    this.scenePass?.dispose();
    this.armorOverlay?.dispose();
    this.shipWake?.dispose();
    await this.aircraftView.dispose();
    if (this.landscape) disposeBattleLandscape(this.landscape);
    this.effects.dispose();
    this.funnelSmoke.dispose();
    await this.visualWaveSampler?.drain();
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
    for (const model of new Set([...this.fleetModels, this.loadedModel ?? this.ship])) model.traverse(object => {
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
