import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Color, DirectionalLight, Group, PerspectiveCamera, Vector3, InstancedBufferGeometry, InstancedMesh, MeshBasicMaterial } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CombatSimulation } from '../simulation/combat';
import { ENGINE_ORDERS, FIXED_DT } from '../simulation/ship';
import { localToWorld, wrapAngle } from '../simulation/geometry';
import { aircraftDeckSpot } from '../simulation/aircraft';
import { shipPreset } from '../ships/presets';
import { CameraRig } from './CameraRig';
import { BattlefieldCamera } from './BattlefieldCamera';
import { ShellFollow } from './ShellFollow';
import { Game } from './Game';
import { VisualEnvironment } from './VisualEnvironment';
import { FrameScene } from './FrameScene';
import { FleetVisibility } from './FleetVisibility';
import { ShipView } from './ShipView';
import { HullDamageFeedback } from './HullDamageFeedback';
import { gunAimPoints, type GunAimPoint } from './gunAim';
import { projectGunAim } from './GunAimIndicators';
import { barrelIds, type Vec3 } from '../ships/blueprint';
import { OCEAN_MAPS, DEFAULT_MAP, oceanMap } from '../maps/catalog';

const globals = ['window', 'document'] as const;
let originals: (PropertyDescriptor | undefined)[];
beforeEach(() => {
  originals = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  globals.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: new EventTarget() }));
});
afterEach(() => globals.forEach((name, i) => {
  if (originals[i]) Object.defineProperty(globalThis, name, originals[i]!); else Reflect.deleteProperty(globalThis, name);
}));

/** Water Pro's live uniforms, without its GPU simulation. */
function fakeWater() {
  return {
    lighting: { sunLight: new DirectionalLight() },
    underwaterDistortion: { intensity: .02 },
    color: { absorptionColor: new Color(.296, .105, .095), waterColor: new Color(), transmissionColor: new Color(),
      update(colors: { waterColor: string; transmissionColor: string; absorptionColor: string }) {
        this.waterColor.set(colors.waterColor); this.transmissionColor.set(colors.transmissionColor); this.absorptionColor.set(colors.absorptionColor);
      } },
    waves: { amplitude: { value: 0 }, windSpeed: { value: 8 }, peakWavelength: { value: 0 }, choppiness: { value: 0 }, windDirection: { value: .5 }, dirty: false },
    foam: { waves: { opacity: 0, color: new Color() }, surface: { color: new Color() }, shoreline: { color: new Color() } },
    fog: {}, getGeometryConfig: () => ({ infinityRingExtent: 950000 }),
    async update() {},
  };
}

