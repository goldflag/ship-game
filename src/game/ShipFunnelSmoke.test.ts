import { expect, test } from 'bun:test';
import { Camera, InstancedMesh, Matrix4, Vector3 } from 'three/webgpu';
import { shipPreset, shipPresets } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { localToWorld } from '../simulation/geometry';
import { funnelOutlets, ShipFunnelSmoke } from './ShipFunnelSmoke';

const fixture = (id = 'bismarck') => {
  const definition = shipPreset(id), sim = new CombatSimulation(definition);
  return { sim, ship: { definition, actor: sim.player, motion: sim.player.motion } };
};
const instances = (smoke: ShipFunnelSmoke) => {
  const mesh = smoke.root.children[0] as InstancedMesh, matrix = new Matrix4();
  return Array.from({ length: smoke.diagnostics().particles }, (_, i) => {
    mesh.getMatrixAt(i, matrix);
    return new Vector3().setFromMatrixPosition(matrix);
  });
};

test('all registered funnel mouths are found without smoking from bases, caps or the submarine', () => {
  const counts: Record<string, number> = { kongo: 2, bismarck: 1, yamato: 1, iowa: 2, 'king-george-v': 2, baltimore: 2, mogami: 2, 'enterprise-cv6': 1, 'type-viic': 0,
    'liberty-cargo': 1, 'liberty-collier': 1, 'victory-cargo': 1, 'flower-corvette': 1, fletcher: 2, gleaves: 2, shokaku: 2, yukikaze: 2, fubuki: 2, cleveland: 2 };
  for (const id of Object.keys(shipPresets)) {
    const outlets = funnelOutlets(shipPreset(id));
    expect(outlets.length).toBe(counts[id]);
    for (const outlet of outlets) {
      expect(outlet.position.every(Number.isFinite)).toBe(true);
      expect(outlet.width).toBeGreaterThan(0);
      const jacket = shipPreset(id).structures!.find(s => s.id === outlet.id)!;
      expect(outlet.position[1]).toBeGreaterThan(jacket.baseY);
    }
  }
  expect(funnelOutlets(shipPreset('enterprise-cv6'))[0].position[0]).toBeCloseTo(11.049, 2);
  // The curved outlet sits aft of the uptake's base, and below its highest lip.
  expect(funnelOutlets(shipPreset('yamato'))[0].position[2]).toBeCloseTo(23.3, 2);
  // The refined Bismarck rim averages 24.30 m, below its raised forward lip.
  expect(funnelOutlets(shipPreset('bismarck'))[0].position[1]).toBeCloseTo(24.45, 2);
  expect(funnelOutlets(shipPreset('fletcher'))[0].position[2]).toBeCloseTo(-9.2146, 2);
  expect(funnelOutlets(shipPreset('yukikaze')).map(o => o.position[1])).toEqual([11.42, 9.98]);
  // Explicit outlet datums also work with stable IDs that lack the old suffix.
  expect(funnelOutlets(shipPreset('iowa')).map(o => o.position)).toEqual([[0, 28.35, 4.46], [0, 27.75, 29.16]]);
});

test('side-discharging carrier exhaust uses the authored mouths below the jacket crown', () => {
  const def = shipPreset('shokaku');
  const outlets = funnelOutlets(def);
  expect(outlets).toHaveLength(2);
  expect(outlets.map(o => o.position)).toEqual([[19.6, 12.8, -10], [19.6, 12.8, 2]]);
  for (const outlet of outlets) {
    const jacket = def.structures!.find(s => s.id === outlet.id)!;
    expect(outlet.position[1]).toBeLessThan(jacket.baseY + jacket.height);
    expect(outlet.position[0]).toBeGreaterThan(def.hull.beam / 2);
  }
});

