import { expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AirOperations } from '../ui/AirOperations';
import { chartPoint, chartWorld, fitAirChart } from '../ui/airChart';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { defaultKeybindings, keybindingsOf } from './keybindings';
import { Game } from './Game';
import { ShellFollow } from './ShellFollow';
import { BattlefieldCamera } from './BattlefieldCamera';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu';
import { WaterSurfaceGeometry, WaterSystem } from '../../vendor/threejs-water-pro/build/index.js';
import { battleEnvironment } from '../maps/conditions';
import { oceanMap } from '../maps/catalog';
import { squadronTargetOrder } from '../ui/airCommands';

test('map overlays and water orders use the displayed camera throughout ascent and panning', () => {
  const camera = new PerspectiveCamera(52, 1.6, .5, 60000);
  camera.position.set(0, 50, 300); camera.lookAt(0, 0, 0);
  const battlefieldCamera = new BattlefieldCamera(camera);
  const game = Object.assign(Object.create(Game.prototype), { camera, battlefieldCamera, hudScale: 1, host: { clientWidth: 1280, clientHeight: 800 } }) as Game;
  battlefieldCamera.beginTransition(); battlefieldCamera.enter([{ x: 0, z: 0 }], 1280, 800);
  for (let i = 0; i < 7; i++) {
    battlefieldCamera.update(); battlefieldCamera.applyTransition(.2);
    const [x, y] = game.projectAirMap(100, -200);
    const water = game.airMapWater(x, y)!;
    expect(water[0]).toBeCloseTo(100, 5); expect(water[1]).toBeCloseTo(-200, 5);
  }
  const before = game.projectAirMap(100, -200);
  game.panAirMap(90, 0); battlefieldCamera.update();
  const after = game.projectAirMap(100, -200);
  expect(after[0]).not.toBe(before[0]);
});

test('an armed action refuses an incompatible click without issuing a different mission', () => {
  expect(squadronTargetOrder('attack', { kind: 'water', point: [200, 420, -900] })).toBeUndefined();
  expect(squadronTargetOrder('defend', { kind: 'ship', team: 'enemy', id: 'enemy-1' })).toBeUndefined();
  expect(squadronTargetOrder('intercept', { kind: 'squadron', team: 'friendly', id: 'ally-flight' })).toBeUndefined();
  expect(squadronTargetOrder('escort', { kind: 'ship', team: 'friendly', id: 'ally' })).toBeUndefined();
  expect(squadronTargetOrder(undefined, { kind: 'ship', team: 'enemy', id: 'enemy-1' })).toEqual({ kind: 'attack', targetId: 'enemy-1' });
  expect(squadronTargetOrder('defend', { kind: 'ship', team: 'friendly', id: 'ally' })).toEqual({ kind: 'defend', targetId: 'ally' });
  expect(squadronTargetOrder('intercept', { kind: 'squadron', team: 'enemy', id: 'enemy-flight' })).toEqual({ kind: 'intercept', flightId: 'enemy-flight' });
});

test('air chart fits distant aircraft in wide and narrow windows and maps clicks back to world coordinates', () => {
  const points = [{ x: -22000, z: 8000 }, { x: 14000, z: -24000 }, { x: 0, z: 0 }];
  for (const [width, height] of [[1000, 540], [350, 280]]) {
    const view = fitAirChart(points, width, height);
    for (const p of points) {
      const [x, y] = chartPoint(view, width, height, p.x, p.z);
      expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(width);
      expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(height);
      const actual = chartWorld(view, width, height, x, y);
      expect(actual[0]).toBeCloseTo(p.x); expect(actual[1]).toBeCloseTo(p.z);
    }
  }
});

test('the operations roster exposes the full inventory and retains a flight target when the ship target changes', () => {
  const def = shipPreset('enterprise-cv6');
  const sim = new CombatSimulation(def, { friendlyBots: [], enemies: [shipPreset('bismarck'), shipPreset('yamato')] });
  sim.launchAircraft('vb-6'); sim.selectTarget(sim.actors[2].motion.id);
  const html = renderToStaticMarkup(<AirOperations data={{ ship: sim.ship, order: 1, camera: 'Chase', trail: [], fps: 60, backend: 'test', airOperationsOpen: true, selectedFlightId: sim.player.airWing!.flights[0].id, combat: sim.telemetry('main', [0, 0, -5000]) }} game={null} bindings={defaultKeybindings()}/>);
  expect(html).not.toContain('48/48 aircraft'); expect(html).toContain('Strike Bismarck');
  expect(html).toContain('Fit battlefield'); expect(html).toContain('Return squadron');
  expect(html).not.toContain('Right-click water to loiter'); expect(html).toContain('map hotkey 8');
  expect(html).not.toContain('air-battlefield-grid'); expect(html).not.toContain('Ready in hangar');
  expect(html).toContain('aria-keyshortcuts="a"'); expect(html).toContain('aria-keyshortcuts="r"');
  expect(html).toContain('f4f-4-wildcat-thumbnail.png'); expect(html).toContain('sbd-3-dauntless-thumbnail.png'); expect(html).toContain('tbd-1-devastator-thumbnail.png');
  expect(html).toContain('air-battlefield-map'); expect(html).not.toContain('<dialog');
  expect(html).toContain('air-box-launching');

});

