import { expect, test } from 'bun:test';
import { Camera, InstancedMesh, Matrix4, Vector3 } from 'three/webgpu';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip } from '../ships/blueprint';
import { CombatSimulation, type CombatEvent } from '../simulation/combat';
import { CombatEffects } from './CombatEffects';
import { EffectParticlePool, effectTexture } from './EffectParticles';

test('optics hide existing and new own-ship smoke while other smoke remains and ages normally', () => {
  const sim = new CombatSimulation(compileShip(blueprint, catalog)), effects = new CombatEffects(), camera = new Camera();
  const event: CombatEvent = { sequence: 1, tick: 0, kind: 'shot', position: [0, 10, 0], message: 'Test gun', shipId: 'player',
    shell: { id: 1, caliberM: .38, velocity: [820, 0, 0] } };
  sim.events.push(event);
  effects.update(sim, 0, camera);
  expect(effects.diagnostics().smoke).toBe(3);
  effects.update(sim, .1, camera, true);
  expect(effects.diagnostics().smoke).toBe(0);
  sim.events.push({ ...event, sequence: 2 }, { ...event, sequence: 3, shipId: 'target' });
  effects.update(sim, .1, camera, true);
  expect(effects.diagnostics().smoke).toBe(3);
  effects.update(sim, 0, camera);
  expect(effects.diagnostics().smoke).toBe(9);
  sim.events.push({ ...event, sequence: 4, kind: 'penetration', normal: [-1, 0, 0] },
    { ...event, sequence: 5, kind: 'module', detonation: true });
  effects.update(sim, 0, camera, true);
  expect(effects.diagnostics().smoke).toBe(3); // Own impact and magazine smoke are hidden too.
  effects.update(sim, 13, camera, true);
  effects.update(sim, 0, camera);
  expect(effects.diagnostics().smoke).toBe(0);
  effects.reset();
  sim.reset();
  sim.events.push({ ...event, sequence: 6 });
  effects.update(sim, 0, camera);
  expect(effects.diagnostics().smoke).toBe(3);
  effects.dispose();
});

test('spray reaches the same position at different frame rates and falls out at the sea', () => {
  const map = effectTexture('smoke'), camera = new Camera(), wind = new Vector3(2, 0, 1);
  const positions = [30, 60, 144].map(fps => {
    const pool = new EffectParticlePool(4, map), p = pool.emit(new Vector3(0, .35, 0));
    p.velocity.set(4, 30, 2); p.drag = .16; p.gravity = 9.81; p.life = 10; p.waterline = true;
    for (let i = 0; i < fps * 2; i++) pool.update(1 / fps, camera, wind);
    const position = p.position.clone();
    expect(p.velocity.y).toBeGreaterThan(0);
    for (let i = 0; i < fps * 5; i++) pool.update(1 / fps, camera, wind);
    expect(pool.count).toBe(0);
    expect(pool.mesh.count).toBe(4); // Shader capacity must not shrink with draw activity.
    pool.dispose(); return position;
  });
  expect(positions[0].distanceTo(positions[1])).toBeLessThan(1e-9);
  expect(positions[0].distanceTo(positions[2])).toBeLessThan(1e-9);
  map.dispose();
});

test('salvos are bounded, do not replay events, pause cleanly, and reset without ghosts', () => {
  const sim = new CombatSimulation(compileShip(blueprint, catalog)), effects = new CombatEffects(), camera = new Camera();
  const event: CombatEvent = { sequence: 1, tick: 0, kind: 'shot', position: [0, 10, 0], message: 'Test gun', shipId: 'player',
    shell: { id: 1, caliberM: .38, velocity: [820, 0, 0] } };
  sim.events.push(event);
  const before = JSON.stringify(sim);
  effects.update(sim, .1, camera);
  expect(effects.diagnostics().flashes).toBeGreaterThan(0); // Even on a long render frame.
  expect(JSON.stringify(sim)).toBe(before);
  const paused = effects.diagnostics();
  effects.update(sim, 0, camera);
  expect(effects.diagnostics()).toEqual(paused);
  for (let i = 2; i < 150; i++) {
    sim.events.splice(0, sim.events.length, { ...event, sequence: i, kind: i % 2 ? 'shot' : 'splash' });
    effects.update(sim, .01, camera);
  }
  const active = effects.diagnostics();
  expect(active.smoke + active.spray + active.flashes + active.foam).toBeLessThanOrEqual(active.particleCapacity);
  sim.events.length = 0; effects.reset(); effects.update(sim, 0, camera);
  expect(effects.diagnostics()).toEqual({ shells: 0, smoke: 0, spray: 0, flashes: 0, foam: 0, particleCapacity: 2272 });
  sim.events.push({ ...event, sequence: 150 }); effects.update(sim, 0, camera);
  expect(effects.diagnostics().flashes).toBeGreaterThan(0);
  for (let i = 0; i < 13 * 60; i++) effects.update(sim, 1 / 60, camera);
  expect(effects.diagnostics().smoke).toBe(0); expect(effects.diagnostics().flashes).toBe(0);
  effects.dispose();
});

