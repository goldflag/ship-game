import { expect, test } from 'bun:test';
import { Camera, InstancedMesh, Matrix4, Vector3 } from 'three/webgpu';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { localToWorld } from '../simulation/geometry';
import { LocalizedFireEffects } from './LocalizedFireEffects';
const def = shipPreset('bismarck');
const position = (mesh: InstancedMesh, index = 0) => { const matrix = new Matrix4(); mesh.getMatrixAt(index, matrix); return new Vector3().setFromMatrixPosition(matrix); };

test('living flames follow the displayed hull, freeze with pause, and extinguish immediately without mutating combat', () => {
  const sim = new CombatSimulation(def), fx = new LocalizedFireEffects(), camera = new Camera(), wind = new Vector3();
  const fire = sim.player.damage.control.mounts[0]; fire.intensity = 1;
  const pose = { ...sim.player.motion, x: 90, z: 40, heading: 1.2, roll: .15, pitch: .06 };
  const poses = [{ actor: sim.player, motion: pose }];
  const before = JSON.stringify(sim);
  fx.update(sim, .4, camera, wind, undefined, poses);
  expect(fx.diagnostics().flames).toBe(3);
  const mesh = fx.root.getObjectByName('Attached fire tongues') as InstancedMesh;
  const matrix = new Matrix4(); mesh.getMatrixAt(1, matrix);
  const center = position(mesh, 1); center.y -= new Vector3().setFromMatrixScale(matrix).y * .43;
  const mount = def.mounts[0];
  expect(center.distanceTo(new Vector3(...localToWorld([mount.position[0], mount.position[1] + mount.weapon.gunhouseSize[2], mount.position[2]], pose)))).toBeLessThan(.0001);
  const frozen = [...mesh.instanceMatrix.array];
  fx.update(sim, 0, camera, wind, undefined, poses);
  expect([...mesh.instanceMatrix.array]).toEqual(frozen);
  pose.x += 30; fx.update(sim, 0, camera, wind, undefined, poses);
  expect(position(mesh, 1).x - center.x).toBeCloseTo(30, 4);
  expect(JSON.stringify(sim)).toBe(before);
  fire.intensity = 0; fx.update(sim, 0, camera, wind);
  expect(fx.diagnostics().flames).toBe(0); expect(fx.diagnostics().smoke).toBe(1);
  fx.update(sim, 7, camera, wind); expect(fx.diagnostics().smoke).toBe(0);
  fx.reset(); expect(fx.diagnostics().sources).toBe(0); fx.dispose();
});

test('internal fires use authored dry outlets, never flame sprites or invented compartments', () => {
  const sim = new CombatSimulation(def), fx = new LocalizedFireEffects(), camera = new Camera();
  const i = def.compartments.findIndex(c => c.fire?.ventPosition);
  sim.player.damage.control.rooms[i].intensity = .8;
  fx.update(sim, .4, camera, new Vector3());
  expect(fx.diagnostics().flames).toBe(0); expect(fx.diagnostics().smoke).toBe(1);
  const smoke = fx.root.getObjectByName('Local fire smoke') as InstancedMesh;
  const expected = new Vector3(...localToWorld(def.compartments[i].fire!.ventPosition!, sim.player.motion)); expected.y += .2;
  expect(position(smoke).distanceTo(expected)).toBeLessThan(.0001);
  sim.player.motion.y = -100; fx.reset(); fx.update(sim, .4, camera, new Vector3());
  expect(fx.diagnostics().smoke).toBe(0); fx.dispose();
});

