import { HeadlessSession } from '../../scripts/multiplayer/headless-session';
import { LocalBattleSession } from './session/LocalBattleSession';
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadShipJoints } from '../../scripts/diagnostics/load-ship-joints';
import { briefingControlGroups, Game } from './Game';
import { makeTestBattlefieldCamera, makeTestEnvironment, makeTestInput } from './testing/fakes';
import type { ClearancePose, ClearanceResult } from './articulationPreview';
import { VisualEnvironment } from './VisualEnvironment';
import { CameraRig } from './CameraRig';
import { ShellFollow } from './ShellFollow';
import { BattlefieldCamera } from './BattlefieldCamera';
import { fleetDesk } from '../ui/fleet/fleetDesk';
import { ShipView } from './ShipView';
import { ObservedShipViews } from './ObservedShipViews';
import { ShipMaterialPalette } from './ShipMaterialPalette';
import { shipPreset, shipPresets } from '../ships/presets';
import * as ShipDetail from './ShipDetail';
import pveRules from '../../assets/gameplay/pve-mission.v1.json';
import type { MissionRules } from '../multiplayer/generated/MissionRules';
import initConstruction, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult } from '../ships/blueprint';
import { createStarterSource } from '../ships/constructionStarter';
import { registerLocalShip, removeLocalShip } from '../ships/localShips';

// Camera controls now also listen for pointer-lock and focus changes.
const browserNames = ['window', 'document'] as const;
let browserGlobals: (PropertyDescriptor | undefined)[];
let localFactory: ReturnType<typeof spyOn>, portFactory: ReturnType<typeof spyOn>;
beforeEach(() => {
  localFactory = spyOn(LocalBattleSession, 'create').mockImplementation(async setup => await HeadlessSession.create(setup) as unknown as LocalBattleSession);
  portFactory = spyOn(LocalBattleSession, 'port').mockImplementation(async (definition, revision) => await HeadlessSession.port(definition, revision) as unknown as LocalBattleSession);
  browserGlobals = browserNames.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  browserNames.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: new EventTarget() }));
});
afterEach(() => {
  localFactory.mockRestore(); portFactory.mockRestore();
  browserNames.forEach((name, i) => {
    if (browserGlobals[i]) Object.defineProperty(globalThis, name, browserGlobals[i]!);
    else Reflect.deleteProperty(globalThis, name);
  });
});

const model = loadShipJoints;

test('rangefinding uses a visible ship and feeds locked range into the real gun aim path', async () => {
  const simulation = await HeadlessSession.create({ playerShipId: 'bismarck', friendlyBots: [], enemies: ['bismarck'], spawnDistance: 18000 });
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000), canvas = Object.assign(new EventTarget(), { setPointerCapture() {} });
  const rig = new CameraRig(camera, canvas as unknown as HTMLCanvasElement);
  const target = simulation.target!;
  rig.toggleBinoculars([target.motion.x, .5, target.motion.z], simulation.ship);
  rig.update(simulation.ship, simulation.ship.y, 0, true);
  const game = Object.assign(Object.create(Game.prototype), { simulation, camera, rig, definition: simulation.definition,
    host: { clientWidth: 1440, clientHeight: 810 }, battery: 'main', manualAim: true, shellFollow: new ShellFollow(), inPort: false,
  }) as Game;
  const runtime = game as unknown as { updateRangefinding(dt: number): void; readSightAim(): [number, number, number]; rangefinder: import('./Rangefinder').Rangefinder; rangeTargets(): import('./rangefinderSight').RangeTarget[] };
  try {
    game.measureRange(); runtime.updateRangefinding(2.9); game.toggleRangeLock();
    expect(rig.rangeAim).toBeUndefined();
    runtime.updateRangefinding(.1); game.toggleRangeLock();
    const aim = runtime.readSightAim();
    const range = Math.hypot(target.motion.x - simulation.ship.x, target.motion.z - simulation.ship.z);
    expect(Math.hypot(aim[0] - simulation.ship.x, aim[2] - simulation.ship.z)).toBeCloseTo(range, 5);
    expect(aim[1]).toBe(.5);
    const center = new Vector3(...aim).project(camera);
    expect(center.x).toBeCloseTo(0, 5); expect(center.y).toBeCloseTo(0, 5);
    // Losing a hull must not expose its future position to the range tracker.
    target.damage.sunk = true; runtime.updateRangefinding(.1);
    expect(runtime.rangefinder.state.phase).toBe('lost');
    expect(runtime.readSightAim()).toEqual(aim);
    expect(runtime.rangeTargets()).not.toContainEqual(expect.objectContaining({ id: target.motion.id }));
    game.toggleRangeLock(); expect(rig.rangeAim).toBeUndefined();
    rig.exitBinoculars(); runtime.updateRangefinding(.1);
    expect(runtime.rangefinder.state.phase).toBe('idle');
  } finally { rig.dispose(); simulation.dispose(); }
});

test('scoping over empty water still adapts when mouse aim moves to a nearby ship', async () => {
  const simulation = await HeadlessSession.create({ playerShipId: 'bismarck', friendlyBots: [], enemies: ['bismarck'], spawnDistance: 5000 });
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000), canvas = Object.assign(new EventTarget(), { setPointerCapture() {} });
  const rig = new CameraRig(camera, canvas as unknown as HTMLCanvasElement);
  const game = Object.assign(Object.create(Game.prototype), { simulation, camera, rig, definition: simulation.definition,
    host: { clientWidth: 1440, clientHeight: 810 }, battery: 'main', manualAim: true, shellFollow: new ShellFollow(), inPort: false,
  }) as Game;
  const ship = simulation.ship, target = simulation.target!.motion;
  const bearing = Math.atan2(target.x - ship.x, ship.z - target.z) + Math.PI / 2;
  const settle = () => { for (let i = 0; i < 180; i++) rig.update(ship, ship.y, 1 / 60); };
  try {
    rig.aimAt([ship.x + Math.sin(bearing) * 15000, .5, ship.z - Math.cos(bearing) * 15000], ship);
    game.toggleBinoculars(); settle();
    const height = camera.position.y, descent = -Math.asin(camera.getWorldDirection(new Vector3()).y);
    const aim = new Vector3(target.x, .5, target.z), delta = aim.clone().sub(camera.position);
    const turn = Math.atan2(delta.x, -delta.z) - rig.bearing;
    const sensitivity = .0025 * Math.tan(camera.fov * Math.PI / 360) / Math.tan(52 * Math.PI / 360);
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0 }));
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 1,
      clientX: Math.atan2(Math.sin(turn), Math.cos(turn)) / sensitivity,
      clientY: (Math.atan2(-delta.y, Math.hypot(delta.x, delta.z)) - descent) / sensitivity,
    }));
    window.dispatchEvent(new Event('pointerup')); settle();
    expect(camera.position.y).toBeLessThan(height - 100);
    expect(-Math.asin(camera.getWorldDirection(new Vector3()).y)).toBeLessThan(descent - .01);
    expect(-Math.asin(camera.getWorldDirection(new Vector3()).y)).toBeLessThanOrEqual(5 * Math.PI / 180);
    const projected = aim.project(camera);
    expect(projected.x).toBeCloseTo(0, 6); expect(projected.y).toBeCloseTo(0, 6);
    expect(rig.binoculars).toBe(true); expect(rig.rangeAim).toBeUndefined();
  } finally { rig.dispose(); simulation.dispose(); }
});

