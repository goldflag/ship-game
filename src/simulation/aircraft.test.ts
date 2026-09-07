import { expect, test } from 'bun:test';
import source from '../../assets/ships/enterprise-cv6/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation, type CombatEvent } from './combat';
import { airborne, launchSquadron, recallAircraft, stepAircraft, aircraftDeckSpot, onFlightDeck, type AirContext } from './aircraft';
import { updateCapability } from './stability';
// Keep the original three-aircraft fixtures exercising backwards-compatible v1 blueprints.
const legacy = structuredClone(source);
legacy.airWing.flightSize = 3; legacy.airWing.deckCapacity = 18;
legacy.airWing.squadrons.forEach(s => { s.count = 6; });
const definition = compileShip(legacy, catalog);
function fixture() {
  const sim = new CombatSimulation(definition, { enemies: [definition], friendlyBots: [], spawnDistance: 5000 });
  sim.target.controller = 'idle';
  let id = 1000;
  const events: Omit<CombatEvent, 'sequence' | 'tick'>[] = [];
  const context: AirContext = { actors: sim.actors, planes: sim.aircraft, shells: sim.shells, torpedoes: sim.torpedoes, releases: sim.airReleases, nextId: () => ++id, emit: e => events.push(e) };
  let time = 0;
  const run = (seconds: number) => { for (let i = 0; i < seconds * 60; i++) { stepAircraft(context, 1 / 60, time); time += 1 / 60; } };
  return { sim, context, events, run };
}
test('mixed flights recover before endurance expires on an undamaged carrier', () => {
  const { sim, run } = fixture();
  sim.target.mounts.forEach(m => { m.hp = 0; });
  for (const id of ['vf-6', 'vb-6', 'vt-6']) sim.launchAircraft(id);
  run(750);
  expect(sim.player.airWing!.planes.filter(p => p.phase === 'lost')).toHaveLength(0);
  expect(sim.player.airWing!.planes.every(p => p.phase === 'ready')).toBe(true);
});
test('versioned air wing validation and unsupported model rejection', () => {
  expect(definition.airWing?.squadrons).toHaveLength(3);
  const invalid = structuredClone(source); invalid.airWing.squadrons[0].modelId = '../../bad';
  expect(() => compileShip(invalid, catalog)).toThrow(/aircraft/);
  invalid.airWing.squadrons[0].modelId = 'sbd-3-dauntless';
  expect(() => compileShip(invalid, catalog)).toThrow(/role/);
});
test('launch queues three, spaces takeoffs, uses moving carrier datum, recall and reset', () => {
  const { sim, run } = fixture();
  sim.ship.x = 300;
  expect(sim.launchAircraft('vf-6')).toBe(3);
  run(1);
  expect(sim.player.airWing!.planes.filter(p => p.phase === 'taxi')).toHaveLength(1);
  expect(sim.aircraft.filter(airborne)).toHaveLength(0);
  run(60);
  expect(sim.aircraft.filter(airborne)).toHaveLength(3);
  sim.recallAircraft();
  expect(sim.aircraft.filter(airborne).every(p => p.phase === 'returning')).toBe(true);
  sim.reset();
  expect(sim.aircraft.every(p => p.phase === 'ready')).toBe(true);
  expect(sim.airReleases).toHaveLength(0);
});
test('dive bombers release ballistic HE bombs with carrier ownership and recover', () => {
  const { sim, run, events } = fixture();
  sim.launchAircraft('vb-6'); run(580);
  expect(events.filter(e => e.kind === 'bomb-release').length).toBeGreaterThan(0);
  expect(sim.shells.every(s => s.ownerId === 'player' && s.ammunition === 'he' && s.he!.explosiveKg > 0)).toBe(true);
  expect(events.filter(e => e.kind === 'aircraft-recovered').length).toBeGreaterThan(0);
  expect(sim.player.airWing!.planes.filter(p => p.squadronId === 'vb-6' && p.phase === 'ready').length).toBeGreaterThan(3);
});
test('torpedo bombers create falling payloads then armed-distance water runners', () => {
  const { sim, run, events } = fixture();
  sim.launchAircraft('vt-6'); run(155);
  expect(events.some(e => e.kind === 'aircraft-release')).toBe(true);
  expect(sim.torpedoes.length).toBeGreaterThan(0);
  expect(sim.torpedoes.every(t => t.ownerId === 'player' && t.position[1] < 0 && t.distance === 0 && t.weapon.armingDistanceM > 0)).toBe(true);
});
test('opposing fighters engage aircraft and shoot them down without friendly damage', () => {
  const { sim, run, events } = fixture();
  sim.target.controller = 'bot'; sim.launchAircraft('vf-6'); run(130);
  expect(events.some(e => e.kind === 'aircraft-fire')).toBe(true);
  expect(events.some(e => e.kind === 'aircraft-lost')).toBe(true);
  expect(sim.aircraft.some(p => p.kills > 0)).toBe(true);
});
test('service loss blocks launches, submerged targets are rejected, aircraft preserve fighting capability', () => {
  const { sim } = fixture();
  sim.target.motion.y = -20;
  expect(sim.launchAircraft('vt-6')).toBe(0);
  sim.player.mounts.forEach(m => { m.hp = 0; }); updateCapability(sim.player, definition);
  expect(sim.player.damage.stability.combatLost).toBe(false);
  sim.player.damage.modules.find(m => m.id === definition.airWing!.serviceModuleId)!.hp = 0;
  expect(sim.launchAircraft('vf-6')).toBe(0);
  updateCapability(sim.player, definition);
  expect(sim.player.damage.stability.combatLost).toBe(true);
});
test('recall cancels queued launches; port fixture cannot deploy', () => {
  const { sim } = fixture();
  launchSquadron(sim.player, 'vf-6'); recallAircraft(sim.player);
  expect(sim.player.airWing!.planes.every(p => p.phase === 'ready')).toBe(true);
  expect(new CombatSimulation(definition).launchAircraft('vf-6')).toBe(0);
});
test('fixed-tick combat integrates bot air operations and resets airborne payloads', () => {
  const { sim } = fixture(); sim.target.controller = 'bot';
  for (let i = 0; i < 1800; i++) sim.step({ throttle: 0, rudder: 0 }, { aim: [0, 0, -5000] as Vec3, fire: false, battery: 'main' });
  expect(sim.target.airWing!.planes.some(airborne)).toBe(true);
  sim.reset(); expect(sim.aircraft.every(p => p.phase === 'ready')).toBe(true);
});
test('aircraft weapons resolve actual ship hits and score hostile damage through combat', () => {
  const { sim } = fixture();
  sim.launchAircraft('vb-6'); sim.launchAircraft('vt-6');
  let bombHit = false, torpedoHit = false;
  for (let i = 0; i < 280 * 60; i++) {
    sim.step({ throttle: 0, rudder: 0 }, { aim: [0, 0, -5000], fire: false, battery: 'main' });
    bombHit ||= sim.events.some(e => !!e.shell && e.shell.caliberM === .35 && !!e.impact);
    torpedoHit ||= sim.events.some(e => e.kind === 'torpedo-hit');
  }
  expect(bombHit).toBe(true); expect(torpedoHit).toBe(true);
  expect(sim.target.damage.compartments.some(c => c.breachAreaM2 > 0)).toBe(true);
  expect(sim.telemetry('main', [0,0,-5000]).playerDamageDealt).toBeGreaterThan(0);
  const log = sim.telemetry('main', [0, 0, -5000]).damageLog;
  expect(log.some(entry => entry.weapon === '500 lb HE bomb')).toBe(true);
  expect(log.some(entry => entry.weapon.includes('Air torpedo'))).toBe(true);
  expect(log.reduce((sum, entry) => sum + entry.damage, 0)).toBeCloseTo(sim.telemetry('main', [0, 0, -5000]).playerDamageDealt, 6);
}, 30000);

