import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Game } from './Game';
import { CameraRig } from './CameraRig';
import { ShellFollow } from './ShellFollow';
import { ShipView } from './ShipView';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';

// Camera controls now also listen for pointer-lock and focus changes.
const browserNames = ['window', 'document'] as const;
let browserGlobals: (PropertyDescriptor | undefined)[];
beforeEach(() => {
  browserGlobals = browserNames.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  browserNames.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: new EventTarget() }));
});
afterEach(() => {
  browserNames.forEach((name, i) => {
    if (browserGlobals[i]) Object.defineProperty(globalThis, name, browserGlobals[i]!);
    else Reflect.deleteProperty(globalThis, name);
  });
});

async function model(id: string) {
  const bytes = await Bun.file(new URL(`../../public/models/${id}.glb`, import.meta.url)).arrayBuffer();
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, new DataView(bytes).getUint32(12, true))));
  return new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes,
    nodes: gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node) }), '');
}

// Exercise the real scene swap with exported joint hierarchies; only GPU startup is omitted.
async function port() {
  const definition = shipPreset('bismarck');
  const simulation = new CombatSimulation(definition);
  simulation.ship.x = 240;
  const loaded = (await model(definition.id)).scene;
  const playerView = new ShipView(loaded.clone(true), definition, simulation.player);
  const targetView = new ShipView(loaded.clone(true), definition, simulation.target);
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
    currentAim: [650, .5, -550], manualAim: true, shellFollow: new ShellFollow(),
    aircraftView: { root: new Group(), async load() {}, diagnostics() { return {}; } },
    effects: { reset() {}, diagnostics() { return {}; } },
    funnelSmoke: { diagnostics() { return {}; } },
    shipLabels: { setFleet() {} },
    ship: new Group(), inPort: true, disposed: false, switchingShip: false,
    renderer: { domElement: { setAttribute() {} } },
  }) as Game;
  return { game, scene, harbor, camera, rig, playerView };
}

test('shell commands affect only the active gun battery and reject unavailable rounds or inactive play', () => {
  const definition = shipPreset('bismarck'), simulation = new CombatSimulation(definition);
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
  let finish!: (value: typeof next) => void;
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
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
    loader.mockImplementation(async url => model(String(url).split('/').pop()!.replace('.glb', '')));
    for (const id of ['yamato', 'baltimore', 'enterprise-cv6', 'type-viic', 'bismarck']) {
      await game.switchShip(shipPreset(id));
      expect(game.definition.id).toBe(id);
      expect(scene.children).toHaveLength(5); // Harbor, aircraft, two hull roots, fleet draw adapter.
      expect(game.simulation.definition.id).toBe(id);
      expect(game.diagnostics().maxMuzzleErrorM).toBeLessThan(.025);
    }
  } finally { loader.mockRestore(); rig.dispose(); }
});

test('a second request cannot replace an in-flight switch; disposed games never attach the result', async () => {
  const { game, scene, playerView, rig } = await port();
  const next = await model('yamato');
  let finish!: (value: typeof next) => void;
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  try {
    const switching = game.switchShip(shipPreset('yamato'));
    await expect(game.switchShip(shipPreset('baltimore'))).rejects.toThrow('idle, loaded port');
    Object.assign(game, { disposed: true });
    finish(next);
    await expect(switching).rejects.toThrow('Game disposed');
    expect(game.definition.id).toBe('bismarck');
    expect(scene.children).toContain(playerView.root);
  } finally { loader.mockRestore(); rig.dispose(); }
});