test('rangefinding admits only fresh enemy exteriors actually observed by the helm ship', () => {
  const ship = { id: 'own', x: 0, y: 0, z: 0 };
  const report = { id: 'contact', presetId: 'bismarck', position: [0, 0, -15000], heading: 0, observedTick: 100, observers: ['own'], health: 1 };
  const simulation = { ship, actors: [], tick: 110, observedShips: [report], observationTracks: [] };
  const game = Object.assign(Object.create(Game.prototype), { simulation, observedShipViews: { position: () => new Vector3(0, 0, -15000) } }) as Game;
  const targets = () => (game as unknown as { rangeTargets(): import('./rangefinderSight').RangeTarget[] }).rangeTargets();
  expect(targets().map(target => target.id)).toEqual(['contact']);
  report.observers = ['other-friendly']; expect(targets()).toEqual([]);
  report.observers = ['own']; simulation.tick = 200; expect(targets()).toEqual([]);
  simulation.tick = 110; report.health = 0; expect(targets()).toEqual([]);
});

// Exercise the real scene swap with exported joint hierarchies; only GPU startup is omitted.
async function port(storageMatrices = false) {
  const definition = shipPreset('bismarck');
  const simulation = await HeadlessSession.port(definition);
  simulation.ship.x = 240;
  const loaded = (await model(definition.id)).scene;
  const playerView = new ShipView(loaded.clone(true), definition, simulation.player);
  const targetView = new ShipView(loaded.clone(true), definition, simulation.target!);
  const scene = new Scene();
  const harbor = new Group();
  scene.add(playerView.root, targetView.root, harbor);
  const camera = new PerspectiveCamera(52, 1.6, 3, 60000);
  const canvas = new EventTarget();
  const rig = new CameraRig(camera, canvas as HTMLCanvasElement);
  rig.setInPort(true);
  canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: -170 }));
  rig.update(simulation.ship, 0, 0, true);
  const game = Object.assign(Object.create(Game.prototype), {
    definition, simulation, playerView, targetView, fleetViews: [playerView, targetView], fleetModels: [loaded], loadedModel: loaded, scene, harbor, camera, rig,
    currentAim: [650, .5, -550], manualAim: true, shellFollow: new ShellFollow(), controlGroups: new Map(), pveStartingGroups: new Map(),
    aircraftView: { root: new Group(), async load() {}, diagnostics() { return {}; } },
    effects: { reset() {}, diagnostics() { return {}; } },
    funnelSmoke: { diagnostics() { return {}; } },
    shipLabels: { setFleet() {} },
    ship: new Group(), inPort: true, disposed: false, switchingShip: false, frameWaiters: [], observedShipViews: new ObservedShipViews(),
    hulls: new Map(), palette: new ShipMaterialPalette(),
    renderer: { backend: { isWebGPUBackend: storageMatrices }, domElement: { setAttribute() {} } },
    environment: makeTestEnvironment(),
  }) as Game;
  return { game, scene, harbor, camera, rig, playerView };
}

