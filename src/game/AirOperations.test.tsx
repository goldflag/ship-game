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
import { PerspectiveCamera } from 'three/webgpu';
import { squadronTargetOrder } from '../ui/airCommands';

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
    inPort: false, paused: false, inspecting: false, playerView: {}, selectedFlightId: 'player/flight-1' }) as Game;
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
