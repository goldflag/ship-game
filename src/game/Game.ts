import { controlEligibility } from './controlEligibility';
import type { DeckPolicy } from '../multiplayer/generated/DeckPolicy';
import { physicalLoss } from './session/battleRules';
import type { ArticulationResolver } from './articulationPreview';
import { PveDraft } from './session/PveDraft';
import type { Formation } from '../multiplayer/generated/Formation';
import type { Placement } from '../multiplayer/generated/Placement';
import { weaponGroups, selectedWeapon } from '../ships/weaponGroups';
import { hullDepth } from './session/motion';
import { assetUrl } from '../assetUrl';
import { BattlefieldCamera } from './BattlefieldCamera';
import { airWingTelemetry } from './session/airTelemetry';
import { projectShipLabel } from './ShipLabels';
import { AirMapController } from './controllers/AirMapController';
import { reportName } from '../ui/reconReports';
import { aircraftFollowView } from './AircraftFollow';
import { aircraftAttitude } from './aircraftPose';
import { AircraftView } from './AircraftView';
import { oceanMap, DEFAULT_MAP, customTerrainOffset, loadMapTerrain, mapTerrainId, placedMapTerrain, type OceanMapId } from '../maps/catalog';
import { OPEN_SEA, terrainHeight, type PlacedTerrain } from '../maps/heightfield';
import { createBattleLandscape, type BattleLandscapeView } from './BattleLandscape';
import { VisualEnvironment, type DeveloperWeather, type EnvironmentOverrides } from './VisualEnvironment';
import { WaterViewFocus } from './WaterViewFocus';
import { BerthMotion } from './BerthMotion';
import { localToWorld } from './geometry';
import { createSeaState, seaHeight, seaWaves, type SeaState } from './session/sea';
import { hullFootprints } from './hullSea';
import { updateWaterShadows } from './WaterShadows';
import { FocusShadowNode } from './FocusShadowNode';
import { ShadowCasterPass } from './ShadowCasterPass';
import * as THREE from 'three/webgpu';
import { pass, vec2 } from 'three/tsl';
import { frameIntervalMs, sanitizeGraphicsSettings, type GraphicsSettings, type LaunchedGraphics, type TerrainQuality } from './graphicsSettings';
import { Ocean } from './ocean/Ocean';
import type { OceanApi, OceanRealism } from './ocean/contracts';
import { HullWetBand } from './HullWetBand';
import { primeHullProfile } from './HullContactFoam';
import { FrameScene } from './FrameScene';
import { FleetShipDraws } from './FleetShipDraws';
import { installFleetBatchInstancing } from './FleetBatchInstancing';
import { installInstanceBufferNames } from './InstanceBufferNames';
import { prepareInstanceUploads } from './InstanceUploads';
import { batchShipModel } from './ShipBatching';
import { prepareShipDetail } from './ShipDetail';
import { ShipMaterialPalette } from './ShipMaterialPalette';
import { ShipOcclusion } from './ShipOcclusion';
import { loadShipModel } from './loadShipModel';
import { Sky } from './sky/Sky';
import type { SkyApi } from './sky/contracts';
import { RemoteBattleSession } from './session/RemoteBattleSession';
import { LocalBattleSession } from './session/LocalBattleSession';
import type { BattleSession, DeckServiceAction } from './session/BattleSession';
import { ShipView } from './ShipView';
import { ObservedShipViews } from './ObservedShipViews';
import { FleetVisibility } from './FleetVisibility';
import { ArmorOverlay } from './ArmorOverlay';
import { DISPLAY_TONE_MAPPING, DisplayTransform } from './DisplayTransform';
import { InspectionHover, type InspectionHoverInfo } from './InspectionHover';
import { ShipLabels, type ObservedLabelReport } from './ShipLabels';
import { HitLabels } from './HitLabels';
import { TorpedoPreview } from './TorpedoPreview';
import { HullDamageFeedback } from './HullDamageFeedback';
import { ENGINE_ORDERS, FIXED_DT, shipVelocity } from './session/motion';
import { GunAimIndicators } from './GunAimIndicators';
import { TorpedoAimIndicators } from './TorpedoAimIndicators';
import { TorpedoMarkers } from './TorpedoMarkers';
import { torpedoAimState, type LeadContact } from './torpedoLead';
import { HitDirectionIndicators } from './HitDirectionIndicators';
import { disposeObjects, disposeObjectsExcept } from './disposeObjects';
import { CombatEffects } from './CombatEffects';
import { EffectLighting } from './EffectLighting';
import { configureRenderOrder } from './renderOrder';
import { DEFAULT_SAMPLED_TEXTURES, requireWebGPU, requireWebGPUBackend, sampledTextureLimit, type RaisedLimits } from './webgpu';
import type { GameAudio } from './GameAudio';
import type { Ammunition, Battery, ShipDefinition, Vec3 } from '../ships/blueprint';
import type { InspectionMode } from '../ships/inspection';
import { selectedShip, shipPreset, loadShipPresets } from '../ships/presets';
import { availableShipIds, freezeLocalFleet, isHistoricalShip, localShip, resolveShip, type LocalShipRevision, type IdentifiedShip } from '../ships/localShips';
import { createConstructionModel } from './constructionModel';
import { applyPremadeWear } from './constructionWear';
import { wearAmount } from '../ships/constructionPaints';
import type { TrialAction } from './session/localConstruction';
import { InputController } from './InputController';
import { CameraRig } from './CameraRig';
import { ShellFollow, type ShellView } from './ShellFollow';
import { sightAim, torpedoBearingAim, torpedoCourseAim } from './aiming';
import type { Rangefinder } from './Rangefinder';
import type { RangeTarget } from './rangefinderSight';
import { RangefindingController } from './controllers/RangefindingController';
import { SpectatorController } from './controllers/SpectatorController';
import { GraphicsController } from './controllers/GraphicsController';
import { HelmWheelController } from './controllers/HelmWheelController';
import { ArticulationPreviewController, type ArticulationPreview } from './controllers/ArticulationPreviewController';
import { createHarborBackdrop, type HarborBackdrop } from './HarborBackdrop';
import { ShipWake } from './ShipWake';
import { gpuWakeFoamPainter } from './WakeFoamGpu';
import type { WakeShip } from './FleetWakeFoam';
import { ShipFunnelSmoke } from './ShipFunnelSmoke';
import type { GameCallbacks, HelmWheelState, PerformanceReadout } from './types';
import type { AirOrder } from '../multiplayer/generated/AirOrder';
import type { ControlPriority } from '../multiplayer/generated/ControlPriority';
import type { FleetActor } from '../game/session/elements';
import { validateBattleSetup, type BattleSetup } from './session/battleSetup';
import { squadronFlights, airborne, onFlightDeck } from './airWing';
import { availableAmmunition } from './mountGeometry';
import { DEPTH_STEP_M } from './session/motion';
import { PROJECTED_HUD_LAYER_FIELDS } from '../ui/hudLayers';

export const BUOYS = [
  { x: -160, z: -800, color: '#b84734' }, { x: 160, z: -800, color: '#42a789' },
  { x: 220, z: -1800, color: '#b84734' }, { x: 540, z: -1800, color: '#42a789' },
];
export type { ArticulationPreview };
/** Battle preparation stages, reported as a label with a completion fraction in [0, 1). */
export type BattleProgress = (label: string, fraction: number) => void;

/** A development capture's camera in a hull's own frame about her waterline (metres: +X starboard, +Y up, −Z bow),
 * held whatever the rig does; `shipId` defaults to the hull the camera rides. See `Game.placeCamera`. */
export interface CameraPin { eye: Vec3; target: Vec3; fov?: number; shipId?: string }
/** A development capture's camera placed every frame in world space after the rig (`Game.directCamera`). `alpha` is the frame's
 * interpolation between the last two simulation frames, the fraction the ships and aircraft are drawn at; `dt` its seconds. */
export type CameraDirector = (camera: THREE.PerspectiveCamera, frame: { alpha: number; dt: number }) => void;
/** Where a ship or aircraft is drawn this frame (`Game.subjectPose`): world metres, radians (heading clockwise from −Z), and a
 * unit `forward` along the hull's heading or the aircraft's nose. */
export interface SubjectPose { position: Vec3; heading: number; pitch: number; roll: number; forward: Vec3; speed: number }

/** One task group as fleet command holds it: its ships, its name and how it sails. */
export interface ControlGroup { name: string; shipIds: string[]; formation?: Formation }
/** The briefing's task groups become the numbered control groups fleet command works
 * with. What the player set on the deploy screen is what sails: each group carries its
 * cruising formation into battle, and the in-battle picker keeps that record current. */
export function briefingControlGroups(briefing: { groups: readonly { id: string; name: string; formation?: Formation }[]; assignments: readonly { id: string; groupId: string }[] }, chosen?: Record<string, Formation>): Map<number, ControlGroup> {
  const groups = new Map<number, ControlGroup>();
  briefing.groups.forEach((group, index) => {
    const shipIds = briefing.assignments.filter(s => s.groupId === group.id).map(s => s.id);
    if (shipIds.length) groups.set(index + 1, { name: group.name, shipIds, formation: chosen?.[group.id] ?? group.formation ?? 'column' });
  });
  return groups;
}

/** Temporarily off while the anchorage is reworked: its 41 MiB of scenery downloads in
 * three serialized waves and is the largest remaining stage of cold start — about 4 s on
 * localhost and 14 s on a 50 Mbit line. The port keeps the ship, ocean and sky. Set this
 * back to true to restore the backdrop; nothing else needs changing. */
const HARBOR_BACKDROP = false;
/** Half-width of the sun shadow square at sea, in meters. */
const BATTLE_SHADOW_HALF = 380;
const NO_SHIPS: ReadonlySet<string> = new Set();

export class Game {
  // Tests build a Game from its field initializers alone (testing/gameFixture.ts), so give state the frame loop reads an
  // initializer here rather than an assignment in the constructor; anything built there, each test must pass in.
  definition: typeof selectedShip;
  private portDefinition = selectedShip;
  /** The port's session until the first sortie; set by `initialize`. */
  simulation!: BattleSession;
  readonly input: InputController;
  private renderer: THREE.WebGPURenderer;
  private scene = new FrameScene();
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
  private observedShipViews = new ObservedShipViews();
  private readonly fleetVisibility = new FleetVisibility();
  private waterViewFocus?: WaterViewFocus;
  private fleetModels: THREE.Group[] = [];
  /** Public hulls a mission may reveal, brought aboard the first time a contact needs one. */
  private recognition?: { models: Map<string, THREE.Group>; asked: Set<string> };
  /** Derived hull templates from fleets this session has already built. Fetching, parsing,
   * painting and batching a hull costs around 1.9 s, and the next battle usually wants the
   * same ones, so they are kept — in least-recently-used order and capped, because each one
   * holds tens of megabytes of vertex data. The fleet at sea is always retained. */
  private readonly hulls = new Map<string, THREE.Group>();
  /** Hulls darken and gloss just above the sea they sit in: the FFT waves plus the wake and bow waves. */
  private readonly hullWetBand = new HullWetBand();
  /** One palette for every hull kept, so paint still collapses across cached fleets. */
  private readonly palette = new ShipMaterialPalette({ surfaceDetail: true, weathering: this.hullWetBand });
  private readonly occlusion: ShipOcclusion;
  private shipLabels: ShipLabels;
  private hitLabels: HitLabels;
  private torpedoPreview = new TorpedoPreview();
  private playerDamageFeedback!: HullDamageFeedback;
  private damageFeedbackShipId?: string;
  private gunAim: GunAimIndicators;
  private torpedoAim: TorpedoAimIndicators;
  private torpedoMarkers: TorpedoMarkers;
  private hitDirections: HitDirectionIndicators;
  private hudScale = 1;
  private loadedModel?: THREE.Group;
  /** Scene light, wind and depth shared by every effect material. */
  private effectLighting = new EffectLighting();
  private effects = new CombatEffects(this.effectLighting);
  private funnelSmoke = new ShipFunnelSmoke(this.effectLighting);
  private environment = new VisualEnvironment({ effects: this.effects, funnelSmoke: this.funnelSmoke, sunAnchor: this.ship });
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
  private damageInspectionShipId?: string;
  get shipDamageOpen(): boolean { return this.inspecting && !!this.damageInspectionShipId; }
  private manualAim = true;
  /** Held right mouse: the guns keep `currentAim` while the sight looks elsewhere. */
  private aimLocked = false;
  private currentAim: Vec3 = [650, .5, -550];
  chartSize = 2;
  airOperationsOpen = false;
  fleetCommandMode = false;
  /** A custom battle reads the fleet chart from its own helm: the ship keeps its last engine
   * and rudder orders, and leaving the chart returns to it. Fleet command releases the helm. */
  helmChart = false;
  battleRevision = 0;
  selectedShipIds: string[] = [];
  /** Task groups from the deployment screen: who sails together, under what
   * name, and the cruising formation the fleet-command picker keeps up to date. */
  readonly controlGroups = new Map<number, ControlGroup>();
  private pveStartingGroups = new Map<number, ControlGroup>();
  private tacticalPause = false;
  /** The ship picker while it is up. */
  helmWheel?: HelmWheelState;
  private cameraFrameListeners = new Set<() => void>();
  onCameraFrame(listener: () => void): () => void {
    this.cameraFrameListeners.add(listener);
    return () => { this.cameraFrameListeners.delete(listener); };
  }
  private flightSelection: string[] = [];
  get selectedFlightIds(): string[] {
    const selected = this.flightSelection ?? [];
    if (!selected.length || !this.simulation) return selected;
    const flights = this.simulation.actors.filter(a => a.team === 'friendly').flatMap(a => a.airWing?.flights ?? []);
    const redirects = new Map(flights.filter(f => f.mergedInto).map(f => [f.id, f.mergedInto!]));
    return [...new Set(selected.map(id => {
      const seen = new Set<string>();
      while (redirects.has(id) && !seen.has(id)) { seen.add(id); id = redirects.get(id)!; }
      return id;
    }))];
  }
  get selectedFlightId(): string | undefined { return this.selectedFlightIds[0]; }
  set selectedFlightId(id: string | undefined) { this.flightSelection = id ? [id] : []; }
  private ocean?: OceanApi;
  private sunLight?: THREE.DirectionalLight;
  private sunShadows?: FocusShadowNode;
  /** Draws the sun's shadow maps without three's scene passes; `enabled` compares the two. */
  shadowCasters?: ShadowCasterPass;
  /** The battle's land and what it was built from; rebuilt when the map, its placement or the terrain density changes. */
  private landscape?: BattleLandscapeView;
  private landscapeSource?: { mapId: OceanMapId; terrain: PlacedTerrain; quality: TerrainQuality };
  private sky?: SkyApi;
  /** Sun transmittance through the clouds, shared by the sun's shadow maps and the sea. */
  private cloudShadow?: (position: THREE.Node<'vec3'>) => THREE.Node<'float'>;
  /** The device limits three requests at `renderer.init()`, filled from the adapter just before (it keeps this object). */
  private readonly deviceLimits: RaisedLimits = {};
  private shipWake?: ShipWake;
  private pipeline?: THREE.RenderPipeline;
  private scenePass?: ReturnType<typeof pass>;
  private display?: DisplayTransform;
  private armorOverlay?: ArmorOverlay;
  private inspectionHover: InspectionHover;
  private abort = new AbortController();
  private resizePending = true;
  private observer: ResizeObserver;
  private disposed = false;
  private switchingShip = false;
  private paused = false;
  private inPort = false;
  /** The port shows only the player's own designs; with none to show the quay stands empty. */
  private berthEmpty = false;
  private readonly berthMotion = new BerthMotion();
  /** Development captures: a camera held on a hull, and the sea time every presentation clock is held at (`freezeScene`). */
  private cameraPin?: CameraPin;
  private cameraDirector?: CameraDirector;
  /** Frames run only through `stepFrame`, each a fixed interval of battle time, not on the display's refresh. */
  private manualClock = false;
  private frozenTime?: number;
  private berthSea?: { wind: number; direction: number; state: SeaState };
  /** The sea the berth hull rode this frame (still water while it is inspected), which the water around it shows. */
  private berthRidden?: SeaState;
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
  /** Owned here so `dispose` can release its worker; the articulation controller creates it on first use. */
  private articulationResolver?: ArticulationResolver;