/** Exercise the real frame loop and exported joints, replacing only browser/GPU services. */
async function frameHarness(shipId = 'bismarck') {
  const bytes = await Bun.file(new URL(`../../public/models/${shipId}.glb`, import.meta.url)).arrayBuffer();
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, new DataView(bytes).getUint32(12, true))));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const simulation = new CombatSimulation(shipPreset(shipId));
  simulation.ship.speed = simulation.definition.handling.forwardSpeed;
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  const rig = new CameraRig(camera, { addEventListener() {} } as unknown as HTMLCanvasElement);
  const playerView = new ShipView(model.scene, simulation.definition, simulation.player);
  const targetView = new ShipView(model.scene.clone(true), simulation.definition, simulation.target);
  const wakePositions: number[] = [];
  const focusPositions: number[] = [];
  const gunAimFrames: { points: GunAimPoint[]; visible: boolean }[] = [];
  const updateCamera = rig.update.bind(rig);
  rig.update = (ship, ...args) => { focusPositions.push(ship.z); updateCamera(ship, ...args); };
  const helm = { throttle: 1, rudder: 0 };
  const water = fakeWater();
  const environment = new VisualEnvironment({ effects: { setWind() {}, setSun() {}, setIllumination() {} }, funnelSmoke: { setWind() {} }, sunAnchor: new Group() });
  environment.attachWater(water as never);
  const battlefieldCamera = new BattlefieldCamera(camera);
  const input = { sample: () => helm, firing: false, clear() {}, setEnabled() {},
    setOrder: (order: number) => { helm.throttle = ENGINE_ORDERS[order]; },
    setRudder: (rudder: number) => { helm.rudder = rudder; } };
  const game = Object.assign(Object.create(Game.prototype), {
    definition: simulation.definition, simulation, playerView, targetView, fleetViews: [playerView, targetView], camera, rig, ship: new Group(), shellFollow: new ShellFollow(),
    renderer: { domElement: { setAttribute() {} } }, manualAim: false, battlefieldCamera, cameraFrameListeners: new Set(), fleetVisibility: new FleetVisibility(),
    host: { clientWidth: 1440, clientHeight: 900 }, airOperationsOpen: false,
    shipLabels: { update() {} }, hitLabels: { update() {} }, torpedoPreview: { update() {} },
    playerDamageFeedback: new HullDamageFeedback(simulation.player.damage.integrity),
    gunAim: { update(points: GunAimPoint[], _camera: PerspectiveCamera, visible: boolean) { gunAimFrames.push({ points, visible }); } },
    hitDirections: { update() {} },
    lastTime: 0, hudTime: Infinity, lastTrailTick: 0, trail: [], fps: 60, battery: 'main',
    ammunition: { main: 'ap', secondary: 'ap' },
    paused: false, inPort: false, inspecting: false, input,
    aircraftView: { root: new Group(), update() {}, warmupParts() { return () => {}; } },
    funnelSmoke: { root: new Group(), update() {}, setWind() {} },
    effects: { root: new Group(), update() {}, reset() {} }, scene: new FrameScene(), water, environment,
    shipWake: { update: (ships: ShipView[]) => wakePositions.push(ships[0].motion.z), reset() {} },
    pipeline: { render() {} }, scheduleFrame() {}, frameWaiters: [],
    callbacks: { pause() {}, error: (message: string) => { throw new Error(message); } },
  }) as { frame(time: number, warmingUp?: boolean): Promise<void>; setInPort(inPort: boolean): void; toggleBinoculars(): void; toggleShellFollow(): void; shellFollow: ShellFollow;
    setAirOperationsOpen(open: boolean): void; followAircraft(id: string): void; returnToShip(): void; fire(): void; setPaused(paused: boolean): void;
    airOperationsOpen: boolean; manualAim: boolean; currentAim: number[]; paused: boolean; inspecting: boolean };
  return { game, simulation, playerView, targetView, camera, rig, helm, input, battlefieldCamera, water, environment, wakePositions, focusPositions, gunAimFrames };
}
const followedAircraft = (game: object) => Reflect.get(game, 'followedAircraftId') as string | undefined;
const rigEnabled = (rig: CameraRig) => Reflect.get(rig, 'enabled') as boolean;

test('render warmup draws without advancing combat or starting a second animation loop', async () => {
  const { game, simulation } = await frameHarness();
  const before = structuredClone(simulation.ship);
  const geometry = new InstancedBufferGeometry(); geometry.instanceCount = 0;
  const hidden = new InstancedMesh(geometry, new MeshBasicMaterial(), 8); hidden.visible = false;
  Reflect.get(game, 'aircraftView').root.add(hidden);
  let renders = 0, scheduled = 0, partsWarming = false, restoredParts = 0;
  Reflect.get(game, 'aircraftView').warmupParts = () => {
    partsWarming = true;
    return () => { partsWarming = false; restoredParts++; };
  };
  Object.assign(game, { pipeline: { render() { renders++; if (renders <= 12) { expect(partsWarming).toBe(true); expect(hidden.visible).toBe(true); expect(geometry.instanceCount).toBe(1); expect(hidden.count).toBe(8); } } }, scheduleFrame() { scheduled++; } });
  for (let i = 0; i < 12; i++) await game.frame(10000 + i * 1000, true);
  expect(hidden.visible).toBe(false); expect(geometry.instanceCount).toBe(0);
  expect(simulation.ship).toEqual(before);
  expect(renders).toBe(12); expect(scheduled).toBe(0);
  expect(partsWarming).toBe(false); expect(restoredParts).toBe(12);
  await game.frame(21020);
  expect(simulation.ship.tick).toBeGreaterThan(before.tick);
  expect(scheduled).toBe(1);
  hidden.dispose(); hidden.material.dispose(); geometry.dispose();
});

