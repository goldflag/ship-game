import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type ShipBlueprint } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { mountFrame, updateMountCarriers } from './mountFrames';
import { createMountState, muzzleWorld, shotDirection, updateMount } from './weapons';
import { shipContacts, type Shell } from './damage';

function fixture() {
  const b = structuredClone(blueprint) as ShipBlueprint;
  b.mounts[0].position = [0, 4, 0]; b.mounts[0].bearingDeg = 180;
  b.mounts[1].position = [0, 8, -6]; b.mounts[1].bearingDeg = 0;
  b.mounts[1].partId = 'oerlikon-20mm-single'; b.mounts[1].parentMountId = b.mounts[0].id;
  return { b, def: compileShip(b, catalog) };
}
test('blueprints retain neutral ship-space datums and reject missing or cyclic carriers', () => {
  const { b, def } = fixture();
  expect(def.mounts[1].position).toEqual([0, 8, -6]);
  expect(def.mounts[1].parentMountId).toBe(b.mounts[0].id);
  for (const parent of ['absent', b.mounts[1].id, b.mounts[2].id]) {
    const bad = structuredClone(b); bad.mounts[1].parentMountId = parent;
    expect(() => compileShip(bad, catalog)).toThrow(/parent mount must precede/);
  }
});
test('installed sectors narrow a reusable component without changing its catalog or neighbors', () => {
  const { b } = fixture(); b.mounts[1].traverseDeg = 70;
  const def = compileShip(b, catalog);
  expect(def.mounts[1].weapon.traverseDeg).toBe(70);
  expect(catalog.parts.find(p => p.id === b.mounts[1].partId)!.traverseDeg).toBe(160);
  b.mounts[1].traverseDeg = 161;
  expect(() => compileShip(b, catalog)).toThrow(/traverseDeg/);
});
test('a roof gun follows a rear-facing carrier and counter-trains independently', () => {
  const { def } = fixture(), states = def.mounts.map(createMountState);
  states[0].train = Math.PI / 2; states[1].train = -Math.PI / 2; states[1].elevation = 0;
  updateMountCarriers(def, states);
  const frame = mountFrame(def, 1, states.map(s => s.train));
  expect(frame.x).toBeCloseTo(6, 10); expect(frame.y).toBe(8); expect(frame.z).toBeCloseTo(0, 10);
  expect(frame.heading).toBeCloseTo(0, 10);
  const pose = { x: 100, y: 2, z: -200, heading: 0, pitch: 0, roll: 0 };
  const muzzle = muzzleWorld(def.mounts[1], states[1], 0, pose);
  expect(muzzle[0]).toBeCloseTo(106, 10);
  expect(muzzle[1]).toBeCloseTo(10 + def.mounts[1].weapon.pivotHeight, 10);
  expect(muzzle[2]).toBeCloseTo(-200 - def.mounts[1].weapon.muzzleForward, 10);
  expect(shotDirection(def.mounts[1], states[1], pose)[2]).toBeCloseTo(-1, 10);
  // An aiming update must retain the inherited frame when iterating its solution.
  updateMount(def.mounts[1], states[1], { ...def, obstructions: [] }, pose, [106, muzzle[1], -700], 0, [0, 0, 0], 1, states);
  expect(states[1].aimCache?.train).toBeCloseTo(-Math.PI / 2, 2);
});
test('direct contacts move with a carried mount, including independently rotated neighbors', () => {
  const { def } = fixture(), sim = new CombatSimulation(def), actor = sim.player;
  Object.assign(actor.motion, { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 });
  actor.mounts[0].train = Math.PI / 2; actor.mounts[1].train = -Math.PI / 2;
  const shell = { id: 1001, ownerId: 'probe', visited: [], position: [6, 8.7, -5], velocity: [0, 0, 100] } as unknown as Shell;
  const hits = (x: number) => shipContacts(shell, [x, 8.7, -5], [x, 8.7, 5], actor, def).filter(h => h.kind === 'mount' && h.index === 1);
  expect(hits(6).length).toBeGreaterThan(0); expect(hits(0)).toHaveLength(0);
});
test('nested carriers compose and the hull-mounted state stays unchanged', () => {
  const { b } = fixture(); b.mounts[2].parentMountId = b.mounts[1].id; b.mounts[2].position = [0, 10, -8]; b.mounts[2].bearingDeg = 0;
  const def = compileShip(b, catalog), states = def.mounts.map(createMountState);
  states[0].train = Math.PI / 2; states[1].train = Math.PI / 2;
  updateMountCarriers(def, states);
  const frame = mountFrame(def, 2, states.map(s => s.train));
  expect([frame.x, frame.y, frame.z].map(n => Math.round(n))).toEqual([6, 10, 2]);
  expect(states[0].carrier).toBeUndefined();
});
