import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Group, PerspectiveCamera, Scene } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Game } from './Game';
import { CameraRig } from './CameraRig';
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
    currentAim: [650, .5, -550], manualAim: true,
    effects: { reset() {}, diagnostics() { return {}; } },
    shipLabels: { setFleet() {} },
    ship: new Group(), inPort: true, disposed: false, switchingShip: false,
    renderer: { domElement: { setAttribute() {} } },
  }) as Game;
  return { game, scene, harbor, camera, rig, playerView };
}

test('switching ships in port retains the scene, camera and old ship until loading completes', async () => {
  const { game, scene, harbor, camera, rig, playerView } = await port();
  const next = await model('yamato');
  let finish!: (value: typeof next) => void;
  const loader = spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const position = camera.position.toArray();
  const rotation = camera.quaternion.toArray();
  try {
    const switching = game.switchShip(shipPreset('yamato'));
    expect(scene.children).toContain(playerView.root);
    expect(game.definition.id).toBe('bismarck');
    finish(next);
    await switching;
    expect(game.definition.id).toBe('yamato');
    expect(scene.children).toContain(harbor);
    expect(scene.children).not.toContain(playerView.root);
    expect(game.simulation.ship.x).toBe(240);
    rig.update(game.simulation.ship, 0, 1 / 60);
    expect(camera.position.toArray()).toEqual(position);
    expect(camera.quaternion.toArray()).toEqual(rotation);
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
    for (const id of ['yamato', 'baltimore', 'enterprise-cv6', 'bismarck']) {
      await game.switchShip(shipPreset(id));
      expect(game.definition.id).toBe(id);
      expect(scene.children).toHaveLength(3);
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
    await game.prepareBattle({ playerShipId: 'baltimore', friendlyBots: ['bismarck', 'bismarck'], enemies: ['yamato', 'enterprise-cv6'] });
    expect(loader).toHaveBeenCalledTimes(4);
    expect(scene.children).toContain(harbor);
    expect(scene.children).toHaveLength(6);
    expect(game.simulation.actors).toHaveLength(5);
    const diagnostics = game.diagnostics();
    expect(diagnostics.maxMuzzleErrorM).toBeLessThan(.025);
    expect(diagnostics.renderedShips.filter(ship => ship.visible).map(ship => ship.id)).toEqual(['player']);
    game.selectTarget('enemy-2');
    expect(game.diagnostics().combat.targetName).toBe(shipPreset('enterprise-cv6').name);
    // Returning to an ordinary port ship drops all old battle actors and bindings.
    await game.switchShip(shipPreset('bismarck'));
    expect(scene.children).toHaveLength(3);
    expect(game.simulation.isBattle).toBe(false);
  } finally { loader.mockRestore(); rig.dispose(); }
});

test('one failed fleet asset leaves the port intact and the same battle can be retried', async () => {
  const { game, scene, playerView, rig } = await port();
  const setup = { playerShipId: 'baltimore', friendlyBots: ['bismarck'], enemies: ['yamato', 'enterprise-cv6'] };
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