test('battle loading holds input and starts one loop only after graphics finish successfully', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value() {} });
  try {
    for (const failure of [false, true]) {
      let finish!: () => void, enabled = true, scheduled = 0;
      const graphics = new Promise<void>(resolve => { finish = resolve; });
      const game = Object.assign(Object.create(Game.prototype), {
        input: { setEnabled(value: boolean) { enabled = value; } },
        setInPort() {}, scheduleFrame() { scheduled++; },
        async warmupRendering() { await graphics; if (failure) throw new Error('Graphics failed'); },
      }) as Game;
      const loading = game.beginBattle();
      await Promise.resolve();
      expect(enabled).toBe(false); expect(scheduled).toBe(0);
      finish();
      if (failure) {
        await expect(loading).rejects.toThrow('Graphics failed');
        expect(enabled).toBe(false); expect(scheduled).toBe(0);
      } else {
        await loading;
        expect(enabled).toBe(true); expect(scheduled).toBe(1);
      }
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'cancelAnimationFrame', original);
    else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
  }
});

test('map and port transitions restore their own absorption after underwater attenuation', async () => {
  const { game, simulation, water, environment } = await frameHarness();
  const { absorptionColor } = water.color;
  for (const map of OCEAN_MAPS) {
    Object.assign(simulation, { mapId: map.id });
    for (const inPort of [false, true]) {
      Object.assign(game, { inPort });
      environment.setScene(map.id, inPort);
      const expected = new Color((inPort ? oceanMap(DEFAULT_MAP) : map).water.absorptionColor);
      absorptionColor.multiplyScalar(.05);
      await game.frame(16);
      expect(absorptionColor.toArray()).toEqual(expected.toArray());
    }
  }
});

test('underwater distortion eases down with camera depth and restores without accumulating', async () => {
  const { game, camera, rig, water } = await frameHarness();
  rig.update = () => {};
  for (const [height, scale] of [[12, 1], [0, 1], [-1, .575], [-2, .15], [-50, .15], [-150, .15], [-1, .575], [12, 1], [-50, .15], [12, 1]]) {
    camera.position.y = height;
    await game.frame(16);
    expect(water.underwaterDistortion.intensity).toBeCloseTo(.02 * scale, 10);
  }
});

test('turning through north takes the short heading path without changing authoritative combat state', async () => {
  const { game, simulation, playerView, helm } = await frameHarness();
  helm.rudder = 1;
  Object.assign(simulation.ship, { heading: Math.PI * 2 - .0001, yawRate: simulation.definition.handling.maxYawRate, rudder: 1 });
  playerView.snap();
  const reference = new CombatSimulation(simulation.definition);
  Object.assign(reference.ship, simulation.ship);
  let time = 0;
  let previousHeading = playerView.motion.heading;
  for (let frame = 0; frame < 180; frame++) {
    const dt = 1 / 144;
    reference.advance(dt, helm, { aim: reference.aimAt(), fire: false, battery: 'main' });
    await game.frame(time += dt * 1000);
    const turn = wrapAngle(playerView.motion.heading - previousHeading);
    expect(turn).toBeGreaterThanOrEqual(-1e-12);
    expect(turn).toBeLessThan(.001);
    previousHeading = playerView.motion.heading;
    expect(simulation.player).toEqual(reference.player);
    expect(simulation.target).toEqual(reference.target);
    expect(Math.max(...playerView.muzzleErrors())).toBeLessThan(.025);
  }
  expect(simulation.ship.heading).toBeLessThan(.1);
});