test('lower fire intensity reduces flame height and opacity; cooling cannot emit fresh flames', () => {
  const sim = new CombatSimulation(def), fx = new LocalizedFireEffects(), camera = new Camera(), wind = new Vector3();
  const fire = sim.player.damage.control.mounts[0]; fire.intensity = 1;
  fx.update(sim, 0, camera, wind);
  const mesh = fx.root.getObjectByName('Attached fire tongues') as InstancedMesh, matrix = new Matrix4();
  mesh.getMatrixAt(1, matrix); const height = new Vector3().setFromMatrixScale(matrix).y;
  const alpha = mesh.geometry.getAttribute('effectOpacity').getX(1);
  fire.intensity = .3; fx.update(sim, 0, camera, wind); mesh.getMatrixAt(1, matrix);
  expect(new Vector3().setFromMatrixScale(matrix).y).toBeLessThan(height);
  expect(mesh.geometry.getAttribute('effectOpacity').getX(1)).toBeLessThan(alpha);
  fire.intensity = 0; fire.heat = .4; fx.update(sim, 1, camera, wind);
  expect(fx.diagnostics().flames).toBe(0); fx.dispose();
});

test('optics hide all own fire effects, retain hostile fires, and allow old smoke to expire', () => {
  const sim = new CombatSimulation(def), fx = new LocalizedFireEffects(), camera = new Camera(), wind = new Vector3();
  sim.player.damage.control.mounts[0].intensity = 1; sim.target.damage.control.mounts[3].intensity = 1;
  fx.update(sim, .4, camera, wind); expect(fx.diagnostics().flames).toBe(6);
  fx.update(sim, 0, camera, wind, sim.player.motion.id);
  expect(fx.diagnostics().flames).toBe(3); expect(fx.diagnostics().smoke).toBe(1);
  fx.update(sim, 0, camera, wind); expect(fx.diagnostics().smoke).toBe(2);
  sim.player.damage.control.mounts[0].intensity = 0; sim.target.damage.control.mounts[3].intensity = 0;
  fx.update(sim, 7, camera, wind, sim.player.motion.id); fx.update(sim, 0, camera, wind);
  expect(fx.diagnostics().smoke).toBe(0); fx.dispose();
});

test('fleet work is bounded and camera-near fires at the end of the roster receive effects', () => {
  const sim = new CombatSimulation(def, { friendlyBots: Array(29).fill(def), enemies: Array(30).fill(def), seed: 1941 });
  const fx = new LocalizedFireEffects(), camera = new Camera(), wind = new Vector3();
  sim.actors.forEach((a, i) => { a.motion.x = (60 - i) * 500; a.motion.z = 0; a.damage.control.mounts.forEach(f => f.intensity = 1); });
  const last = sim.actors.at(-1)!; camera.position.set(last.motion.x, 20, 0);
  for (let i = 0; i < 60; i++) fx.update(sim, .4, camera, wind);
  expect(fx.diagnostics().sources).toBe(32); expect(fx.diagnostics().flames).toBe(96);
  expect(fx.diagnostics().smoke).toBeLessThanOrEqual(512);
  const mesh = fx.root.getObjectByName('Attached fire tongues') as InstancedMesh;
  expect(position(mesh).x).toBeGreaterThan(last.motion.x - 20);
  expect(position(mesh).x).toBeLessThan(last.motion.x + 20);
  fx.reset(); expect(fx.diagnostics()).toEqual({ sources: 0, flames: 0, smoke: 0, capacity: 608 }); fx.dispose();
});

test('30 and 60 Hz emit the same bounded smoke cadence without a paused backlog', () => {
  const counts = [30, 60].map(fps => {
    const sim = new CombatSimulation(def), fx = new LocalizedFireEffects(), camera = new Camera(), wind = new Vector3();
    sim.player.damage.control.mounts[0].intensity = 1;
    for (let i = 0; i < fps * 4; i++) fx.update(sim, 1 / fps, camera, wind);
    const count = fx.diagnostics().smoke;
    for (let i = 0; i < fps; i++) fx.update(sim, 0, camera, wind);
    expect(fx.diagnostics().smoke).toBe(count); fx.dispose(); return count;
  });
  expect(counts).toEqual([10, 10]);
});
