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

/** Fails with `message` in the diff, naming the ship and funnel instead of a bare `false`. */
const holds = (ok: boolean, message: string) => expect(ok ? '' : message).toBe('');
/** A funnel structure's plan extent and highest point: its surface when it has one, else its footprint prism. */
const extent = (s: NonNullable<ReturnType<typeof shipPreset>['structures']>[number]) => {
  const points = s.surface?.vertices ?? s.footprint.map(([x, z]) => [x, s.baseY + s.height, z]);
  const range = (i: number) => [Math.min(...points.map(p => p[i])), Math.max(...points.map(p => p[i]))];
  return { x: range(0), z: range(2), top: Math.max(...points.map(p => p[1])) };
};

// Rules rather than measured literals: an accuracy pass that moves or reshapes a funnel keeps passing while its smoke
// still leaves that funnel's mouth, and a new ship needs no entry here.
test('every surface ship smokes from each funnel mouth, once, and never from bases, caps or the submarine', () => {
  for (const id of Object.keys(shipPresets)) {
    const def = shipPreset(id), outlets = funnelOutlets(def);
    // Construction ships smoke from installed sockets (the test above); a submarine has no funnel.
    if (def.construction || def.submarine) { holds(!outlets.length, `${id}: ${outlets.length} outlets`); continue; }
    holds(outlets.length > 0, `${id}: no funnel outlet`);
    for (const [i, outlet] of outlets.entries()) {
      const where = `${id} ${outlet.id} at ${outlet.position.map(v => v.toFixed(2)).join(', ')}`;
      holds(outlet.position.every(Number.isFinite) && outlet.width > 0, `${where}: not a mouth`);
      // A base, cap or casing matched as a funnel would add a second outlet at the same stack.
      for (const other of outlets.slice(i + 1))
        holds(Math.hypot(outlet.position[0] - other.position[0], outlet.position[2] - other.position[2]) > 1, `${where}: shares a stack with ${other.id}`);
      const jacket = def.structures!.find(s => s.id === outlet.id)!, { x, z, top } = extent(jacket);
      const [px, py, pz] = outlet.position;
      holds(px >= x[0] - .1 && px <= x[1] + .1 && pz >= z[0] - .1 && pz <= z[1] + .1, `${where}: outside its funnel's plan [${x}] × [${z}]`);
      // Side-discharging stacks (outside the beam) smoke below their crown: the carrier test below.
      if (Math.abs(px) <= def.hull.beam / 2)
        holds(py >= jacket.baseY + .6 * (top - jacket.baseY) && py <= top + 1, `${where}: not at its funnel's mouth (base ${jacket.baseY}, top ${top.toFixed(2)})`);
    }
    // Explicit outlet datums are used as authored, including on stable IDs that lack the old -funnel suffix.
    for (const s of def.structures ?? []) if (s.exhaust)
      expect(outlets.find(o => o.id === s.id)?.position).toEqual(s.exhaust.position);
  }
  // A curved uptake smokes aft of its base, and a raked cap below its raised forward lip.
  const yamato = shipPreset('yamato'), uptake = yamato.structures!.find(s => s.id === 'funnel-jacket')!;
  const base = uptake.footprint.reduce((sum, [, z]) => sum + z, 0) / uptake.footprint.length;
  expect(funnelOutlets(yamato)[0].position[2]).toBeGreaterThan(base);
  const bismarck = shipPreset('bismarck'), cap = bismarck.structures!.find(s => s.id === 'funnel-jacket')!;
  expect(funnelOutlets(bismarck)[0].position[1]).toBeLessThan(extent(cap).top);
});

test('side-discharging carrier exhaust uses the authored mouths below the jacket crown', () => {
  const def = shipPreset('shokaku');
  const outlets = funnelOutlets(def);
  expect(outlets).toHaveLength(2);
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