test('firing enters shell view without feeding its camera into aim, freezes on pause and restores optics', async () => {
  const { game, simulation, camera, rig, playerView, gunAimFrames } = await frameHarness();
  game.manualAim = true;
  rig.aimAt([2500, 0, -2500], playerView.motion);
  game.toggleBinoculars();
  for (let i = 0; i < 180; i++) rig.update(playerView.motion, playerView.motion.y, 1 / 60);
  const fov = camera.fov;
  let time = 0;
  for (let i = 0; i < 600; i++) await game.frame(time += 1000 / 60);
  expect(gunAimFrames.at(-1)!.visible).toBe(true);
  expect(gunAimFrames.at(-1)!.points).toHaveLength(4);
  game.toggleShellFollow();
  simulation.requestFire();
  await game.frame(time += 1000 / 60);
  expect(game.shellFollow.phase).toBe('flight');
  expect(gunAimFrames.at(-1)).toEqual({ points: [], visible: false });
  expect(rig.binoculars).toBe(false);
  expect(playerView.root.visible).toBe(true);
  const aim = [...game.currentAim];
  for (let i = 0; i < 8; i++) {
    await game.frame(time += 1000 / 60);
    expect(game.currentAim).toEqual(aim);
  }
  game.paused = true;
  const position = camera.position.clone(), tick = simulation.tick;
  await game.frame(time += 100);
  expect(camera.position).toEqual(position);
  expect(simulation.tick).toBe(tick);
  game.paused = false;
  game.toggleShellFollow();
  expect(game.shellFollow.phase).toBe('off');
  expect(rig.binoculars).toBe(true);
  expect(camera.fov).toBeCloseTo(fov, 10);
  expect(camera.position.distanceTo(playerView.root.position)).toBeLessThan(100);
  game.toggleShellFollow();
  game.setInPort(true);
  expect(game.shellFollow.phase).toBe('off');
  expect(rig.binoculars).toBe(false);
});

test('death exits binoculars without a surviving teammate and prevents scope reentry', async () => {
  const { game, simulation, rig, camera, playerView } = await frameHarness();
  await game.frame(16);
  game.toggleBinoculars();
  await game.frame(32);
  expect(rig.binoculars).toBe(true);
  simulation.player.damage.sunk = true;
  await game.frame(48);
  expect(rig.binoculars).toBe(false);
  expect(camera.fov).toBeCloseTo(52);
  expect(playerView.root.visible).toBe(true);
  game.toggleBinoculars();
  expect(rig.binoculars).toBe(false);
});

test('shell-follow cannot restore binoculars after player death', async () => {
  const { game, simulation, rig, camera } = await frameHarness();
  await game.frame(16);
  game.toggleBinoculars();
  rig.setShellView({ position: [0, 100, 0], velocity: [0, 0, -100] });
  simulation.player.damage.sunk = true;
  await game.frame(32);
  expect(rig.binoculars).toBe(false);
  expect(camera.fov).toBeCloseTo(52);
});

test('target inspection follows the interpolated underway target and resets without a streak', async () => {
  const { game, simulation, targetView, focusPositions } = await frameHarness();
  simulation.targetUnderway = true;
  simulation.target.motion.speed = simulation.definition.handling.forwardSpeed * .25;
  game.inspecting = true;
  let time = 0;
  for (let frame = 0; frame < 90; frame++) {
    const before = targetView.root.position.z;
    await game.frame(time += 1000 / 144);
    if (frame > 3) expect((before - targetView.root.position.z) * 144).toBeCloseTo(simulation.target.motion.speed, 7);
    expect(focusPositions.at(-1)).toBe(targetView.root.position.z);
  }
  simulation.resetTarget();
  game.paused = true;
  await game.frame(time += 1000 / 144);
  expect(targetView.motion).toEqual(simulation.target.motion);
});

