import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { addBreach, createDamage, hitShip, updateFlooding, type DamageEvent, type Shell } from './damage';
import { damageHull, damageShellHull } from './durability';
import { consumeStructure, damageRegion, localDamageEvidence, regionCondition } from './localDamage';
import { heatModule, heatMount, updateDamageControl } from './damageControl';
import { supportPerformance } from './machinery';
import { damageAwareAimPoints } from './bots';
import { fireReadout } from './damageReadout';
import { updateMount } from './weapons';
import { burstShell } from './burst';
import { damageBlastHull } from './durability';

const fixture = () => { const def = compileShip(blueprint, catalog), sim = new CombatSimulation(def); Object.assign(sim.target.motion, { x: 0, z: 0 }); return { def, sim, actor: sim.target }; };
const projectile = (id = 1): Shell => ({ id, ownerId: 'player', position: [-30, 1, -21], velocity: [800, 0, 0], age: 0, damage: 70, caliberM: .38, penetrationMm: 550, visited: [] });
const localHit = (f: ReturnType<typeof fixture>, point: Vec3, id = 1) => damageShellHull(projectile(id), f.actor, 45.5, localDamageEvidence(f.actor, f.def, point));

test('repeated damage tapers locally, while opposite sides and lower spaces remain fresh', () => {
  const f = fixture(), point: Vec3 = [-17, 1, -21];
  const first = localHit(f, point);
  for (let i = 0; i < 25; i++) localHit(f, point, i + 2);
  expect(localHit(f, point, 90)).toBeLessThan(first * .01);
  expect(localHit(f, [17, 1, -21], 91)).toBeCloseTo(first, 6);
  expect(localHit(f, [-17, -4, -21], 92)).toBeCloseTo(first, 6);
  expect(f.actor.damage.integrity).toBeGreaterThan(f.actor.damage.maxIntegrity * .7);
});

test('spreading the same number of hits removes more hull HP than shooting one area', () => {
  const focused = fixture(), spread = fixture();
  for (let i = 0; i < 16; i++) {
    localHit(focused, [-17, 1, -21], i);
    localHit(spread, [i < 8 ? -17 : 17, 1, -110 + (i % 8) * 30], i);
  }
  expect(focused.actor.damage.integrity - spread.actor.damage.integrity).toBeGreaterThan(400);
});

test('one shell cannot multiply hull damage across layers, ticks or repeat contacts', () => {
  const f = fixture(), shell = projectile();
  let paid = 0;
  for (const point of [[-17, 1, -21], [-17, 1, -21], [17, 1, -21]] as Vec3[]) paid += damageShellHull(shell, f.actor, 45.5, localDamageEvidence(f.actor, f.def, point));
  expect(paid).toBeCloseTo(45.5, 8);
  paid += damageShellHull(shell, f.actor, 59.5, localDamageEvidence(f.actor, f.def, [17, 1, -21]));
  expect(paid).toBeCloseTo(59.5, 8);
});

test('a shell traverses wreckage and damages an intact module without spending its opportunity at entry', () => {
  const f = fixture(); delete f.def.structuralPlating; delete f.def.stability;
  f.def.mounts = []; f.actor.mounts = []; f.def.connections = []; f.actor.damage.connections = [];
  f.def.armor = [{ id: 'test-plate', name: 'Outer plate', center: [-17, 1, -21], size: [.001, 4, 4], thicknessMm: 100 }];
  f.def.modules = [{ id: 'intact-engine', name: 'Intact engine', kind: 'engine', center: [5, 1, -21], size: [2, 2, 2], hp: 100, compartmentId: f.def.compartments[0].id }];
  f.actor.damage = createDamage(f.def);
  const entry = damageRegion(f.def, [-17, 1, -21])!;
  f.actor.damage.regions.find(r => r.id === entry.id)!.hp = 0;
  const events: DamageEvent[] = [], shell = projectile();
  hitShip(shell, [-30, 1, -21], [10, 1, -21], f.actor, f.def, e => events.push(e));
  expect(events[0].impact!.hullDamage).toBe(0);
  const equipment = events.find(e => e.impact?.targetId === 'intact-engine')!.impact!;
  expect(equipment.damage).toBeGreaterThan(0);
  expect(equipment.hullDamage).toBeGreaterThan(0);
  expect(equipment.throughWreckage).toBe(true);
  expect(events.reduce((n, e) => n + (e.impact?.hullDamage ?? 0), 0)).toBeLessThanOrEqual(59.5);
});

