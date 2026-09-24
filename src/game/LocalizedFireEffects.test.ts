import { expect, test } from 'bun:test';
import { Camera, InstancedBufferGeometry, InstancedMesh, Matrix4, PointLight, Vector3 } from 'three/webgpu';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { localToWorld } from './geometry';
import { LocalizedFireEffects } from './LocalizedFireEffects';
import type { BattleSession } from './session/BattleSession';
const def = shipPreset('bismarck');
const session = (sim: CombatSimulation) => sim as unknown as BattleSession;
const run = (fx: LocalizedFireEffects, sim: CombatSimulation, seconds: number, camera = new Camera(), wind = new Vector3(), hidden?: string, fps = 60) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) fx.update(session(sim), 1 / fps, camera, wind, hidden);
};
const mesh = (fx: LocalizedFireEffects, name: string) => fx.root.getObjectByName(name) as InstancedMesh<InstancedBufferGeometry>;
const matrices = (target: InstancedMesh<InstancedBufferGeometry>) => Array.from({ length: target.geometry.instanceCount }, (_, i) => { const m = new Matrix4(); target.getMatrixAt(i, m); return m; });
/** Smoke albedo of every drawn puff (red channel of `fireColor`). */
const albedos = (fx: LocalizedFireEffects) => { const smoke = mesh(fx, 'Ship fire smoke'), color = smoke.geometry.getAttribute('fireColor');
  return Array.from({ length: smoke.geometry.instanceCount }, (_, i) => color.getX(i)); };
const burn = (fire: { intensity: number; heat: number }, intensity = 1) => { fire.intensity = intensity; fire.heat = Math.max(1, intensity); };

test('a burning turret streams upright flame tongues over its roof, follows the displayed hull, and pauses without mutating combat', () => {
  const sim = new CombatSimulation(def), fx = new LocalizedFireEffects(), camera = new Camera(), wind = new Vector3();
  burn(sim.player.damage.control.mounts[0]);
  const pose = { ...sim.player.motion, x: 90, z: 40, heading: 1.2 };
  const poses = [{ actor: sim.player, motion: pose }];
  const before = JSON.stringify(sim);
  for (let i = 0; i < 60; i++) fx.update(session(sim), 1 / 60, camera, wind, undefined, poses);
  const flames = mesh(fx, 'Ship fire flames');
  expect(fx.diagnostics().flames).toBeGreaterThan(10);
  const mount = def.mounts[0], roof = new Vector3(...localToWorld([mount.position[0], mount.position[1] + mount.weapon.gunhouseSize[2], mount.position[2]], pose));
  for (const m of matrices(flames)) {
    const up = new Vector3().setFromMatrixColumn(m, 1).normalize(), base = new Vector3().setFromMatrixPosition(m);
    // Upright on the world axis from a level camera, however the hull is turned.
    expect(up.y).toBeGreaterThan(.999);
    base.y = roof.y;
    expect(base.distanceTo(roof)).toBeLessThan(mount.weapon.gunhouseSize[0] * .5 + 2);
  }
  const frozen = [...flames.instanceMatrix.array];
  fx.update(session(sim), 0, camera, wind, undefined, poses);
  expect([...flames.instanceMatrix.array]).toEqual(frozen);
  expect(JSON.stringify(sim)).toBe(before);
  fx.dispose();
});

test('a put-out fire stops flaming at once, smoulders in thinning wisps, then leaves nothing', () => {
  const sim = new CombatSimulation(def), fx = new LocalizedFireEffects();
  const fire = sim.player.damage.control.mounts[0]; burn(fire);
  run(fx, sim, 5);
  expect(fx.diagnostics().flames).toBeGreaterThan(0); expect(fx.diagnostics().smoke).toBeGreaterThan(0);
  fire.intensity = 0; fire.heat = .5;
  run(fx, sim, 3);
  expect(fx.diagnostics().flames).toBe(0); expect(fx.diagnostics().embers).toBe(0);
  run(fx, sim, 20);
  expect(fx.diagnostics().sources).toBe(1);
  // Fresh wisps are pale; the fire's own oily smoke is near black.
  expect(Math.max(...albedos(fx))).toBeGreaterThan(.3);
  run(fx, sim, 90);
  expect(fx.diagnostics()).toMatchObject({ sources: 0, flames: 0, smoke: 0 });
  fx.dispose();
});