test('pause holds the interpolated pose and resume continues without a tick-sized jump', async () => {
  const { game, simulation, playerView } = await frameHarness();
  let time = 0;
  for (let frame = 0; frame < 8; frame++) await game.frame(time += 1000 / 144);
  const position = playerView.root.position.clone(), tick = simulation.tick;
  game.paused = true;
  for (let frame = 0; frame < 10; frame++) {
    await game.frame(time += 1000 / 59);
    expect(playerView.root.position).toEqual(position);
    expect(simulation.tick).toBe(tick);
  }
  game.paused = false;
  await game.frame(time += 1000 / 144);
  expect((position.z - playerView.root.position.z) * 144).toBeCloseTo(simulation.ship.speed, 7);
  expect(Math.abs(simulation.ship.z - playerView.motion.z)).toBeLessThanOrEqual(simulation.ship.speed * FIXED_DT);
});

test('manual aiming and binoculars keep the camera attached to the displayed ship at full speed', async () => {
  const { game, playerView, camera, rig } = await frameHarness();
  game.manualAim = true;
  rig.aimAt([650, .5, -550], playerView.motion);
  let time = 0;
  for (const binoculars of [false, true, false]) {
    if (rig.binoculars !== binoculars) game.toggleBinoculars();
    for (let frame = 0; frame < 180; frame++) await game.frame(time += 1000 / 144);
    await game.frame(time += 1000 / 144);
    const offset = camera.position.clone().sub(playerView.root.position);
    for (let frame = 0; frame < 30; frame++) {
      await game.frame(time += [1000 / 144, 1000 / 47, 1000 / 72, 43][frame % 4]);
      expect(camera.position.clone().sub(playerView.root.position).distanceTo(offset)).toBeLessThan(1e-9);
      expect(playerView.root.visible).toBe(!binoculars);
      expect(game.currentAim.every(Number.isFinite)).toBe(true);
    }
  }
});

test('gun circles follow the displayed barrels between simulation ticks in rolling seas', async () => {
  const { game, simulation, playerView, camera, rig, gunAimFrames } = await frameHarness();
  const aim: Vec3 = [5000, .5, -2000];
  simulation.aimAt = () => aim;
  Object.assign(simulation.sea, { amplitudeM: 1.5, windMps: 12 });
  // Keep the sight completely still at high magnification while the hull moves.
  rig.update = () => {};
  camera.position.set(0, 36, 0);
  camera.fov = 2 * Math.atan(Math.tan(52 * Math.PI / 360) / 24) * 180 / Math.PI;
  camera.updateProjectionMatrix(); camera.lookAt(new Vector3(...aim)); camera.updateMatrixWorld();
  let time = 0;
  for (let frame = 0; frame < 600; frame++) await game.frame(time += 1000 / 60);
  const nodes = new Map<string, Group>();
  playerView.model.traverse(node => { if (node.userData.nodeId) nodes.set(node.userData.nodeId, node as Group); });
  for (const dt of Array.from({ length: 30 }, (_, i) => [1000 / 144, 1000 / 144, 1000 / 47, 1000 / 120][i % 4])) {
    await game.frame(time += dt);
    const mounts = simulation.player.mounts.map((state, i) => {
      const mount = simulation.definition.mounts[i];
      return { ...state,
        train: -nodes.get(`${mount.id}.yaw`)!.rotation.y - mount.bearingDeg * Math.PI / 180,
        elevation: nodes.get(`${mount.id}.${barrelIds(mount.weapon)[0]}.elevation`)!.rotation.x };
    });
    const expected = gunAimPoints({ ...simulation.player, motion: playerView.motion, mounts }, simulation.definition, 'main', aim);
    const actual = gunAimFrames.at(-1)!.points;
    for (let i = 0; i < actual.length; i++) {
      const displayed = projectGunAim(new Vector3(...expected[i].point), camera, 1440, 900);
      const circle = projectGunAim(new Vector3(...actual[i].point), camera, 1440, 900);
      expect(Math.hypot(circle.x - displayed.x, circle.y - displayed.y)).toBeLessThan(.01);
      expect(actual[i].status).toBe(simulation.player.mounts[i].status);
    }
  }
});