test('shell commands affect only the active gun battery and reject unavailable rounds or inactive play', async () => {
  const definition = shipPreset('bismarck'), simulation = await HeadlessSession.port(definition);
  const game = Object.assign(Object.create(Game.prototype), { definition, simulation, currentAim: [2000, 10, 0],
    battery: 'main', ammunition: { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' },
    inPort: false, paused: false, airOperationsOpen: false }) as Game;
  const main = game.weaponGroupId!;
  game.selectAmmunition('he'); expect(game.ammunition[main]).toBe('he'); expect(game.selectedAmmunition).toBe('he');
  game.battery = 'secondary'; const secondary = game.weaponGroupId!; game.selectAmmunition('he'); expect(game.ammunition[secondary]).toBe('he');
  game.selectAmmunition('ap'); expect(game.ammunition[main]).toBe('he');
  for (const state of simulation.player.mounts) { state.ammo -= state.heAmmo; state.heAmmo = 0; }
  game.selectAmmunition('he'); expect(game.ammunition[secondary]).toBe('ap');
  game.battery = 'torpedo'; game.selectAmmunition('he'); expect(game.ammunition.torpedo).toBe('ap');
  game.battery = 'main';
  Object.assign(game, { paused: true }); game.selectAmmunition('ap'); expect(game.ammunition[main]).toBe('he');
  Object.assign(game, { paused: false, inPort: true }); game.selectAmmunition('ap'); expect(game.ammunition[main]).toBe('he');
  Object.assign(game, { inPort: false, airOperationsOpen: true }); game.selectAmmunition('ap'); expect(game.ammunition[main]).toBe('he');
  game.airOperationsOpen = false; simulation.player.damage.sunk = true; game.selectAmmunition('ap'); expect(game.ammunition[main]).toBe('he');
});

test('switching ships retains the port until loading completes, then frames the new hull with the same orbit', async () => {
  const { game, scene, harbor, camera, rig, playerView } = await port();
  const next = await model('type-viic');
  let finish!: (value: typeof next) => void, started!: () => void;
  const loading = new Promise<void>(resolve => { started = resolve; });
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  const position = camera.position.toArray();
  const rotation = camera.quaternion.toArray();
  const bearing = rig.bearing;
  try {
    const switching = game.switchShip(shipPreset('type-viic'));
    expect(scene.children).toContain(playerView.root);
    expect(game.definition.id).toBe('bismarck');
    rig.update(game.simulation.ship, 0, 1 / 60);
    expect(camera.position.toArray()).toEqual(position);
    expect(camera.quaternion.toArray()).toEqual(rotation);
    // The port session compiles in its worker before the hull is fetched.
    await loading;
    expect(game.definition.id).toBe('bismarck');
    finish(next);
    await switching;
    expect(game.definition.id).toBe('type-viic');
    expect(scene.children).toContain(harbor);
    expect(scene.children).not.toContain(playerView.root);
    expect(game.simulation.ship.x).toBe(240);
    rig.update(game.simulation.ship, 0, 0, true);
    expect(rig.bearing).toBe(bearing);
    expect(camera.position.distanceTo(new Vector3(240, 0, 0))).toBeLessThan(new Vector3(...position).distanceTo(new Vector3(240, 0, 0)));
    for (const z of [-33.55, 33.55]) {
      const projected = new Vector3(240, 0, z).project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(1);
      expect(Math.abs(projected.y)).toBeLessThan(1);
    }
    expect(game.diagnostics().maxMuzzleErrorM).toBeLessThan(.025);
  } finally { loader.mockRestore(); rig.dispose(); }
});


test('a delayed first articulation preview cannot overwrite poses after leaving and returning to port', async () => {
  const { game, rig } = await port();
  const previousDev = process.env.DEV;
  process.env.DEV = 'true';
  const pending: { targets: ClearancePose[]; finish: (results: ClearanceResult[]) => void }[] = [];
  Object.assign(game, {
    articulationRequest: 0, battery: 'main',
    input: makeTestInput(),
    callbacks: { pause() {} },
    battlefieldCamera: makeTestBattlefieldCamera(),
    refreshLandscape() {},
    articulationResolver: {
      resolve(_definition: unknown, _current: ClearancePose[], targets: ClearancePose[]) {
        return new Promise<ClearanceResult[]>(finish => pending.push({ targets, finish }));
      },
    },
  });
  const capture = spyOn(rig, 'capturePointer').mockImplementation(() => {});
  const finish = (index: number) => pending[index].finish(pending[index].targets.map(pose => ({ pose, blocked: false, obstructionId: null })));
  try {
    const delayed = game.previewArticulation({ trainFraction: .4, elevationFraction: .5, recoilFraction: 1 });
    expect(pending).toHaveLength(1);
    game.setInPort(false);
    game.setInPort(true);
    const reset = structuredClone(game.simulation.player.mounts);
    finish(0);
    await delayed;
    expect(game.simulation.player.mounts).toEqual(reset);
    // A fresh request still applies, then restoring preview returns to this port's original states.
    const current = game.previewArticulation({ trainFraction: -.2, elevationFraction: .6, recoilFraction: .5 });
    finish(1);
    await current;
    expect(game.simulation.player.mounts[0].train).toBe(pending[1].targets[0].train);
    expect(game.simulation.player.mounts[0].recoil).toBe(.5);
    await game.previewArticulation(null);
    expect(game.simulation.player.mounts).toEqual(reset);
  } finally {
    capture.mockRestore(); rig.dispose();
    if (previousDev === undefined) delete process.env.DEV;
    else process.env.DEV = previousDev;
  }
});

test('failed ship loads preserve the old ship and allow retry', async () => {
  const { game, scene, playerView, rig } = await port();
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValue(new Error('Network unavailable'));
  try {
    await expect(game.switchShip(shipPreset('yamato'))).rejects.toThrow('Network unavailable');
    expect(game.definition.id).toBe('bismarck');
    expect(scene.children).toContain(playerView.root);
    const invalid = await model('yamato');
    invalid.scene.userData.definitionHash = 'stale';
    loader.mockResolvedValue(invalid);
    await expect(game.switchShip(shipPreset('yamato'))).rejects.toThrow('different versions');
    expect(scene.children).toContain(playerView.root);
    loader.mockImplementation(async url => model(String(url).split('/').pop()!.replace(/\.glb(\?.*)?$/, '')));
    for (const id of ['yamato', 'baltimore', 'enterprise-cv6', 'type-viic', 'bismarck']) {
      await game.switchShip(shipPreset(id));
      expect(game.definition.id).toBe(id);
      expect(scene.children).toHaveLength(5); // Harbor, aircraft, two hull roots, fleet draw adapter.
      expect(game.simulation.definition.id).toBe(id);
      expect(game.diagnostics().maxMuzzleErrorM).toBeLessThan(.025);
    }
  } finally { loader.mockRestore(); rig.dispose(); }
});

test('saved construction revisions load into port and replace the previously inspected design', async () => {
  await initConstruction({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() });
  const catalog = catalogJson as ConstructionCatalog, source = createStarterSource(catalog, 'blank');
  source.construction.primitives = [{ id: 'hull', kind: 'box', size: [8, 5, 48], position: [0, 0, 0], rotationDeg: 0 }];
  const compile = () => JSON.parse(compile_construction(JSON.stringify(source), JSON.stringify(catalog))) as ConstructionResult;
  const { game, scene, harbor, rig } = await port();
  try {
    const first = registerLocalShip(source, compile());
    await game.switchShip(first.definition);
    expect(game.definition.contentHash).toBe(first.result.contentHash);
    expect(scene.children).toContain(harbor);
    source.name = 'Revised harbor design'; source.revision = crypto.randomUUID(); source.construction.primitives[0].size[2] = 60;
    const next = registerLocalShip(source, compile());
    await game.switchShip(next.definition);
    expect(game.definition.name).toBe(source.name);
    expect(game.definition.contentHash).toBe(next.result.contentHash);
    expect(game.definition.hull.length).toBe(60);
    expect(game.simulation.definition.id).toBe(next.definition.id);
    expect(scene.children).toContain(harbor);
  } finally { removeLocalShip(source.id); rig.dispose(); }
});

test('a second request cannot replace an in-flight switch; disposed games never attach the result', async () => {
  const { game, scene, playerView, rig } = await port();
  const next = await model('yamato');
  let finish!: (value: typeof next) => void, started!: () => void;
  const loading = new Promise<void>(resolve => { started = resolve; });
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  try {
    const switching = game.switchShip(shipPreset('yamato'));
    await expect(game.switchShip(shipPreset('baltimore'))).rejects.toThrow('idle, loaded port');
    await loading;
    Object.assign(game, { disposed: true });
    finish(next);
    await expect(switching).rejects.toThrow('Game disposed');
    expect(game.definition.id).toBe('bismarck');
    expect(scene.children).toContain(playerView.root);
  } finally { loader.mockRestore(); rig.dispose(); }
});

test.each([false, true])('battle loading binds each mixed fleet hull and selected target to its own exported joints (storage matrices: %s)', async storageMatrices => {
  const { game, scene, harbor, rig } = await port(storageMatrices);
  const aircraftLoader = spyOn((game as unknown as { aircraftView: { load(modelIds: string[], storageMatrices?: boolean): Promise<void> } }).aircraftView, 'load');
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => model(String(url).split('/').pop()!.replace(/\.glb(\?.*)?$/, '')));
  try {
    await game.prepareBattle({ playerShipId: 'baltimore', friendlyBots: ['bismarck', { shipId: 'bismarck', aiLevel: 'hard' }],
      enemies: [{ shipId: 'yamato', aiLevel: 'static' }, { shipId: 'enterprise-cv6', aiLevel: 'moving' }],
      spawnDistance: 7500, mapId: 'pacific-islands', timeOfDay: 'night', weather: 'fog' });
    expect(loader).toHaveBeenCalledTimes(4);
    expect(aircraftLoader).toHaveBeenCalledTimes(1);
    expect(aircraftLoader).toHaveBeenCalledWith(shipPreset('enterprise-cv6').airWing!.squadrons.map(s => s.modelId), storageMatrices);
    expect(scene.children).toContain(harbor);
    expect(scene.children).toHaveLength(8); // Harbor, aircraft, five hull roots, fleet draw adapter.
    expect(game.simulation.actors).toHaveLength(5);
    expect(game.diagnostics().mapId).toBe('pacific-islands');
    expect(game.diagnostics().timeOfDay).toBe('night');
    expect(game.diagnostics().weather).toBe('fog');
    expect(game.simulation.islands).toHaveLength(3);
    expect(game.simulation.target!.motion.z - game.simulation.ship.z).toBe(-7500);
    expect(game.simulation.ship.heading).toBe(0);
    expect(game.simulation.target!.motion.heading).toBe(Math.PI);
    const diagnostics = game.diagnostics();
    expect(diagnostics.fleet.map(actor => actor.aiLevel)).toEqual(['normal', 'normal', 'hard', 'static', 'moving']);
    expect(diagnostics.maxMuzzleErrorM).toBeLessThan(.025);
    expect(diagnostics.renderedShips.filter(ship => ship.visible).map(ship => ship.id)).toEqual(['player']);
    game.selectTarget('enemy-2');
    expect(game.diagnostics().combat.targetName).toBe(shipPreset('enterprise-cv6').name);
    // Returning to an ordinary port ship drops all old battle actors and bindings.
    await game.switchShip(shipPreset('bismarck'));
    expect(scene.children).toHaveLength(5); // Harbor, aircraft, two hull roots, fleet draw adapter.
    expect(game.simulation.isBattle).toBe(false);
  } finally { aircraftLoader.mockRestore(); loader.mockRestore(); rig.dispose(); }
});