  private settings: GraphicsSettings;
  /** Ocean tier, the ocean and sky renderers and terrain density this scene was built with; every other row applies live. */
  readonly launchedGraphics: LaunchedGraphics;
  private frameIntervalMs = 0;
  private detailBudgetPx = 1.25;

  constructor(private host: HTMLElement, settings: GraphicsSettings, private callbacks: GameCallbacks, definition = selectedShip, readonly audio?: GameAudio) {
    this.settings = sanitizeGraphicsSettings(settings);
    this.launchedGraphics = { ocean: this.settings.ocean, terrain: this.settings.terrain, oceanRenderer: this.settings.oceanRenderer, skyRenderer: this.settings.skyRenderer };
    this.frameIntervalMs = frameIntervalMs(this.settings.frameLimit);
    this.graphicsControl.applyDetail();
    this.definition = definition;
    this.battery = this.weaponGroups[0]?.battery ?? 'main';
    this.aimModule = definition.modules.find(m => m.kind === 'engine')?.id ?? '';
    // Centimeter-scale fittings must remain distinct at 20 km, even with the
    // close near plane needed by bridge and shell-follow views. The scene pass
    // uses floating-point reversed depth; TSL's depth readers use the same mapping.
    this.renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance', reversedDepthBuffer: true, requiredLimits: this.deviceLimits });
    this.renderer.toneMapping = DISPLAY_TONE_MAPPING;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    // Three's default PCF takes five noise-rotated taps within about one texel, so where a
    // grazing wall stretches a texel across many pixels its edges stair-step. PCFSoft's
    // bilinear 3×3 gather is smooth at the same cost; water shadows keep their own filter.
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.occlusion = new ShipOcclusion(this.camera, this.renderer.reversedDepthBuffer);
    this.renderer.domElement.setAttribute('aria-label', `${this.definition.name} ocean scene. Drag to orbit; scroll to zoom.`);
    this.renderer.domElement.tabIndex = 0;
    this.host.appendChild(this.renderer.domElement);
    this.shipLabels = new ShipLabels(this.host, id => this.observedShipViews?.labelAnchor(id), id => this.observedShipViews?.position(id));
    this.hitLabels = new HitLabels(this.host);
    this.gunAim = new GunAimIndicators(this.host);
    this.torpedoAim = new TorpedoAimIndicators(this.host);
    this.torpedoMarkers = new TorpedoMarkers(this.host);
    this.hitDirections = new HitDirectionIndicators(this.host.parentElement ?? this.host);
    this.rig = new CameraRig(this.camera, this.renderer.domElement, this.definition.viewpoints?.bridge, {
      pause: () => this.setPaused(true), aim: () => { this.manualAim = true; }, aimLock: held => this.setAimLock(held),
    });
    this.inspectionHover = new InspectionHover(this.renderer.domElement, this.camera);
    this.rig.setHullLength(definition.hull.length);
    this.input = new InputController({
      pause: () => { if (this.shipDamageOpen && !this.paused) this.closeInspection(); else if (this.airOperationsOpen && !this.paused) this.setAirOperationsOpen(false); else if (!this.inPort) this.setPaused(!this.paused); },
      camera: () => this.cycleCamera(), recenter: () => this.recenter(),
      portHome: () => { if (this.inPort && !this.paused) this.rig.portHome(); },
      hud: () => { if (!this.inPort) callbacks.hud(); }, fullscreen: () => this.fullscreen(),
      optics: () => this.toggleBinoculars(), weaponGroup: index => this.selectWeaponSlot(index),
      cursor: released => { if (released) this.rig.releasePointer(); else if (this.controls().capturePointer && !document.querySelector('dialog[open]')) this.rig.capturePointer(); },
      chartSize: direction => this.resizeChart(direction),
      simulationSpeed: () => this.cycleSimulationSpeed(),
      shellFollow: () => this.toggleShellFollow(),
      freeCamera: () => this.toggleFreeCamera(),
      shipDamage: () => this.toggleShipDamage(),
      shellType: () => this.cycleAmmunition(),
      rangefind: () => this.measureRange(), rangeLock: () => this.toggleRangeLock(),
      isSpectating: () => !this.inPort && this.simulation.isBattle && this.simulation.player.damage.sunk,
      cycleSpectator: direction => this.cycleSpectator(direction),
      helmWheel: held => { if (held) this.openHelmWheel('held'); else this.releaseHelmWheel(); },
      airOperations: () => this.fleetCommandMode ? this.airOperationsOpen ? this.followFleetShip(this.selectedShipIds[0] ?? this.simulation.ship.id) : this.enterFleetCommand()
        // A carrier keeps its own air chart on this key; its fleet chart opens from the battle tally.
        : this.fleetChartAvailable && !this.simulation.player.airWing ? this.openFleetChart() : this.setAirOperationsOpen(!this.airOperationsOpen),
      depth: direction => this.setDepth((this.simulation.player.submarine?.targetDepthM ?? 0) + direction * DEPTH_STEP_M),
      depthPreset: depthM => this.setDepth(depthM),
      emergencyBlow: () => this.setDepth(0, true),
      periscope: () => this.togglePeriscope(),
    });
    this.updateInputEligibility(true);
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
    // Diagnostics may replace the settings object before start; accept any saved shape.
    this.settings = sanitizeGraphicsSettings(this.settings);
    Object.assign(this.launchedGraphics, { ocean: this.settings.ocean, terrain: this.settings.terrain, oceanRenderer: this.settings.oceanRenderer,
      skyRenderer: this.settings.skyRenderer });
    this.frameIntervalMs = frameIntervalMs(this.settings.frameLimit);
    this.graphicsControl.applyDetail();
    this.graphicsControl.applyAmbientOcclusion();
    this.callbacks.progress('Starting graphics', 0.08);
    this.resize();
    // Constructing the renderer touched no GPU API; ask before three can fall back to WebGL2, and
    // raise the limits three's device request carries to what the adapter offers.
    Object.assign(this.deviceLimits, await requireWebGPU());
    await this.renderer.init();
    requireWebGPUBackend(this.renderer);
    installFleetBatchInstancing(this.renderer.backend);
    installInstanceBufferNames(this.renderer.backend);
    for (const root of [this.effects.root, this.funnelSmoke.root, this.aircraftView.root]) prepareInstanceUploads(root);
    configureRenderOrder(this.renderer);
    this.assertActive();
    this.callbacks.progress(`Loading ${this.definition.name}`, 0.2);
    // The port session compiles the hull in its worker while the model loads.
    // Through the same cache the fleets use, so the first sortie does not fetch and rebuild
    // the hull the player has been looking at in port.
    // A saved design's hull is built from its frozen revision, as its port session is: a rebuilt port (a launch-time
    // setting, the ocean renderer switch) starts with the design already berthed.
    const [simulation, model] = await Promise.all([this.portSession(this.definition), this.hull(this.definition, localShip(this.definition.id)).then(async model => { await prepareShipDetail(model); return model; })]);
    if (this.disposed) { simulation.dispose(); this.assertActive(); }
    this.simulation = simulation;
    this.playerDamageFeedback = new HullDamageFeedback(simulation.player.damage.integrity);
    if (this.deferredPort !== undefined) { const inPort = this.deferredPort; this.deferredPort = undefined; this.setInPort(inPort); }
    this.rig.update(this.simulation.ship, 0, 0, true);
    this.loadedModel = model;
    this.playerView = new ShipView(model.clone(true), this.definition, this.simulation.player, this.renderer.reversedDepthBuffer);
    this.targetView = this.simulation.target ? new ShipView(model.clone(true), this.definition, this.simulation.target, this.renderer.reversedDepthBuffer) : undefined;
    this.fleetViews = [this.playerView, ...(this.targetView ? [this.targetView] : [])];
    this.fleetDraws = new FleetShipDraws(this.fleetViews);
    this.scene.add(this.fleetDraws.root);
    this.fleetModels = [model];
    this.shipLabels.setFleet(this.fleetViews, this.simulation.actors, this.simulation.ship.id);
    this.ship.position.copy(this.playerView.root.position);
    if (this.targetView) this.targetView.root.visible = !this.inPort;
    if (this.definition.airWing) {
      this.callbacks.progress('Loading aircraft', 0.32);
      await this.aircraftView.load(this.definition.airWing.squadrons.map(s => s.modelId));
    }
    this.assertActive();
    this.scene.add(...this.fleetViews.map(view => view.root), this.observedShipViews.root, this.effects.root, this.funnelSmoke.root, this.aircraftView.root, this.torpedoPreview.root);
    this.scene.add(this.environment.ambientLight);

    this.callbacks.progress('Building the Atlantic', 0.37);
    const ocean = this.ocean = await this.createOcean();
    // Meshes are lit by a game-owned sun that carries the near and wide shadow maps from the
    // start, since three caches a light's shadow node on its first build; the sea shades from
    // the ocean's own sun uniforms. Its shadow offsets are the ones the scene's sun has always used.
    this.sunLight = new THREE.DirectionalLight();
    this.sunLight.name = 'Sun';
    Object.assign(this.sunLight.shadow, { bias: -.0005, radius: 1, blurSamples: 8 });
    this.scene.add(this.sunLight);
    // Size the maps from the settings before the node clones them and anything renders:
    // resizing a map after its first render destroys a texture queued GPU work still reads.
    this.graphicsControl.applyShadows();
    this.sunShadows = new FocusShadowNode(this.sunLight);
    this.sunShadows.casters = this.shadowCasters = new ShadowCasterPass(this.renderer);
    this.sunLight.shadow.shadowNode = this.sunShadows as never;
    this.assertActive();
    // Until the first scene applies its own: fog from 2.5 km, complete at 16 km, fading into the sky over 10 km.
    Object.assign(ocean.fog, { start: 2500, end: 16000, power: 1.4, skyBlendDistance: 10000 });
    Object.assign(ocean.foam.surface, { opacity: .13 });
    Object.assign(ocean.foam.crest, { opacity: .45 });
    // A broader directional spectrum breaks up parallel ripples into the
    // small crossing waves of the supplied naval-game water references.
    ocean.waves.directionalSharpness = .8;
    // VisualEnvironment trims sky light on meshes with the sun; the sea's own reflection ignores it.
    ocean.environmentIntensity = 1;
    this.torpedoPreview.setOcean(ocean);
    this.environment.attachOcean(ocean, this.sunLight);
    this.waterViewFocus = new WaterViewFocus(ocean.reflections);

    this.callbacks.progress('Lighting the sky', 0.59);
    const sky = this.sky = await this.createSky(ocean);
    // Each lightning strike's thunder, heard after the sound's travel time.
    sky.onThunder = strike => this.audio?.thunder(strike);
    this.assertActive();
    this.environment.attachSky(sky);
    // Water and sky both exist now; nothing renders before the warmup below.
    this.environment.setScene(this.simulation.mapId, this.inPort);
    ocean.setSky(sky.oceanSky);
    // Clouds shade the sun on ships and islands through the sun's own shadow maps, and the sea
    // through its shadow hook. The Sky Pro comparison casts no cloud shadows, as before. A ship's
    // paint already binds WebGPU's default 16 textures and samplers a stage, so on a device that
    // grants no more the cloud shadow falls on the sea alone.
    if (sky.renderer === 'game') this.cloudShadow = position => sky.cloudShadow(position);
    this.sunShadows.cloud = sampledTextureLimit(this.renderer) > DEFAULT_SAMPLED_TEXTURES ? this.cloudShadow : undefined;
    const sunlight = this.sunLight;
    this.fitSunShadow();
    this.graphicsControl.applyReflections();
    this.scene.add(sunlight.target);

    // Combat hulls use the shared simulation pose. GPU wave sampling remains visual
    // ocean detail and buoy motion; it cannot move ship hitboxes or muzzle positions.
    this.shipWake = new ShipWake(ocean, gpuWakeFoamPainter(this.renderer), () => ocean.meshSpacing, () => this.renderer.domElement.height);
    // The wet band reads the sea exactly as the surface draws it: waves, wake field and bow waves.
    // Hull paint compiles on first draw, after this.
    const shipWake = this.shipWake;
    this.hullWetBand.setSea((x, z) => ocean.waveField.heightAt(vec2(x, z)).add(shipWake.surfaceHeight(x, z)), () => shipWake.bowWaves.crestHeight());
    for (const buoy of BUOYS) this.addBuoy(buoy);
    if (HARBOR_BACKDROP) {
      this.callbacks.progress('Building the naval anchorage', 0.72);
      this.harbor = await createHarborBackdrop(this.settings.terrain);
      this.harbor.visible = this.inPort;
      this.scene.add(this.harbor);
      this.assertActive();
    }

    this.callbacks.progress('Preparing ocean effects and lighting', 0.82);
    this.scenePass = pass(this.scene, this.camera);
    const sceneColor = this.scenePass.getTextureNode('output');
    // The ocean's scene.fogNode already fogs each material at its own distance; the sky adds
    // sun shafts and rain haze over the composed view, before the display grade.
    const radiance = sky.postProcess(this.scenePass, ocean.postProcess(this.scenePass, sceneColor));
    // FXAA detects edges in display space, after tone mapping and sRGB conversion.
    this.armorOverlay = new ArmorOverlay();
    this.display = new DisplayTransform({ radiance: radiance as THREE.Node<'vec4'>, scene: sceneColor, exposure: sky.exposure, overlay: this.armorOverlay });
    this.graphicsControl.buildPipeline();
    await this.warmupRendering();
    this.callbacks.progress('Ready to get underway', 1);
    this.callbacks.ready();
    this.updateInputEligibility();
    this.lastTime = performance.now();
    this.scheduleFrame();
  }

  /** The game's ocean, or for comparison the vendored Water Pro library it replaced, behind the same facade
   * (Graphics `oceanRenderer`, switched from the developer console). Only the comparison downloads the library. */
  private async createOcean(): Promise<OceanApi> {
    const quality = this.launchedGraphics.ocean;
    if (this.launchedGraphics.oceanRenderer === 'waterpro') {
      const { WaterProOcean } = await import('./comparison/WaterProOcean');
      return WaterProOcean.create(this.renderer, this.scene, this.camera, { quality });
    }
    return Ocean.create(this.renderer, this.scene, this.camera, { quality, seed: 1941 });
  }

