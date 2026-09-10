import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FleetHud } from './FleetHud';
import { aircraftState, armamentFraction, armamentLabel, conditionLevel, type WingAircraft } from './AirWingManifest';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { defaultKeybindings } from '../game/keybindings';

const aircraft = (overrides: Partial<WingAircraft>): WingAircraft => ({ id: 'enterprise-cv6/vf-6/3', flightId: 'enterprise-cv6/vf-6/0', modelId: 'f4f-4-wildcat', role: 'fighter', phase: 'ready', status: 'ready',
  hp: 100, payload: false, ammo: 16, location: 'Hangar', followable: false, lossReason: undefined, enduranceSeconds: 1050, ...overrides });

const hud = (airOperationsOpen: boolean, visible = true) => {
  const simulation = new CombatSimulation(shipPreset('enterprise-cv6'));
  const data = { ship: simulation.ship, order: 1, camera: 'Chase' as const, trail: [], fps: 60, backend: 'test', airOperationsOpen, combat: simulation.telemetry('main', [0, 0, -5000]) };
  return renderToStaticMarkup(<FleetHud data={data} game={null} visible={visible} bindings={defaultKeybindings()}/>);
};

test('the wing manifest lists every squadron and aircraft of the wing in M view only', () => {
  const html = hud(true);
  expect(html.match(/class="air-manifest-row /g)).toHaveLength(9);
  expect(html.match(/class="air-manifest-cell"/g)).toHaveLength(48);
  expect(html).toContain('Flights 0/4 · Deck 0/12 · Hangar 48');
  expect(html).toContain('16 ready · 0 airborne · 16 armed');
  expect(html).toContain('--condition:1;--armament:1');
  expect(html).not.toContain('Deck operations suspended');
  expect(hud(false)).not.toContain('air-manifest');
  expect(hud(true, false)).not.toContain('air-manifest');
});

test('cells derive armament from bursts or payload and recolor damaged, critical and lost aircraft', () => {
  expect(armamentFraction(aircraft({ ammo: 8 }))).toBe(.5);
  expect(armamentLabel(aircraft({ ammo: 8 }))).toBe('8 bursts');
  expect(armamentLabel(aircraft({ ammo: 0 }))).toBe('Guns empty');
  expect(armamentFraction(aircraft({ role: 'dive-bomber', payload: true, ammo: 0 }))).toBe(1);
  expect(armamentLabel(aircraft({ role: 'dive-bomber', payload: false, ammo: 0 }))).toBe('Released');
  expect(armamentLabel(aircraft({ role: 'torpedo-bomber', payload: true, ammo: 0 }))).toBe('Torpedo');
  expect(armamentFraction(aircraft({ role: 'torpedo-bomber', payload: true, status: 'lost', phase: 'lost' }))).toBe(0);
  expect(conditionLevel(aircraft({ hp: 72 }))).toBeUndefined();
  expect(conditionLevel(aircraft({ hp: 49 }))).toBe('damaged');
  expect(conditionLevel(aircraft({ hp: 24 }))).toBe('critical');
  expect(conditionLevel(aircraft({ hp: 0, status: 'lost', phase: 'lost' }))).toBe('lost');
  expect(aircraftState(aircraft({ phase: 'outbound', status: 'on-mission' }))).toBe('Outbound');
  expect(aircraftState(aircraft({ phase: 'lost', status: 'lost', lossReason: 'Shot down' }))).toBe('Shot down');
});

test('fleet ship spectating includes aircraft nametags without opening carrier controls', () => {
  const simulation = new CombatSimulation(shipPreset('fletcher'));
  const data = { ship: simulation.ship, order: 1, camera: 'Chase' as const, trail: [], fps: 60, backend: 'test', airOperationsOpen: false,
    fleetCommandMode: true, spectatedShipId: simulation.ship.id, combat: simulation.telemetry('main', [0, 0, -5000]) };
  const game = { simulation, selectedShipIds: [], selectedFlightIds: [], controlGroups: new Map() } as unknown as import('../game/Game').Game;
  const html = renderToStaticMarkup(<FleetHud data={data} game={game} visible={true} bindings={defaultKeybindings()}/>);
  expect(html).toContain('Squadron names and status');
  expect(html).not.toContain('air-manifest');
});

test('hiding the fleet HUD keeps the M-mode camera surface interactive and removes instruments', () => {
  const simulation = new CombatSimulation(shipPreset('fletcher'));
  const data = { ship: simulation.ship, order: 1, camera: 'Chase' as const, trail: [], fps: 60, backend: 'test', airOperationsOpen: true,
    fleetCommandMode: true, combat: simulation.telemetry('main', [0, 0, -5000]) };
  const game = { simulation, selectedShipIds: [], selectedFlightIds: [], controlGroups: new Map() } as unknown as import('../game/Game').Game;
  const render = (visible: boolean) => renderToStaticMarkup(<FleetHud data={data} game={game} visible={visible} bindings={defaultKeybindings()}/>);
  const hidden = render(false);
  expect(hidden).not.toContain('inert=""');
  expect(hidden).not.toContain('visibility:hidden');
  expect(hidden).toContain('Fleet command chart');
  expect(hidden).not.toContain('Own fleet');
  expect(hidden).not.toContain('Fleet views');
  expect(render(true)).toContain('Own fleet');
});
