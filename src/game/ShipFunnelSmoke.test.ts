import { expect, test } from 'bun:test';
import { Camera, Group, InstancedMesh, Matrix4, Mesh, Object3D, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { shipPreset, shipPresets } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { localToWorld } from './geometry';
import { funnelOutlets, ShipFunnelSmoke } from './ShipFunnelSmoke';
import { createStarterSource } from '../ships/constructionStarter';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog } from '../ships/blueprint';

const fixture = (id = 'bismarck') => {
  const definition = shipPreset(id), sim = new CombatSimulation(definition);
  return { sim, ship: { definition, actor: sim.player, motion: sim.player.motion } };
};
const billows = (smoke: ShipFunnelSmoke) => smoke.root.children.find(child => (child as InstancedMesh).isInstancedMesh) as InstancedMesh;
const ribbon = (smoke: ShipFunnelSmoke) => smoke.root.children.find(child => (child as Mesh).isMesh && !(child as InstancedMesh).isInstancedMesh) as Mesh;
const instances = (smoke: ShipFunnelSmoke) => {
  const mesh = billows(smoke), matrix = new Matrix4();
  return Array.from({ length: smoke.diagnostics().particles }, (_, i) => {
    mesh.getMatrixAt(i, matrix);
    return new Vector3().setFromMatrixPosition(matrix);
  });
};

test('construction smoke uses installed exhaust sockets and cancels the ship world pose', () => {
  const base = shipPreset('bismarck'), definition = { ...base, modules: base.modules.map(m => ({ ...m })) };
  definition.structures = [];
  definition.construction = createStarterSource(catalogJson as ConstructionCatalog, 'patrol').construction;
  definition.construction.equipment = [{ id: 'stack', partId: 'kirov-forward-funnel', position: [3, 2, 7], bearingDeg: 90 }];
  definition.modules = [{ ...definition.modules[0], id: 'stack', role: 'boiler', size: [4, 12, 11] }];
  const model = new Group(), installed = new Group(), root = new Group(), socket = new Object3D();
  model.position.set(300, 40, -900); model.rotation.set(.1, .6, -.2);
  installed.position.set(3, 2, 7); installed.rotation.y = -Math.PI / 2;
  root.userData = { nodeId: 'stack.root', funnelOutletWidthM: 2.6, funnelOutletLengthM: 6.5 };
  socket.userData.nodeId = 'stack.socket.exhaust-out'; socket.position.set(0, 10, 2);
  model.add(installed); installed.add(root); root.add(socket);
  const before = JSON.stringify(definition), [outlet] = funnelOutlets(definition, model);
  expect(outlet.id).toBe('stack');
  outlet.position.forEach((value, i) => expect(value).toBeCloseTo([1, 12, 7][i], 9));
  expect(outlet.width).toBe(2.6); expect(outlet.length).toBe(6.5);
  expect(outlet.bearingRad).toBeCloseTo(Math.PI / 2, 9);
  expect(JSON.stringify(definition)).toBe(before);
  socket.userData.nodeId = 'stack.socket.exhaust-in';
  expect(funnelOutlets(definition, model)).toEqual([]);
  socket.userData.nodeId = 'stack.socket.exhaust-out'; definition.modules[0].role = 'combined-drive';
  expect(funnelOutlets(definition, model)).toEqual([]);
});

