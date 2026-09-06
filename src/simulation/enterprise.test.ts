import { expect, test } from 'bun:test';
import source from '../../assets/ships/enterprise-cv6/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { barrelIds, compileShip, type Battery, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { createMountState, muzzleLocal } from './weapons';

const definition = compileShip(source, catalog);

test('Enterprise uses the March 1942 count and preserves distinct single and quadruple muzzle axes', () => {
  expect(definition.mounts.filter(m => m.weapon.caliberM === .127)).toHaveLength(8);
  expect(definition.mounts.filter(m => m.weapon.caliberM === .02794)).toHaveLength(4);
  expect(definition.mounts.filter(m => m.weapon.caliberM === .02)).toHaveLength(30);
  expect(definition.mounts.flatMap(m => barrelIds(m.weapon))).toHaveLength(54);
  const single = { ...definition.mounts[0], position: [0, 0, 0] as Vec3, bearingDeg: 0 };
  expect(muzzleLocal(single, { train: 0, elevation: 0 }, 0)[0]).toBe(0);
  expect(createMountState(single).ammo).toBe(360);
  const quad = { ...definition.mounts.find(m => m.weapon.barrelCount === 4)!, position: [0, 0, 0] as Vec3, bearingDeg: 0 };
  expect(barrelIds(quad.weapon)).toEqual(['left-outer', 'left', 'right', 'right-outer']);
  [0, 1, 2, 3].forEach((index) => {
    expect(muzzleLocal(quad, { train: 0, elevation: 0 }, index)[0]).toBeCloseTo([-.45, -.15, .15, .45][index], 6);
  });
  expect(createMountState(quad).ammo).toBe(3200);
});

for (const battery of ['main', 'secondary'] as Battery[]) {
  test(`Enterprise ${battery} fires only aligned mounts and preserves ammunition on the opposite side`, () => {
    const sim = new CombatSimulation(definition);
    const helm = { throttle: 0, rudder: 0 };
    const intent = { aim: [1800, 0, 0] as Vec3, fire: false, battery };
    for (let i = 0; i < 900; i++) sim.step(helm, intent);
    const ready = definition.mounts.filter((m, i) => m.battery === battery && sim.player.mounts[i].status === 'ready');
    expect(ready).toHaveLength(battery === 'main' ? 4 : 22);
    expect(ready.every(m => !m.id.includes('-port-'))).toBe(true);
    const before = sim.player.mounts.map(m => m.ammo);
    sim.step(helm, { ...intent, fire: true });
    const shots = sim.events.filter(e => e.kind === 'shot');
    expect(shots).toHaveLength(battery === 'main' ? 4 : 34);
    expect(new Set(shots.map(e => JSON.stringify(e.position))).size).toBe(shots.length);
    definition.mounts.forEach((m, i) => {
      expect(before[i] - sim.player.mounts[i].ammo).toBe(ready.includes(m) ? m.weapon.barrelCount! : 0);
    });
    sim.step(helm, { ...intent, fire: true });
    expect(sim.events.filter(e => e.kind === 'shot')).toHaveLength(shots.length);
  });
}

test('invalid loft sections and structures cannot enter an Enterprise definition', () => {
  const bad = (edit: (b: typeof source) => void, pattern: RegExp) => {
    const b = structuredClone(source); edit(b);
    expect(() => compileShip(b, catalog)).toThrow(pattern);
  };
  bad(b => b.hull.sections[1].station = 0, /strictly increasing/);
  bad(b => b.hull.sections[1].points[0][0] = 100, /half breadth/);
  bad(b => b.hull.sections[1].points[1][1] = -100, /section height/);
  bad(b => b.hull.sections.pop(), /span/);
  bad(b => b.structures[1].id = b.structures[0].id, /duplicate/);
  bad(b => b.structures[0].footprint[0][0] = NaN, /finite/);
  bad(b => b.mountEnvelope.beam = b.hull.beam - 1, /mountEnvelope/);
});