  /** The game's sky, or for comparison the vendored Sky Pro library it replaced, behind the same facade
   * (Graphics `skyRenderer`, switched from the developer console). Only the comparison downloads the library. */
  private async createSky(ocean: OceanApi): Promise<SkyApi> {
    const quality = this.settings.clouds;
    if (this.launchedGraphics.skyRenderer === 'skypro') {
      const { SkyProSky } = await import('./comparison/SkyProSky');
      return SkyProSky.create(this.renderer, this.scene, this.camera, { quality });
    }
    // Splashes sit on the drawn waves; the wake's small heights are not worth a second lookup. Rain stays out of
    // the hull views that hide funnel smoke: the port's cutaways and the damage X-ray.
    return Sky.create(this.renderer, this.scene, this.camera, { quality, weather: { seaHeight: (x, z) => ocean.waveField.heightAt(vec2(x, z)),
      sheltered: () => this.inspecting || (this.inPort && this.playerView?.inspection.mode !== 'exterior') } });
  }

  private async warmupRendering(progress?: BattleProgress): Promise<void> {
    const scar = this.playerView!.impactMarks.createWarmupMesh();
    this.scene.add(scar);
    // Exercise the actual ship batches, the sea's viewport copies and post-processing targets.
    // Compiling the scene against the canvas misses those pipeline variants.
    // Twelve frames also cover the sky environment's nine-frame update cycle.
    // Prepare scenery behind the initial camera too, before the first port drag.
    const culled: THREE.Object3D[] = [];
    this.scene.traverse(object => {
      if (object.frustumCulled) { culled.push(object); object.frustumCulled = false; }
    });
    try {
      for (let frame = 0; frame < 12; frame++) {
        if (progress) progress('Preparing battle graphics', .9 + frame / 12 * .09);
        else this.callbacks.progress('Preparing the harbor view', .84 + frame / 12 * .14);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        this.assertActive();
        await this.frame(performance.now(), true);
      }
    } finally {
      culled.forEach(object => { object.frustumCulled = true; });
      scar.removeFromParent(); scar.geometry.dispose();
    }
    await this.frame(performance.now(), true);
    // A submitted frame is not necessarily finished on the GPU. A tiny readback
    // drains the startup work.
    await this.renderer.readRenderTargetPixelsAsync(this.display!.frame!.renderTarget!, 0, 0, 1, 1);
    this.assertActive();
  }

  /** Finish battle-specific pipeline compilation under the loading screen,
   * with the worker and visual clocks held at their initial state. */
  async beginBattle(progress?: BattleProgress): Promise<void> {
    cancelAnimationFrame(this.raf);
    await this.frameTask;
    cancelAnimationFrame(this.raf);
    this.assertActive();
    this.setInPort(false);
    this.paused = true;
    this.updateInputEligibility(true);
    await this.warmupRendering(progress);
    this.assertActive();
    this.paused = false;
    this.updateInputEligibility(this.fleetCommandMode);
    this.lastTime = performance.now();
    this.scheduleFrame();
  }

  /** Replace only ship-owned resources; the harbor, ocean, renderer and camera stay alive. */
  async switchShip(definition: typeof selectedShip): Promise<void> {
    if (this.disposed || !this.inPort || !this.playerView || this.switchingShip) throw new Error('Ship switching requires an idle, loaded port.');
    if (definition.id === this.definition.id && definition.contentHash === this.definition.contentHash) return;
    this.switchingShip = true;
    try {
      const simulation = await this.portSession(definition);
      // Keep the berth while retaining this hull's authoritative loaded draft
      // and trim. Copying the old motion would also replace its flotation pose.
      const { x, z, heading } = this.simulation.ship;
      Object.assign(simulation.ship, { x, z, heading });
      await this.replaceFleet(simulation, definition);
      this.portDefinition = definition;
    } finally { this.switchingShip = false; }
  }

  /** Load and validate the complete fleet before replacing the current port scene. */
  async prepareBattle(setup: BattleSetup, progress?: BattleProgress, trial = false): Promise<void> {
    if (this.disposed || !this.inPort || !this.playerView || this.switchingShip) throw new Error('Battle setup requires an idle, loaded port.');
    const map = oceanMap(setup.mapId ?? DEFAULT_MAP);
    this.switchingShip = true;
    try {
      // The land must be charted before the setup's spawns can be checked against it.
      progress?.(`Charting ${map.name}`, 0.04);
      await loadMapTerrain(map.id);
      this.assertActive();
      validateBattleSetup(setup, availableShipIds(), placedMapTerrain(map.id, customTerrainOffset(setup.spawnDistance))!);
      const revisions = freezeLocalFleet([setup.playerShipId, ...setup.friendlyBots.map(bot => typeof bot === 'string' ? bot : bot.shipId), ...setup.enemies.map(bot => typeof bot === 'string' ? bot : bot.shipId)]);
      if (isHistoricalShip(this.definition.id)) this.portDefinition = this.definition;
      const definition = resolveShip(setup.playerShipId);
      const simulation = await LocalBattleSession.create(setup, { revisions, trial });
      simulation.onFailure = message => this.callbacks.error(message);
      await this.replaceFleet(simulation, definition, progress);
      this.environment.setBattle({ timeOfDay: setup.timeOfDay ?? 'map', weather: setup.weather ?? 'map',
        conditions: { timeHours: setup.timeHours, cloudCover: setup.cloudCover, windSpeed: setup.windSpeed } });
      progress?.('Forming the battle lines', 0.9);
    } finally { this.switchingShip = false; }
  }

  async preparePveBattle(draft: PveDraft, placements: Placement[], progress?: BattleProgress): Promise<void> {
    if (this.disposed || !this.inPort || !this.playerView || this.switchingShip) throw new Error('Return to an idle port before deploying.');
    this.switchingShip = true;
    try {
      progress?.('Preparing mission waters', .04);
      // The deployment chart charted these waters already; a failed load surfaces here rather than as open sea.
      await loadMapTerrain(draft.briefing.setup.mapId as OceanMapId);
      const simulation = await draft.deploy(placements);
      simulation.onFailure = message => this.callbacks.error(message);
      await this.replaceFleet(simulation, shipPreset(simulation.definition.id), progress);
      this.environment.setBattle({ timeOfDay: 'noon', weather: draft.briefing.setup.weather as import('../maps/conditions').WeatherId, conditions: {} });
      briefingControlGroups(draft.briefing, draft.formations).forEach((group, slot) => this.controlGroups.set(slot, group));
      this.pveStartingGroups = new Map([...this.controlGroups].map(([slot, group]) => [slot, { name: group.name, shipIds: [...group.shipIds], formation: group.formation }]));
      progress?.('Preparing fleet command', .9);
    } finally { this.switchingShip = false; }
  }