test('battle preparation reports each loading stage in order for the loading screen', async () => {
  const { game, rig } = await port();
  let active = 0, peak = 0;
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => {
    peak = Math.max(peak, ++active);
    try { return await model(String(url).split('/').pop()!.replace(/\.glb(\?.*)?$/, '')); }
    finally { active--; }
  });
  const stages: [string, number][] = [];
  try {
    await game.prepareBattle({ playerShipId: 'baltimore', friendlyBots: ['bismarck'], enemies: ['yamato', 'enterprise-cv6'], spawnDistance: 7500, mapId: 'pacific-islands' }, (label, fraction) => stages.push([label, fraction]));
    expect(stages[0][0]).toBe('Charting Pacific Islands');
    expect(stages.map(([, fraction]) => fraction)).toEqual([...stages.map(([, fraction]) => fraction)].sort((a, b) => a - b));
    expect(stages.every(([, fraction]) => fraction >= 0 && fraction < 1)).toBe(true);
    expect(stages.map(([label]) => label)).toContain('Spotting the air wing');
    expect(stages.map(([label]) => label)).toContain('Mustering the fleets');
    expect(stages.at(-1)?.[0]).toBe('Forming the battle lines');
    expect(peak).toBe(1); // Never retain multiple in-flight GLB parses.
    expect(loader).toHaveBeenCalledTimes(4);
    expect(stages.filter(([label]) => label.startsWith('Loading ') || label.endsWith(' aboard'))).toHaveLength(5);
    // A disposed session never renders again, so a pending frame wait must not hang the loading screen.
    Object.assign(game, { disposed: true });
    await game.nextFrame();
  } finally { loader.mockRestore(); rig.dispose(); }
});

test.each(['yamato', 'enterprise-cv6'])('PvE prepares detail only for owned hull types without disclosing the hidden %s', async enemy => {
  const { game, rig } = await port();
  const loaded: string[] = [], detailed: string[] = [];
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => {
    const id = String(url).split('/').pop()!.replace(/\.glb(\?.*)?$/, '');
    loaded.push(id);
    const gltf = await model(id);
    gltf.scene.name = id;
    return gltf;
  });
  const detail = spyOn(ShipDetail, 'prepareShipDetail').mockImplementation(async root => { detailed.push(root.name); });
  const stages: string[] = [];
  try {
    await game.prepareBattle({ playerShipId: 'bismarck', friendlyBots: ['fletcher', 'fletcher'],
      enemies: [enemy], spawnDistance: 5000, missionRules: pveRules as MissionRules }, label => stages.push(label));
    expect(game.simulation.actors.every(actor => actor.team === 'friendly')).toBe(true);
    // Getting underway waits only on the hulls already at sea, and the loading text names
    // no hull at all, so nothing about the mission fleet leaks before contact.
    expect(loaded).toEqual(['bismarck', 'fletcher']);
    expect(detailed.sort()).toEqual(['bismarck', 'fletcher']);
    expect(stages.every(label => !Object.keys(shipPresets).some(id => label.toLowerCase().includes(id.split('-')[0])))).toBe(true);
    expect(stages).toContain('Preparing the fleet');

    // A hull the mission reveals is fetched at that moment and drawn once it lands. The
    // report already names the preset, so this asks for nothing the player was not told.
    const contact = { id: 'contact-0-1', presetId: enemy, position: [0, 0, -8000] as [number, number, number],
      heading: 0, pitch: 0, roll: 0, health: 1, mounts: [], launchers: [],
      velocity: [0, 0, 0] as [number, number, number], observedTick: 0, observers: [] };
    const observed = (game as unknown as { observedShipViews: ObservedShipViews }).observedShipViews;
    observed.update([contact], 0, true);
    expect(observed.root.children).toHaveLength(0);
    for (let pump = 1; pump < 100 && !observed.root.children.length; pump++) {
      await new Promise(resolve => setTimeout(resolve, 0));
      observed.update([contact], pump, true);
    }
    expect(observed.root.children).toHaveLength(1);
    expect(loaded).toEqual(['bismarck', 'fletcher', enemy]);
    // A revealed hull never gets detail buffers; only actor-backed views use those.
    expect(detailed.sort()).toEqual(['bismarck', 'fletcher']);
    // Asking again for a hull already aboard, or one already refused, costs no second fetch.
    observed.update([contact, { ...contact, id: 'contact-0-2' }], 200, true);
    expect(loaded).toEqual(['bismarck', 'fletcher', enemy]);
  } finally { detail.mockRestore(); loader.mockRestore(); rig.dispose(); game.simulation.dispose?.(); }
}, 30000);

