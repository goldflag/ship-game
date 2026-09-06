import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { addBreach, updateFlooding } from './damage';
import { directControl, heatModule, heatMount, updateDamageControl } from './damageControl';
const fixture = (teams = 3) => { const def = compileShip(blueprint, catalog); def.damageControl!.teams = teams; const sim = new CombatSimulation(def); return { def, sim, a: sim.player }; };
const run = (a: ReturnType<typeof fixture>['a'], seconds: number) => { for (let t = 0; t < seconds * 60; t++) updateDamageControl(a, a.definition, 1 / 60, () => {}); };

test('teams extinguish fires; finite fuel bounds unattended burning and damage persists', () => {
  const fought = fixture(), neglected = fixture(0);
  for (const { a } of [fought, neglected]) heatMount(a, 0, 100);
  run(fought.a, 180); run(neglected.a, 180);
  expect(fought.a.damage.control.mounts[0].heat).toBe(0);
  expect(fought.a.mounts[0].hp).toBeGreaterThan(80);
  expect(neglected.a.mounts[0].hp).toBeLessThan(40);
  expect(neglected.a.damage.control.mounts[0].fuel).toBe(0);
  expect(neglected.a.damage.control.mounts[0].intensity).toBe(0);
});

test('water prevents magazine ignition; HP exhaustion alone never detonates; dry delivered heat can', () => {
  for (const water of [false, true]) {
    const { a, def } = fixture(0), mi = def.modules.findIndex(m => m.kind === 'magazine'), m = def.modules[mi];
    const ri = def.compartments.findIndex(c => c.id === m.compartmentId);
    a.damage.modules[mi].hp = 0; run(a, 1); expect(a.damage.modules[mi].detonated).toBe(false);
    if (water) a.damage.compartments[ri].waterM3 = def.compartments[ri].capacityM3 * .3;
    heatModule(a, def, mi, 180); run(a, 1);
    expect(a.damage.modules[mi].detonated).toBe(!water);
    expect(a.damage.compartments[ri].breachAreaM2 > 0).toBe(!water);
    if (!water) expect(a.mounts[0].ammo).toBe(0);
  }
});

test('protected feed paths prevent automatic remote magazine explosions from one gunhouse fire', () => {
  const { a, def } = fixture(0); heatMount(a, 0, 100); run(a, 180);
  expect(def.mounts[0].magazineId).toBeDefined();
  expect(a.damage.modules.some(m => m.detonated)).toBe(false);
  def.damageControl!.flashProtection = 0;
  const exposed = new CombatSimulation(def).player; heatMount(exposed, 0, 150); run(exposed, 90);
  expect(exposed.damage.modules.some(m => m.detonated)).toBe(true);
});

test('finite spares and repair ceiling never revive destroyed machinery or replenish ammunition', () => {
  const { a, def } = fixture(); directControl(a, 'repairs');
  a.mounts[0].hp = 0; a.mounts[1].hp = 20; a.mounts[1].ammo = 7; a.mounts[1].heAmmo = 2;
  a.damage.modules[0].hp = 0; a.damage.modules[1].hp = 10; a.damage.control.spares = 25;
  const initial = a.mounts[1].hp + a.damage.modules[1].hp;
  run(a, 200);
  expect(a.mounts[0].hp).toBe(0); expect(a.damage.modules[0].hp).toBe(0);
  expect(a.mounts[1].hp + a.damage.modules[1].hp - initial).toBeCloseTo(25, 7);
  expect(a.damage.control.spares).toBe(0); expect(a.mounts[1].ammo).toBe(7); expect(a.mounts[1].heAmmo).toBe(2);
  a.damage.control.spares = 1000; run(a, 1000);
  expect(a.mounts[1].hp).toBeCloseTo(60); expect(a.damage.modules[1].hp).toBeCloseTo(def.modules[1].hp * .6);
});

test('flooding teams close intact open boundaries but preserve damaged boundaries and conserve transferred water', () => {
  const { a, def } = fixture(); def.compartments.forEach(c => c.pumpM3PerSecond = 0);
  const link = a.damage.connections[0], other = a.damage.connections[1];
  link.state = 'open'; other.state = 'damaged'; other.damageAreaM2 = .1;
  a.damage.compartments[link.fromIndex].waterM3 = def.compartments[link.fromIndex].capacityM3 * .2;
  directControl(a, 'flooding'); run(a, 7);
  expect(String(link.state)).toBe('closed'); expect(other.state).toBe('damaged');
  a.damage.control.pumping.fill(0);
  const before = a.damage.compartments.reduce((s, r) => s + r.waterM3, 0);
  updateFlooding(a, def, 1 / 60);
  expect(a.damage.compartments.reduce((s, r) => s + r.waterM3, 0)).toBeCloseTo(before, 7);
});

test('shoring consumes spares, oversized openings remain, and portable pumping takes setup time', () => {
  const { a, def } = fixture(); directControl(a, 'flooding');
  addBreach(a.damage.compartments[0], def.compartments[0].center, .1, 1);
  addBreach(a.damage.compartments[1], def.compartments[1].center, 1, 2);
  a.damage.compartments[2].waterM3 = 10;
  run(a, 1); expect(a.damage.control.pumping.every(p => p === 0)).toBe(true);
  run(a, 60);
  expect(a.damage.compartments[0].breachAreaM2).toBeCloseTo(0); expect(a.damage.compartments[1].breachAreaM2).toBe(1);
  expect(a.damage.control.spares).toBeCloseTo(170); expect(a.damage.control.pumping[2]).toBeGreaterThan(0);
});

test('closed boundaries contain fire and opened paths can spread it', () => {
  const { a } = fixture(0), link = a.damage.connections[0];
  a.damage.control.rooms[link.fromIndex].heat = 1.5; run(a, 45);
  expect(a.damage.control.rooms[link.toIndex].heat).toBe(0);
  link.state = 'open'; run(a, 70);
  expect(a.damage.control.rooms[link.toIndex].intensity).toBeGreaterThan(0);
});

test('damage control resets and uses identical fixed ticks at different display rates', () => {
  const x = fixture(), y = fixture();
  const initial = structuredClone(x.a.damage.control);
  for (const f of [x, y]) heatMount(f.a, 0, 100);
  const intent = { battery: 'main' as const, aim: [0, 0, -1000] as [number, number, number], fire: false, controlPriority: 'fires' as const };
  for (let i = 0; i < 600; i++) x.sim.advance(1 / 60, { throttle: 0, rudder: 0 }, intent);
  for (let i = 0; i < 300; i++) y.sim.advance(1 / 30, { throttle: 0, rudder: 0 }, intent);
  expect(x.a.damage).toEqual(y.a.damage); x.sim.reset(); expect(x.a.damage.control).toEqual(initial);
});