  async restartPveBattle(): Promise<void> {
    const session = this.simulation;
    if (!(session instanceof LocalBattleSession) || !session.missionRules || this.inPort || this.switchingShip || this.disposed) throw new Error('No PvE mission is available to restart.');
    this.switchingShip = true; this.paused = true;
    this.input.clear(); this.input.setOrder(1); this.input.setRudder(0); this.updateInputEligibility(true); this.rig.releasePointer();
    cancelAnimationFrame(this.raf);
    try {
      await this.frameTask; cancelAnimationFrame(this.raf);
      await session.restartPve(); this.assertActive(); this.battleRevision++; this.environment.setOverrides({});
      this.endFollow(); this.spectatedShipId = undefined; this.selectedShipIds = [];
      this.selectedFlightId = undefined; this.selectFlights([]); this.spectator.forgetHelm();
      this.inspectionHover?.clear(); this.inspecting = false; this.damageInspectionShipId = undefined;
      this.fleetViews.forEach(view => { view.inspect(false); view.impactMarks.clear(); view.snap(); });
      this.syncControlledShip(); this.observedShipViews?.clear(); this.aircraftView.reset();
      this.playerDamageFeedback = new HullDamageFeedback(session.player.damage.integrity);
      this.effects.reset(); this.funnelSmoke.reset(); this.shipWake?.reset(); this.audio?.reset(session);
      this.trail = []; this.lastTrailTick = 0; this.lastShellPress = undefined;
      this.controlPriority = 'balanced'; this.controlFocus = ''; this.aimModule = '';
      this.ammunition = { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' };
      this.currentAim = session.aimAt(undefined, this.battery, this.weaponGroupId);
      this.controlGroups.clear();
      this.pveStartingGroups.forEach((group, slot) => this.controlGroups.set(slot, { name: group.name, shipIds: [...group.shipIds], formation: group.formation }));
      this.tacticalPause = false; this.enterFleetCommand(false); this.fitAirMap();
      await this.frame(performance.now(), true);
    } finally {
      this.switchingShip = false; this.lastTime = performance.now();
      if (!this.disposed) { this.setPaused(false); this.scheduleFrame(); }
    }
  }

  async prepareOnlineBattle(session: RemoteBattleSession, progress?: BattleProgress): Promise<void> {
    if (this.disposed || !this.inPort || this.switchingShip) throw new Error('Return to port before joining.');
    this.switchingShip = true;
    try {
      // The server chose the map; its chart has usually loaded while both fleets were matched.
      progress?.(`Charting ${oceanMap(session.mapId).name}`, 0.04);
      await loadMapTerrain(session.mapId);
      this.assertActive();
      await this.replaceFleet(session, session.definition as IdentifiedShip, progress);
      this.environment.setBattle({ timeOfDay: session.metadata.environment.timeOfDay, weather: session.metadata.environment.weather, conditions: {} });
    } finally { this.switchingShip = false; }
  }

  get isConstructionTrial(): boolean { return this.simulation instanceof LocalBattleSession && this.simulation.trial; }
  async trialAction(action: TrialAction): Promise<void> {
    if (!(this.simulation instanceof LocalBattleSession) || !this.simulation.trial) throw new Error('Open a sea trial to use damage controls.');
    await this.simulation.trialAction(action);
  }
  async resetTrial(): Promise<void> {
    const session = this.simulation;
    if (!(session instanceof LocalBattleSession) || !session.trial || this.switchingShip || this.disposed) throw new Error('No trial is available to reset.');
    this.switchingShip = true; this.setPaused(true); cancelAnimationFrame(this.raf);
    this.input.clear(); this.input.setOrder(1); this.input.setRudder(0);
    try {
      await this.frameTask; cancelAnimationFrame(this.raf);
      await session.resetTrial(); this.assertActive(); this.battleRevision++; this.environment.setOverrides({});
      this.fleetViews.forEach(view => { view.impactMarks.clear(); view.snap(); });
      this.syncControlledShip(); this.effects.reset(); this.funnelSmoke.reset(); this.shipWake?.reset(); this.audio?.reset(session);
      this.playerDamageFeedback = new HullDamageFeedback(session.player.damage.integrity); this.trail = []; this.lastTrailTick = 0;
      await this.frame(performance.now(), true);
    } finally { this.switchingShip = false; this.lastTime = performance.now(); if (!this.disposed) { this.setPaused(false); this.scheduleFrame(); } }
  }

  /** Developer console: the weather on screen, its live overrides, and the
   * wind the sea physics ride. Online battles keep the server's conditions. */
  developerWeather(): DeveloperWeather | undefined {
    const reading = this.environment.reading();
    if (!reading) return undefined;
    const session = this.simulation;
    return { scene: this.inPort ? 'port' : 'battle', reading, overrides: this.environment.getOverrides(),
      locked: !this.inPort && !!session.networked, seaWind: !this.inPort && session instanceof LocalBattleSession ? session.sea.windMps : undefined };
  }
  /** Replace the developer weather overrides. In a local battle the sea
   * physics follow the wind; a new scene, restart or trial reset clears them. */
  setDeveloperWeather(overrides: EnvironmentOverrides): void {
    if (!this.inPort && this.simulation.networked) throw new Error('Online battles keep the server\'s weather.');
    const previous = this.environment.getOverrides();
    this.environment.setOverrides(overrides);
    const next = this.environment.getOverrides();
    if (!this.inPort && this.simulation instanceof LocalBattleSession
      && (previous.windSpeed !== next.windSpeed || previous.windDirection !== next.windDirection))
      this.simulation.setWind(next.windSpeed, next.windDirection);
  }

  async returnToPort(): Promise<void> {
    if (this.switchingShip) return;
    this.simulation.surrender?.();
    this.setPaused(true);
    // replaceFleet requires a port scene, but must not reset the live authority.
    this.inPort = true;
    // Design ids carry their content hash, so an edit since sailing retires the
    // old id. Berth only a revision the port can still compile.
    const berthable = (ship: typeof selectedShip) => isHistoricalShip(ship.id) || !!localShip(ship.id);
    const definition = [this.definition, this.portDefinition].find(berthable) ?? selectedShip;
    try { await this.replaceFleet(await this.portSession(definition), definition); this.setInPort(true); }
    catch (error) { this.inPort = false; throw error; }
  }

  /** The port's session for `definition`: the Rust authority holding one hull, never stepped. */
  private portSession(definition: typeof selectedShip): Promise<LocalBattleSession> {
    return LocalBattleSession.port(definition, localShip(definition.id));
  }

  /** The hull on show rides the port's sea on screen while its session stays
   * still. The sea is the CPU mirror a battle would resolve for the wind the
   * water shows, so a console wind change reaches the berth too. Inspection
   * views settle the hull, keeping plates and rooms steady under the cursor. */
  private updateBerthMotion(dt: number): void {
    const view = this.playerView, reading = this.inPort ? this.environment.reading() : undefined;
    this.berthRidden = undefined;
    if (!view || !reading) { if (view?.seaOffset) { view.seaOffset = undefined; this.berthMotion.reset(); } return; }
    if (this.berthSea?.wind !== reading.windSpeed || this.berthSea.direction !== reading.windDirection)
      this.berthSea = { wind: reading.windSpeed, direction: reading.windDirection, state: { ...createSeaState(this.simulation.mapId, 'clear', this.simulation.seed, reading.windSpeed), direction: reading.windDirection * Math.PI / 180 } };
    const riding = view.inspection.mode === 'exterior' && !this.berthEmpty;
    this.berthRidden = riding ? this.berthSea.state : { ...this.berthSea.state, amplitudeM: 0 };
    if (this.frozenTime === undefined) this.berthMotion.update(this.berthRidden, view.definition.hull, view.actor.motion, dt);
    else if (this.berthMotion.seaTime !== this.frozenTime) this.berthMotion.seek(this.frozenTime, this.berthRidden, view.definition.hull, view.actor.motion);
    view.seaOffset = this.berthMotion;
  }

  private syncControlledShip(): void {
    if (this.playerView?.actor === this.simulation.player) return;
    const view = this.fleetViews.find(v => v.actor === this.simulation.player);
    if (!view) return;
    if (!view.definition.contentHash) throw new Error('The controlled ship has no content identity.');
    if (this.inspecting) this.closeInspection();
    this.resetRangefinding();
    this.playerView = view; this.definition = view.definition as IdentifiedShip;
    this.shipLabels.setFleet(this.fleetViews, this.simulation.actors, view.actor.motion.id);
    this.playerDamageFeedback = new HullDamageFeedback(view.actor.damage.integrity);
    this.rig.setBridge(this.definition.viewpoints?.bridge); this.rig.setHullLength(this.definition.hull.length);
    this.inspecting = false; this.damageInspectionShipId = undefined; this.spectatedShipId = undefined; this.airOperationsOpen = false; this.selectedFlightId = undefined;
    this.battery = this.weaponGroups[0]?.battery ?? 'main';
    this.ammunition = { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' };
    this.controlPriority = view.actor.damage.control.priority; this.controlFocus = view.actor.damage.control.focus ?? '';
    this.input.setOrder(1); this.input.setRudder(0);
    this.trail = []; this.rig.exitBinoculars(); this.audio?.reset(this.simulation);
  }

  /** Development captures (the browser harness): hold the camera at `pin` in a hull's own frame whatever the rig does, or give it back. */
  placeCamera(pin?: CameraPin): void { this.cameraPin = pin && { ...pin, eye: [...pin.eye], target: [...pin.target] }; }
  private pinCamera({ eye, target, fov, shipId }: CameraPin): void {
    const { x, z, heading } = (this.fleetViews.find(view => view.actor.motion.id === shipId) ?? this.cameraShipView).motion;
    // About the waterline and heading only: the view holds still while the hull heaves, rolls and pitches in it.
    const frame = { x, y: 0, z, heading, roll: 0, pitch: 0 };
    this.camera.position.set(...localToWorld(eye, frame));
    this.camera.lookAt(...localToWorld(target, frame));
    if (fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld();
  }
  /** Development captures (the film driver): place the camera every frame in world space, after the rig, whatever the rig does;
   * no director gives it back. The director sets the lens too; the projection is updated after it runs. */
  directCamera(director?: CameraDirector): void { this.cameraDirector = director; }
  /** Development captures: `true` stops the display-driven frame loop, so frames run only through `stepFrame`; `false` resumes it. */
  async setManualClock(manual: boolean): Promise<void> {
    if (manual === this.manualClock) return;
    this.manualClock = manual;
    cancelAnimationFrame(this.raf);
    await this.frameTask;
    cancelAnimationFrame(this.raf);
    this.lastTime = performance.now();
    if (!manual) this.scheduleFrame();
  }
  /** Development captures under the manual clock: draw the next frame `dt` seconds of battle (at most 0.1) after the last, once the
   * simulation has answered every batch posted so far. Stepped this way a battle presents every tick in order however long a frame
   * takes; a frame of 0 s only applies the pending batch. */
  async stepFrame(dt = 1 / 60): Promise<void> {
    if (!this.manualClock) throw new Error('Game.stepFrame runs only under the manual clock.');
    if (!(dt >= 0 && dt <= .1)) throw new Error(`Game.stepFrame takes 0 to 0.1 s; got ${dt}.`);
    await this.frameTask;
    await this.simulation.batchSettled?.();
    this.assertActive();
    this.frameTask = this.frame(this.lastTime + dt * 1000, false, dt);
    await this.frameTask;
  }
  /** Development captures: resolves once the GPU has finished every frame submitted so far, so a capture reads the last one. */
  async gpuIdle(): Promise<void> {
    await (this.renderer.backend as unknown as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device?.queue.onSubmittedWorkDone();
  }
  /** Development captures: where the ship or aircraft `id` is drawn this frame, interpolated as the renderer draws it. */
  subjectPose(id: string): SubjectPose | undefined {
    const view = this.fleetViews.find(entry => entry.actor.motion.id === id);
    if (view) {
      const { heading, pitch, roll, speed } = view.motion, { x, y, z } = view.root.position;
      return { position: [x, y, z], heading, pitch, roll, speed, forward: [Math.sin(heading), 0, -Math.cos(heading)] };
    }
    const plane = this.simulation.aircraft.find(entry => entry.id === id), alpha = this.simulation.interpolationAlpha;
    const carrier = plane && this.fleetViews.find(entry => entry.actor.motion.id === plane.ownerId);
    const owner = plane && this.simulation.actors.find(actor => actor.motion.id === plane.ownerId);
    const seen = plane && carrier && owner && aircraftFollowView(plane, owner, carrier.motion, alpha);
    if (!plane || !seen) return;
    const forward = seen.velocity, speed = Math.hypot(...plane.velocity);
    // On deck the nose follows taxi turns and the deck's slope; the flight attitude is for the air.
    if (onFlightDeck(plane)) return { position: seen.position, heading: Math.atan2(forward[0], -forward[2]), pitch: 0, roll: 0, forward, speed };
    const { heading, pitch, bank } = aircraftAttitude(plane, alpha);
    return { position: seen.position, heading, pitch, roll: bank, forward, speed };
  }
  /** Development captures: the long-wave sea's height at `x, z` this frame, the swell a camera near the water must clear. */
  seaSurface(x: number, z: number): number {
    const sea = this.simulation.sea;
    return sea ? seaHeight(sea, x, z, this.simulation.presentationTime ?? this.simulation.tick / 60) : 0;
  }
  /** What the camera shows is where it was sent: no optics glide, zoom, orbit or chart transition is still easing. */
  get cameraSettled(): boolean { return !!this.cameraPin || !!this.cameraDirector || (!this.rig.transitioning && !this.battlefieldCamera.transitioning); }

  /** Development captures: hold every presentation clock at `time` seconds of sea (the berth's ride, the waves, clouds, funnel
   * smoke, wake and a battle itself) until called without a time. The sea's foam and wake and the smoke are first replayed for
   * `history` seconds with every hull held where it stands, so two runs frozen at one time draw the same sea whatever each ran
   * before. Underway, the replay fades the wakes astern; `history` 0 keeps them, and the foam of whatever sea came before. */
  async freezeScene(time?: number, history = 30): Promise<void> {
    if (time === undefined) { this.frozenTime = undefined; this.sky?.hold(); this.lastTime = performance.now(); return; }
    cancelAnimationFrame(this.raf);
    await this.frameTask;
    cancelAnimationFrame(this.raf);
    this.assertActive();
    this.frozenTime = time;
    try {
      // The berth rides to `time` first: smoke leaves the funnels where the hull stands then.
      this.updateBerthMotion(0);
      this.fleetViews.forEach(view => view.updateMotion(this.inPort ? 1 : this.simulation.interpolationAlpha));
      const ocean = this.ocean!, step = 1 / 30, emptyBerth = this.inPort && this.berthEmpty;
      const hulls = emptyBerth ? [] : this.inPort ? [this.playerView!] : this.fleetViews;
      if (history > 0) this.funnelSmoke.reset();
      ocean.time = time - history;
      for (let steps = Math.round(history / step); steps > 0; steps--) {
        this.funnelSmoke.update(hulls, step, this.camera);
        this.shipWake?.update(emptyBerth ? [] : this.inPort ? hulls : this.wakeShips(), step, [], this.camera, []);
        await ocean.update(step);
      }
      ocean.time = time;
      this.sky?.hold(time);
    } finally {
      this.lastTime = performance.now();
      this.scheduleFrame();
    }
  }

  /** Resolve once the next frame has been rendered, so a scene change is on screen. */
  nextFrame(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return new Promise(resolve => this.frameWaiters.push(resolve));
  }

  private async replaceFleet(simulation: BattleSession, definition: typeof selectedShip, progress?: BattleProgress): Promise<void> {
    this.inspectionHover?.clear();
    const actorDefinitions = new Map(simulation.actors.map(actor => [actor.definition.id, actor.definition]));
    const definitions = [...actorDefinitions.values()];
    const models = new Map<string, THREE.Group>();
    const views: ShipView[] = [];
    const clones: THREE.Group[] = [];
    let draws: FleetShipDraws | undefined;
    try {
      // Parsing, painting, batching and LOD generation all allocate large temporary
      // buffers. Finish one model before fetching the next to bound peak memory.
      let loaded = 0;
      const hullShare = 0.6 / definitions.length;
      progress?.(simulation.missionRules ? 'Preparing the fleet' : `Loading ${definitions[0].name}`, 0.08);
      for (const def of definitions) {
        this.assertActive();
        const model = await this.hull(def, (simulation instanceof LocalBattleSession || simulation instanceof RemoteBattleSession) ? simulation.constructionShips.get(def.id) : localShip(def.id));
        models.set(def.id, model);
        this.assertActive();
        // Report-only exteriors clone the original geometry; they never use
        // FleetShipDraws' detail buffers. Only actor-backed ShipViews need LODs.
        // Keep the full public catalog loaded independently of hidden enemies.
        if (actorDefinitions.has(def.id)) await prepareShipDetail(model);
        loaded += 1;
        const next = definitions.find(d => !models.has(d.id));
        progress?.(simulation.missionRules ? 'Preparing the fleet' : next ? `Loading ${next.name}` : `${def.name} aboard`, 0.08 + hullShare * loaded);
      }
      if (definitions.some(d => d.airWing)) { progress?.('Spotting the air wing', 0.7); await this.aircraftView.load(definitions.flatMap(d => d.airWing?.squadrons.map(s => s.modelId) ?? [])); }
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
      this.simulation.dispose?.();
      this.definition = definition; this.simulation = simulation;
      this.playerDamageFeedback = new HullDamageFeedback(simulation.player.damage.integrity);
      this.audio?.reset(simulation);
      this.fleetModels = [...models.values()]; this.loadedModel = models.get(definition.id);
      this.recognition = simulation.missionRules ? { models, asked: new Set(models.keys()) } : undefined;
      this.observedShipViews?.setModels(simulation.missionRules ? models : new Map(), this.recognition && (presetId => this.loadRecognitionModel(presetId)));
      this.fleetViews = views; this.playerView = views.find(view => view.actor === simulation.player)!;
      this.shipWake?.reset();
      this.fleetDraws = draws;
      this.scene.add(this.fleetDraws.root);
      this.targetView = views.find(view => view.actor === simulation.target);
      this.shipLabels.setFleet(views, simulation.actors, simulation.ship.id);
      this.articulation.discard();
      this.controlPriority = 'balanced'; this.controlFocus = '';
      this.lastShellPress = undefined;
      this.ammunition = { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' };
      this.battery = this.weaponGroups[0]?.battery ?? 'main'; this.manualAim = true; this.inspecting = false; this.damageInspectionShipId = undefined;
      this.airOperationsOpen = false; this.selectedFlightId = undefined; this.effects.reset();
      this.fleetCommandMode = false; this.helmChart = false; this.selectedShipIds = []; this.controlGroups.clear(); this.pveStartingGroups.clear(); this.tacticalPause = false; this.spectator.forgetHelm(); this.helmWheel = undefined; this.wheel.forgetOffer();
      this.currentAim = simulation.aimAt(undefined, this.battery, this.weaponGroupId);
      this.aimModule = simulation.target?.definition.modules.find(m => m.kind === 'engine')?.id ?? '';
      this.rig.setBridge(definition.viewpoints?.bridge);
      this.rig.setHullLength(definition.hull.length);
      this.renderer.domElement.setAttribute('aria-label', `${definition.name} ocean scene. Drag to orbit; scroll to zoom.`);
      disposeObjectsExcept({ roots: [...this.hulls.values()], materials: this.palette.sharedMaterials() }, ...previous, ...this.trimHulls(models));
    } catch (error) {
      simulation.dispose?.();
      draws?.dispose();
      views.forEach(view => { view.impactMarks.dispose(); view.rig.dispose(); });
      disposeObjectsExcept({ roots: [...this.hulls.values()], materials: this.palette.sharedMaterials() }, ...clones, ...views.map(view => view.root));
      throw error;
    }
  }

  /** A fresh, unbatched exterior of a ship in this battle, for a viewer that owns its own
   * renderer (the after-action hit map). The caller disposes it. */
  async reviewModel(definition: ShipDefinition): Promise<THREE.Group> {
    const simulation = this.simulation;
    const revision = (simulation instanceof LocalBattleSession || simulation instanceof RemoteBattleSession) ? simulation.constructionShips.get(definition.id) : localShip(definition.id);
    if (revision) return createConstructionModel(revision.source, revision.result);
    const hash = 'contentHash' in definition ? definition.contentHash as string : undefined;
    return (await loadShipModel(assetUrl(definition.modelUrl), undefined, hash)).scene;
  }

  /** How many derived hulls to keep beyond the fleet at sea. Enough for a repeat sortie with
   * the same fleet plus the hulls it met, small enough that an idle port is not holding a
   * battle's worth of vertex data. */
  private static readonly HULL_CACHE = 8;

  /** Fit the wide sun shadow map to what it must cover: the berthed hull in port, a
   * fixed square around the shadow focus at sea. The near map adds close-up detail
   * wherever the camera looks; see FocusShadowNode. */
  private fitSunShadow(): void {
    const sunlight = this.sunLight;
    if (!sunlight) return;
    const half = this.inPort ? THREE.MathUtils.clamp(this.definition.hull.length / 2 + 30, 60, BATTLE_SHADOW_HALF) : BATTLE_SHADOW_HALF;
    const camera = sunlight.shadow.camera;
    if (camera.right === half) return;
    Object.assign(camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 1800 });
    camera.updateProjectionMatrix();
    // Recomputes the texel-proportional normal bias for the new extent.
    this.graphicsControl.applyShadows();
  }

  /** Centre the near shadow map where the camera is looking, at the distance of the
   * subject the wide map follows, and size it to the frame visible there. */
  private focusNearShadow(): void {
    const sunlight = this.sunLight;
    if (!sunlight || !this.sunShadows) return;
    this.sunShadows.focusOn(this.camera, sunlight.target.position, sunlight.shadow.camera.right);
  }

  /** A derived hull template: fetched, painted and batched once, then reused. */
  private async hull(definition: ShipDefinition, revision?: LocalShipRevision): Promise<THREE.Group> {
    const hash = 'contentHash' in definition ? definition.contentHash as string : undefined;
    const key = `${definition.id}:${hash ?? ''}`;
    const cached = this.hulls.get(key);
    // Reinserting keeps the map in least-recently-used order for trimHulls.
    if (cached) { this.hulls.delete(key); this.hulls.set(key, cached); return cached; }
    if (definition.id.startsWith('local-') && definition.construction && (!revision || revision.definition.contentHash !== hash)) throw new Error('The frozen design revision is unavailable. Return to the builder and launch again.');
    const model = revision ? await createConstructionModel(revision.source, revision.result) : (await loadShipModel(assetUrl(definition.modelUrl), undefined, hash)).scene;
    if (!hash || model.userData.definitionHash !== hash) {
      disposeObjects(model);
      throw new Error('The ship model and definition have different versions. Rebuild the ship assets and reload.');
    }
    // A premade ship weathers as a player-built one does, by the wear its appearance names; a design measured its own.
    if (!revision) applyPremadeWear(model, wearAmount(model.userData.appearanceWear));
    this.palette.apply(model);
    this.occlusion.adopt(model);
    batchShipModel(model);
    // The hull's waterline for its contact foam, sliced while loading rather than in a battle frame.
    primeHullProfile(definition, model);
    this.hulls.set(key, model);
    return model;
  }

  /** Drop the least recently used hulls once the fleet at sea is settled, and hand them back
   * so they are retired alongside the rest of the outgoing scene. */
  private trimHulls(fleet: ReadonlyMap<string, THREE.Group>): THREE.Group[] {
    const afloat = new Set(fleet.values());
    const evicted: THREE.Group[] = [];
    for (const [key, model] of this.hulls) {
      if (this.hulls.size <= Game.HULL_CACHE) break;
      if (afloat.has(model)) continue;
      this.hulls.delete(key); evicted.push(model);
    }
    return evicted;
  }

  /** Bring aboard a hull the mission has just revealed. Loading the whole public catalog
   * before the battle instead cost 109 MiB and about 7 s locally — 27 s on a 50 Mbit line —
   * every time, whatever the player brought, and streaming it in behind the battle stalled
   * frames for twenty seconds. A contact already names its preset in the report, so fetching
   * it at that moment tells the player nothing they were not just told. */
  private loadRecognitionModel(presetId: string): void {
    const recognition = this.recognition;
    // Failures stay marked as asked: one unavailable hull must not be retried every frame.
    if (!recognition || recognition.asked.has(presetId)) return;
    const definition = shipPreset(presetId);
    if (definition.id !== presetId) return;
    recognition.asked.add(presetId);
    void (async () => {
      try {
        await loadShipPresets([presetId]);
        const model = await this.hull(definition);
        if (this.disposed || recognition !== this.recognition) return;
        recognition.models.set(presetId, model);
        this.fleetModels.push(model);
        if (definition.airWing) await this.aircraftView.load(definition.airWing.squadrons.map(squadron => squadron.modelId));
      } catch (error) {
        // A hull that will not load stays undrawn rather than costing the battle.
        console.warn(`Recognition model unavailable: ${presetId}`, error);
      }
    })();
  }

  private readonly buoys: THREE.Object3D[] = [];
  /** Development captures: the channel buoys off the berth, which a film at sea hides. */
  setBuoysVisible(visible: boolean): void { this.buoys.forEach(buoy => { buoy.visible = visible; }); }
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
    this.buoys.push(group);
    this.scene.add(group);
    this.ocean!.addFloater(group, { smoothing: 0.6 });
  }

  private scheduleFrame(): void {
    if (this.disposed || this.manualClock) return;
    this.raf = requestAnimationFrame(time => {
      // A frame rate limit skips whole display refreshes; the next frame's dt covers the gap.
      if (this.frameIntervalMs && time - this.lastTime < this.frameIntervalMs - 2) { this.scheduleFrame(); return; }
      this.frameTask = this.frame(time);
    });
  }

  /** `stepDt` (the manual clock) is the frame's exact battle seconds, 0 included: a frame that only applies a pending batch. */
  private async frame(time: number, warmingUp = false, stepDt?: number): Promise<void> {
    if (this.disposed) return;
    const realDt = warmingUp ? 1 / 60 : stepDt ?? Math.min(Math.max((time - this.lastTime) / 1000, 0.001), 0.1);
    this.lastTime = time;
    const ended = this.simulation.isBattle && this.simulation.result !== 'active';
    const dt = this.frozenTime !== undefined || (!ended && (this.paused || this.tacticalPause)) ? 0 : realDt;
    const presentationDt = dt * (ended ? 1 : this.simulation.simulationSpeed ?? 1);
    try {
      if (this.resizePending) this.resize();
      let state = this.simulation.ship;
      this.updateSpectator();
      const focusView = this.cameraShipView;
      const focus = focusView.motion;
      this.rig.setSubmarine(focusView.definition.submarine);
      // Apply mouse aim before sampling the sight; follow the new rendered pose
      // after stepping, with camera damping applied only once per frame.
      // Whatever ends the flight (a follow, the chart, port), the helm keys return to the ship the same frame.
      this.input.setFlying(this.rig.freeCamera);
      this.rig.setFreeMove(this.input.flight);
      this.rig.update(focus, focus.y, 0);
      this.updateRangefinding(presentationDt);
      const aim = this.manualAim ? this.simulation.player.damage.sunk || this.viewAway || this.aimLocked ? this.currentAim : this.readSightAim() : this.simulation.aimAt(this.aimModule, this.battery, this.weaponGroupId);
      this.currentAim = aim;
      // The HUD reads damage-control detail for the camera's ship only; tell the
      // transport before it schedules the next batch.
      this.simulation.setFollowedShip?.(this.spectatedShipId);
      if (!this.inPort && !warmingUp) this.simulation.advance(dt, this.input.sample(), { aim, fire: this.gunsCommandable && (this.input.firing || this.rig.firing), battery: this.battery, weaponGroupId: this.weaponGroupId, ammunition: this.selectedAmmunition, controlPriority: this.controlPriority, controlFocus: this.controlFocus }, () => {
        this.fleetViews.forEach(view => view.capturePreviousPose());
      });
      this.syncControlledShip();
      state = this.simulation.ship;
      const alpha = this.inPort ? 1 : this.simulation.interpolationAlpha;
      this.updateBerthMotion(dt);
      this.fleetViews.forEach(view => view.updateMotion(alpha));
      this.observedShipViews?.update(this.simulation.observedShips ?? [], this.simulation.tick, !this.inPort && !this.inspecting,
        this.airOperationsOpen ? undefined : this.cameraShipView.actor.motion.id, presentationDt);
      this.shipLabels.setObserved(this.observedLabelReports());
      // A salvo must not synchronously project scars onto every struck hull.
      // Share the budget across the fleet and rotate which hull gets first use.
      const impactBudget = { remainingMs: 2 };
      for (let i = 0; i < this.fleetViews.length; i++) {
        const view = this.fleetViews[(i + this.simulation.tick) % this.fleetViews.length];
        view.impactMarks.update(this.simulation.events, view.actor.motion.id, impactBudget, () => view.updateArticulation(alpha));
      }
      this.ship.position.copy(this.playerView!.root.position);
      this.ship.quaternion.copy(this.playerView!.root.quaternion);
      this.shellFollow.update(this.simulation.shells, this.simulation.events, state.id, dt);
      this.rig.setShellView(this.followedView(alpha));
      // The optics belong to whichever hull the camera sits on, so a spectator keeps
      // the glasses up after their own ship is gone and loses them when this one sinks.
      if (this.cameraShipView.actor.damage.sunk) this.rig.exitBinoculars();
      if (this.airOperationsOpen) this.battlefieldCamera.update();
      else {
        this.updateSpectator();
        const pose = this.cameraShipView.motion;
        this.rig.setTorpedoView(this.battery === 'torpedo' && !this.definition.submarine && this.cameraShipView === this.playerView);
        // The port camera frames the berth, so it holds still while the hull heaves.
        this.rig.update(pose, pose.y - (this.cameraShipView.seaOffset?.heave ?? 0), realDt);
        if (this.cameraDirector) {
          this.cameraDirector(this.camera, { alpha, dt: realDt });
          this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
        } else if (this.cameraPin) this.pinCamera(this.cameraPin);
      }
      this.battlefieldCamera.applyTransition(realDt);
      this.environment.setShadowFocus(this.waterViewFocus?.update(this.fleetViews, this.camera,
        !this.inPort && !this.airOperationsOpen && !this.battlefieldCamera.transitioning && this.rig.magnification > 1.5));
      this.environment.update(this.camera, dt);
      this.fleetVisibility.update(this.fleetViews, this.camera, this.sunShadows!, this.inPort || warmingUp, this.rig.magnification);
      this.fleetViews.forEach(view => { if (view.renderActive || view === this.playerView) view.updateArticulation(alpha); });
      const showGunAim = !this.inPort && !this.simulation.player.damage.sunk && !this.viewAway && !this.rig.circlingShip;
      this.gunAim.update(showGunAim ? this.playerView!.gunAimPoints(this.battery, aim, this.weaponGroupId) : [], this.camera, showGunAim, realDt, this.playerView!);
      this.hitDirections.update(this.simulation, this.camera, !this.inPort);
      const showTorpedoAim = showGunAim && this.battery === 'torpedo' && this.host?.dataset.shipLabels !== 'false';
      const torpedoAim = showTorpedoAim ? torpedoAimState(this.simulation.player, this.playerView!.motion, aim, this.torpedoContacts(), this.weaponGroupId) : undefined;
      this.torpedoPreview.update(torpedoAim, showTorpedoAim);
      this.torpedoAim.update(torpedoAim, this.camera, showTorpedoAim);
      const torpedoes = this.simulation.torpedoes;
      this.torpedoMarkers.update(torpedoes, torpedoes.length ? this.friendlyShipIds() : NO_SHIPS, this.camera, !this.inPort && !this.inspecting);
      this.inspectionHover?.update(this.inPort && !this.paused && !this.switchingShip ? this.playerView?.inspection : undefined);
      this.fleetViews.forEach(view => {
        view.rig.update(presentationDt, this.ocean!.waves.windSpeed, this.ocean!.waves.windDirection,
          view.root, view.motion, view.actor.damage.sunk, this.camera, !this.inPort);
        view.updateRenderMatrices();
      });
      const emptyBerth = this.inPort && this.berthEmpty;
      this.aircraftView.update(this.simulation, this.camera, !emptyBerth && !this.inspecting && (!this.inPort || this.playerView?.inspection.mode === 'exterior'), this.inPort, new Map(this.fleetViews.map(view => [view.actor.motion.id, view.root])), this.airOperationsOpen ? undefined : this.cameraShipView.actor.motion.id, presentationDt);
      // Labels use the aircraft poses just drawn this frame, including observed smoothing.
      this.cameraFrameListeners.forEach(listener => listener());
      // Own smoke is suppressed for the hull the lens sits on, which is the followed
      // teammate while spectating rather than the player's own ship.
      const opticsShipId = this.rig.binoculars && !this.shellFollow.view ? this.cameraShipView.actor.motion.id : undefined;
      this.effects.update(this.simulation, presentationDt, this.camera, opticsShipId, this.fleetViews);
      this.funnelSmoke.root.visible = !emptyBerth && !this.inspecting && (!this.inPort || this.playerView!.inspection.mode === 'exterior');
      this.funnelSmoke.update(this.inPort ? [this.playerView!] : this.fleetViews, presentationDt, this.camera, opticsShipId);
      if (!warmingUp) this.audio?.update(this.simulation, this.input.order, this.battery,
        this.camera.position.toArray(), new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).toArray(), this.weaponGroupId);
      // Optics sit at the subject's bridge, where its own hull would fill the lens. In
      // port only the player's model is on show, so leave that visibility alone.
      const opticsHull = this.airOperationsOpen || this.battlefieldCamera.transitioning || !this.rig.binoculars ? undefined : this.cameraShipView;
      if (this.inPort) this.playerView!.root.visible = !emptyBerth;
      else this.fleetViews.forEach(view => { view.root.visible = view !== opticsHull; });
      this.harbor?.update(dt, this.camera);
      if (!this.inPort) {
        // A chart that finished loading after the battle began takes the open sea's place.
        if (this.landscapeSource?.terrain !== (this.simulation.terrain ?? OPEN_SEA)) this.refreshLandscape();
        this.landscape?.update(this.camera);
      }
      this.fitSunShadow();
      this.focusNearShadow();
      this.shipWake!.seaHeight = this.ocean!.waves.significantHeight;
      this.shipWake!.update(emptyBerth ? [] : this.inPort ? [this.playerView!] : this.wakeShips(), dt, this.simulation.events, this.camera, this.inPort ? [] : this.simulation.torpedoes);
      this.hullWetBand.update(this.ocean!.waves.significantHeight);
      // The sea reads the opaque ships through the scene pass, so publish batch poses first.
      this.fleetDraws?.update(this.camera, this.renderer.domElement.height, this.detailBudgetPx);
      // Hidden hangar aircraft, LODs and dormant effects must compile against
      // the actual ocean capture and final targets before their first appearance.
      const warmInstances: { mesh: THREE.InstancedMesh; visible: boolean; count?: number }[] = [];
      const restoreAircraftParts = warmingUp ? this.aircraftView.warmupParts() : undefined;
      if (warmingUp) for (const root of [this.effects.root, this.funnelSmoke.root, this.aircraftView.root]) root.traverse(object => {
        if (!(object instanceof THREE.InstancedMesh)) return;
        const geometry = object.geometry as THREE.InstancedBufferGeometry;
        warmInstances.push({ mesh: object, visible: object.visible, count: geometry.instanceCount });
        object.visible = true;
        if (geometry.isInstancedBufferGeometry) geometry.instanceCount = Math.max(1, geometry.instanceCount);
      });
      this.scene.beginFrame();
      try {
        // Ship occlusion first: the ocean pass below draws ship materials too.
        this.occlusion.render(this.renderer, this.scene);
        // A paused frame (dt 0) renders the same waves, foam and wake again. The Water Pro comparison steps
        // asynchronously and renders its capture passes before this frame may.
        this.coupleHullSea(emptyBerth);
        const stepping = this.ocean!.update(dt);
        if (stepping) { await stepping; if (this.disposed) return; }
        this.renderFrame();
        updateWaterShadows(this.ocean!, this.sunShadows!.wide as unknown as THREE.DirectionalLight, this.renderer.reversedDepthBuffer, this.settings.waterShadows, this.cloudShadow);
        if (this.frameWaiters.length) { const waiters = this.frameWaiters; this.frameWaiters = []; waiters.forEach(resolve => resolve()); }
      } finally {
        this.scene.endFrame();
        restoreAircraftParts?.();
        for (const { mesh, visible, count } of warmInstances) {
          mesh.visible = visible;
          if (count !== undefined) (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = count;
        }
      }
      const combatTime = this.simulation.tick * FIXED_DT;
      this.shipLabels.update(this.camera, combatTime, this.simulation.events, this.simulation.ship.id);
      this.hitLabels.update(this.simulation, this.fleetViews, this.camera, !this.inPort && !this.inspecting);
      const damageSubject = this.simulation.actors.find(actor => actor.motion.id === this.spectatedShipId) ?? this.simulation.player;
      if (this.damageFeedbackShipId !== damageSubject.motion.id) {
        this.damageFeedbackShipId = damageSubject.motion.id;
        this.playerDamageFeedback = new HullDamageFeedback(damageSubject.damage.integrity);
      }
      const playerDamage = this.playerDamageFeedback.update(damageSubject.damage.integrity, combatTime);
      if (realDt > 0) this.fps += (1 / realDt - this.fps) * 0.04;
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
          rangefinder: this.canRange ? { ...this.rangefinder.state } : undefined,
          viewBearing: this.rig.bearing, chartSize: this.chartSize, airOperationsOpen: this.airOperationsOpen, selectedFlightId: this.selectedFlightId, selectedFlightIds: [...this.selectedFlightIds],
          fleetCommandMode: this.fleetCommandMode, helmChart: this.helmChart, selectedShipIds: [...this.selectedShipIds], controlledShipId: this.simulation.controlledShipId, helmWheel: this.helmWheel && { ...this.helmWheel }, tacticalPaused: this.tacticalPause, simulationSpeed: this.simulation.simulationSpeed, achievedSpeed: this.simulation.achievedSpeed,
          airMap: this.airOperationsOpen ? { ...this.battlefieldCamera.view } : undefined,
          squadronMarkers: this.simulation.actors.flatMap(actor => (airWingTelemetry(actor, this.simulation.actors)?.groups ?? [])
            .filter(f => f.airborne > 0).map(f => {
              const point = projectShipLabel(new THREE.Vector3(...f.position).add(new THREE.Vector3(0, 24, 0)), this.camera, this.host.clientWidth / this.hudScale, this.host.clientHeight / this.hudScale);
              return { ...f, team: actor.team, ownerId: actor.motion.id, screen: point };
            })),
          shellFollow: this.shellFollow.phase, followedAircraftId: this.followedAircraftId, spectatedShipId: this.spectatedShipId,
          freeCamera: this.rig.freeCamera, freeCameraSpeed: this.rig.freeCameraSpeed, aimLocked: this.aimLocked,
          playerDamage,
          shipDamageOpen: this.shipDamageOpen, inspectedPartId: this.shipDamageOpen ? this.cameraShipView.inspection.selectedId : undefined,
          mapId: this.simulation.mapId, terrain: this.simulation.terrain, fps: Math.round(this.fps), performance: this.performanceReadout(), trail: this.spectatedShipId ? [] : [...this.trail], inspecting: this.inspecting, aimModule: this.manualAim ? 'point' : this.aimModule,
          aimMarker: this.projectAim(aim) });
      }
      if (!warmingUp) this.scheduleFrame();
    } catch (error) {
      if (warmingUp) throw error;
      if (!this.disposed) this.callbacks.error(error instanceof Error ? error.message : String(error));
    }
  }