test('finishing a one-HP module awards only the hull consequence of that fresh damage', () => {
  const f = fixture(); delete f.def.structuralPlating; delete f.def.stability;
  f.def.armor = []; f.def.mounts = []; f.actor.mounts = []; f.def.connections = []; f.actor.damage.connections = [];
  f.def.modules = [{ id: 'test-engine', name: 'Engine', kind: 'engine', center: [5, 1, -21], size: [2, 2, 2], hp: 100, compartmentId: f.def.compartments[0].id }];
  f.actor.damage = createDamage(f.def); f.actor.damage.modules[0].hp = 1;
  const before = f.actor.damage.integrity;
  hitShip(projectile(), [0, 1, -21], [10, 1, -21], f.actor, f.def, () => {});
  expect(before - f.actor.damage.integrity).toBeLessThan(2);
  expect(f.actor.damage.modules[0].hp).toBe(0);
});

test('local structure is finite and independent of integration step and equipment repairs', () => {
  const a = fixture(), b = fixture(), id = damageRegion(a.def, [-17, 1, -21])!.id;
  consumeStructure(a.actor, 180, id);
  for (let i = 0; i < 600; i++) consumeStructure(b.actor, .3, id);
  expect(regionCondition(a.actor, id)).toBeCloseTo(regionCondition(b.actor, id), 10);
  const prior = a.actor.damage.regions.find(r => r.id === id)!.hp;
  a.actor.mounts[0].hp = 50;
  for (let i = 0; i < 600; i++) updateDamageControl(a.actor, a.def, 1 / 60, () => {});
  expect(a.actor.damage.regions.find(r => r.id === id)!.hp).toBe(prior);
  a.sim.reset(); expect(a.sim.target.damage.regions.every(r => r.hp === r.maximum)).toBe(true);
});

test('overlapping apertures count only newly opened area; widening and distinct holes still leak', () => {
  const { actor } = fixture(), room = actor.damage.compartments[0];
  expect(addBreach(room, [-17, -2, 0], .1, 1)).toBeCloseTo(.1);
  for (let i = 0; i < 100; i++) expect(addBreach(room, [-17, -2, 0], .1, i + 2)).toBe(0);
  const wider = addBreach(room, [-17, -2, 0], .2, 103);
  expect(wider).toBeCloseTo(.1, 2);
  expect(addBreach(room, [-17, -2, 3], .1, 104)).toBeCloseTo(.1);
  expect(addBreach(room, [17, -2, 0], .1, 105)).toBeCloseTo(.1);
  expect(room.breachAreaM2).toBeCloseTo(.4, 2);
});

test('burned-out fuel does not regenerate from later hits, even in wrecked equipment', () => {
  const { actor, def } = fixture(); def.damageControl!.teams = 0; actor.damage.control.teams = [];
  const mi = def.modules.findIndex(m => m.kind === 'engine'), room = def.compartments.findIndex(c => c.id === def.modules[mi].compartmentId);
  actor.damage.modules[mi].hp = 0; heatModule(actor, def, mi, 100);
  updateDamageControl(actor, def, 1, () => {});
  expect(actor.damage.control.rooms[room].intensity).toBeGreaterThan(0);
  actor.damage.control.rooms[room].fuel = 0; actor.damage.control.rooms[room].heat = 0;
  heatModule(actor, def, mi, 1000); updateDamageControl(actor, def, 1, () => {});
  expect(actor.damage.control.rooms[room].intensity).toBe(0);
  expect(actor.damage.control.rooms[room].fuel).toBe(0);
});

