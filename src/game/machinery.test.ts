import { expect, test } from 'bun:test';
import { equipmentCondition, supportPerformance, systemHealth } from './machinery';
import type { ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './session/elements';
import { createShipState } from './session/motion';

function fixture() {
  const modules = [
    { id: 'small-engine', role: 'combined-drive', center: [0, -1, 0] },
    { id: 'large-engine', role: 'combined-drive', center: [2, -1, 0] },
    { id: 'small-funnel', role: 'boiler', center: [0, 3, 0] },
    { id: 'large-funnel', role: 'boiler', center: [2, 3, 0] },
    { id: 'screw', role: 'shaft', center: [0, -2, 0] },
  ].map(m => ({ ...m, kind: 'engine', hp: 100, size: [1, 1, 1] }));
  const def = { modules, compartments: [], mounts: [], hull: { volume: {} },
    loading: { contributions: ['small-engine', 'large-engine'].map(id => ({ id, kind: 'equipment', massKg: 35000 })) },
    propulsion: { groups: ['small', 'large'].map((name, i) => ({ id: name, share: i ? .75 : .25, driveIds: [name + '-engine'], shaftIds: ['screw'], boilerIds: ['small-funnel', 'large-funnel'] })),
      sharedExhaust: { engines: [{ id: 'small-engine', kw: 1000 }, { id: 'large-engine', kw: 3000 }], funnels: [{ id: 'small-funnel', kw: 1000 }, { id: 'large-funnel', kw: 5000 }] } },
  } as unknown as ShipDefinition;
  const actor = { motion: createShipState('test'), damage: { sunk: false, modules: modules.map(m => ({ id: m.id, hp: 100 })) } } as unknown as Combatant;
  const damage = (id: string, hp: number) => { actor.damage.modules.find(m => m.id === id)!.hp = hp; };
  return { actor, def, damage };
}

test('machinery readings track pooled spare capacity, unequal funnels and surviving engines', () => {
  const { actor, def, damage } = fixture();
  expect(systemHealth(actor, def, 'engine')).toBe(1);
  damage('small-funnel', 0);
  expect(systemHealth(actor, def, 'engine')).toBe(1);
  damage('large-funnel', 50);
  expect(systemHealth(actor, def, 'engine')).toBeCloseTo((2500 - 80) / 3920);
  expect(supportPerformance(actor, def).power).toBe(1);
  damage('large-engine', 0);
  expect(systemHealth(actor, def, 'engine')).toBeCloseTo(.25);
  expect(supportPerformance(actor, def).power).toBe(.5);
  damage('large-funnel', 0);
  expect(systemHealth(actor, def, 'engine')).toBe(0);
  expect(supportPerformance(actor, def).power).toBe(0);
});

test('machinery readings remove submerged exhaust and exposed propellers from service', () => {
  const { actor, def } = fixture();
  def.modules.find(m => m.id === 'large-funnel')!.center[1] = -10;
  expect(equipmentCondition(actor, def, 'large-funnel').reason).toBe('flooded');
  expect(systemHealth(actor, def, 'engine')).toBeCloseTo((1000 - 80) / 3920);
  def.modules.find(m => m.id === 'screw')!.center[1] = 2;
  expect(systemHealth(actor, def, 'engine')).toBe(0);
  expect(supportPerformance(actor, def).power).toBe(1);
});

test('one damaged screw leaves its shared engine driving the healthy screw', () => {
  const { actor, def, damage } = fixture();
  def.modules.push({ ...def.modules.find(m => m.id === 'screw')!, id: 'second-screw', center: [2,-2,0] });
  actor.damage.modules.push({ id: 'second-screw', hp: 100 } as typeof actor.damage.modules[number]);
  for (const group of def.propulsion!.groups) group.shaftIds.push('second-screw');
  damage('screw', 0);
  expect(systemHealth(actor, def, 'engine')).toBeCloseTo(.5);
  delete def.propulsion!.sharedExhaust;
  expect(systemHealth(actor, def, 'engine')).toBeCloseTo(.5);
});

test('engine health reads exactly as module by module through damage, flooded rooms and a rolling sea', async () => {
  const { CombatSimulation } = await import('../simulation/combat');
  const { shipPreset } = await import('../ships/presets');
  const { createSeaState } = await import('./session/sea');
  const seeded = (seed: number) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
  /** The general reading: every module's `equipmentCondition`, combined as the propulsion groups (or the engines) combine. */
  const reference = (actor: Combatant, def: ShipDefinition) => {
    if (actor.damage.sunk) return 0;
    const available = (id: string) => equipmentCondition(actor, def, [...def.modules].reverse().find(m => m.id === id)!).availability;
    if (def.propulsion) return def.propulsion.groups.reduce((power, group) => {
      const steam = group.boilerIds.length ? group.boilerIds.reduce((n, id) => n + available(id), 0) / group.boilerIds.length : 1;
      const shaft = group.shaftIds.length ? group.shaftIds.reduce((n, id) => n + available(id), 0) / group.shaftIds.length : 1;
      return power + group.share * Math.min(steam, Math.min(...group.driveIds.map(available))) * shaft;
    }, 0);
    const modules = def.modules.filter(m => m.kind === 'engine');
    return modules.length ? modules.reduce((n, m) => n + available(m.id), 0) / modules.length : 1;
  };
  const random = seeded(3);
  let compared = 0, flooded = 0;
  for (const id of ['bismarck', 'yamato', 'king-george-v', 'baltimore', 'fletcher', 'flower-corvette', 'enterprise-cv6', 'shokaku']) {
    const sim = new CombatSimulation(shipPreset(id)), actor = sim.player, def = actor.definition;
    actor.sea = { state: createSeaState('north-atlantic', 'storm-clouds', 7, 16), time: 0 };
    for (let round = 0; round < 60; round++) {
      for (const [i, state] of actor.damage.modules.entries()) state.hp = random() < .3 ? def.modules[i].hp * Math.floor(random() * 4) / 3 : def.modules[i].hp;
      for (const room of actor.damage.compartments) room.waterM3 = random() < .2 ? random() * 400 : 0;
      Object.assign(actor.motion, { y: (random() - .7) * 12, roll: (random() - .5) * .4, pitch: (random() - .5) * .1, heading: random() * 6.3 });
      actor.sea.time = random() * 100;
      actor.damage.sunk = random() < .05;
      const value = systemHealth(actor, def, 'engine');
      expect(Object.is(value, reference(actor, def))).toBe(true);
      compared++; flooded += Number(value < 1);
    }
  }
  expect(compared).toBe(480);
  expect(flooded).toBeGreaterThan(100);
});