test('bot strike orders fall back from a lost or submerged target to a valid hostile ship', () => {
  const { sim, context, run } = fixture();
  const other = new CombatSimulation(definition).player;
  other.motion.id = 'friendly-extra'; other.motion.x = 500;
  context.actors.push(other);
  sim.target.controller = 'bot'; sim.target.targetId = sim.player.motion.id;
  sim.player.damage.sunk = true;
  run(6);
  const strikes = sim.target.airWing!.planes.filter(p => p.role !== 'fighter' && p.phase !== 'ready');
  expect(strikes.length).toBeGreaterThan(0);
  expect(strikes.every(p => p.targetId === other.motion.id)).toBe(true);
});

test('fighters alone cannot keep a carrier in a ship battle after all strike aircraft and guns are lost', () => {
  const { sim } = fixture();
  sim.player.mounts.forEach(m => { m.hp = 0; });
  sim.player.airWing!.planes.filter(p => p.role !== 'fighter').forEach(p => { p.phase = 'lost'; });
  updateCapability(sim.player, definition);
  expect(sim.player.damage.stability.combatLost).toBe(true);
});


test('deck aircraft occupy distinct stable spots and taxi continuously before takeoff', () => {
  const { sim, run } = fixture();
  run(1 / 60);
  const planes = sim.player.airWing!.planes;
  expect(new Set(planes.map(p => p.position.join(','))).size).toBe(18);
  const first = planes[0]; const parked = [...first.position];
  sim.launchAircraft('vf-6'); run(1 / 60);
  expect(first.phase).toBe('taxi');
  expect(Math.hypot(...first.position.map((v, i) => v - parked[i]))).toBeLessThan(.6);
  expect(onFlightDeck(first)).toBe(true);
  sim.recallAircraft(); run(25);
  expect(first.phase).toBe('rearming');
  expect(first.deckPosition).toEqual(aircraftDeckSpot(sim.player, first));
});