test('one failed fleet asset leaves the port intact and the same battle can be retried', async () => {
  const { game, scene, playerView, rig } = await port();
  const setup = { playerShipId: 'baltimore', friendlyBots: ['bismarck'], enemies: ['yamato', 'enterprise-cv6'], spawnDistance: 5000 };
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => {
    if (String(url).includes('enterprise')) throw new Error('Fleet asset unavailable');
    return model(String(url).split('/').pop()!.replace(/\.glb(\?.*)?$/, ''));
  });
  try {
    await expect(game.prepareBattle(setup)).rejects.toThrow('Fleet asset unavailable');
    expect(scene.children).toContain(playerView.root);
    expect(game.definition.id).toBe('bismarck');
    loader.mockImplementation(async url => model(String(url).split('/').pop()!.replace(/\.glb(\?.*)?$/, '')));
    await game.prepareBattle(setup);
    expect(game.simulation.actors).toHaveLength(4);
  } finally { loader.mockRestore(); rig.dispose(); }
});

test('failed aircraft loads leave the current port intact and allow another launch attempt', async () => {
  const { game, scene, playerView, rig } = await port();
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => model(String(url).split('/').pop()!.replace(/\.glb(\?.*)?$/, '')));
  const view = (game as unknown as { aircraftView: { load(): Promise<void> } }).aircraftView;
  // Create the rejection when called, after the asynchronous ship loads finish.
  const aircraftLoader = spyOn(view, 'load').mockImplementation(async () => { throw new Error('Aircraft unavailable'); });
  const setup = { playerShipId: 'enterprise-cv6', friendlyBots: [], enemies: ['enterprise-cv6'], spawnDistance: 5000 };
  try {
    await expect(game.prepareBattle(setup)).rejects.toThrow('Aircraft unavailable');
    expect(game.definition.id).toBe('bismarck'); expect(scene.children).toContain(playerView.root);
    aircraftLoader.mockResolvedValue();
    await game.prepareBattle(setup); expect(game.definition.id).toBe('enterprise-cv6');
  } finally { aircraftLoader.mockRestore(); loader.mockRestore(); rig.dispose(); }
});

test('spectating follows only surviving teammates, cycles duplicates, and resets after loss or port', async () => {
  const definition = shipPreset('bismarck');
  const simulation = await HeadlessSession.create({ playerShipId: 'bismarck', friendlyBots: ['bismarck', 'type-viic', 'bismarck'], enemies: ['bismarck'], spawnDistance: 5000 });
  const camera = new PerspectiveCamera(52, 1.6, .5, 60000);
  const rig = new CameraRig(camera, new EventTarget() as HTMLCanvasElement);
  const fleetViews = simulation.actors.map(actor => ({ actor, definition: actor.definition, motion: actor.motion }));
  const game = Object.assign(Object.create(Game.prototype), {
    definition, simulation, rig, fleetViews, playerView: fleetViews[0], targetView: fleetViews.at(-1),
    inPort: false, selectedBattery: 'main', currentAim: [0, 0, -5000], ammunition: {}, shellFollow: new ShellFollow(), input: makeTestInput({ order: 5, rudderOrder: 1 }), battlefieldCamera: makeTestBattlefieldCamera(),
  }) as Game;
  const update = () => (game as unknown as { updateSpectator(): void }).updateSpectator();
  try {
    // A live helm ship may watch a teammate: the session can hand the helm over.
    game.spectateTeammate('friendly-1'); expect(game.spectatedShipId).toBe('friendly-1');
    simulation.player.damage.sunk = true;
    update(); expect(game.spectatedShipId).toBe('friendly-1');
    game.spectateTeammate('enemy-1'); expect(game.spectatedShipId).toBe('friendly-1');
    game.spectateTeammate('player'); expect(game.spectatedShipId).toBe('friendly-1');
    game.cycleSpectator(-1); expect(game.spectatedShipId).toBe('friendly-3');
    game.cycleSpectator(1); expect(game.spectatedShipId).toBe('friendly-1');
    game.cycleSpectator(1); expect(game.spectatedShipId).toBe('friendly-2');
    const friend = simulation.actors[2];
    friend.motion.speed = 4;
    friend.helm = { throttle: .5, rudder: -.5 };
    const telemetry = () => (game as unknown as { shipTelemetry(aim: [number, number, number]): import('./types').Telemetry }).shipTelemetry([0, 0, -5000]);
    expect(telemetry()).toMatchObject({ ship: { id: friend.motion.id, speed: 4 }, shipDefinition: { id: 'type-viic' }, order: 3, rudderOrder: -.5 });
    expect(telemetry().combat?.submarine).toBeDefined();
    expect(telemetry().combat?.playerSunk).toBe(true);
    const projected = new Vector3(friend.motion.x, friend.motion.y, friend.motion.z).project(camera);
    expect(Math.abs(projected.x)).toBeLessThan(1); expect(Math.abs(projected.y)).toBeLessThan(1);
    expect(simulation.player.controller).toBe('player'); expect(friend.controller).toBe('bot');
    friend.damage.sunk = true;
    update(); expect(game.spectatedShipId).toBe('friendly-1');
    expect(telemetry().ship.id).toBe('friendly-1');
    expect(telemetry().combat?.submarine).toBeUndefined();
    simulation.actors[1].damage.stability.combatLost = true;
    update(); expect(game.spectatedShipId).toBe('friendly-1'); // Disarmed hulls remain afloat.
    simulation.actors[1].damage.sunk = true;
    update(); expect(game.spectatedShipId).toBe('friendly-3');
    simulation.actors[3].damage.sunk = true;
    update(); expect(game.spectatedShipId).toBeUndefined();
    game.cycleSpectator(1); expect(game.spectatedShipId).toBeUndefined();
    // A restored fleet (a fresh battle) offers no spectator while the helm ship floats.
    for (const actor of simulation.actors) { actor.damage.sunk = false; actor.damage.stability.combatLost = false; }
    update(); expect(game.spectatedShipId).toBeUndefined();
    expect(telemetry().ship.id).toBe('player');
    expect(telemetry().order).toBe(5);
    simulation.player.damage.sunk = true; update(); expect(game.spectatedShipId).toBe('friendly-1');
    Object.assign(game, { inPort: true }); update(); expect(game.spectatedShipId).toBeUndefined();
  } finally { rig.dispose(); }
});