  get graphics(): GraphicsSettings { return this.settings; }

  applyGraphics(next: GraphicsSettings): void { this.graphicsControl.apply(next); }
  private graphicsController?: GraphicsController;
  /** Applies settings rows to the scene. Built on first use: the constructor already needs it. */
  private get graphicsControl(): GraphicsController {
    const game = this;
    return this.graphicsController ??= new GraphicsController({
      get settings() { return game.settings; }, set settings(value) { game.settings = value; },
      get frameIntervalMs() { return game.frameIntervalMs; }, set frameIntervalMs(value) { game.frameIntervalMs = value; },
      get detailBudgetPx() { return game.detailBudgetPx; }, set detailBudgetPx(value) { game.detailBudgetPx = value; },
      get pipeline() { return game.pipeline; }, set pipeline(value) { game.pipeline = value; },
      get renderer() { return game.renderer; }, get display() { return game.display; }, get scenePass() { return game.scenePass; }, get camera() { return game.camera; }, get ocean() { return game.ocean; }, get sunLight() { return game.sunLight; }, get sky() { return game.sky; }, get occlusion() { return game.occlusion; },
      get aircraftView() { return game.aircraftView; }, get effects() { return game.effects; }, get funnelSmoke() { return game.funnelSmoke; },
      get disposed() { return game.disposed; },
      requestResize() { game.resizePending = true; }, reportError: message => game.callbacks.error(message),
    });
  }