test('fire readouts identify a threatened magazine and working crews', () => {
  const { actor, def } = fixture(); heatMount(actor, 0, 100);
  updateDamageControl(actor, def, 1 / 60, () => {});
  const fire = fireReadout(actor, def).find(f => f.id === def.mounts[0].id)!;
  expect(fire.status).toBe('Growing'); expect(fire.threat?.toLowerCase()).toContain('magazine');
  for (let i = 0; i < 450; i++) updateDamageControl(actor, def, 1 / 60, () => {});
  expect(fireReadout(actor, def).find(f => f.id === def.mounts[0].id)?.status).toBe('Being fought');
});

test('generator loss slows loading and reduces fixed pumping; directors affect targeting independently', () => {
  const healthy = fixture(), failed = fixture();
  failed.def.modules.forEach((m, i) => { if (m.kind === 'generator') failed.actor.damage.modules[i].hp = 0; });
  expect(supportPerformance(failed.actor, failed.def).power).toBe(0);
  for (const f of [healthy, failed]) {
    const state = f.actor.mounts[0]; state.reload = 10;
    updateMount(f.def.mounts[0], state, f.def, f.actor.motion, [1000, 5, 0], 1, [0, 0, 0], supportPerformance(f.actor, f.def).power);
    f.actor.damage.compartments[0].waterM3 = 10;
    f.def.compartments[0].pumpM3PerSecond = 1; updateFlooding(f.actor, f.def, 1);
  }
  expect(healthy.actor.mounts[0].reload).toBe(9); expect(failed.actor.mounts[0].reload).toBe(9.75);
  expect(healthy.actor.damage.compartments[0].waterM3).toBeLessThan(failed.actor.damage.compartments[0].waterM3);
  healthy.def.modules.forEach((m, i) => { if (m.kind === 'fire-control') healthy.actor.damage.modules[i].hp = 0; });
  expect(supportPerformance(healthy.actor, healthy.def)).toEqual({ power: 1, fireControl: 0 });
});

test('bots shift away from exhausted empty areas while considering surviving internals', () => {
  const f = fixture(); f.sim.player.motion.x = -1000;
  expect(damageAwareAimPoints(f.sim.player, f.actor)).toBeUndefined();
  for (const r of f.actor.damage.regions) r.hp = 0;
  const fresh = f.def.localDamage!.regions.find(r => r.id === 'upper-hull-port-6')!;
  f.actor.damage.regions.find(r => r.id === fresh.id)!.hp = fresh.durabilityFraction * f.actor.damage.maxIntegrity;
  f.actor.damage.modules.forEach(m => m.hp = 0);
  const points = damageAwareAimPoints(f.sim.player, f.actor)!;
  expect(points[0][2]).toBeCloseTo(fresh.center[2]);
  expect(points[0][0]).toBeLessThan(0);
});

test('global hull exhaustion still sinks and post-loss damage cannot consume more local structure', () => {
  const f = fixture(); f.actor.damage.integrity = 1;
  localHit(f, [-17, 1, -21]); updateFlooding(f.actor, f.def, 1 / 60);
  expect(f.actor.damage.defeatCause).toBe('hull-failure');
  const snapshot = structuredClone(f.actor.damage.regions);
  expect(damageHull(f.actor, 100, snapshot[0].id)).toBe(0);
  expect(f.actor.damage.regions).toEqual(snapshot);
});

test('underwater shock spans nearby regions and repeat blasts lose effectiveness', () => {
  const f = fixture(), first = damageBlastHull(f.actor, f.def, [-17, -2, 0], 320);
  expect(first).toBeGreaterThan(250);
  expect(f.actor.damage.regions.filter(r => r.hp < r.maximum).length).toBeGreaterThan(1);
  for (let i = 0; i < 12; i++) damageBlastHull(f.actor, f.def, [-17, -2, 0], 320);
  expect(damageBlastHull(f.actor, f.def, [-17, -2, 0], 320)).toBeLessThan(first * .1);
});