test('the map releases aim, blocks firing and restores aiming on close without losing flight selection', () => {
  const simulation = new CombatSimulation(shipPreset('enterprise-cv6'));
  const requestFire = mock(); simulation.requestFire = requestFire;
  const rig = { setEnabled: mock(), capturePointer: mock(), setShellView: mock(), update: mock() };
  const game = Object.assign(Object.create(Game.prototype), { simulation, shellFollow: new ShellFollow(), input: { clear: mock() }, rig, battlefieldCamera: new BattlefieldCamera(new PerspectiveCamera()), host: { clientWidth: 1280, clientHeight: 800 },
    inPort: false, paused: false, inspecting: false, fleetViews: [], playerView: {}, selectedFlightId: 'player/flight-1' }) as Game;
  game.setAirOperationsOpen(true);
  expect(game.airOperationsOpen).toBe(true); expect(rig.setEnabled).toHaveBeenLastCalledWith(false);
  game.capturePointer(); game.fire(); expect(rig.capturePointer).not.toHaveBeenCalled(); expect(requestFire).not.toHaveBeenCalled();
  game.setAirOperationsOpen(false);
  expect(game.airOperationsOpen).toBe(false); expect(rig.setEnabled).toHaveBeenLastCalledWith(true); expect(rig.capturePointer).toHaveBeenCalledTimes(1);
  expect(game.selectedFlightId).toBe('player/flight-1');
});

test('older keybindings keep a custom M binding while adding a reachable map shortcut', () => {
  const saved: Record<string, unknown> = defaultKeybindings();
  delete saved.airOperations; saved.camera = ['KeyM', null];
  const migrated = keybindingsOf(saved);
  expect(migrated.camera).toEqual(['KeyM', null]); expect(migrated.airOperations[0]).not.toBe('KeyM');
  expect(migrated.airOperations[0]).toBeTruthy();
});

for (const [width, height] of [[2048, 1176], [390, 844]]) test(`carrier water covers maximum zoom and pan at ${width}×${height}`, () => {
  const camera = new PerspectiveCamera(52, width / height, .5, 60000);
  const material = new MeshBasicMaterial();
  const clipmap = new WaterSurfaceGeometry({ levels: 6, segments: 16, baseSize: 256, infinityRingExtent: camera.far * .95 }, material);
  // Exercise the actual vendor geometry/rebuild API without needing a GPU.
  const water = Object.assign(Object.create(WaterSystem.prototype), { _camera: camera, clipmap, waterMaterial: material, _fresnel: {}, atmosphericFogPass: {} }) as WaterSystem;
  const simulation = new CombatSimulation(shipPreset('enterprise-cv6'));
  const battlefieldCamera = new BattlefieldCamera(camera);
  const rig = { setEnabled() {}, capturePointer() {}, setShellView() {}, update() {} };
  const game = Object.assign(Object.create(Game.prototype), { camera, simulation, water, rig, battlefieldCamera, shellFollow: new ShellFollow(), input: { clear() {} },
    host: { clientWidth: width, clientHeight: height }, inPort: false, paused: false, inspecting: false, fleetViews: [], playerView: {} }) as Game;
  try {
    game.setAirOperationsOpen(true);
    battlefieldCamera.cancelTransition();
    battlefieldCamera.zoom(100000, width / 2, height / 2, width, height);
    battlefieldCamera.pan(-100000, 100000, width, height);
    battlefieldCamera.update();
    clipmap.update(camera.position);
    clipmap.getObject().updateMatrixWorld(true);
    const mesh = clipmap.getObject().children[0] as Mesh;
    mesh.geometry.computeBoundingBox();
    const waterBounds = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const ray = new Raycaster(); ray.setFromCamera(new Vector2(x, y), camera);
      const surface = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())!;
      expect(surface.clone().project(camera).z).toBeLessThan(1);
      expect(waterBounds.containsPoint(surface)).toBe(true);
      expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
    }
    game.setAirOperationsOpen(false);
    battlefieldCamera.cancelTransition();
    game.setAirOperationsOpen(true);
    expect(clipmap.getObject().children[0]).toBe(mesh); // Reopening reuses the expanded mesh.
  } finally { clipmap.dispose(); material.dispose(); }
});


test('closing the carrier map restores the chosen weather visibility', () => {
  const simulation = new CombatSimulation(shipPreset('enterprise-cv6'));
  const rig = { setEnabled() {}, capturePointer() {}, setShellView() {}, update() {} };
  for (const weather of ['clear', 'storm-clouds', 'fog'] as const) {
    const map = oceanMap(simulation.mapId), environment = battleEnvironment(map, 'night', weather);
    const camera = new PerspectiveCamera();
    const water = { fog: { fadeStart: environment.fog.start, fadeEnd: environment.fog.end }, getGeometryConfig: () => ({ infinityRingExtent: 950000 }) };
    const game = Object.assign(Object.create(Game.prototype), { camera, simulation, water, rig, shellFollow: new ShellFollow(), input: { clear() {} },
      battlefieldCamera: new BattlefieldCamera(camera), host: { clientWidth: 1280, clientHeight: 800 },
      battleWeather: weather, battleTimeOfDay: 'night', inPort: false, paused: false, inspecting: false, fleetViews: [], playerView: {} }) as Game;
    game.setAirOperationsOpen(true); expect(water.fog.fadeEnd).toBe(900000);
    game.setAirOperationsOpen(false);
    expect(water.fog).toEqual({ fadeStart: environment.fog.start, fadeEnd: environment.fog.end });
  }
});