  private performanceReadout(): PerformanceReadout {
    const { width = 0, height = 0 } = this.renderer.domElement;
    const readout: PerformanceReadout = { mode: this.settings.readout, fps: Math.round(this.fps), frameMs: this.fps > 0 ? 1000 / this.fps : 0, width, height };
    const load = this.inPort ? undefined : this.simulation.simulationLoad;
    if (load) readout.simulation = { ...load, speed: this.simulation.simulationSpeed ?? 1, achievedSpeed: this.simulation.achievedSpeed };
    if (this.settings.readout === 'detailed') {
      const draws = this.fleetDraws?.diagnostics(), effects = this.effects.diagnostics();
      readout.detail = { shipInstances: draws?.instances ?? 0, reducedInstances: draws?.reduced ?? 0,
        particles: effects.smoke + effects.spray + effects.flashes + effects.foam, aircraft: this.aircraftView.diagnostics().instances };
    }
    return readout;
  }

  setHudScale(scale: number): void {
    this.hudScale = scale;
    this.resizeHudOverlays();
  }

  private resizeHudOverlays(): void {
    // Overlay projection and collision placement use the same logical space as CSS.
    const width = Math.max(this.host.clientWidth, 1) / this.hudScale;
    const height = Math.max(this.host.clientHeight, 1) / this.hudScale;
    for (const field of PROJECTED_HUD_LAYER_FIELDS) this[field].resize(width, height);
  }