test('battle loading binds each mixed fleet hull and selected target to its own exported joints', async () => {
  const { game, scene, harbor, rig } = await port();
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => model(String(url).split('/').pop()!.replace('.glb', '')));
  try {
    await game.prepareBattle({ playerShipId: 'baltimore', friendlyBots: ['bismarck', { shipId: 'bismarck', aiLevel: 'hard' }],
      enemies: [{ shipId: 'yamato', aiLevel: 'static' }, { shipId: 'enterprise-cv6', aiLevel: 'moving' }],
      spawnDistance: 7500, mapId: 'pacific-islands', timeOfDay: 'night', weather: 'fog' });
    expect(loader).toHaveBeenCalledTimes(4);
    expect(scene.children).toContain(harbor);
    expect(scene.children).toHaveLength(8); // Harbor, aircraft, five hull roots, fleet draw adapter.
    expect(game.simulation.actors).toHaveLength(5);
    expect(game.diagnostics().mapId).toBe('pacific-islands');
    expect(game.diagnostics().timeOfDay).toBe('night');
    expect(game.diagnostics().weather).toBe('fog');
    expect(game.simulation.islands).toHaveLength(3);
    expect(game.simulation.target.motion.z - game.simulation.ship.z).toBe(-7500);
    expect(game.simulation.ship.heading).toBe(0);
    expect(game.simulation.target.motion.heading).toBe(Math.PI);
    const diagnostics = game.diagnostics();
    expect(diagnostics.fleet.map(actor => actor.aiLevel)).toEqual([undefined, 'normal', 'hard', 'static', 'moving']);
    expect(diagnostics.maxMuzzleErrorM).toBeLessThan(.025);
    expect(diagnostics.renderedShips.filter(ship => ship.visible).map(ship => ship.id)).toEqual(['player']);
    game.selectTarget('enemy-2');
    expect(game.diagnostics().combat.targetName).toBe(shipPreset('enterprise-cv6').name);
    // Returning to an ordinary port ship drops all old battle actors and bindings.
    await game.switchShip(shipPreset('bismarck'));
    expect(scene.children).toHaveLength(5); // Harbor, aircraft, two hull roots, fleet draw adapter.
    expect(game.simulation.isBattle).toBe(false);
  } finally { loader.mockRestore(); rig.dispose(); }
});

test('battle preparation reports each loading stage in order for the loading screen', async () => {
  const { game, rig } = await port();
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => model(String(url).split('/').pop()!.replace('.glb', '')));
  const stages: [string, number][] = [];
  try {
    await game.prepareBattle({ playerShipId: 'baltimore', friendlyBots: ['bismarck'], enemies: ['yamato', 'enterprise-cv6'], spawnDistance: 7500, mapId: 'pacific-islands' }, (label, fraction) => stages.push([label, fraction]));
    expect(stages[0][0]).toBe('Charting Pacific Islands');
    expect(stages.map(([, fraction]) => fraction)).toEqual([...stages.map(([, fraction]) => fraction)].sort((a, b) => a - b));
    expect(stages.every(([, fraction]) => fraction >= 0 && fraction < 1)).toBe(true);
    expect(stages.map(([label]) => label)).toContain('Spotting the air wing');
    expect(stages.map(([label]) => label)).toContain('Mustering the fleets');
    expect(stages.at(-1)?.[0]).toBe('Forming the battle lines');
    // Parallel model preparation can finish after every download has arrived;
    // each completion then says "aboard" instead of naming the next download.
    expect(stages.filter(([label]) => label.startsWith('Loading ') || label.endsWith(' aboard'))).toHaveLength(5);
    // A disposed session never renders again, so a pending frame wait must not hang the loading screen.
    Object.assign(game, { disposed: true });
    await game.nextFrame();
  } finally { loader.mockRestore(); rig.dispose(); }
});

test('one failed fleet asset leaves the port intact and the same battle can be retried', async () => {
  const { game, scene, playerView, rig } = await port();
  const setup = { playerShipId: 'baltimore', friendlyBots: ['bismarck'], enemies: ['yamato', 'enterprise-cv6'], spawnDistance: 5000 };
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => {
    if (String(url).includes('enterprise')) throw new Error('Fleet asset unavailable');
    return model(String(url).split('/').pop()!.replace('.glb', ''));
  });
  try {
    await expect(game.prepareBattle(setup)).rejects.toThrow('Fleet asset unavailable');
    expect(scene.children).toContain(playerView.root);
    expect(game.definition.id).toBe('bismarck');
    loader.mockImplementation(async url => model(String(url).split('/').pop()!.replace('.glb', '')));
    await game.prepareBattle(setup);
    expect(game.simulation.actors).toHaveLength(4);
  } finally { loader.mockRestore(); rig.dispose(); }
});

