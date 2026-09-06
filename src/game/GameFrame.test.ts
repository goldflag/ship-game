import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Color, Group, PerspectiveCamera } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CombatSimulation } from '../simulation/combat';
import { ENGINE_ORDERS, FIXED_DT } from '../simulation/ship';
import { wrapAngle } from '../simulation/geometry';
import { shipPreset } from '../ships/presets';
import { CameraRig } from './CameraRig';
import { ShellFollow } from './ShellFollow';
import { Game } from './Game';
import { ShipView } from './ShipView';
import { HullDamageFeedback } from './HullDamageFeedback';
import type { GunAimPoint } from './gunAim';

const globals = ['window', 'document'] as const;
let originals: (PropertyDescriptor | undefined)[];
beforeEach(() => {
  originals = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  globals.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: new EventTarget() }));
});
afterEach(() => globals.forEach((name, i) => {
  if (originals[i]) Object.defineProperty(globalThis, name, originals[i]!); else Reflect.deleteProperty(globalThis, name);
}));

/** Exercise the real frame loop and exported joints, replacing only browser/GPU services. */
async function frameHarness() {
  const bytes = await Bun.file(new URL('../../public/models/bismarck.glb', import.meta.url)).arrayBuffer();
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, new DataView(bytes).getUint32(12, true))));
  const nodes = gltf.nodes.map(({ mesh: _mesh, ...node }: { mesh?: number }) => node);
  const model = await new GLTFLoader().parseAsync(JSON.stringify({ asset: gltf.asset, scene: gltf.scene, scenes: gltf.scenes, nodes }), '');
  const simulation = new CombatSimulation(shipPreset('bismarck'));
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
  const game = Object.assign(Object.create(Game.prototype), {
    definition: simulation.definition, simulation, playerView, targetView, fleetViews: [playerView, targetView], camera, rig, ship: new Group(), shellFollow: new ShellFollow(),
    renderer: { domElement: { setAttribute() {} } }, manualAim: false,
    shipLabels: { update() {} },
    playerDamageFeedback: new HullDamageFeedback(simulation.player.damage.integrity),
    gunAim: { update(points: GunAimPoint[], _camera: PerspectiveCamera, visible: boolean) { gunAimFrames.push({ points, visible }); } },
    hitDirections: { update() {} },
    lastTime: 0, hudTime: Infinity, lastTrailTick: 0, trail: [], fps: 60, battery: 'main',
    ammunition: { main: 'ap', secondary: 'ap' },
    paused: false, inPort: false, inspecting: false,
    input: { sample: () => helm, firing: false, setEnabled() {},
      setOrder: (order: number) => { helm.throttle = ENGINE_ORDERS[order]; },
      setRudder: (rudder: number) => { helm.rudder = rudder; } },
    effects: { update() {}, reset() {} }, sky: { update() {} },
    surfaceWaterAbsorption: new Color(.296, .105, .095),
    water: { color: { absorptionColor: new Color(.296, .105, .095) }, async update() {} },
    shipWake: { update: (ship: { z: number }) => wakePositions.push(ship.z), reset() {} },
    pipeline: { render() {} }, scheduleFrame() {}, updateSeaState() {}, updatePortLighting() {},
    callbacks: { pause() {}, error: (message: string) => { throw new Error(message); } },
  }) as { frame(time: number): Promise<void>; setInPort(inPort: boolean): void; toggleBinoculars(): void; toggleShellFollow(): void; shellFollow: ShellFollow;
    manualAim: boolean; currentAim: number[]; paused: boolean; inspecting: boolean };
  return { game, simulation, playerView, targetView, camera, rig, helm, wakePositions, focusPositions, gunAimFrames };
}

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
  expect(camera.fov).toBe(fov);
  expect(camera.position.distanceTo(playerView.root.position)).toBeLessThan(100);
  game.toggleShellFollow();
  game.setInPort(true);
  expect(game.shellFollow.phase).toBe('off');
  expect(rig.binoculars).toBe(false);
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