  private resize(): void {
    const width = Math.max(this.host.clientWidth, 1), height = Math.max(this.host.clientHeight, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * this.settings.renderScale / 100);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.ocean?.resize(width, height);
    this.resizeHudOverlays();
    this.aircraftView.resize(height);
    this.sky?.resize(width, height);
    this.resizePending = false;
  }
  private renderFrame(): void {
    const inspection = this.inPort ? this.playerView?.inspection : undefined;
    const armor = !!this.armorOverlay && inspection?.mode === 'armor' && inspection.root.visible;
    this.graphicsControl.suspendTemporal(armor);
    if (!armor) {
      if (this.armorOverlay) this.armorOverlay.enabled.value = 0;
      this.pipeline!.render();
      return;
    }
    this.armorOverlay!.render(this.renderer, this.camera, inspection!.root);
    // Keep the opaque armor out of the ocean/sky pass; composite it once afterward.
    inspection.root.visible = false;
    try { this.pipeline!.render(); }
    finally { inspection!.root.visible = true; }
  }
  setPaused(paused: boolean): void {
    if (paused) { this.inspectionHover?.clear(); this.closeHelmWheel(); }
    this.lastShellPress = undefined;
    this.paused = paused;
    this.audio?.setScene(this.inPort, paused);
    this.updateInputEligibility();
    this.rig.setEnabled(this.controls().rigEnabled);
    this.callbacks.pause(paused);
  }
  capturePointer(): void { if (this.controls().capturePointer) this.rig.capturePointer(); }
  /** Hand the cursor to an overlay panel; `capturePointer` takes it back when the controls allow. */
  releasePointer(): void { this.rig.releasePointer(); }
  /** The end screen of a decided battle: the camera circles the ship it rides until called with `false`. The fleet
   * chart, when open, keeps its own camera. */
  circleShip(on: boolean): void { this.rig.circle(on && !this.inPort && !this.airOperationsOpen); }
  /** Developer console: compare the analytic bow waves against the native wake field alone. */
  toggleBowWaves(): boolean { return this.shipWake?.toggleBowWaves() ?? false; }
  /** Developer console: switch one ocean realism feature to compare it with the look tuned to the replaced library. */
  toggleOceanRealism(feature: keyof OceanRealism): boolean {
    const realism = this.ocean?.realism;
    if (!realism) return false;
    realism[feature] = !realism[feature];
    return realism[feature];
  }
  toggleTacticalPause(): void {
    if (this.inPort || this.simulation.networked || !this.fleetCommandMode || this.simulation.result !== 'active') return;
    this.tacticalPause = !this.tacticalPause;
    this.input.clear();
    this.updateInputEligibility();
  }
  selectFleetShips(ids: string[]): void {
    this.selectedShipIds = [...new Set(ids)].filter(id => this.simulation.actors.some(a => a.motion.id === id && a.team === 'friendly' && !physicalLoss(a)));
  }
  /** Open the fleet chart. Leaving a ship's helm keeps that ship selected so the next order
   * has a recipient; a battle that opens on the chart starts with nothing selected. */
  enterFleetCommand(preselect = true): void {
    if (this.inPort || !this.simulation.releaseHelm) return;
    // A chart read from the helm is already open, and its helm is not given up behind the player's back.
    if (this.helmChart) return;
    this.fleetCommandMode = true;
    this.simulation.releaseHelm();
    if (preselect && !this.selectedShipIds.length) this.selectFleetShips([this.simulation.ship.id]);
    this.setAirOperationsOpen(true);
    this.updateInputEligibility(true);
    this.rig.releasePointer();
  }
  /** Whether this battle can order its fleet from the chart without giving up the helm. */
  get fleetChartAvailable(): boolean {
    return !this.inPort && this.simulation.isBattle && !this.simulation.missionRules && !!this.simulation.selectShip && !!this.simulation.releaseHelm;
  }
  /** Open the fleet chart from the helm. Nothing is preselected: an order to the hull under
   * the player's hand would engage its autopilot, so that has to be a deliberate pick. */
  openFleetChart(): void {
    if (!this.fleetChartAvailable || this.fleetCommandMode || this.paused) return;
    if (this.airOperationsOpen) this.setAirOperationsOpen(false);
    this.closeHelmWheel();
    this.helmChart = true; this.fleetCommandMode = true;
    this.selectFleetShips([]); this.flightSelection = [];
    this.setAirOperationsOpen(true);
    this.updateInputEligibility();
    this.rig.releasePointer();
  }
  /** Back to the helm the chart was opened from, or to the view a sunk helm leaves behind. */
  leaveFleetChart(): void {
    if (!this.helmChart) return;
    // The chart closes while fleet command still owns it, so a ship without aircraft can close it.
    this.setAirOperationsOpen(false);
    this.helmChart = false; this.fleetCommandMode = false; this.tacticalPause = false;
    this.selectedShipIds = []; this.flightSelection = [];
    this.updateInputEligibility();
  }
  followFleetShip(id: string): void {
    if (this.helmChart) { this.leaveFleetChart(); return; }
    if (!this.fleetCommandMode) return;
    const view = this.fleetViews.find(v => v.actor.motion.id === id && this.simulation.actors.some(a => a === v.actor && a.team === 'friendly') && !physicalLoss(v.actor));
    if (!view) return;
    this.simulation.releaseHelm?.();
    // Leave the chart from inside spectateTeammate so the descent it starts is not
    // cancelled; only close it here when the ship is not a spectator candidate.
    this.spectateTeammate(id);
    if (this.airOperationsOpen) this.setAirOperationsOpen(false);
    this.updateInputEligibility(true);
  }
  takeFleetHelm(id: string): void {
    if (!this.fleetCommandMode || !this.simulation.actors.some(a => a.motion.id === id && a.team === 'friendly' && !physicalLoss(a))) return;
    if (this.helmChart) { this.leaveFleetChart(); this.takeHelm(id); return; }
    this.followFleetShip(id);
    this.simulation.selectShip?.(id);
    this.input.clear(); this.input.setOrder(1); this.input.setRudder(0);
  }
  private helmWheelController?: HelmWheelController;
  /** The ship picker held on Tab or offered after a sinking. Built on first use, so a test-assembled Game has one too. */
  private get wheel(): HelmWheelController {
    const game = this;
    return this.helmWheelController ??= new HelmWheelController({
      get simulation() { return game.simulation; }, get rig() { return game.rig; }, get input() { return game.input; },
      get inPort() { return game.inPort; }, get paused() { return game.paused; }, get airOperationsOpen() { return game.airOperationsOpen; },
      get inspecting() { return game.inspecting; }, get fleetCommandMode() { return game.fleetCommandMode; }, get spectatedShipId() { return game.spectatedShipId; },
      get helmWheel() { return game.helmWheel; }, set helmWheel(state) { game.helmWheel = state; },
      takeFleetHelm: id => game.takeFleetHelm(id), spectateTeammate: id => game.spectateTeammate(id),
    });
  }
  get helmCandidates(): FleetActor[] { return this.wheel.candidates; }
  openHelmWheel(reason: HelmWheelState['reason']): void { this.wheel.open(reason); }
  highlightHelmCandidate(id: string | undefined): void { this.wheel.highlight(id); }
  closeHelmWheel(): void { this.wheel.close(); }
  releaseHelmWheel(): void { this.wheel.release(); }
  takeHelm(id: string): void { this.wheel.takeHelm(id); }
  private offerHelmWheel(): void { this.wheel.offer(); }
  launchAircraft(squadronId: string): void {
    const flight = squadronFlights(this.simulation.player).find(f => f.squadronId === squadronId && f.planeIds.every(id => ['ready', 'lost'].includes(this.simulation.aircraft.find(p => p.id === id)?.phase ?? 'lost')));
    if (!this.inPort && !this.paused && this.simulation.launchAircraft(squadronId)) this.selectedFlightId = flight?.id;
  }
  selectFlights(ids: string[]): void {
    const available = new Set((this.fleetCommandMode ? this.simulation.actors.filter(a => a.team === 'friendly') : [this.simulation.player]).flatMap(a => squadronFlights(a).map(f => f.id)));
    this.flightSelection = [...new Set(ids)].filter(id => available.has(id));
  }
  selectFlight(id: string, additive = false): void {
    if (!(this.fleetCommandMode ? this.simulation.actors.filter(a => a.team === 'friendly') : [this.simulation.player]).some(a => squadronFlights(a).some(f => f.id === id))) return;
    const current = this.selectedFlightIds;
    this.selectFlights(additive ? current.includes(id) ? current.filter(value => value !== id) : [...current, id]
      : current.length === 1 && current[0] === id ? [] : [id]);
  }
  commandDeck(id: string, action: DeckServiceAction): boolean { return !this.inPort && (!this.paused || this.fleetCommandMode) && (this.simulation.commandDeck?.(id, action) ?? false); }
  cancelDeckTask(carrierId: string, requestId: number): boolean { return !this.inPort && (!this.paused || this.fleetCommandMode) && (this.simulation.cancelDeckTask?.(carrierId, requestId) ?? false); }
  setDeckPolicy(carrierId: string, policy: DeckPolicy): boolean { return !this.inPort && (!this.paused || this.fleetCommandMode) && (this.simulation.setDeckPolicy?.(carrierId, policy) ?? false); }
  prioritizeDeckTask(carrierId: string, requestId: number): boolean { return !this.inPort && (!this.paused || this.fleetCommandMode) && (this.simulation.prioritizeDeckTask?.(carrierId, requestId) ?? false); }
  orderFlight(id: string, order: AirOrder): boolean { return !this.inPort && (!this.paused || this.fleetCommandMode) && this.simulation.orderFlight(id, order); }
  commandSquadron(id: string, order: AirOrder): boolean { return !this.inPort && (!this.paused || this.fleetCommandMode) && this.simulation.commandSquadron(id, order); }
  private airMapController?: AirMapController;
  /** Chart gestures and projections. Built on first use, so a test-assembled Game has one too. */
  private get airMap(): AirMapController {
    const game = this;
    return this.airMapController ??= new AirMapController({
      get simulation() { return game.simulation; }, get camera() { return game.camera; }, get battlefieldCamera() { return game.battlefieldCamera; },
      get fleetViews() { return game.fleetViews; }, get aircraftView() { return game.aircraftView; }, get observedShipViews() { return game.observedShipViews; },
      get host() { return game.host; }, get canvas() { return game.renderer.domElement; }, get hudScale() { return game.hudScale; },
    });
  }
  panAirMap(dx: number, dy: number, x?: number, y?: number): void { this.airMap.pan(dx, dy, x, y); }
  get mapProjectionStamp(): number { return this.airMap.projectionStamp; }
  projectAirMap(x: number, z: number, altitude = 0): [number, number] | null { return this.airMap.project(x, z, altitude); }
  projectFleetShip(id: string): [number, number] | null { return this.airMap.projectFleetShip(id); }
  /** Hostile hulls the sight can lead: simulated enemies afloat and fresh reports of the rest. */
  private torpedoContacts(): LeadContact[] {
    const { player, actors, observedShips, observationTracks, tick } = this.simulation;
    const sinking = new Set((observationTracks ?? []).filter(track => track.visibleCondition?.sinking).map(track => track.id));
    return [
      ...actors.filter(actor => actor.team !== player.team && !actor.damage.sunk).map(actor => ({ id: actor.motion.id, position: [actor.motion.x, 0, actor.motion.z] as Vec3, velocity: shipVelocity(actor), lengthM: actor.definition.hull.length })),
      ...(observedShips ?? []).filter(report => tick - report.observedTick <= 60 && !sinking.has(report.id)).map(report => ({ id: report.id, position: report.position, velocity: report.velocity })),
    ];
  }
  private friendlyShipIds(): Set<string> {
    const team = this.simulation.player.team;
    return new Set(this.simulation.actors.filter(actor => actor.team === team).map(actor => actor.motion.id));
  }
  /** Enemy hulls in a PvE battle are reports, not actors: they carry the chart's
   * name for the contact and the observed hull fraction while the sighting is fresh. */
  private observedLabelReports(): ObservedLabelReport[] {
    const reports = this.simulation.observedShips;
    if (!reports?.length) return [];
    const tick = this.simulation.tick;
    const tracks = new Map((this.simulation.observationTracks ?? []).map(track => [track.id, track]));
    return reports.map(report => {
      const track = tracks.get(report.id);
      const fresh = Number.isFinite(report.health) && tick - report.observedTick <= 60;
      return { id: report.id, name: track ? reportName(track) : 'Surface contact', health: fresh ? report.health : undefined, sunk: !!track?.visibleCondition?.sinking };
    });
  }
  projectContact(id: string): [number, number] | null { return this.airMap.projectContact(id); }
  projectContactGroup(ids: string[]): [number, number] | null { return this.airMap.projectContactGroup(ids); }
  projectAircraft(id: string): [number, number] | null { return this.airMap.projectAircraft(id); }
  projectAirMapPath(points: Vec3[], closed = false, filled = false): string { return this.airMap.projectPath(points, closed, filled); }
  projectSquadron(ownerId: string, flightId: string): { x: number; y: number } | null { return this.airMap.projectSquadron(ownerId, flightId); }
  airMapWater(x: number, y: number): [number, number] | undefined { return this.airMap.waterAt(x, y); }
  zoomAirMap(delta: number, x?: number, y?: number): void { this.airMap.zoom(delta, x, y); }
  fitAirMap(): void { this.airMap.fit(); }
  centerAirMap(): void { this.airMap.center(); }
  centerAirMapOn(x: number, z: number): void { this.airMap.centerOn(x, z); }
  orbitAirMap(dx: number, dy: number): void { this.airMap.orbit(dx, dy); }
  setAirMapTilt(degrees: number): void { this.airMap.setTilt(degrees); }
  resetAirMapAngle(): void { this.airMap.resetAngle(); }
  setAirOperationsOpen(open: boolean): void {
    if (this.inPort || (!this.fleetCommandMode && ((open && (this.simulation.player.damage.sunk || this.paused)) || !this.simulation.player.airWing))) return;
    if (open === this.airOperationsOpen) return;
    this.battlefieldCamera.beginTransition(typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    this.airOperationsOpen = open;
    this.input.clear();
    if (open) {
      if (this.inspecting) this.closeInspection();
      this.endFollow(); this.rig.setEnabled(this.controls().rigEnabled);
      this.battlefieldCamera.enter(this.airMap.reportedPoints(), this.host.clientWidth, this.host.clientHeight);
      if (!this.fleetCommandMode) this.selectedFlightId ??= squadronFlights(this.simulation.player)[0]?.id;
      // The map raises camera.far; the horizon ring grows once and keeps that reach.
      this.ocean?.ensureHorizon(this.camera.far);
      this.environment.setChartFog(true);
    } else {
      this.battlefieldCamera.exit();
      this.environment.setChartFog(false);
      this.rig.update(this.playerView?.motion ?? this.simulation.ship, this.simulation.ship.y, 0, true);
      // Closing the map from the pause menu keeps the rig idle until play resumes.
      this.rig.setEnabled(this.controls().rigEnabled);
      if (this.controls().captureAfterChart) this.rig.capturePointer();
    }
    this.battlefieldCamera.applyTransition(0);
  }
  followAircraft(id: string): void {
    const carriers = this.fleetCommandMode ? this.simulation.actors.filter(a => a.team === this.simulation.player.team) : [this.simulation.player];
    if ((!this.fleetCommandMode && this.simulation.player.damage.sunk) || this.inPort || this.inspecting || !carriers.some(a => a.airWing?.planes.some(p => p.id === id && !['lost', 'withdrawn'].includes(p.phase) && (airborne(p) || onFlightDeck(p))))) return;
    this.endFollow();
    if (this.airOperationsOpen) this.setAirOperationsOpen(false);
    this.followedAircraftId = id;
  }
  /** Snapshot at the point of use: camera transitions and frame ordering stay here. */
  private controls(inputSuspended = false) {
    return controlEligibility({
      paused: !!this.paused, tacticalPause: !!this.tacticalPause, inPort: !!this.inPort,
      waterReady: !!this.ocean, fleetCommand: !!this.fleetCommandMode,
      // Before the port session arrives there is no helm and nothing has sunk.
      hasHelm: !!this.simulation?.controlledShipId, sunk: !!this.simulation?.player.damage.sunk,
      chartOpen: !!this.airOperationsOpen, chartTransitioning: !!this.battlefieldCamera?.transitioning,
      inspecting: !!this.inspecting, shellFollow: !!this.shellFollow?.view, aircraftFollow: !!this.followedAircraftId,
      freeCamera: !!this.rig?.freeCamera,
    }, inputSuspended);
  }
  /** Loading and a pending helm release can suspend input before session state catches up. */
  private updateInputEligibility(suspended = false): void {
    this.input.setEnabled(this.controls(suspended).inputEnabled, this.helmChart);
  }
  private get viewAway(): boolean { return this.controls().viewAway; }
  private get gunsCommandable(): boolean { return this.controls().gunsCommandable; }
  /** The presentation-only target the rig follows this frame. A followed aircraft
   * that is lost or leaves the visible phases ends its follow here. */
  private followedView(alpha: number): ShellView | undefined {
    const plane = this.simulation.aircraft.find(p => p.id === this.followedAircraftId && !['lost', 'withdrawn'].includes(p.phase));
    const carrier = plane && this.fleetViews.find(v => v.actor.motion.id === plane.ownerId);
    const owner = plane && this.simulation.actors.find(a => a.motion.id === plane.ownerId);
    const view = plane && carrier && owner ? aircraftFollowView(plane, owner, carrier.motion, alpha) : undefined;
    if (this.followedAircraftId && !view) this.endFollow();
    return view ?? this.shellFollow.view;
  }
  /** Instruments follow the spectator without transferring control of the actor. */
  private shipTelemetry(aim: Vec3) {
    const subject = this.spectatedShipId
      ? this.simulation.actors.find(actor => actor.motion.id === this.spectatedShipId) ?? this.simulation.player
      : this.simulation.player;
    const spectating = subject !== this.simulation.player || (this.fleetCommandMode && this.simulation.controlledShipId !== subject.motion.id);
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
  /** Every hull on the water leaves a wake: the fleet's views and the reported
   * enemy exteriors. The camera's hull leads so the swell solver centres on it. */
  /** Around every drawn hull the water shows the sea it rides: the battle's combat sea at the time its poses are drawn
   * (paused and tactical-paused frames hold it), or the berth's in port. Presentation only. */
  private coupleHullSea(emptyBerth: boolean): void {
    const sea = this.inPort ? this.berthRidden : this.simulation.sea;
    if (!sea || emptyBerth) { this.ocean!.setHullSea([], 0, []); return; }
    const time = this.inPort ? this.berthMotion.seaTime : this.simulation.presentationTime ?? this.simulation.tick / 60;
    const ships = this.inPort ? [this.playerView!] : this.wakeShips();
    this.ocean!.setHullSea(seaWaves(sea), time, hullFootprints(ships, { x: this.camera.position.x, z: this.camera.position.z }, sea.amplitudeM));
  }
  private wakeShips(): WakeShip[] {
    const focus = this.cameraShipView;
    return [focus, ...this.fleetViews.filter(view => view !== focus), ...this.observedShipViews?.wakeShips() ?? []];
  }
  private get cameraShipView(): ShipView {
    return this.fleetViews.find(view => view.actor.motion.id === this.damageInspectionShipId)
      ?? this.fleetViews.find(view => view.actor.motion.id === this.spectatedShipId)
      ?? (this.inspecting ? this.targetView! : this.playerView!);
  }
  private spectatorController?: SpectatorController;
  /** Which friendly hull the camera rides without the helm. Built on first use, so a test-assembled Game has one too. */
  private get spectator(): SpectatorController {
    const game = this;
    return this.spectatorController ??= new SpectatorController({
      get simulation() { return game.simulation; }, get definition() { return game.definition; }, get fleetViews() { return game.fleetViews; },
      get rig() { return game.rig; }, get input() { return game.input; }, get battlefieldCamera() { return game.battlefieldCamera; },
      get inPort() { return game.inPort; }, get fleetCommandMode() { return game.fleetCommandMode; }, get airOperationsOpen() { return game.airOperationsOpen; },
      get inspecting() { return game.inspecting; }, get followingAircraft() { return !!game.followedAircraftId; },
      get spectatedShipId() { return game.spectatedShipId; }, set spectatedShipId(id) { game.spectatedShipId = id; },
      controls: () => game.controls(), enterFleetCommand: () => game.enterFleetCommand(), offerHelmWheel: () => game.offerHelmWheel(),
      setAirOperationsOpen: open => game.setAirOperationsOpen(open), inspectTarget: () => game.closeInspection(), endFollow: () => game.endFollow(),
    });
  }
  private updateSpectator(): void { this.spectator.update(); }
  spectateTeammate(id: string): void { this.spectator.spectate(id); }
  cycleSpectator(direction: number): void { this.spectator.cycle(direction); }
  returnToShip(): void { this.endFollow(); }
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
      (type === 'ap' || mount.weapon.he) && availableAmmunition(this.simulation.player.mounts[i], type) >= mount.weapon.barrelCount);
    if (!available) return;
    this.ammunition[this.weaponGroupId ?? this.battery] = type;
    this.simulation.orderAmmunition(this.battery, type, immediate, this.weaponGroupId);
  }
  recallAircraft(flightId?: string): void { if (!this.inPort && !this.paused) this.simulation.recallAircraft(flightId); }
  setDepth(depthM: number, emergency = false): void {
    if (this.inPort || this.paused || this.simulation.player.damage.sunk) return;
    this.simulation.setDepth?.(depthM, emergency);
  }
  /** 1× → 2× → 4× → 1×. The session refuses the change outside an active PvE battle. */
  cycleSimulationSpeed(): void {
    if (this.inPort || this.simulation.networked || !this.simulation.setSimulationSpeed) return;
    const speeds = [1, 2, 4] as const;
    this.simulation.setSimulationSpeed(speeds[(speeds.indexOf(this.simulation.simulationSpeed ?? 1) + 1) % speeds.length]);
  }
  resizeChart(direction: number): void { if (this.airOperationsOpen) { this.zoomAirMap(-direction * 220); return; } this.chartSize = THREE.MathUtils.clamp(this.chartSize + direction, 0, 4); }
  togglePeriscope(): void {
    if (!this.definition.submarine || this.simulation.player.damage.sunk) return;
    this.toggleBinoculars();
  }
  /** Raise or lower the glasses on whichever hull carries the camera. A spectator following
   * a teammate has no sight to aim, so the lens opens along the bearing already being viewed. */
  toggleBinoculars(): void {
    if (this.paused || this.inPort || this.inspecting || this.airOperationsOpen) return;
    if (this.shellFollow.view || this.followedAircraftId || this.rig.freeCamera) { this.endFollow(); return; }
    const spectated = this.spectatedShipId ? this.cameraShipView : undefined;
    if ((spectated?.actor ?? this.simulation.player).damage.sunk) return;
    const definition = spectated?.definition ?? this.definition;
    const ship = spectated?.motion ?? this.simulation.ship;
    const bearing = this.rig.bearing;
    const range = (definition.torpedoTubes?.[0]?.weapon.rangeM ?? 5000) * .98;
    const alongBearing = (): Vec3 => [ship.x + Math.sin(bearing) * range, .5, ship.z - Math.cos(bearing) * range];
    let aim = spectated ? alongBearing() : this.manualAim ? this.readSightAim() : this.currentAim;
    if (!spectated && !this.rig.binoculars && definition.submarine && hullDepth(ship) > .5) {
      const ahead = (aim[0] - ship.x) * Math.sin(bearing) - (aim[2] - ship.z) * Math.cos(bearing);
      // During a shallow dive the chase sight can meet the sea over our own
      // stern. Moving to the scope would turn around to keep that point in view.
      // Continue along the viewing bearing, including deliberate stern aiming.
      if (ahead < definition.hull.length) aim = alongBearing();
    }
    this.rig.toggleBinoculars(aim, ship);
  }
  private readSightAim(): Vec3 {
    const lockedAim = this.rig.rangeAim;
    if (lockedAim && (this.battery === 'main' || this.battery === 'secondary')) return lockedAim;
    const aim = sightAim(this.camera.position.toArray(), this.camera.getWorldDirection(new THREE.Vector3()).toArray(),
      this.simulation.actors.filter(actor => actor !== this.simulation.player && actor.motion.y > -40).map(actor => ({ pose: actor.motion, armor: actor.definition.armor, definition: actor.definition, trains: actor.mounts.map(m => m.train) })));
    const tube = this.definition.torpedoTubes?.find(t => selectedWeapon('torpedo', t.weapon, this.battery, this.weaponGroupId));
    if (this.battery !== 'torpedo' || !tube) return aim;
    return (this.camera.position.y < 0 ? torpedoCourseAim : torpedoBearingAim)(aim, this.simulation.ship, tube.weapon.rangeM);
  }
  private rangefindingController?: RangefindingController;
  /** The binocular rangefinder. Built on first use, so a test-assembled Game has one too. */
  private get rangefinding(): RangefindingController {
    const game = this;
    return this.rangefindingController ??= new RangefindingController({
      get simulation() { return game.simulation; }, get camera() { return game.camera; }, get rig() { return game.rig; }, get host() { return game.host; },
      get observedShipViews() { return game.observedShipViews; }, get playerMotion() { return game.playerView?.motion; },
      get inPort() { return game.inPort; }, get viewAway() { return game.viewAway; }, get battery() { return game.battery; },
      get ordersBlocked() { return !!(game.paused || game.tacticalPause || game.helmWheel); },
      takeManualAim() { game.manualAim = true; },
    });
  }
  private get rangefinder(): Rangefinder { return this.rangefinding.rangefinder; }
  private get canRange(): boolean { return this.rangefinding.canRange; }
  private resetRangefinding(): void { this.rangefinding.reset(); }
  /** Read by Game.test.ts. */
  private rangeTargets(): RangeTarget[] { return this.rangefinding.targets(); }
  measureRange(): void { this.rangefinding.measure(); }
  toggleRangeLock(): void { this.rangefinding.toggleLock(); }
  private updateRangefinding(seconds: number): void { this.rangefinding.update(seconds); }
  /** Hide the berthed ship while the port has no player design to show. Battles are unaffected. */
  setPortBerthEmpty(empty: boolean): void { this.berthEmpty = empty; }
  /** A port request made before the port session arrived; applied by `initialize`. */
  private deferredPort?: boolean;
  setInPort(inPort: boolean): void {
    if (!this.simulation) { this.deferredPort = inPort; return; }
    this.resetRangefinding();
    this.inspectionHover?.clear();
    // Cancel pending previews even when their first result has not arrived yet.
    this.restoreArticulation();
    if (!inPort && this.switchingShip) return;
    this.endFollow();
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
    // A battle's land lives as long as its battle; the port has its own harbor.
    if (inPort) this.disposeLandscape(); else this.refreshLandscape();
    if (this.harbor) this.harbor.visible = inPort;
    this.fleetViews.forEach(view => { view.root.visible = view === this.playerView || !inPort; view.inspect(false); });
    this.inspecting = false; this.damageInspectionShipId = undefined; this.targetView?.inspect(false); this.playerView?.inspect(false);
    this.rig.setInspecting(false);
    this.manualAim = true;
    this.airOperationsOpen = false; this.selectedFlightId = undefined;
    this.environment.setScene(this.simulation.mapId, inPort);
    this.input.setOrder(1); this.input.setRudder(0);
    if (inPort) {
      this.controlPriority = 'balanced'; this.controlFocus = '';
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
      if (!this.simulation.isBattle) this.simulation.ship.x = 0;
      this.trail = [{ x: this.simulation.ship.x, z: this.simulation.ship.z }];
    }
    this.fleetViews.forEach(view => view.snap());
    this.setPaused(false);
    if (leavingPort) {
      this.audio?.departure();
      this.currentAim = this.simulation.aimAt(this.aimModule, this.battery, this.weaponGroupId);
      this.rig.aimAt(this.currentAim, this.simulation.ship);
      if (this.simulation.missionRules) this.enterFleetCommand(false);
      else this.rig.capturePointer();
    }
    this.renderer.domElement.setAttribute('aria-label', `${this.definition.name} ocean scene. ${inPort ? 'Drag to orbit; scroll to zoom.' : 'Click to capture mouse. Mouse to aim; left mouse to fire; Shift for binoculars; Control for cursor; Escape to pause.'}`);
  }
  fire(): void { if (this.gunsCommandable && !this.paused && !this.inPort && this.playerView) this.simulation.requestFire(); }
  toggleShellFollow(): void {
    if (this.simulation.player.damage.sunk || this.paused || this.inPort || this.inspecting || this.airOperationsOpen) return;
    if (this.shellFollow.enabled) { this.endFollow(); return; }
    this.endFollow();
    this.shellFollow.setEnabled(true);
  }
  /** Leave the ship and fly the view freely. The ship keeps her engine, rudder and gun orders;
   * the helm keys steer the camera until the view returns. */
  toggleFreeCamera(): void {
    if (this.rig.freeCamera) { this.endFollow(); return; }
    if (this.paused || this.inPort || this.inspecting || this.airOperationsOpen || this.battlefieldCamera.transitioning) return;
    this.endFollow();
    this.rig.setFreeCamera(true); this.input.setFlying(true);
  }
  /** Right mouse held: the guns stay on the point they have while the sight looks around.
   * Letting go brings the sight back onto that point. */
  private setAimLock(held: boolean): void {
    if (held === this.aimLocked) return;
    const sighting = this.manualAim && !this.viewAway && !this.spectatedShipId && !this.simulation.player.damage.sunk;
    if (held && !sighting) return;
    this.aimLocked = held;
    if (!held && sighting) this.rig.aimAt(this.currentAim, this.simulation.ship);
  }
  /** End any shell or aircraft follow or free flight and snap the camera back onto the focused hull;
   * the rig restores the optics it saved when the follow began. */
  private endFollow(): void {
    this.followedAircraftId = undefined;
    this.shellFollow.setEnabled(false);
    this.rig.setShellView();
    this.rig.setFreeCamera(false);
    const focus = this.cameraShipView?.motion;
    if (focus) this.rig.update(focus, focus.y, 0, true);
  }
  /** Port model view; `selected` isolates one volume or a whole armor zone, equipment group or space. */
  setPortInspection(mode: InspectionMode, selected?: string | readonly string[]): void {
    this.inspectionHover?.clear();
    if (this.inPort) this.playerView?.setInspection(mode, selected);
  }
  subscribeInspectionHover(listener: (hover: InspectionHoverInfo | null) => void): () => void {
    return this.inspectionHover.subscribe(listener);
  }
  selectAim(moduleId: string): void { this.resetRangefinding(); this.endFollow(); this.manualAim = moduleId === 'point'; this.aimModule = moduleId; }
  /** Live X-ray of the ship whose condition the helm HUD reports; never the enemy target. */
  toggleShipDamage(): void {
    if (this.inPort || this.paused || this.switchingShip || !this.playerView) return;
    if (this.shipDamageOpen) { this.closeInspection(); return; }
    if (this.airOperationsOpen || this.battlefieldCamera?.transitioning) return;
    const view = this.fleetViews.find(view => view.actor.motion.id === this.spectatedShipId) ?? this.playerView;
    if (view.actor.damage.sunk) return;
    if (this.inspecting) this.closeInspection();
    this.closeHelmWheel(); this.endFollow(); this.input.clear(); this.setAimLock(false);
    this.damageInspectionShipId = view.actor.motion.id;
    this.inspecting = true;
    view.setInspection('damage');
    this.rig.setHullLength(view.definition.hull.length);
    this.rig.setInspecting(true);
  }
  inspectShipPart(id?: string): void {
    if (!this.shipDamageOpen) return;
    this.cameraShipView.setInspection('damage', id);
  }
  private closeInspection(): void {
    this.inspectionHover?.clear();
    this.fleetViews.forEach(view => view.inspect(false));
    this.inspecting = false; this.damageInspectionShipId = undefined;
    const view = this.cameraShipView;
    this.rig.setHullLength(view.definition.hull.length);
    this.rig.setInspecting(false);
    this.input.clear();
    if (!this.spectatedShipId && !this.simulation.player.damage.sunk) this.rig.aimAt(this.currentAim, this.simulation.ship);
    if (!this.paused && !this.airOperationsOpen && !this.simulation.player.damage.sunk) this.rig.capturePointer();
  }
  inspectTarget(): void {
    if (this.inspecting) { this.closeInspection(); return; }
    const target = this.simulation.target;
    if (!target) return;
    if (this.simulation.player.damage.sunk && !this.inspecting) return;
    this.endFollow();
    this.inspecting = !this.inspecting;
    this.targetView?.inspect(this.inspecting);
    this.rig.setHullLength((this.inspecting ? target.definition : this.definition).hull.length);
    this.rig.setInspecting(this.inspecting);
    if (!this.inspecting && !this.simulation.player.damage.sunk) this.rig.aimAt(this.currentAim, this.simulation.ship);
  }
  selectTarget(id: string): void {
    if (!this.simulation.selectTarget(id)) return;
    this.resetRangefinding();
    this.endFollow();
    this.targetView?.inspect(false);
    this.targetView = this.fleetViews.find(view => view.actor === this.simulation.target);
    this.targetView?.inspect(this.inspecting && !this.shipDamageOpen);
    if (!this.simulation.target && !this.shipDamageOpen) { this.inspecting = false; this.rig.setInspecting(false); }
    if (this.inspecting && !this.shipDamageOpen && this.simulation.target) this.rig.setHullLength(this.simulation.target.definition.hull.length);
    this.aimModule = ''; this.manualAim = false;
    this.currentAim = this.simulation.aimAt('', this.battery, this.weaponGroupId);
    if (!this.inspecting && !this.simulation.player.damage.sunk) this.rig.aimAt(this.currentAim, this.simulation.ship);
  }
  private articulationController?: ArticulationPreviewController<ReturnType<Game['diagnostics']>>;
  /** Development-only joint-limit review of the berthed ship. Built on first use, so a test-assembled Game has one too. */
  private get articulation() {
    const game = this;
    return this.articulationController ??= new ArticulationPreviewController({
      get simulation() { return game.simulation; }, get definition() { return game.definition; }, get playerView() { return game.playerView; },
      get inPort() { return game.inPort; }, get disposed() { return game.disposed; },
      get resolver() { return game.articulationResolver; }, set resolver(value) { game.articulationResolver = value; },
      diagnostics: () => game.diagnostics(),
    });
  }
  private restoreArticulation(): void { this.articulation.restore(); }
  /** Development-only port inspection of the loaded model at catalog joint limits. */
  previewArticulation(pose: ArticulationPreview | null) { return this.articulation.preview(pose); }
  diagnostics() {
    return { mapId: this.simulation.mapId ?? DEFAULT_MAP, oceanRenderer: this.launchedGraphics?.oceanRenderer,
      ...this.environment.diagnostics(),
      terrain: this.terrainDiagnostics(), shipId: this.definition.id, contentHash: this.definition.contentHash,
      camera: { mode: this.rig.mode, binoculars: this.rig.binoculars, magnification: this.rig.magnification, fov: this.camera.fov,
        shellFollow: this.shellFollow.phase, followedAircraftId: this.followedAircraftId, spectatedShipId: this.spectatedShipId, followedShellId: this.shellFollow.shellId,
        freeCamera: this.rig.freeCamera, aimLocked: this.aimLocked,
        pointerLocked: this.rig.pointerLocked, position: this.camera.position.toArray(), aim: this.currentAim, manualAim: this.manualAim,
        projectionMatrix: this.camera.projectionMatrix.toArray(), matrixWorldInverse: this.camera.matrixWorldInverse.toArray() },
      network: { online: !!this.simulation.networked, phase: this.simulation.phase, status: this.simulation.connectionStatus, epoch: this.simulation instanceof RemoteBattleSession ? this.simulation.metadata.connectionEpoch : undefined },
      tick: this.simulation.tick, battleSeed: this.simulation.seed, paused: this.paused, fps: this.fps, inspecting: this.inspecting, inPort: this.inPort,
      simulationSpeed: this.simulation.simulationSpeed ?? 1, tacticalPaused: this.tacticalPause,
      fleetOrders: this.simulation.fleetOrders, observationTracks: this.simulation.observationTracks,
      reconCoverage: this.simulation.reconCoverage,
      effects: this.effects.diagnostics(),
      funnelSmoke: this.funnelSmoke.diagnostics(),
      wakeFoam: this.shipWake?.diagnostics(),
      shipRigs: this.fleetViews.map(view => ({ shipId: view.actor.motion.id, ...view.rig.diagnostics() })),
      audio: this.audio?.diagnostics(),
      portInspection: this.playerView?.inspection.mode, selectedVolume: this.playerView?.inspection.selectedIds.values().next().value, selectedVolumes: this.playerView?.inspection.selectedIds.size ?? 0, hoveredVolume: this.playerView?.inspection.hoveredId,
      maxMuzzleErrorM: Math.max(0, ...this.fleetViews.flatMap(view => view.muzzleErrors())),
      maxTorpedoMuzzleErrorM: Math.max(0, ...this.fleetViews.flatMap(view => view.torpedoMuzzleErrors())),
      torpedoLaunchers: this.simulation.player.torpedoLaunchers,
      depthCharges: this.simulation.depthCharges.map(c => ({ id: c.id, ownerId: c.ownerId, position: [...c.position], submerged: c.submerged, detonationDepthM: c.weapon.detonationDepthM })),
      combat: this.simulation.telemetry(this.battery, this.currentAim, this.weaponGroupId),
      fleet: this.simulation.actors.map(actor => ({ id: actor.motion.id, definitionId: actor.definition.id, team: actor.team, controller: actor.controller, aiLevel: actor.bot?.aiLevel, targetId: actor.targetId, motion: { ...actor.motion }, submarine: actor.submarine ? { ...actor.submarine } : undefined, ammo: actor.mounts.reduce((n, m) => n + m.ammo, 0), integrity: actor.damage.integrity,
        construction: actor.definition.construction ? { massKg: actor.definition.hull.massKg, loading: actor.definition.loading,
          compartments: structuredClone(actor.damage.compartments), modules: structuredClone(actor.damage.modules), stability: { ...actor.damage.stability }, mounts: structuredClone(actor.mounts) } : undefined })),
      renderedShips: this.fleetViews.map(view => ({ id: view.actor.motion.id, visible: view.root.visible,
        impactMarks: view.impactMarks.count, impactDrawCalls: view.impactMarks.drawCalls })),
      renderedAircraft: this.aircraftView.diagnostics(),
      aircraft: this.simulation.aircraft.map(p => ({ ...p, position: [...p.position] })),
      airReleases: this.simulation.airReleases.map(p => ({ ...p })),
      torpedoes: this.simulation.torpedoes.map(t => ({ id: t.id, ownerId: t.ownerId, tubeId: t.tubeId, position: [...t.position], distance: t.distance, armed: t.distance >= (t.weapon.armingDistanceM ?? 0) })),
      events: this.simulation.events.slice(-20) };
  }
  private projectAim(aim: Vec3): { x: number; y: number; visible: boolean } {
    const point = new THREE.Vector3(...aim);
    // Clip depth does not tell ahead from astern under reversed depth; view space does.
    const ahead = point.clone().applyMatrix4(this.camera.matrixWorldInverse).z < 0;
    point.project(this.camera);
    return { x: (point.x + 1) * 50, y: (1 - point.y) * 50, visible: ahead && Math.abs(point.x) < .94 && Math.abs(point.y) < .85 };
  }
  /** Build the battle's land for its map and placement, and hand the camera the same surface to keep clear of. */
  private refreshLandscape(): void {
    const mapId = this.simulation.mapId ?? DEFAULT_MAP, terrain = this.simulation.terrain ?? OPEN_SEA, quality = this.settings.terrain;
    const built = this.landscapeSource;
    if (!built || built.mapId !== mapId || built.quality !== quality || built.terrain.field !== terrain.field
      || built.terrain.offset[0] !== terrain.offset[0] || built.terrain.offset[1] !== terrain.offset[1]) {
      this.disposeLandscape();
      if (terrain.field) {
        this.landscape = createBattleLandscape(oceanMap(mapId), terrain, quality);
        this.scene.add(this.landscape.root);
      }
    }
    this.landscapeSource = { mapId, terrain, quality };
    this.rig.setBattleTerrain((x, z) => terrainHeight(terrain, x, z));
  }
  private disposeLandscape(): void {
    this.landscape?.root.removeFromParent();
    this.landscape?.dispose();
    this.landscape = this.landscapeSource = undefined;
    this.rig?.setBattleTerrain(() => 0);
  }
  /** What the battle's land is, without its samples. */
  private terrainDiagnostics() {
    const terrain = this.simulation.terrain ?? OPEN_SEA, id = mapTerrainId(this.simulation.mapId ?? DEFAULT_MAP);
    return { id, offset: [...terrain.offset], charted: !id || !!terrain.field, bounds: terrain.field?.bounds(), rendered: !!this.landscape };
  }
  cycleCamera(): void { if (this.airOperationsOpen) { this.setAirOperationsOpen(false); return; } const aircraft = !!this.followedAircraftId; this.endFollow(); if (!aircraft) this.rig.cycle(); }
  recenter(): void { if (this.airOperationsOpen) { this.centerAirMap(); return; } this.endFollow(); this.rig.recenter(); }
  fullscreen(): void {
    const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    action?.catch(() => { /* Browsers may decline fullscreen; sailing remains available. */ });
  }