test('a battle that opens on the fleet chart selects nothing; leaving a helm keeps that ship selected', async () => {
  const simulation = await HeadlessSession.create({ playerShipId: 'enterprise-cv6', friendlyBots: ['fletcher'], enemies: ['baltimore'], spawnDistance: 7500 });
  const camera = new PerspectiveCamera(52, 1.6, .5, 60000);
  const rig = new CameraRig(camera, new EventTarget() as HTMLCanvasElement);
  const views = simulation.actors.map(actor => ({ actor, definition: actor.definition, motion: actor.motion }));
  const input = makeTestInput({ setEnabled(value: boolean) { this.isEnabled = value; } });
  const game = Object.assign(Object.create(Game.prototype), {
    simulation, definition: simulation.definition, rig, camera, fleetViews: views, playerView: views[0], targetView: views.at(-1),
    inPort: false, selectedBattery: 'main', currentAim: [0, 0, -7500], ammunition: {}, shellFollow: new ShellFollow(), input,
    battlefieldCamera: new BattlefieldCamera(camera), selectedShipIds: [], controlGroups: new Map(), host: { clientWidth: 1280, clientHeight: 800 },
    water: { getGeometryConfig: () => ({ infinityRingExtent: Infinity }) }, environment: { setChartFog() {} },
  }) as Game;
  try {
    game.enterFleetCommand(false);
    expect(game.fleetCommandMode).toBe(true);
    expect(game.selectedShipIds).toEqual([]);
    game.followFleetShip('player');
    game.enterFleetCommand();
    expect(game.selectedShipIds).toEqual(['player']);
  } finally { simulation.dispose(); rig.dispose(); }
});

test('a custom battle reads the fleet chart from its helm: nothing is released, the rudder holds, and M comes back to the ship', async () => {
  const simulation = await HeadlessSession.create({ playerShipId: 'bismarck', friendlyBots: ['fletcher', 'baltimore'], enemies: ['mogami'], spawnDistance: 7500 });
  const camera = new PerspectiveCamera(52, 1.6, .5, 60000);
  const rig = new CameraRig(camera, new EventTarget() as HTMLCanvasElement);
  const views = simulation.actors.map(actor => ({ actor, definition: actor.definition, motion: actor.motion }));
  const input = makeTestInput({ helmHeld: false, setEnabled(value: boolean, held = false) { this.isEnabled = value; this.helmHeld = held; } });
  const game = Object.assign(Object.create(Game.prototype), {
    simulation, definition: simulation.definition, rig, camera, fleetViews: views, playerView: views[0], targetView: views.at(-1),
    inPort: false, selectedBattery: 'main', currentAim: [0, 0, -7500], ammunition: {}, shellFollow: new ShellFollow(), input,
    battlefieldCamera: new BattlefieldCamera(camera), selectedShipIds: [], controlGroups: new Map(), host: { clientWidth: 1280, clientHeight: 800 },
    water: { getGeometryConfig: () => ({ infinityRingExtent: Infinity }) }, environment: { setChartFog() {} },
  }) as Game;
  const update = () => (game as unknown as { updateSpectator(): void }).updateSpectator();
  const advance = () => simulation.advance(.1, { throttle: 1, rudder: .5 }, { aim: [0, 0, -7500], battery: 'main', fire: false });
  try {
    expect(game.fleetChartAvailable).toBe(true);
    expect(fleetDesk(game).can.fleetChart).toBe(true);
    fleetDesk(game).issue({ kind: 'fleet-command' }); advance(); update();
    expect(game.helmChart).toBe(true);
    expect(game.airOperationsOpen).toBe(true);
    // The helm is still the player's, the keys are the chart's, and the wheel stays where it was put.
    expect(simulation.controlledShipId).toBe('player');
    expect(input.isEnabled).toBe(false);
    expect(input.helmHeld).toBe(true);
    expect(game.selectedShipIds).toEqual([]);
    game.selectFleetShips(['friendly-1']);
    fleetDesk(game).issue({ kind: 'autonomous', shipId: 'friendly-1' }); advance();
    // An order to the hull under the player's hand steers it until the helm is touched again.
    expect((simulation as unknown as { autopilot?: object }).autopilot).toBeUndefined();
    fleetDesk(game).issue({ kind: 'route', shipId: 'player', point: [0, -1500], speedMps: 10, append: false }); advance();
    expect((simulation as unknown as { autopilot?: object }).autopilot).toEqual({ throttle: 1, rudder: .5 });
    // The chart's own key, Follow and the return button all take the same way back.
    game.followFleetShip('friendly-1'); advance(); update();
    expect(game.helmChart).toBe(false);
    expect(game.fleetCommandMode).toBe(false);
    expect(game.airOperationsOpen).toBe(false);
    expect(game.spectatedShipId).toBeUndefined();
    expect(simulation.controlledShipId).toBe('player');
    expect(input.isEnabled).toBe(true);
    expect(input.helmHeld).toBe(false);
    expect(game.selectedShipIds).toEqual([]);
    // Taking another helm from the chart leaves it through the custom battle's own transfer.
    game.openFleetChart();
    game.takeFleetHelm('friendly-2'); advance(); update();
    expect(game.helmChart).toBe(false);
    expect(game.airOperationsOpen).toBe(false);
    expect(simulation.controlledShipId).toBe('friendly-2');
  } finally { simulation.dispose(); rig.dispose(); }
});