test('exhaust follows a moving, heeled funnel; released smoke drifts independently, freezes and resets', () => {
  const { sim, ship } = fixture(), smoke = new ShipFunnelSmoke(), camera = new Camera();
  Object.assign(ship.motion, { x: 240, z: -900, heading: 1.2, roll: .15, pitch: -.1 });
  const before = JSON.stringify(sim);
  for (let i = 0; i < 4; i++) smoke.update([ship], .1, camera);
  expect(JSON.stringify(sim)).toBe(before);
  expect(smoke.diagnostics().particles).toBe(1);
  const origin = new Vector3(...localToWorld(funnelOutlets(ship.definition)[0].position, ship.motion));
  const first = instances(smoke)[0];
  expect(first.distanceTo(origin)).toBeLessThan(4);
  for (let i = 0; i < 20; i++) smoke.update([ship], 0, camera);
  expect(instances(smoke)[0].distanceTo(first)).toBe(0);
  ship.motion.x += 20;
  smoke.setWind(10, 0);
  smoke.update([ship], .1, camera);
  // Wind plus small local turbulence, without inheriting the hull's 20 m move.
  expect(instances(smoke)[0].x - first.x).toBeGreaterThan(.31);
  expect(instances(smoke)[0].x - first.x).toBeLessThan(.39);
  expect(instances(smoke)[0].y).toBeGreaterThan(first.y);
  smoke.update([ship], 0, camera, ship.motion.id);
  expect(smoke.diagnostics().particles).toBe(0);
  smoke.update([ship], 0, camera);
  expect(smoke.diagnostics().particles).toBe(1);
  sim.reset(); ship.motion = sim.player.motion;
  smoke.update([ship], 0, camera);
  expect(smoke.diagnostics().particles).toBe(0);
  expect(instances(smoke)).toEqual([]);
  smoke.dispose();
});

test('exhaust increases underway, emits from both funnels, and dies away after machinery loss or immersion', () => {
  const { ship } = fixture('fletcher'), smoke = new ShipFunnelSmoke(), camera = new Camera();
  for (let i = 0; i < 20; i++) smoke.update([ship], .1, camera);
  const idle = smoke.diagnostics().particles;
  expect(idle).toBe(10);
  smoke.reset(); ship.motion.speed = ship.definition.handling.forwardSpeed;
  for (let i = 0; i < 20; i++) smoke.update([ship], .1, camera);
  expect(smoke.diagnostics().particles).toBeGreaterThan(idle);
  expect(instances(smoke).some(p => p.z < 0)).toBe(true);
  expect(instances(smoke).some(p => p.z > 0)).toBe(true);
  for (const module of ship.actor.damage.modules) module.hp = 0;
  for (let i = 0; i < 130; i++) smoke.update([ship], .1, camera);
  expect(smoke.diagnostics().particles).toBe(0);
  const fresh = fixture().ship;
  fresh.motion.y = -40;
  for (let i = 0; i < 20; i++) smoke.update([fresh], .1, camera);
  expect(smoke.diagnostics().particles).toBe(0);
  fresh.motion.y = 0; fresh.actor.damage.sunk = true;
  for (let i = 0; i < 20; i++) smoke.update([fresh], .1, camera);
  expect(smoke.diagnostics().particles).toBe(0);
  smoke.dispose();
});

test('emission timing is stable across display rates and fleet storage remains bounded', () => {
  const counts = [30, 60, 144].map(fps => {
    const { ship } = fixture(), smoke = new ShipFunnelSmoke(), camera = new Camera();
    for (let i = 0; i < fps * 2; i++) smoke.update([ship], 1 / fps, camera);
    const count = smoke.diagnostics().particles;
    smoke.dispose(); return count;
  });
  expect(counts).toEqual([5, 5, 5]);
  const ships = Array.from({ length: 60 }, (_, i) => {
    const { ship } = fixture('fletcher');
    ship.motion.id = `ship-${i}`; ship.motion.speed = ship.definition.handling.forwardSpeed;
    return ship;
  });
  const smoke = new ShipFunnelSmoke(), camera = new Camera();
  for (let i = 0; i < 130; i++) smoke.update(ships, .1, camera);
  expect(smoke.diagnostics().outlets.length).toBe(120);
  expect(smoke.diagnostics().particles).toBeGreaterThan(5000);
  expect(smoke.diagnostics().particles).toBeLessThanOrEqual(smoke.diagnostics().capacity);
  smoke.reset();
  expect(smoke.diagnostics().particles).toBe(0);
  smoke.dispose();
});