test('all registered funnel mouths are found without smoking from bases, caps or the submarine', () => {
  const counts: Record<string, number> = { resolute: 0, 'admiral-hipper': 1, bismarck: 1, yamato: 1, iowa: 2, 'king-george-v': 2, hood: 2, baltimore: 2, mogami: 2, 'enterprise-cv6': 1, 'type-viic': 0,
    'liberty-cargo': 1, 'liberty-collier': 1, 'victory-cargo': 1, 'flower-corvette': 1, fletcher: 2, gleaves: 2, shokaku: 2, yukikaze: 2, fubuki: 2, cleveland: 2, alaska: 1 };
  for (const id of Object.keys(shipPresets)) {
    const outlets = funnelOutlets(shipPreset(id));
    if (shipPreset(id).construction) { expect(outlets).toEqual([]); continue; }
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
  // The Bismarck cap's raked mouth (23.43 m aft to 25.0 m forward) averages 24.09 m, below its raised forward lip.
  expect(funnelOutlets(shipPreset('bismarck'))[0].position[1]).toBeCloseTo(24.24, 2);
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
  // Wind (0.35 m in 0.1 s) plus local turbulence, without inheriting the hull's 20 m move.
  expect(instances(smoke)[0].x - first.x).toBeGreaterThan(.25);
  expect(instances(smoke)[0].x - first.x).toBeLessThan(.45);
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
  // Two funnels at the idle rate (3.8 billows/s each) for two seconds.
  expect(idle).toBe(14);
  smoke.reset(); ship.motion.speed = ship.definition.handling.forwardSpeed;
  for (let i = 0; i < 20; i++) smoke.update([ship], .1, camera);
  expect(smoke.diagnostics().particles).toBeGreaterThan(idle);
  expect(instances(smoke).some(p => p.z < 0)).toBe(true);
  expect(instances(smoke).some(p => p.z > 0)).toBe(true);
  for (const module of ship.actor.damage.modules) module.hp = 0;
  for (let i = 0; i < 130; i++) smoke.update([ship], .1, camera);
  expect(smoke.diagnostics().particles).toBe(0);
  // The released trail outlives the billows, then drifts away and ends.
  expect(smoke.diagnostics().trailSegments).toBeGreaterThan(0);
  for (let i = 0; i < 900; i++) smoke.update([ship], .1, camera);
  expect(smoke.diagnostics().trailSegments).toBe(0);
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
  expect(new Set(counts).size).toBe(1);
  expect(counts[0]).toBe(7);
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

test('a released trail streams downwind behind a moving ship, lit and bounded to what the camera sees', () => {
  const { ship } = fixture(), smoke = new ShipFunnelSmoke(), camera = new PerspectiveCamera(50, 16 / 9, .5, 60000);
  smoke.setWind(8, Math.PI / 2); // Drift toward +Z.
  ship.motion.speed = ship.definition.handling.forwardSpeed;
  camera.position.set(-600, 120, 300); camera.lookAt(0, 30, 300); camera.updateMatrixWorld();
  for (let i = 0; i < 600; i++) {
    ship.motion.z -= ship.motion.speed * 1.5 / 60; // Heading 0: the bow runs toward −Z.
    smoke.update([ship], 1 / 60, camera);
  }
  const mesh = ribbon(smoke), positions = mesh.geometry.getAttribute('position');
  const count = mesh.geometry.drawRange.count;
  expect(mesh.visible).toBe(true);
  expect(count).toBeGreaterThan(30);
  // The strip streams aft of the funnel (+Z).
  const mouth = localToWorld(funnelOutlets(ship.definition)[0].position, ship.motion);
  let aft = 0;
  for (let i = 0; i < positions.count && i < 400; i++) aft = Math.max(aft, positions.getZ(i) - mouth[2]);
  expect(aft).toBeGreaterThan(100);
  // Turn the camera away: the trail keeps drifting but draws nothing.
  camera.position.set(0, 30, 4000); camera.lookAt(0, 30, 9000); camera.updateMatrixWorld();
  smoke.update([ship], 1 / 60, camera);
  expect(smoke.diagnostics().trailSegments).toBe(0);
  // Own optics hide the trail as well as the billows.
  camera.position.set(-600, 120, 300); camera.lookAt(0, 30, 300); camera.updateMatrixWorld();
  smoke.update([ship], 0, camera, ship.motion.id);
  expect(smoke.diagnostics()).toMatchObject({ particles: 0, trailSegments: 0 });
  smoke.dispose();
});

test('damaged boilers and working up darken the exhaust; a steady plant makes light haze', () => {
  const albedo = (setup: (ship: ReturnType<typeof fixture>['ship']) => void, step?: (ship: ReturnType<typeof fixture>['ship'], i: number) => void) => {
    const { ship } = fixture(), smoke = new ShipFunnelSmoke(), camera = new Camera();
    setup(ship);
    for (let i = 0; i < 40; i++) { step?.(ship, i); smoke.update([ship], .1, camera); }
    const colors = billows(smoke).instanceColor!, n = smoke.diagnostics().particles;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += colors.getX(i);
    smoke.dispose();
    return sum / n;
  };
  const steady = albedo(ship => { ship.motion.speed = ship.definition.handling.forwardSpeed * .5; });
  const damaged = albedo(ship => {
    ship.motion.speed = ship.definition.handling.forwardSpeed * .5;
    ship.definition.modules.forEach((m, i) => { if (m.kind === 'engine' || m.role === 'boiler') ship.actor.damage.modules[i].hp *= .25; });
  });
  const workingUp = albedo(() => {}, (ship, i) => { ship.motion.speed = ship.definition.handling.forwardSpeed * i / 60; });
  expect(damaged).toBeLessThan(steady * .5);
  expect(workingUp).toBeLessThan(steady * .85);
});
