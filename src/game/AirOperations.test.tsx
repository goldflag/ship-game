import { expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AirOperations } from '../ui/AirOperations';
import { chartPoint, chartWorld, fitAirChart } from '../ui/airChart';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { defaultKeybindings, keybindingsOf } from './keybindings';
import { Game } from './Game';
import { ShellFollow } from './ShellFollow';

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
  const html = renderToStaticMarkup(<AirOperations data={{ ship: sim.ship, order: 1, camera: 'Chase', trail: [], fps: 60, backend: 'test', combat: sim.telemetry('main', [0, 0, -5000]) }} game={null} bindings={defaultKeybindings()}/>);
  expect(html).toContain('48 / 48 aircraft'); expect(html).toContain('36 in hangar');
  expect(html).toContain('Attack Bismarck'); expect(html).toContain('New strikes: Yamato');
  expect(html).toContain('Launch 6'); expect(html).toContain('Fit air wing');
  expect(html).toContain('Assign strike target'); expect(html).toContain('Return flight');
});

test('the map releases aim, blocks firing and restores aiming on close without losing flight selection', () => {
  const simulation = new CombatSimulation(shipPreset('enterprise-cv6'));
  const requestFire = mock(); simulation.requestFire = requestFire;
  const rig = { setEnabled: mock(), capturePointer: mock(), setShellView: mock() };
  const game = Object.assign(Object.create(Game.prototype), { simulation, shellFollow: new ShellFollow(), input: { clear: mock() }, rig,
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
