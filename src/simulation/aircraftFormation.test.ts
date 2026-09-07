import { expect, test } from 'bun:test';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { stepAircraft, squadronFlights, type AirContext } from './aircraft';
import { formationLeader, formationOffset, formationPosition } from './aircraftFormation';
import { length, sub } from './geometry';

function fixture(squadron = 'vf-6', seed = 11) {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6'), {
    friendlyBots: [], enemies: [{ definition: shipPreset('bismarck'), aiLevel: 'static' }], spawnDistance: 5000, seed,
  });
  const flight = squadronFlights(sim.player).find(f => f.squadronId === squadron)!;
  const planes = sim.aircraft.filter(p => flight.planeIds.includes(p.id));
  let id = 0, tick = 0;
  const releases: number[] = [];
  const ctx: AirContext = { seed, actors: sim.actors, planes: sim.aircraft, shells: [], torpedoes: [], releases: [], nextId: () => ++id,
    emit: e => { if (e.kind === 'bomb-release' || e.kind === 'aircraft-release') releases.push(tick / 60); } };
  const step = () => { stepAircraft(ctx, 1 / 60, tick / 60); tick++; };
  return { sim, flight, planes, releases, step, time: () => tick / 60 };
}

for (const squadron of ['vf-6', 'vb-6', 'vt-6']) test(`${squadron} assembles from staggered launches and holds a separated V through patrol turns`, () => {
  const { sim, flight, planes, step, time } = fixture(squadron);
  sim.commandSquadron(flight.id, { kind: 'patrol', point: [2000, 420, -3000] });
  let maximumError = 0, minimumSeparation = Infinity, maximumBank = 0;
  for (let tick = 0; tick < 180 * 60; tick++) {
    const before = planes.map(p => [...p.position] as typeof p.position);
    step();
    if (tick < 90 * 60) continue;
    for (const [i, p] of planes.entries()) {
      maximumError = Math.max(maximumError, length(sub(p.position, formationPosition(flight, p, planes[0], time(), sim.seed))));
      maximumBank = Math.max(maximumBank, Math.abs(p.bank));
      // Formation guidance must not teleport planes or bypass the CPU velocity.
      expect(length(sub(p.position, before[i]))).toBeCloseTo(length(p.velocity) / 60, 7);
      for (const other of planes.slice(i + 1)) minimumSeparation = Math.min(minimumSeparation, length(sub(p.position, other.position)));
    }
  }
  expect(maximumError).toBeLessThan(12);
  expect(minimumSeparation).toBeGreaterThan(25);
  expect(maximumBank).toBeGreaterThan(.2);
});

test('a lost leader is replaced without exchanging surviving slots, and recall exits formation', () => {
  const { sim, flight, planes, step, time } = fixture();
  sim.commandSquadron(flight.id, { kind: 'patrol', point: [2000, 420, -3000] });
  for (let i = 0; i < 120 * 60; i++) step();
  const offsets = planes.map(p => formationOffset(flight, p, time(), sim.seed));
  planes[0].hp = 0; planes[0].phase = 'lost';
  expect(formationLeader(flight, planes)?.id).toBe(planes[1].id);
  expect(planes.map(p => formationOffset(flight, p, time(), sim.seed))).toEqual(offsets);
  for (let i = 0; i < 45 * 60; i++) step();
  for (const p of planes.slice(1)) expect(length(sub(p.position, formationPosition(flight, p, planes[1], time(), sim.seed)))).toBeLessThan(12);
  sim.commandSquadron(flight.id, { kind: 'return' }); step();
  expect(planes.slice(1).every(p => p.phase === 'returning')).toBe(true);
  expect(formationLeader(flight, planes)).toBeUndefined();
});

test('formation variation is smooth, bounded and seeded independently of other launches', () => {
  const { flight, planes } = fixture();
  const p = planes[1], original = formationOffset(flight, p, 100, 11);
  expect(formationOffset(flight, p, 100, 11)).toEqual(original);
  expect(formationOffset(flight, p, 100, 12)).not.toEqual(original);
  expect(length(sub(original, formationOffset(flight, p, 100 + 1 / 60, 11)))).toBeLessThan(.03);
  for (let time = 0; time < 200; time++) expect(length(sub(formationOffset(flight, p, time, 11), [-32, 3, 27]))).toBeLessThan(3);
});

for (const squadron of ['vb-6', 'vt-6']) test(`${squadron} holds its ingress formation and releases the whole attack wave together`, () => {
  const { sim, flight, planes, releases, step, time } = fixture(squadron);
  sim.commandSquadron(flight.id, { kind: 'attack', targetId: sim.target.motion.id });
  let heldFormation = false;
  for (let i = 0; i < 300 * 60 && releases.length < 6; i++) {
    step();
    if (time() > 50 && planes[0].pilot.attackStage === 'ingress'
      && planes.every(p => length(sub(p.position, formationPosition(flight, p, planes[0], time(), sim.seed))) < 20)) heldFormation = true;
  }
  expect(heldFormation).toBe(true);
  expect(releases).toHaveLength(6);
  expect(Math.max(...releases) - Math.min(...releases)).toBeLessThan(8);
});
