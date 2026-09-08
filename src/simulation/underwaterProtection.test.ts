import { expect, test } from 'bun:test';
import bismarck from '../../assets/ships/bismarck/blueprint.json';
import yamato from '../../assets/ships/yamato/blueprint.json';
import kgv from '../../assets/ships/king-george-v/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { damageTorpedoHit, firstTorpedoHit, torpedoProtection, type Torpedo } from './torpedoes';
import { localToWorld } from './geometry';
import { inspectionEntries } from '../ships/inspection';

const weapon = { ...catalog.torpedoes[0], kind: 'torpedo' as const, damage: 480, breachAreaM2: .55 };
const round: Torpedo = { id: 1, ownerId: 'attacker', tubeId: 'test', position: [0, -2, 0], velocity: [23, 0, 0], distance: 400, age: 20, weapon };

for (const blueprint of [bismarck, yamato, kgv]) {
  test(`${blueprint.id}: real side contacts receive protection; ends, keel and opposite side do not`, () => {
    const def = compileShip(blueprint, catalog);
    const sim = new CombatSimulation(def);
    const actor = sim.player;
    actor.motion.heading = .8; actor.motion.roll = .1; actor.motion.pitch = -.03;
    for (const side of [-1, 1]) {
      const from = localToWorld([side * (def.hull.beam / 2 + 5), -2, 0], actor.motion);
      const to = localToWorld([0, -2, 0], actor.motion);
      const hit = firstTorpedoHit(round, from, to, [actor])!;
      expect(hit).toBeDefined();
      expect(torpedoProtection(def, hit.point).damageReduction).toBe(.5);
    }
    expect(torpedoProtection(def, [0, -def.hull.draft, 0]).damageReduction).toBe(0);
    expect(torpedoProtection(def, [0, -2, -def.hull.length * .45]).damageReduction).toBe(0);
    expect(torpedoProtection(def, [def.hull.beam / 2, .01, 0]).damageReduction).toBe(0);
    def.underwaterProtection!.zones = def.underwaterProtection!.zones.filter(z => z.center[0] < 0);
    expect(torpedoProtection(def, [def.hull.beam / 2, -2, 0]).damageReduction).toBe(0);
  });

  test(`${blueprint.id}: protection halves direct damage and breach at the same impact, and is inspectable`, () => {
    const def = compileShip(blueprint, catalog);
    const unprotected = structuredClone(def); delete unprotected.underwaterProtection;
    const point: Vec3 = [def.hull.beam / 2, -2, 0];
    const strike = (d: typeof def) => {
      const actor = new CombatSimulation(d).player;
      const message = damageTorpedoHit(round, actor, point);
      return { loss: actor.damage.maxIntegrity - actor.damage.integrity, breach: actor.damage.compartments.reduce((n,c) => n + c.breachAreaM2, 0), message };
    };
    const a = strike(def), b = strike(unprotected);
    expect(a.loss).toBeGreaterThan(0);
    expect(a.loss / b.loss).toBeCloseTo(.5, 2);
    expect(b.loss).toBeLessThanOrEqual(10500);
    expect(a.breach).toBeCloseTo(.175);
    expect(b.breach).toBeCloseTo(.35);
    expect(a.message).toContain('underwater defense');
    expect(inspectionEntries(def).filter(e => e.underwaterProtection)).toHaveLength(2);
    const overlap = structuredClone(def); overlap.underwaterProtection!.zones.push({ ...overlap.underwaterProtection!.zones[1], id: 'overlap' });
    expect(strike(overlap)).toEqual(a);
  });
}

test('protection schema rejects invalid calibration and coverage; absent extension remains valid', () => {
  for (const edit of [
    (b: any) => b.underwaterProtection.version = 2,
    (b: any) => b.underwaterProtection.zones[0].damageReduction = 1,
    (b: any) => b.underwaterProtection.zones[0].breachReduction = -1,
    (b: any) => b.underwaterProtection.zones[0].center[1] = 3,
    (b: any) => b.underwaterProtection.zones[0].size[0] = 100,
    (b: any) => b.underwaterProtection.zones.push(b.underwaterProtection.zones[0]),
  ]) {
    const b = structuredClone(bismarck); edit(b);
    expect(() => compileShip(b, catalog)).toThrow();
  }
  const b: any = structuredClone(bismarck); delete b.underwaterProtection;
  expect(compileShip(b, catalog).underwaterProtection).toBeUndefined();
});