for (const fps of [60, 144]) test(`a stationary binocular sight has no abrupt vertical gun-circle jumps as the ship bobs at ${fps} fps`, async () => {
  const { game, simulation, playerView, camera, rig, helm, gunAimFrames } = await frameHarness();
  helm.throttle = 0; simulation.ship.speed = 0; playerView.snap();
  Object.assign(simulation.sea, { amplitudeM: .96, windMps: 0 });
  Object.assign(rig, { scopeMagnification: 24 });
  game.manualAim = true;
  rig.aimAt([5000, .5, -2000], playerView.motion);
  game.toggleBinoculars();
  let time = 0;
  for (let frame = 0; frame < 1200; frame++) await game.frame(time += 1000 / 60);
  let previousY: number | undefined, maxJump = 0, minHeave = Infinity, maxHeave = -Infinity;
  for (let frame = 0; frame < fps * 5; frame++) {
    await game.frame(time += 1000 / fps);
    const point = gunAimFrames.at(-1)!.points[0];
    const screen = projectGunAim(new Vector3(...point.point), camera, 1440, 900);
    expect(screen.edge).toBe(false);
    if (previousY !== undefined) maxJump = Math.max(maxJump, Math.abs(screen.y - previousY));
    previousY = screen.y;
    minHeave = Math.min(minHeave, playerView.motion.y); maxHeave = Math.max(maxHeave, playerView.motion.y);
  }
  expect(maxHeave - minHeave).toBeGreaterThan(.01);
  expect(maxJump).toBeLessThan(1);
});

test('repositioning for port and launch clears the old ship poses', async () => {
  const { game, simulation, playerView, gunAimFrames } = await frameHarness();
  await game.frame(50);
  game.setInPort(true);
  await game.frame(55);
  expect(gunAimFrames.at(-1)).toEqual({ points: [], visible: false });
  expect(playerView.motion).toEqual(simulation.ship);
  expect(playerView.motion.x).toBe(240);
  expect(simulation.tick).toBe(0);
  game.setInPort(false);
  await game.frame(60);
  expect(playerView.motion).toEqual(simulation.ship);
  expect(playerView.motion.x).toBe(0);
  expect(Math.max(...playerView.muzzleErrors())).toBeLessThan(.025);
});

for (const frameTimes of [[1 / 30], [1 / 59], [1 / 60], [1 / 120], [1 / 144], [1 / 144, 1 / 47, 1 / 72, .043]]) {
  test(`full-speed frame movement stays uniform at frame intervals ${frameTimes}`, async () => {
    const { game, simulation, playerView, wakePositions, focusPositions } = await frameHarness();
    let time = 0;
    for (let frame = 0; frame < 90; frame++) {
      const dt = frameTimes[frame % frameTimes.length];
      const before = playerView.root.position.z;
      await game.frame(time += dt * 1000);
      if (frame > 3) expect((before - playerView.root.position.z) / dt).toBeCloseTo(simulation.ship.speed, 7);
      expect(wakePositions.at(-1)).toBe(playerView.root.position.z);
      expect(focusPositions.at(-1)).toBe(playerView.root.position.z);
    }
  });
}