test('the helm wheel swaps hulls in a custom battle: held on its key, offered once after a sinking, never spectating a live helm', async () => {
  const simulation = await HeadlessSession.create({ playerShipId: 'bismarck', friendlyBots: ['fletcher', 'baltimore'], enemies: ['mogami'], spawnDistance: 7500 });
  const camera = new PerspectiveCamera(52, 1.6, .5, 60000);
  const rig = new CameraRig(camera, new EventTarget() as HTMLCanvasElement);
  const views = simulation.actors.map(actor => ({ actor, definition: actor.definition, motion: actor.motion }));
  const input = makeTestInput({ order: 1, rudderOrder: 0, setEnabled(value: boolean) { this.isEnabled = value; }, setOrder(value: number) { this.order = value; }, setRudder(value: number) { this.rudderOrder = value; } });
  const game = Object.assign(Object.create(Game.prototype), {
    simulation, definition: simulation.definition, rig, camera, fleetViews: views, playerView: views[0], targetView: views.at(-1),
    inPort: false, selectedBattery: 'main', currentAim: [0, 0, -7500], ammunition: {}, shellFollow: new ShellFollow(), input,
    battlefieldCamera: new BattlefieldCamera(camera), selectedShipIds: [], controlGroups: new Map(), host: { clientWidth: 1280, clientHeight: 800 },
    water: { getGeometryConfig: () => ({ infinityRingExtent: Infinity }) }, environment: { setChartFog() {} }, callbacks: { pause() {} },
  }) as Game;
  const update = () => (game as unknown as { updateSpectator(): void }).updateSpectator();
  const advance = () => simulation.advance(.1, { throttle: 0, rudder: 0 }, { aim: [0, 0, -7500], battery: 'main', fire: false });
  const held = spyOn(rig, 'setHeld');
  try {
    advance(); update();
    expect(simulation.controlledShipId).toBe('player');
    expect(game.spectatedShipId).toBeUndefined(); // a live helm is never handed a spectator
    expect(game.helmCandidates.map(a => a.motion.id)).toEqual(['friendly-1', 'friendly-2']);
    game.openHelmWheel('held');
    expect(game.helmWheel).toEqual({ reason: 'held' });
    expect(held).toHaveBeenLastCalledWith(true);
    expect(input.isEnabled).toBe(true); // The wheel holds the rig, not keyboard shortcuts.
    game.highlightHelmCandidate('enemy-1'); expect(game.helmWheel?.highlightId).toBeUndefined();
    game.highlightHelmCandidate('friendly-1'); expect(game.helmWheel?.highlightId).toBe('friendly-1');
    // Releasing the key without a pick just closes the wheel.
    game.highlightHelmCandidate(undefined); game.releaseHelmWheel();
    expect(game.helmWheel).toBeUndefined(); expect(held).toHaveBeenLastCalledWith(false);
    expect(simulation.controlledShipId).toBe('player');
    game.openHelmWheel('held'); game.highlightHelmCandidate('friendly-2'); game.releaseHelmWheel();
    expect(game.helmWheel).toBeUndefined();
    // The camera lands on the hull at once while the session confirms the helm.
    expect(game.spectatedShipId).toBe('friendly-2');
    advance();
    expect(simulation.controlledShipId).toBe('friendly-2');
    expect(simulation.player.motion.id).toBe('friendly-2');
    expect(simulation.actors[0].motion.id).toBe('player');
    // The old hull keeps sailing under its captain; the wheel now centres on the new one.
    expect(game.helmCandidates.map(a => a.motion.id).sort()).toEqual(['friendly-1', 'player']);
    // Losing the new hull offers the wheel once; Esc leaves it closed until another sinking.
    Object.assign(game, { spectatedShipId: undefined });
    simulation.player.damage.sunk = true; update();
    expect(game.helmWheel).toEqual({ reason: 'sunk' });
    game.closeHelmWheel(); update();
    expect(game.helmWheel).toBeUndefined();
    game.openHelmWheel('held'); expect(game.helmWheel?.reason).toBe('held');
    game.releaseHelmWheel();
    // A sunk-offered wheel does not close on key release; a pick or Esc does.
    game.openHelmWheel('sunk'); game.releaseHelmWheel(); expect(game.helmWheel?.reason).toBe('sunk');
    game.setPaused(true); expect(game.helmWheel).toBeUndefined();
  } finally { simulation.dispose(); rig.dispose(); }
});

test('fleet selection and camera follow keep captains active; helm transfer resumes standing orders without resetting another actor', async () => {
  const simulation = await HeadlessSession.create({ playerShipId: 'enterprise-cv6', friendlyBots: ['fletcher'], enemies: ['baltimore'], spawnDistance: 7500 });
  const camera = new PerspectiveCamera(52, 1.6, .5, 60000);
  const rig = new CameraRig(camera, new EventTarget() as HTMLCanvasElement);
  const views = simulation.actors.map(actor => ({ actor, definition: actor.definition, motion: actor.motion }));
  let clears = 0;
  const input = makeTestInput({ order: 1, rudderOrder: 0, clear() { clears++; }, setEnabled(value: boolean) { this.isEnabled = value; this.clear(); }, setOrder(value: number) { this.order = value; }, setRudder(value: number) { this.rudderOrder = value; } });
  const battlefieldCamera = new BattlefieldCamera(camera);
  const game = Object.assign(Object.create(Game.prototype), {
    simulation, definition: simulation.definition, rig, camera, fleetViews: views, playerView: views[0], targetView: views.at(-1),
    inPort: false, selectedBattery: 'main', currentAim: [0, 0, -7500], ammunition: {}, shellFollow: new ShellFollow(), input,
    battlefieldCamera, selectedShipIds: [], controlGroups: new Map(), host: { clientWidth: 1280, clientHeight: 800 },
    water: { getGeometryConfig: () => ({ infinityRingExtent: Infinity }) }, environment: { setChartFog() {} },
  }) as Game;
  const update = () => (game as unknown as { updateSpectator(): void }).updateSpectator();
  const advance = () => simulation.advance(.1, { throttle: 0, rudder: 0 }, { aim: [0, 0, -7500], battery: 'main', fire: false });
  try {
    simulation.routeShip('player', [[0, -1500]], 10);
    simulation.escortShip('friendly-1', 'player', [650, 450], 160);
    const carrier = simulation.player, hp = carrier.damage.integrity;
    game.enterFleetCommand(); advance(); update();
    expect(game.airOperationsOpen).toBe(true);
    expect(simulation.controlledShipId).toBeUndefined();
    // Let the ascent finish the way the frame loop does, so the camera sits overhead.
    battlefieldCamera.update(); battlefieldCamera.applyTransition(2);
    expect(camera.position.y).toBeGreaterThan(1000);
    game.selectFleetShips(['friendly-1', 'enemy-1']);
    expect(game.selectedShipIds).toEqual(['friendly-1']);
    expect(simulation.player).toBe(carrier);
    const capture = spyOn(rig, 'capturePointer');
    game.followFleetShip('friendly-1'); update();
    expect(game.airOperationsOpen).toBe(false);
    expect(game.spectatedShipId).toBe('friendly-1');
    expect(simulation.controlledShipId).toBeUndefined();
    // Following steers the camera with the mouse like the helm does: the cursor is taken at once.
    expect(capture).toHaveBeenCalled();
    // Leaving the chart descends from the overhead pose instead of cutting to the ship.
    expect(battlefieldCamera.transitioning).toBe(true);
    battlefieldCamera.applyTransition(0);
    expect(camera.position.y).toBeGreaterThan(1000);
    // Switching between hulls already on the water stays a cut.
    game.spectateTeammate('player');
    expect(battlefieldCamera.transitioning).toBe(false);
    game.takeFleetHelm('friendly-1'); advance(); update();
    expect(simulation.controlledShipId).toBe('friendly-1');
    expect(input.isEnabled).toBe(true);
    const firstClear = clears;
    update(); update();
    expect(clears).toBe(firstClear); // Rendering must never clear a held key every frame.
    game.enterFleetCommand(); advance(); update();
    expect(simulation.controlledShipId).toBeUndefined();
    expect(simulation.fleetOrders['friendly-1'].movement.type).toBe('escort');
    expect(carrier.damage.integrity).toBe(hp);
    expect(simulation.actors[0]).toBe(carrier);
  } finally { simulation.dispose(); rig.dispose(); }
});