test('large-gun fire remains in the gas at 0.35 seconds and cools completely into smoke', () => {
  const sim = new CombatSimulation(compileShip(blueprint, catalog)), effects = new CombatEffects(), camera = new Camera();
  sim.events.push({ sequence: 1, tick: 0, kind: 'shot', position: [0, 10, 0], message: 'Test gun', shipId: 'player',
    shell: { id: 1, caliberM: .38, velocity: [820, 0, 0] } });
  effects.update(sim, 0, camera); effects.update(sim, .35, camera);
  const mesh = effects.root.getObjectByName('Propellant and impact volumes') as InstancedMesh;
  const state = mesh.geometry.getAttribute('effectVolume'), sphere = mesh.geometry.getAttribute('effectSphere');
  expect(state.getZ(0)).toBeGreaterThan(.2);
  expect(sphere.getW(0) * 2).toBeGreaterThan(24);
  effects.update(sim, .65, camera);
  for (let i = 0; i < effects.diagnostics().smoke; i++) expect(state.getZ(i)).toBe(0);
  expect(effects.diagnostics().smoke).toBeGreaterThan(0);
  effects.dispose();
});

test('water droplets stay round through their apex instead of rotating as long rods', () => {
  const sim = new CombatSimulation(compileShip(blueprint, catalog)), effects = new CombatEffects(), camera = new Camera();
  sim.events.push({ sequence: 1, tick: 0, kind: 'splash', position: [0, 0, 0], message: 'Test splash', shipId: 'player',
    shell: { id: 1, caliberM: .38, velocity: [790, -85, 0] } });
  effects.update(sim, 0, camera);
  const mesh = effects.root.getObjectByName('Water droplets and mist') as InstancedMesh;
  const matrix = new Matrix4(), x = new Vector3(), y = new Vector3();
  for (const dt of [.5, 1.5, 1.5]) {
    effects.update(sim, dt, camera);
    expect(effects.diagnostics().spray).toBeGreaterThan(0);
    let visible = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      x.setFromMatrixColumn(matrix, 0); y.setFromMatrixColumn(matrix, 1);
      if (x.lengthSq() < .0001) continue;
      expect(y.length() / x.length()).toBeCloseTo(1, 5); visible++;
    }
    expect(visible).toBeGreaterThan(0);
  }
  effects.dispose();
});

test('billboards reorient while paused and expired storage is reused', () => {
  const map = effectTexture('flash'), pool = new EffectParticlePool(2, map), camera = new Camera(), wind = new Vector3();
  pool.emit(new Vector3(0, 3, 0));
  pool.update(0, camera, wind);
  const first = new Matrix4(); pool.mesh.getMatrixAt(0, first);
  camera.rotateY(Math.PI / 2); pool.update(0, camera, wind);
  const rotated = new Matrix4(); pool.mesh.getMatrixAt(0, rotated);
  expect(first.equals(rotated)).toBe(false);
  pool.emit(new Vector3()); pool.emit(new Vector3()); pool.update(0, camera, wind);
  expect(pool.count).toBe(2);
  pool.dispose(); map.dispose();
});

test('the shell pool keeps its shader capacity through empty frames, salvos and resets', () => {
  const sim = new CombatSimulation(compileShip(blueprint, catalog));
  const effects = new CombatEffects(), camera = new Camera();
  const pool = effects.root.getObjectByName('Shell bodies') as InstancedMesh;
  const matrix = new Matrix4(), scale = new Vector3();
  const helm = { throttle: 0, rudder: 0 };
  const intent = { aim: [1800, 0, 0] as [number, number, number], battery: 'main' as const, fire: false };
  const check = () => {
    effects.update(sim, 0, camera);
    // Three's instancing shader sizes its buffer from count when it first compiles.
    expect(pool.count).toBe(pool.instanceMatrix.count);
    for (let i = 0; i < pool.count; i++) {
      pool.getMatrixAt(i, matrix);
      if (i < sim.shells.length) {
        const position = new Vector3().setFromMatrixPosition(matrix);
        sim.shells[i].position.forEach((value, axis) => expect(position.getComponent(axis)).toBeCloseTo(value, 3));
        for (const size of scale.setFromMatrixScale(matrix).toArray()) expect(size).toBeCloseTo(sim.shells[i].caliberM, 5);
      } else {
        expect(scale.setFromMatrixScale(matrix).toArray()).toEqual([0, 0, 0]);
      }
    }
  };
  try {
    check();
    for (let i = 0; i < 3600; i++) sim.step(helm, intent);
    sim.step(helm, { ...intent, fire: true });
    expect(sim.shells).toHaveLength(8);
    check();
    sim.shells.splice(1);
    check();
    sim.reset();
    check();
    for (let i = 0; i < 3600; i++) sim.step(helm, intent);
    sim.step(helm, { ...intent, fire: true });
    expect(sim.shells).toHaveLength(8);
    check();
  } finally {
    effects.dispose();
  }
});