test('failed aircraft loads leave the current port intact and allow another launch attempt', async () => {
  const { game, scene, playerView, rig } = await port();
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => model(String(url).split('/').pop()!.replace('.glb', '')));
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

test('spectating follows only surviving teammates, cycles duplicates, and resets after loss or port', () => {
  const definition = shipPreset('bismarck');
  const simulation = new CombatSimulation(definition, { friendlyBots: [definition, shipPreset('type-viic'), definition], enemies: [definition] });
  const camera = new PerspectiveCamera(52, 1.6, .5, 60000);
  const rig = new CameraRig(camera, new EventTarget() as HTMLCanvasElement);
  const fleetViews = simulation.actors.map(actor => ({ actor, definition: actor.definition, motion: actor.motion }));
  const game = Object.assign(Object.create(Game.prototype), {
    definition, simulation, rig, fleetViews, playerView: fleetViews[0], targetView: fleetViews.at(-1),
    inPort: false, selectedBattery: 'main', currentAim: [0, 0, -5000], ammunition: {}, shellFollow: new ShellFollow(), input: { clear() {}, order: 5, rudderOrder: 1 }, battlefieldCamera: { cancelTransition() {} },
  }) as Game;
  const update = () => (game as unknown as { updateSpectator(): void }).updateSpectator();
  try {
    game.spectateTeammate('friendly-1'); expect(game.spectatedShipId).toBeUndefined();
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
    update(); expect(game.spectatedShipId).toBe('friendly-3');
    simulation.actors[3].damage.sunk = true;
    update(); expect(game.spectatedShipId).toBeUndefined();
    game.cycleSpectator(1); expect(game.spectatedShipId).toBeUndefined();
    simulation.reset(); update(); expect(game.spectatedShipId).toBeUndefined();
    expect(telemetry().ship.id).toBe('player');
    expect(telemetry().order).toBe(5);
    simulation.player.damage.sunk = true; update(); expect(game.spectatedShipId).toBe('friendly-1');
    Object.assign(game, { inPort: true }); update(); expect(game.spectatedShipId).toBeUndefined();
  } finally { rig.dispose(); }
});

test('direct slots select a single type, never cycle, and retain selection when guns are lost', () => {
  const definition = shipPreset('bismarck'), simulation = new CombatSimulation(definition);
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
  game.selectWeaponSlot(3); expect(game.battery).toBe('torpedo');
  game.selectWeaponSlot(4); expect(game.battery).toBe('depth-charge');
});

test('single shell presses queue, rapid pairs force that choice, and slow presses cancel it', () => {
  const definition = shipPreset('bismarck'), simulation = new CombatSimulation(definition);
  const game = Object.assign(Object.create(Game.prototype), { definition, simulation, battery: 'main',
    ammunition: { main: 'ap', secondary: 'ap', torpedo: 'ap', 'depth-charge': 'ap' },
    inPort: false, paused: false, airOperationsOpen: false }) as Game;
  const main = game.weaponGroupId!;
  game.cycleAmmunition(1000);
  expect(game.ammunition[main]).toBe('he'); expect(simulation.player.mounts[0].loaded).toBe('ap');
  game.cycleAmmunition(1200);
  expect(game.ammunition[main]).toBe('he'); expect(simulation.player.mounts[0].loaded).toBe('he');
  expect(simulation.player.mounts[0].reload).toBe(definition.mounts[0].weapon.reloadSeconds);
  game.cycleAmmunition(2000); game.cycleAmmunition(2400);
  expect(game.ammunition[main]).toBe('he');
  game.cycleAmmunition(3000); game.battery = 'secondary'; game.cycleAmmunition(3100);
  expect(simulation.telemetry('main', [2000, 10, 0], main).ammunition).toBe('ap');
  expect(game.selectedAmmunition).toBe('he');
  expect(simulation.player.mounts.filter((_, i) => definition.mounts[i].battery === 'secondary').every(m => m.loaded === 'ap')).toBe(true);
});

test('rapid shell presses in different secondary groups never force a neighboring group to reload', () => {
  const definition = shipPreset('bismarck'), simulation = new CombatSimulation(definition);
  const game = Object.assign(Object.create(Game.prototype), { definition, simulation, battery: 'main',
    ammunition: {}, inPort: false, paused: false, airOperationsOpen: false }) as Game;
  const groups = game.weaponGroups;
  game.selectWeaponSlot(1); game.cycleAmmunition(1000);
  game.selectWeaponSlot(2); game.cycleAmmunition(1100);
  expect(simulation.player.mounts.every(m => m.loaded === 'ap')).toBe(true);
  game.selectWeaponSlot(1); game.cycleAmmunition(1200); game.cycleAmmunition(1300);
  expect(simulation.player.mounts.every(m => m.loaded === 'ap')).toBe(true);
  game.cycleAmmunition(2000); game.cycleAmmunition(2100);
  definition.mounts.forEach((m, i) => {
    expect(simulation.player.mounts[i].loaded).toBe(groups[1].mountIds.includes(m.id) ? 'he' : 'ap');
  });
  expect(game.selectedAmmunition).toBe('he');
});