test('direct slots select a single type, never cycle, and retain selection when guns are lost', async () => {
  const definition = shipPreset('bismarck'), simulation = await HeadlessSession.port(definition);
  const game = Object.assign(Object.create(Game.prototype), { definition, simulation, battery: 'main',
    ammunition: {}, inPort: false, paused: false, airOperationsOpen: false }) as Game;
  const groups = game.weaponGroups;
  for (const [index, group] of groups.entries()) {
    game.selectWeaponSlot(index); expect(game.weaponGroupId).toBe(group.id);
    game.selectWeaponSlot(index); expect(game.weaponGroupId).toBe(group.id);
  }
  game.selectWeaponSlot(1); game.selectAmmunition('he');
  game.selectWeaponSlot(2); expect(game.selectedAmmunition).toBe('ap');
  game.selectWeaponSlot(1); expect(game.selectedAmmunition).toBe('he');
  for (const state of simulation.player.mounts) { state.hp = 0; state.ammo = 0; }
  game.selectWeaponSlot(1); expect(game.weaponGroupId).toBe(groups[1].id);
  game.selectWeaponSlot(9); expect(game.weaponGroupId).toBe(groups[1].id);
  game.selectWeaponGroup('missing'); expect(game.weaponGroupId).toBe(groups[1].id);
  game.definition = shipPreset('fletcher');
  game.selectWeaponSlot(1); expect(game.battery).toBe('torpedo');
  game.selectWeaponSlot(2); expect(game.battery).toBe('depth-charge');
});

test('single shell presses queue, rapid pairs force that choice, and slow presses cancel it', async () => {
  const definition = shipPreset('bismarck'), simulation = await HeadlessSession.port(definition);
  const game = Object.assign(Object.create(Game.prototype), { definition, simulation, battery: 'main',
    ammunition: { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' },
    inPort: false, paused: false, airOperationsOpen: false }) as Game;
  const main = game.weaponGroupId!;
  // The authority loads the round; the session carries the selection.
  game.cycleAmmunition(1000);
  expect(game.ammunition[main]).toBe('he'); expect(simulation.ammunitionSelection[main]).toBe('he');
  game.cycleAmmunition(1200);
  expect(game.ammunition[main]).toBe('he'); expect(simulation.ammunitionSelection[main]).toBe('he');
  game.cycleAmmunition(2000); game.cycleAmmunition(2400);
  expect(game.ammunition[main]).toBe('he');
  game.cycleAmmunition(3000); game.battery = 'secondary'; game.cycleAmmunition(3100);
  expect(simulation.ammunitionSelection[main]).toBe('ap');
  expect(simulation.telemetry('main', [2000, 10, 0], main).ammunition).toBe('ap');
  expect(game.selectedAmmunition).toBe('he');
});

test('rapid shell presses in different secondary groups never force a neighboring group to reload', async () => {
  const definition = shipPreset('bismarck'), simulation = await HeadlessSession.port(definition);
  const game = Object.assign(Object.create(Game.prototype), { definition, simulation, battery: 'main',
    ammunition: {}, inPort: false, paused: false, airOperationsOpen: false }) as Game;
  const groups = game.weaponGroups;
  game.selectWeaponSlot(1); game.cycleAmmunition(1000);
  game.selectWeaponSlot(2); game.cycleAmmunition(1100);
  // Group 2 carries no HE, so its press orders nothing; a neighbour's press is never its own.
  expect(simulation.ammunitionSelection[groups[1].id]).toBe('he'); expect(simulation.ammunitionSelection[groups[2].id]).toBeUndefined();
  game.selectWeaponSlot(1); game.cycleAmmunition(1200); game.cycleAmmunition(1300);
  expect(simulation.ammunitionSelection[groups[1].id]).toBe('ap'); expect(simulation.ammunitionSelection[groups[2].id]).toBeUndefined();
  game.cycleAmmunition(2000); game.cycleAmmunition(2100);
  expect(simulation.ammunitionSelection[groups[1].id]).toBe('he'); expect(simulation.ammunitionSelection[groups[2].id]).toBeUndefined();
  expect(game.selectedAmmunition).toBe('he');
});

test('task groups become numbered control groups carrying the formation the player deployed them in', () => {
  const briefing = {
    groups: [{ id: 'g1', name: 'Battle line', formation: 'line-abreast' as const }, { id: 'g2', name: 'Screen' }, { id: 'g3', name: 'Reserve' }],
    assignments: [{ id: 'bb', groupId: 'g1' }, { id: 'ca', groupId: 'g1' }, { id: 'dd', groupId: 'g2' }],
  };
  // The deploy screen's choice wins; a group's own cruising formation stands in; column is the default.
  expect([...briefingControlGroups(briefing, { g2: 'screen' })]).toEqual([
    [1, { name: 'Battle line', shipIds: ['bb', 'ca'], formation: 'line-abreast' }],
    [2, { name: 'Screen', shipIds: ['dd'], formation: 'screen' }],
  ]);
  // An empty group takes no slot, and without a draft record each group keeps its own formation.
  expect([...briefingControlGroups(briefing)].map(([slot, group]) => [slot, group.formation])).toEqual([[1, 'line-abreast'], [2, 'column']]);
});

test('a second sortie with the same fleet reuses the hulls the first one built', async () => {
  const { game, rig } = await port();
  const loaded: string[] = [];
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => {
    const id = String(url).split('/').pop()!.replace(/\.glb(\?.*)?$/, '');
    loaded.push(id);
    const gltf = await model(id); gltf.scene.name = id; return gltf;
  });
  const setup = { playerShipId: 'bismarck', friendlyBots: ['fletcher'], enemies: ['iowa'], spawnDistance: 5000 };
  try {
    await game.prepareBattle(setup);
    expect([...loaded].sort()).toEqual(['bismarck', 'fletcher', 'iowa']);
    loaded.length = 0;
    // A whole new fleet, built from hulls the first sortie already parsed, painted and batched.
    await game.prepareBattle(setup);
    expect(loaded).toEqual([]);
    loaded.length = 0;
    await game.prepareBattle({ ...setup, enemies: ['yamato'] });
    expect(loaded).toEqual(['yamato']);
  } finally { loader.mockRestore(); rig.dispose(); game.simulation.dispose?.(); }
}, 30000);

test('kept hulls are capped, least recently used first, and never take the fleet at sea with them', async () => {
  const { game, rig } = await port();
  const internals = game as unknown as { hulls: Map<string, Group>; trimHulls(fleet: ReadonlyMap<string, Group>): Group[] };
  try {
    for (let index = 0; index < 12; index++) internals.hulls.set(`hull-${index}`, new Group());
    // The oldest entry is still afloat, so the sweep has to step over it.
    const afloat = new Map([['afloat', internals.hulls.get('hull-0')!]]);
    const evicted = internals.trimHulls(afloat);
    expect(internals.hulls.size).toBe(8);
    expect(evicted).toHaveLength(4);
    expect(internals.hulls.has('hull-0')).toBe(true);
    expect(['hull-1', 'hull-2', 'hull-3', 'hull-4'].every(key => !internals.hulls.has(key))).toBe(true);
    expect(internals.trimHulls(afloat)).toEqual([]);
  } finally { rig.dispose(); game.simulation.dispose?.(); }
});
