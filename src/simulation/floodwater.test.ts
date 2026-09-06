import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Compartment } from '../ships/blueprint';
import { addBreach, createDamage, updateFlooding, type Combatant } from './damage';
import { levelAtVolume, waterBody } from './floodwater';
import { createShipState } from './ship';
import { waterLevel } from './stability';

const base = compileShip(blueprint, catalog);
const steppedRoom: Compartment = {
  id: 'stepped', name: 'Stepped space', center: [0, 0, 0], size: [10, 10, 10],
  capacityM3: 104, pumpM3PerSecond: 0,
  cells: [
    { center: [0, -3, 0], size: [1, 4, 1] },
    { center: [0, -.5, 0], size: [10, 1, 10] },
  ],
};
function fixture() {
  const def = { ...base, compartments: [structuredClone(steppedRoom)], connections: [] };
  const actor: Combatant = { motion: createShipState(), mounts: [], damage: createDamage(def) };
  return { def, actor };
}

test('water inspection is read-only, including the first water admitted to a dry room', () => {
  const { def, actor } = fixture();
  actor.damage.stability.water = [waterBody(def.compartments[0], 0, .2, .1)];
  actor.damage.compartments[0].waterM3 = 2;
  const before = structuredClone(actor);
  for (let i = 0; i < 5; i++) expect(Number.isFinite(waterLevel(actor, def, 0))).toBe(true);
  expect(actor).toEqual(before);
});

test('pressure follows the current volume across changes in a compound room cross-section', () => {
  const { def, actor } = fixture();
  actor.damage.stability.water = [waterBody(def.compartments[0], 2, 0, 0)];
  for (const [volume, level] of [[0, -5], [2, -3], [4, -1], [54, -.5], [104, 0]]) {
    actor.damage.compartments[0].waterM3 = volume;
    expect(waterLevel(actor, def, 0)).toBeCloseTo(level, 6);
  }
});

test('empty compound spaces use their actual lowest cell, not an unoccupied bounding-box corner', () => {
  const room: Compartment = { ...steppedRoom, center: [0, 0, 0], size: [10, 10, 2], capacityM3: 16,
    cells: [{ center: [-4, 4, 0], size: [2, 2, 2] }, { center: [4, -4, 0], size: [2, 2, 2] }] };
  // At 45 degrees both cells sit at the same elevation.
  expect(waterBody(room, 0, Math.PI / 4, 0).level).toBeGreaterThan(-1.5);
});

test('portal transfer conserves water without overshooting the equal pressure level', () => {
  const { def, actor } = fixture();
  def.compartments = [0, 1].map(i => ({ ...structuredClone(steppedRoom), id: `room-${i}` }));
  const connected = { ...def, connections: [{ fromId: 'room-0', toId: 'room-1', areaM2: 100, state: 'open' as const, position: [0, -5, 0] as [number, number, number] }] };
  actor.damage = createDamage(connected);
  actor.damage.compartments[0].waterM3 = 3;
  actor.damage.compartments[1].waterM3 = 1;
  actor.damage.stability.elapsed = 0;
  actor.damage.stability.water = connected.compartments.map((c, i) => waterBody(c, 3 - 2 * i, 0, 0));
  updateFlooding(actor, connected, 1 / 60);
  expect(actor.damage.compartments[0].waterM3).toBeCloseTo(2, 6);
  expect(actor.damage.compartments[1].waterM3).toBeCloseTo(2, 6);
  expect(waterLevel(actor, connected, 0)).toBeGreaterThanOrEqual(waterLevel(actor, connected, 1) - 1e-7);
});

test('warming inspection caches between ticks cannot change a flooding replay', () => {
  const { def, actor } = fixture();
  addBreach(actor.damage.compartments[0], [0, -4, 0], .1, 1);
  const observed = structuredClone(actor);
  for (let tick = 0; tick < 120; tick++) {
    // Exercise both a cold cache (restored state) and repeated render reads.
    for (let frame = 0; frame < 3; frame++) waterLevel(observed, def, 0);
    updateFlooding(actor, def, 1 / 60);
    updateFlooding(observed, def, 1 / 60);
  }
  expect(observed).toEqual(actor);
  expect(actor.damage.compartments[0].waterM3).toBeGreaterThan(0);
});

test('fill curves remain monotone and bounded under heel, trim and restored caches', () => {
  for (const [roll, pitch] of [[0, 0], [.2, -.15], [Math.PI / 4, .1], [2.3, -.4], [0, Math.PI / 2]]) {
    const body = waterBody(steppedRoom, 2, roll, pitch), restored = structuredClone(body);
    const bottom = waterBody(steppedRoom, 0, roll, pitch).level;
    const top = waterBody(steppedRoom, steppedRoom.capacityM3, roll, pitch).level;
    let previous = bottom;
    for (let i = 0; i <= 100; i++) {
      const volume = steppedRoom.capacityM3 * i / 100, level = levelAtVolume(steppedRoom, body, volume);
      expect(Number.isFinite(level)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(level).toBeLessThanOrEqual(top + 1e-9);
      expect(levelAtVolume(steppedRoom, restored, volume)).toBe(level);
      previous = level;
    }
  }
});

test('a fill curve handles a vertical gap between cells without inventing water volume', () => {
  const room: Compartment = { ...steppedRoom, capacityM3: 2,
    cells: [{ center: [0, -4.5, 0], size: [1, 1, 1] }, { center: [0, -.5, 0], size: [1, 1, 1] }] };
  const body = waterBody(room, .5, 0, 0);
  expect(levelAtVolume(room, body, 1)).toBe(-4);
  expect(levelAtVolume(room, body, 1.5)).toBe(-.5);
});