test('all fleet impact marks share one cosmetic work budget, renewed for each frame', async () => {
  const { game, playerView, targetView } = await frameHarness();
  const budgets: { remainingMs: number }[] = [], available: number[] = [];
  for (const view of [playerView, targetView]) view.impactMarks.update = (_events, _id, budget) => {
    if (!budget) throw new Error('Missing fleet impact budget');
    budgets.push(budget); available.push(budget.remainingMs); budget.remainingMs = 0;
  };
  await game.frame(1000 / 60);
  await game.frame(2000 / 60);
  expect(available).toEqual([2, 0, 2, 0]);
  expect(budgets[0]).toBe(budgets[1]); expect(budgets[2]).toBe(budgets[3]);
  expect(budgets[0]).not.toBe(budgets[2]);
});


test('the frame feeds every fleet wake the rendered pose, and only the player in port', async () => {
  const { game, playerView, targetView } = await frameHarness();
  const frames: { ships: ShipView[]; positions: number[] }[] = [];
  Object.assign(game, { shipWake: {
    update(ships: ShipView[]) { frames.push({ ships: [...ships], positions: ships.map(ship => ship.motion.z) }); }, reset() {},
  } });
  await game.frame(100);
  expect(frames.at(-1)!.ships).toEqual([playerView, targetView]);
  expect(frames.at(-1)!.positions).toEqual([playerView.root.position.z, targetView.root.position.z]);
  game.setInPort(true);
  await game.frame(200);
  expect(frames.at(-1)!.ships).toEqual([playerView]);
});

test('binoculars, then shell follow, then death: the follow never feeds the sight and death forbids returning to optics', async () => {
  const { game, simulation, camera, rig, playerView, gunAimFrames, input } = await frameHarness();
  const requests = spyOn(simulation, 'requestFire');
  game.manualAim = true;
  rig.aimAt([2500, 0, -2500], playerView.motion);
  let time = 0;
  await game.frame(time += 1000 / 60);
  game.toggleBinoculars();
  for (let i = 0; i < 600; i++) await game.frame(time += 1000 / 60);
  expect(rig.binoculars).toBe(true);
  game.fire(); expect(requests).toHaveBeenCalledTimes(1);
  game.toggleShellFollow();
  await game.frame(time += 1000 / 60);
  expect(game.shellFollow.phase).toBe('flight');
  expect(rig.binoculars).toBe(false);
  expect(gunAimFrames.at(-1)!.visible).toBe(false);
  const frozen = [...game.currentAim];
  input.firing = true;
  for (let i = 0; i < 30; i++) await game.frame(time += 1000 / 60);
  expect(game.currentAim).toEqual(frozen);
  expect(camera.position.distanceTo(playerView.root.position)).toBeGreaterThan(300);
  simulation.player.damage.sunk = true;
  await game.frame(time += 1000 / 60);
  expect(rig.binoculars).toBe(false); expect(camera.fov).toBeCloseTo(52);
  game.fire(); expect(requests).toHaveBeenCalledTimes(1);
  game.returnToShip();
  await game.frame(time += 1000 / 60);
  expect(game.shellFollow.phase).toBe('off');
  expect(rig.binoculars).toBe(false); expect(camera.fov).toBeCloseTo(52);
  expect(gunAimFrames.at(-1)).toEqual({ points: [], visible: false });
  expect(camera.position.distanceTo(playerView.root.position)).toBeLessThan(400);
  game.toggleBinoculars(); expect(rig.binoculars).toBe(false);
  game.toggleShellFollow(); expect(game.shellFollow.phase).toBe('off');
});

