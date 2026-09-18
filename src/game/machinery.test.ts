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