test('compartment fires smoke from their authored vent and show flame only once fierce', () => {
  const sim = new CombatSimulation(def), fx = new LocalizedFireEffects();
  const i = def.compartments.findIndex(c => c.fire?.ventPosition);
  burn(sim.player.damage.control.rooms[i], .2);
  run(fx, sim, 3);
  expect(fx.diagnostics().flames).toBe(0); expect(fx.diagnostics().smoke).toBeGreaterThan(0);
  const vent = new Vector3(...localToWorld(def.compartments[i].fire!.ventPosition!, sim.player.motion));
  const smoke = mesh(fx, 'Ship fire smoke'), center = smoke.geometry.getAttribute('fireCenter');
  const lowest = Array.from({ length: smoke.geometry.instanceCount }, (_, k) => new Vector3(center.getX(k), center.getY(k), center.getZ(k)))
    .sort((a, b) => a.y - b.y)[0];
  expect(Math.hypot(lowest.x - vent.x, lowest.z - vent.z)).toBeLessThan(8);
  burn(sim.player.damage.control.rooms[i], 1);
  run(fx, sim, 3);
  expect(fx.diagnostics().flames).toBeGreaterThan(0);
  sim.player.motion.y = -100; fx.reset(); run(fx, sim, 1);
  expect(fx.diagnostics()).toMatchObject({ sources: 0, flames: 0, smoke: 0 });
  fx.dispose();
});

test('a fire being fought turns part of its smoke to steam; one flooded out goes in a burst of white steam', () => {
  const sim = new CombatSimulation(def), fx = new LocalizedFireEffects();
  const fire = sim.player.damage.control.mounts[0]; burn(fire);
  run(fx, sim, 6);
  expect(Math.max(...albedos(fx))).toBeLessThan(.4);
  fire.suppressed = true; fire.intensity = .5;
  run(fx, sim, 6);
  expect(albedos(fx).filter(a => a > .6).length).toBeGreaterThan(3);
  fx.reset();
  // Other hulls carry no suppression flag: falling heat while burning reads as being fought.
  const room = def.compartments.findIndex(c => c.fire?.ventPosition), roomFire = sim.target.damage.control.rooms[room];
  delete (roomFire as { suppressed?: boolean }).suppressed; delete (roomFire as { trend?: string }).trend;
  burn(roomFire); run(fx, sim, 4);
  for (let k = 0; k < 6 * 60; k++) { roomFire.heat -= .02 / 60; fx.update(session(sim), 1 / 60, new Camera(), new Vector3()); }
  expect(albedos(fx).filter(a => a > .6).length).toBeGreaterThan(3);
  fx.reset();
  burn(roomFire); run(fx, sim, 4);
  sim.target.damage.compartments[room].waterM3 = def.compartments[room].capacityM3 * .5;
  roomFire.intensity = 0;
  run(fx, sim, 1);
  expect(albedos(fx).filter(a => a > .8).length).toBeGreaterThan(3);
  fx.dispose();
});

test('optics leave out every fire effect of their own hull, which keeps burning unseen', () => {
  const sim = new CombatSimulation(def), fx = new LocalizedFireEffects();
  burn(sim.player.damage.control.mounts[0]); burn(sim.target.damage.control.mounts[3]);
  run(fx, sim, 4);
  const both = fx.diagnostics();
  run(fx, sim, 1, new Camera(), new Vector3(), sim.player.motion.id);
  const hidden = fx.diagnostics();
  expect(hidden.flames).toBeLessThan(both.flames); expect(hidden.smoke).toBeLessThan(both.smoke); expect(hidden.flames).toBeGreaterThan(0);
  run(fx, sim, 1);
  expect(fx.diagnostics().smoke).toBeGreaterThan(hidden.smoke);
  fx.dispose();
});