test('HE can ignite room fuel without equipment, while intact armor blocks that heat', () => {
  for (const thickness of [0, 320]) {
    const f = fixture(); delete f.def.structuralPlating; delete f.def.stability;
    f.def.modules = []; f.def.mounts = []; f.actor.mounts = []; f.def.connections = [];
    f.def.compartments = [{ id: 'fuel-room', name: 'Fuel space', center: [4, 1, -21], size: [2, 2, 2], capacityM3: 4, pumpM3PerSecond: 0,
      fire: { fuelSeconds: 90, ignitionHeat: .45, heatPerDamage: .02 } }];
    f.def.armor = thickness ? [{ id: 'shield', name: 'Armor', center: [0, 1, -21], size: [.1, 8, 8], thicknessMm: thickness }] : [];
    f.actor.damage = createDamage(f.def); f.actor.damage.control.teams = [];
    const shell = { ...projectile(), position: [-1, 1, -21] as Vec3, he: { explosiveKg: 20, fragmentPenetrationMm: 30, damage: 150, stockFraction: .3, basis: 'Test fixture' } };
    burstShell(shell, [f.actor], () => {}); updateDamageControl(f.actor, f.def, 1 / 60, () => {});
    expect(f.actor.damage.control.rooms[0].intensity > 0).toBe(thickness === 0);
  }
});

test('blueprints reject invalid region ownership and nonfinite fire profiles', () => {
  const badMount = structuredClone(blueprint); badMount.localDamage.regions.find(r => r.kind === 'mount')!.mountId = 'missing';
  expect(() => compileShip(badMount, catalog)).toThrow('unknown mount');
  const badFuel = structuredClone(blueprint); badFuel.compartments[0].fire.fuelSeconds = -1;
  expect(() => compileShip(badFuel, catalog)).toThrow('fuelSeconds');
  const badHeat = structuredClone(blueprint); badHeat.compartments[0].fire.heatPerDamage = NaN;
  expect(() => compileShip(badHeat, catalog)).toThrow('heatPerDamage');
});

test('an armed burst beyond a fully depleted entry still damages intact internal structure', () => {
  const f = fixture(), ap = f.def.mounts[0].weapon.ap;
  f.def.armor = []; f.def.modules = []; f.def.mounts = []; f.actor.mounts = []; f.def.connections = [];
  delete f.def.structuralPlating; delete f.def.stability;
  f.actor.damage = createDamage(f.def);
  const entry = localDamageEvidence(f.actor, f.def, [-17, 1, -21])!;
  f.actor.damage.regions.find(r => r.id === entry.regionId)!.hp = 0;
  const shell = { ...projectile(), ap, position: [10, 1, -21] as Vec3, lastHitShipId: f.actor.motion.id };
  expect(damageShellHull(shell, f.actor, 45.5, entry)).toBe(0);
  const before = f.actor.damage.integrity;
  burstShell(shell, [f.actor], () => {});
  expect(before - f.actor.damage.integrity).toBeGreaterThan(0);
  expect(before - f.actor.damage.integrity).toBeLessThanOrEqual(45.5);
});

test('pressure-hull growth widens its own opening instead of migrating a distant shell hole', () => {
  const { actor } = fixture(), room = actor.damage.compartments[0];
  addBreach(room, [-17, 1, 0], .1, 1);
  const shellHole = structuredClone(room.breaches[0]);
  for (let i = 0; i < 5; i++) addBreach(room, [0, -9, 0], .001, -1, .05, [0, -1, 0], true);
  expect(room.breaches).toHaveLength(2);
  expect(room.breaches[0]).toEqual(shellHole);
  expect(room.breaches[1]).toMatchObject({ position: [0, -9, 0], radiusM: .05 });
  expect(room.breaches[1].areaM2).toBeCloseTo(.005, 9);
  expect(room.breachAreaM2).toBeCloseTo(.105, 9);
});
