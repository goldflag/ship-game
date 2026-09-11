import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelmWheel, WHEEL_SIZE, nearestNode, wheelNodes } from './HelmWheel';
import { defaultKeybindings } from '../game/keybindings';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import type { Telemetry } from '../game/types';
import type { CombatTelemetry } from '../simulation/combat';

type Contact = CombatTelemetry['contacts'][number];
const contact = (over: Partial<Contact>): Contact => ({ id: 'friendly-1', shipId: 'fletcher', name: 'Fletcher', team: 'friendly', controller: 'bot', x: 0, z: 0, heading: 0, speed: 15, integrity: 1, sunk: false, status: 'operational', combatLost: false, physicalLost: false, ...over });

function telemetry(over: Partial<Telemetry> = {}): Telemetry {
  const definition = shipPreset('bismarck'), simulation = new CombatSimulation(definition);
  const combat = simulation.telemetry('main', [0, 0, -5000]);
  combat.contacts = [
    contact({ id: 'player', shipId: 'bismarck', name: 'Bismarck', controller: 'player', speed: 12 }),
    contact({ id: 'friendly-1', x: 0, z: -2000, speed: 16 }),                                     // 2 km north
    contact({ id: 'friendly-2', shipId: 'baltimore', name: 'Baltimore', x: 1600, z: 0, integrity: .64 }), // east
    contact({ id: 'friendly-3', shipId: 'enterprise-cv6', name: 'Enterprise', x: -6000, z: 6000, integrity: .3, status: 'immobile' }), // south-west
    contact({ id: 'friendly-4', shipId: 'king-george-v', name: 'King George V', x: 0, z: 5000, physicalLost: true, sunk: true, integrity: 0 }),
    contact({ id: 'enemy-1', shipId: 'mogami', name: 'Mogami', team: 'enemy', x: 3000, z: -8000 }),
  ];
  return { ship: { ...simulation.ship, x: 0, z: 0 }, shipDefinition: definition, order: 1, camera: 'Chase', fps: 60, backend: 'test', trail: [], combat, controlledShipId: 'player', helmWheel: { reason: 'held' }, ...over };
}

test('the wheel places every afloat friendly except the centre hull at true bearing, numbered clockwise from north', () => {
  const nodes = wheelNodes(telemetry());
  expect(nodes.map(n => [n.id, n.key])).toEqual([['friendly-1', 1], ['friendly-2', 2], ['friendly-3', 3]]);
  const [north, east, southWest] = nodes;
  expect(Math.round(north.bearing)).toBe(0); expect(north.y).toBeLessThan(WHEEL_SIZE / 2); expect(Math.abs(north.x - WHEEL_SIZE / 2)).toBeLessThan(1e-6);
  expect(Math.round(east.bearing)).toBe(90); expect(east.x).toBeGreaterThan(WHEEL_SIZE / 2);
  expect(Math.round(southWest.bearing)).toBe(225);
  // Log range: the carrier 8.5 km off sits farther out than the destroyer at 2 km, but not four times as far.
  const r = (n: typeof north) => Math.hypot(n.x - WHEEL_SIZE / 2, n.y - WHEEL_SIZE / 2);
  expect(r(southWest)).toBeGreaterThan(r(north));
  expect(r(southWest) / r(north)).toBeLessThan(2);
  expect(north.kn).toBeCloseTo(31.1, 0);
  expect(nearestNode(nodes, WHEEL_SIZE / 2 + 10, WHEEL_SIZE / 2)).toBeUndefined(); // the hub is a dead zone
  expect(nearestNode(nodes, WHEEL_SIZE / 2, 60)?.id).toBe('friendly-1');
  expect(nearestNode(nodes, 120, WHEEL_SIZE - 80)?.id).toBe('friendly-3');
});

test('ships stacked on one bearing are nudged apart so both names stay readable', () => {
  const data = telemetry();
  data.combat!.contacts = [data.combat!.contacts[0], contact({ id: 'friendly-1', x: 700, z: 0 }), contact({ id: 'friendly-2', shipId: 'baltimore', name: 'Baltimore', x: 1300, z: 0 }), contact({ id: 'friendly-3', shipId: 'cleveland', name: 'Cleveland', x: 1900, z: 0 })];
  const nodes = wheelNodes(data);
  expect(nodes.map(n => Math.round(n.bearing))).toEqual([90, 90, 90]);
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    expect(Math.hypot((nodes[i].x - nodes[j].x) / 104, (nodes[i].y - nodes[j].y) / 60)).toBeGreaterThanOrEqual(.99);
  }
  for (const n of nodes) { expect(n.x).toBeGreaterThan(WHEEL_SIZE / 2); expect(Math.hypot(n.x - WHEEL_SIZE / 2, n.y - WHEEL_SIZE / 2)).toBeLessThanOrEqual(282.01); }
  // Every node stays on its own side of the rose, and the range order survives the nudge.
  expect(nodes[0].x).toBeLessThan(nodes[2].x);
});

test('the wheel renders the fleet with hull, speed and range, highlights the pick and explains the hold gesture', () => {
  const render = (data: Telemetry) => renderToStaticMarkup(<HelmWheel data={data} game={{} as never} bindings={defaultKeybindings()}/>);
  const held = render(telemetry({ helmWheel: { reason: 'held', highlightId: 'friendly-2' } }));
  expect(held).toContain('Choose a ship to command');
  expect(held).toContain('<b>Bismarck</b>');
  expect(held).toContain('At the helm');
  expect(held).toContain('Take the helm of Fletcher · 100 percent hull · 2.0 km bearing 000 · key 1');
  expect(held).toContain('64% · 29 kn · 1.6 km');
  expect(held).toContain('30% · 29 kn · 8.5 km · immobile');
  expect(held).not.toContain('King George V');
  expect(held).not.toContain('Mogami');
  expect(held.match(/helm-wheel-node[^"]*\son\b/g)).toHaveLength(1);
  expect(held.match(/aria-pressed="true"/g)).toHaveLength(1);
  expect(held).toContain('release <kbd>Tab</kbd>');
  expect(held).toContain('<kbd>1</kbd>–<kbd>3</kbd>');
  const sunk = render(telemetry({ helmWheel: { reason: 'sunk' } }));
  expect(sunk).toContain('helm-wheel-sunk');
  expect(sunk).toContain('Sinking · choose a ship');
  expect(sunk).toContain('keeps watching');
  const following = render(telemetry({ fleetCommandMode: true, controlledShipId: undefined, spectatedShipId: 'player' }));
  expect(following).toContain('Following · captain in command');
  expect(render(telemetry({ helmWheel: undefined }))).toBe('');
});