test('fleet fire work is bounded and camera-near fires at the end of the roster still burn', () => {
  const sim = new CombatSimulation(def, { friendlyBots: Array(29).fill(def), enemies: Array(30).fill(def), seed: 1941 });
  const fx = new LocalizedFireEffects(), camera = new Camera(), wind = new Vector3();
  sim.actors.forEach((a, i) => { a.motion.x = (60 - i) * 500; a.motion.z = 0; a.damage.control.mounts.forEach(f => burn(f)); });
  const last = sim.actors.at(-1)!; camera.position.set(last.motion.x, 20, 0);
  run(fx, sim, 6, camera, wind);
  const { sources, flames, smoke, embers, capacity } = fx.diagnostics();
  expect(sources).toBe(32);
  expect(flames + smoke + embers).toBeLessThanOrEqual(capacity);
  const near = matrices(mesh(fx, 'Ship fire flames')).map(m => new Vector3().setFromMatrixPosition(m).x);
  expect(near.some(x => Math.abs(x - last.motion.x) < 20)).toBe(true);
  fx.reset(); expect(fx.diagnostics()).toMatchObject({ sources: 0, flames: 0, smoke: 0, embers: 0, glows: 0, lights: 0 }); fx.dispose();
});

test('30 and 60 Hz emit the same smoke, and a pause adds no backlog', () => {
  const counts = [30, 60].map(fps => {
    const sim = new CombatSimulation(def), fx = new LocalizedFireEffects(), camera = new Camera(), wind = new Vector3();
    burn(sim.player.damage.control.mounts[0]);
    run(fx, sim, 6, camera, wind, undefined, fps);
    const count = fx.diagnostics().smoke;
    for (let i = 0; i < fps; i++) fx.update(session(sim), 0, camera, wind);
    expect(fx.diagnostics().smoke).toBe(count); fx.dispose(); return count;
  });
  expect(Math.abs(counts[0] - counts[1])).toBeLessThanOrEqual(1);
});

test('two fire lights always exist; they light the nearest fires after dark and stay dark when unused', () => {
  const sim = new CombatSimulation(def), fx = new LocalizedFireEffects();
  const lights = () => fx.root.children.filter((child): child is PointLight => child instanceof PointLight);
  expect(lights().length).toBe(2);
  expect(lights().every(light => light.intensity === 0)).toBe(true);
  const fire = sim.player.damage.control.mounts[0]; burn(fire);
  fx.lighting.setSun(new Vector3(0, 1, 0), 1); run(fx, sim, 3);
  const day = Math.max(...lights().map(light => light.intensity));
  fx.lighting.setSun(new Vector3(0, 1, 0), .1); run(fx, sim, 1);
  const night = Math.max(...lights().map(light => light.intensity));
  expect(day).toBeGreaterThan(0); expect(night).toBeGreaterThan(day * 2);
  expect(fx.diagnostics()).toMatchObject({ lights: 1, glows: 1 });
  // Optics on the burning hull leave its light out with its flames.
  run(fx, sim, .1, new Camera(), new Vector3(), sim.player.motion.id);
  expect(fx.diagnostics().lights).toBe(0);
  fire.intensity = 0; run(fx, sim, 1);
  expect(lights().length).toBe(2); expect(lights().every(light => light.intensity === 0)).toBe(true);
  expect(fx.diagnostics().glows).toBe(0);
  fx.dispose();
});

test('the effects setting thins fire emission', () => {
  const counts = [1, .5].map(density => {
    const sim = new CombatSimulation(def), fx = new LocalizedFireEffects();
    fx.setDensity(density); burn(sim.player.damage.control.mounts[0]);
    run(fx, sim, 4);
    const count = fx.diagnostics().smoke; fx.dispose(); return count;
  });
  expect(counts[1]).toBeLessThan(counts[0] * .7);
});

test('a lost hull burns on as the battle left her, each fire until the sea closes over it', () => {
  const sim = new CombatSimulation(def), fx = new LocalizedFireEffects();
  burn(sim.player.damage.control.mounts[0]);
  sim.player.damage.sunk = true;
  run(fx, sim, 3);
  expect(fx.diagnostics().flames).toBeGreaterThan(0);
  expect(fx.diagnostics().sources).toBe(1);
  // Settled below the turret roof: nothing more of that fire draws.
  sim.player.motion.y = -(def.mounts[0].position[1] + def.mounts[0].weapon.gunhouseSize[2] + 1);
  run(fx, sim, 3);
  expect(fx.diagnostics()).toMatchObject({ sources: 0, flames: 0 });
  fx.dispose();
});