  async dispose(): Promise<void> {
    this.articulationResolver?.dispose();
    this.simulation.dispose?.();
    this.disposed = true;
    this.audio?.dispose();
    cancelAnimationFrame(this.raf);
    const waiters = this.frameWaiters; this.frameWaiters = []; waiters.forEach(resolve => resolve());
    this.abort.abort(); this.observer.disconnect(); this.input.dispose(); this.rig.dispose();
    this.inspectionHover.dispose();
    this.shipLabels.dispose();
    this.hitLabels.dispose();
    this.torpedoPreview.dispose();
    this.gunAim.dispose();
    this.torpedoAim.dispose();
    this.torpedoMarkers.dispose();
    this.hitDirections.dispose();
    await this.initialization;
    await this.frameTask;
    this.fleetDraws?.dispose();
    this.observedShipViews?.dispose();
    this.fleetViews.forEach(view => { view.impactMarks.dispose(); view.rig.dispose(); });
    this.pipeline?.dispose();
    this.graphicsController?.dispose();
    this.display?.dispose();
    this.scenePass?.dispose();
    this.occlusion.dispose();
    this.armorOverlay?.dispose();
    this.shipWake?.dispose();
    await this.aircraftView.dispose();
    this.disposeLandscape();
    this.effects.dispose();
    this.funnelSmoke.dispose();
    this.effectLighting.dispose();
    await this.ocean?.dispose();
    this.sunShadows?.dispose();
    this.shadowCasters?.dispose();
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
    // A model loaded after unmount may not have reached scene.add yet, and a kept hull from
    // an earlier fleet is in neither the scene nor the current one.
    for (const model of new Set([...this.fleetModels, ...this.hulls.values(), this.loadedModel ?? this.ship])) model.traverse(object => {
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
    this.hulls.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