test('air map, then aircraft follow, then return: the sight freezes overhead and returns with the gun circles and fire commands', async () => {
  const { game, simulation, camera, playerView, battlefieldCamera, gunAimFrames, input } = await frameHarness('enterprise-cv6');
  const requests = spyOn(simulation, 'requestFire');
  game.manualAim = true;
  let time = 0;
  for (let i = 0; i < 5; i++) await game.frame(time += 1000 / 60);
  expect(gunAimFrames.at(-1)!.visible).toBe(true);
  game.fire(); expect(requests).toHaveBeenCalledTimes(1);
  game.setAirOperationsOpen(true);
  expect(game.airOperationsOpen).toBe(true);
  expect(battlefieldCamera.transitioning).toBe(true);
  const frozen = [...game.currentAim];
  game.fire(); expect(requests).toHaveBeenCalledTimes(1);
  input.firing = true;
  const rounds = () => simulation.player.mounts.reduce((n, m) => n + m.ammo, 0);
  const stock = rounds();
  for (let i = 0; i < 100; i++) await game.frame(time += 1000 / 60);
  expect(battlefieldCamera.transitioning).toBe(false);
  expect(camera.position.y).toBeGreaterThan(1000);
  expect(gunAimFrames.at(-1)).toEqual({ points: [], visible: false });
  expect(game.currentAim).toEqual(frozen);
  expect(rounds()).toBe(stock);
  // Following a parked aircraft closes the map and descends onto its deck spot.
  const plane = simulation.player.airWing!.planes[0];
  plane.deckSlot = 0;
  game.followAircraft(plane.id);
  expect(game.airOperationsOpen).toBe(false);
  expect(followedAircraft(game)).toBe(plane.id);
  for (let i = 0; i < 100; i++) await game.frame(time += 1000 / 60);
  const deck = new Vector3(...localToWorld(aircraftDeckSpot(simulation.player, plane), playerView.motion));
  expect(camera.position.distanceTo(deck)).toBeLessThan(100);
  expect(gunAimFrames.at(-1)!.visible).toBe(false);
  expect(game.currentAim).toEqual(frozen);
  // Losing the aircraft ends its follow on its own.
  plane.phase = 'lost';
  await game.frame(time += 1000 / 60);
  expect(followedAircraft(game)).toBeUndefined();
  expect(gunAimFrames.at(-1)!.visible).toBe(true);
  expect(camera.position.distanceTo(playerView.root.position)).toBeLessThan(400);
  game.fire(); expect(requests).toHaveBeenCalledTimes(2);
  // Return by command restores the same view.
  plane.phase = 'ready';
  game.followAircraft(plane.id);
  await game.frame(time += 1000 / 60);
  expect(followedAircraft(game)).toBe(plane.id);
  expect(gunAimFrames.at(-1)!.visible).toBe(false);
  game.returnToShip();
  await game.frame(time += 1000 / 60);
  expect(followedAircraft(game)).toBeUndefined();
  expect(gunAimFrames.at(-1)!.visible).toBe(true);
  expect(camera.position.distanceTo(playerView.root.position)).toBeLessThan(400);
});

test('pausing during the map descent freezes combat while the camera finishes, and closing the map while paused keeps the rig idle', async () => {
  const { game, simulation, rig, battlefieldCamera } = await frameHarness('enterprise-cv6');
  let time = 0;
  for (let i = 0; i < 5; i++) await game.frame(time += 1000 / 60);
  game.setAirOperationsOpen(true);
  for (let i = 0; i < 100; i++) await game.frame(time += 1000 / 60);
  game.setAirOperationsOpen(false);
  expect(battlefieldCamera.transitioning).toBe(true);
  expect(rigEnabled(rig)).toBe(true);
  game.setPaused(true);
  expect(rigEnabled(rig)).toBe(false);
  const tick = simulation.tick;
  for (let i = 0; i < 100; i++) await game.frame(time += 1000 / 60);
  expect(simulation.tick).toBe(tick);
  expect(battlefieldCamera.transitioning).toBe(false);
  game.setPaused(false);
  expect(rigEnabled(rig)).toBe(true);
  await game.frame(time += 1000 / 60);
  expect(simulation.tick).toBeGreaterThan(tick);
  game.setAirOperationsOpen(true);
  expect(rigEnabled(rig)).toBe(false);
  game.setPaused(true);
  game.setAirOperationsOpen(false);
  expect(game.airOperationsOpen).toBe(false);
  expect(rigEnabled(rig)).toBe(false);
  game.setPaused(false);
  expect(rigEnabled(rig)).toBe(true);
});