test('recovery reaches the deck, rolls to a stop, parks and rearms without disappearing', () => {
  const { sim, run, events } = fixture();
  const p = sim.player.airWing!.planes[0];
  p.phase = 'landing'; p.position = [0, 20, 120]; p.previousPosition = [...p.position];
  let touched = false, parked = false, largestStep = 0;
  for (let i = 0; i < 90 * 60; i++) {
    const previous = [...p.position]; run(1 / 60);
    largestStep = Math.max(largestStep, Math.hypot(...p.position.map((v, j) => v - previous[j])));
    touched ||= String(p.phase) === 'rollout'; parked ||= String(p.phase) === 'parking';
  }
  expect(touched).toBe(true); expect(parked).toBe(true);
  expect(largestStep).toBeLessThan(1);
  expect(String(p.phase)).toBe('ready'); expect(p.hp).toBe(100);
  expect(events.filter(e => e.kind === 'aircraft-recovered')).toHaveLength(1);
});

test('a recalled group waits its turn and all survivors recover on a stationary carrier', () => {
  const { sim, run } = fixture();
  sim.launchAircraft('vf-6'); run(65); sim.recallAircraft(); run(400);
  expect(sim.player.airWing!.planes.filter(p => p.squadronId === 'vf-6').every(p => p.phase === 'ready')).toBe(true);
});

test('a taxi aircraft clears the launch lane when the airborne limit fills', () => {
  const { sim, context, run } = fixture();
  sim.launchAircraft('vf-6'); run(1);
  const plane = sim.player.airWing!.planes[0];
  for (let i = 0; i < 144; i++) context.planes.push({ ...structuredClone(plane), id: `capacity/${i}`, phase: 'outbound' });
  run(35);
  expect(plane.phase).toBe('rearming');
  expect(plane.deckPosition).toEqual(aircraftDeckSpot(sim.player, plane));
});

test('a fighter group gets airborne within 37 seconds without overlapping occupied deck runs', () => {
  const { sim, run } = fixture(); run(1 / 60);
  sim.launchAircraft('vf-6');
  const departures = new Map<string, number>();
  for (let tick = 0; tick < 40 * 60; tick++) {
    run(1 / 60);
    const planes = sim.player.airWing!.planes;
    expect(planes.filter(p => p.phase === 'taxi' || (p.phase === 'takeoff' && onFlightDeck(p))).length).toBeLessThanOrEqual(1);
    for (const p of planes) if (airborne(p) && !onFlightDeck(p) && !departures.has(p.id)) departures.set(p.id, (tick + 1) / 60);
  }
  expect(departures.size).toBe(3);
  expect(Math.min(...departures.values())).toBeLessThan(12.5);
  expect(Math.max(...departures.values())).toBeLessThan(37);
});
