import { expect, test } from 'bun:test';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { torpedoPreviewSectors } from './TorpedoPreview';
import { tubeSolution, tubeLocalPosition } from '../simulation/torpedoes';
import { localToWorld } from '../simulation/geometry';

for (const id of ['type-viic', 'fletcher']) test(`${id} preview uses launch sectors, actual course, arming and range without changing tube state`, () => {
  const sim = new CombatSimulation(shipPreset(id));
  const actor = sim.player, aim: [number, number, number] = id === 'fletcher' ? [3000, .5, 0] : [0, .5, -3000];
  const before = structuredClone(actor.torpedoTubes);
  const sectors = torpedoPreviewSectors(actor, aim);
  expect(sectors.length).toBeGreaterThan(0);
  for (const s of sectors) {
    expect(s.arming).toBeGreaterThan(0); expect(s.range).toBeGreaterThan(s.arming);
    expect(s.end).toBeGreaterThan(s.start);
    expect(Number.isFinite(s.heading)).toBe(true);
  }
  const tube = actor.definition.torpedoTubes![0];
  const solution = tubeSolution(actor, tube, { ...actor.torpedoTubes![0] }, aim, 0);
  expect(sectors[0].heading).toBeCloseTo(solution.heading, 10);
  expect(sectors[0].origin).toEqual(localToWorld(tubeLocalPosition(actor, tube), actor.motion));
  expect(actor.torpedoTubes).toEqual(before);
  actor.motion.y = -100;
  if (id === 'type-viic') expect(torpedoPreviewSectors(actor, aim).every(s => !s.course)).toBe(true);
});
