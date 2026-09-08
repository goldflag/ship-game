import { expect, test } from 'bun:test';
import { InstancedMesh, Matrix4, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { AircraftGunfire } from './AircraftGunfire';
import { ballisticStep } from '../simulation/ballistics';

test('AA tracer reaches its CPU airburst endpoint with drag and inherited ship velocity', () => {
  const sim = new CombatSimulation(shipPreset('bismarck')), gunfire = new AircraftGunfire();
  const camera = new PerspectiveCamera(52, 1, .5, 60000);
  const endpoint = ballisticStep([0, 300, 0], [15, 0, -800], 3, .08).position;
  sim.events.push({ sequence: 1, tick: 0, kind: 'aircraft-fire', position: [0, 300, 0], shipId: 'player', message: 'AA',
    aircraft: { id: 'target', target: endpoint, tracerSpeed: 800, direction: [0, 0, -1], velocity: [15, 0, 0], dragPerSecond: .08,
      airburst: { flightTime: 3, caliberM: .105 } } });
  try {
    sim.tick = 181; gunfire.update(sim, camera);
    const tips = gunfire.root.getObjectByName('Aircraft tracer tips') as InstancedMesh;
    expect(gunfire.diagnostics()).toBe(1);
    expect(at(tips).position.distanceTo(new Vector3(...endpoint))).toBeLessThan(.001);
  } finally { gunfire.dispose(); }
});

test('light AA stays visible beyond a nearby aim point and survives combat history eviction', () => {
  const sim = new CombatSimulation(shipPreset('bismarck')), gunfire = new AircraftGunfire(), camera = new PerspectiveCamera();
  try {
    sim['emit']({ kind: 'aircraft-fire', position: [0, 300, 0], shipId: 'player', message: 'Light AA',
      aircraft: { id: 'hostile', target: [0, 300, -400], tracerSpeed: 800 } });
    sim.tick = 7; gunfire.update(sim, camera);
    expect(gunfire.diagnostics()).toBe(1);
    for (let i = 0; i < 128; i++) sim['emit']({ kind: 'contact', position: [0, 0, 0], shipId: 'target', message: 'Other combat' });
    expect(sim.events.some(e => e.kind === 'aircraft-fire')).toBe(false);
    gunfire.update(sim, camera);
    expect(gunfire.diagnostics()).toBe(1);
    sim.tick = 121; gunfire.update(sim, camera);
    const streaks = gunfire.root.getObjectByName('Aircraft tracer cores') as InstancedMesh;
    expect(gunfire.diagnostics()).toBe(1);
    expect(at(streaks).position.z).toBeLessThan(-1500);
    const before = [...streaks.instanceMatrix.array];
    gunfire.update(sim, camera); expect([...streaks.instanceMatrix.array]).toEqual(before);
    sim.reset(); gunfire.update(sim, camera);
    expect(gunfire.diagnostics()).toBe(0);
  } finally { gunfire.dispose(); }
});

test('busy gunfire grows instance storage instead of dropping live tracers at 512', () => {
  const sim = new CombatSimulation(shipPreset('bismarck')), gunfire = new AircraftGunfire(), camera = new PerspectiveCamera();
  try {
    for (let i = 0; i < 100; i++) sim['emit']({ kind: 'aircraft-fire', position: [i, 100, 0], shipId: 'player', message: 'Fighter burst',
      aircraft: { id: `fighter-${i}`, target: [i, 100, -500] } });
    sim.tick = 16; gunfire.update(sim, camera);
    expect(gunfire.diagnostics()).toBe(600);
    const cores = gunfire.root.getObjectByName('Aircraft tracer cores') as InstancedMesh;
    expect(cores.children).toHaveLength(1);
    const page = cores.children[0] as InstancedMesh;
    expect(at(page, 87).scale.y).toBeGreaterThan(0);
    sim.tick = 100; gunfire.update(sim, camera);
    expect([...page.instanceMatrix.array].every(n => n === 0)).toBe(true);
  } finally { gunfire.dispose(); }
});

const at = (mesh: InstancedMesh, index = 0) => {
  const matrix = new Matrix4(); mesh.getMatrixAt(index, matrix);
  return { position: new Vector3().setFromMatrixPosition(matrix), scale: new Vector3().setFromMatrixScale(matrix) };
};
test('AA calibers remain visually distinct at equal range through normal and binocular views', () => {
  const sim = new CombatSimulation(shipPreset('bismarck')), gunfire = new AircraftGunfire();
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  const calibers = [.02, .037, .105, .13335];
  for (const [i, caliberM] of calibers.entries()) sim.events.push({ sequence: i + 1, tick: 0, kind: 'aircraft-fire',
    position: [0, 300, 0], shipId: 'player', message: 'AA size review',
    aircraft: { id: 'hostile', target: [0, 300, -1600], tracerSpeed: 800, caliberM,
      ...(caliberM > .08 ? { airburst: { flightTime: 2, caliberM } } : {}) } });
  try {
    sim.tick = 61;
    for (const range of [100, 1000, 5000]) for (const fov of [52, 8]) {
      camera.position.set(0, 300, range - 800); camera.lookAt(0, 300, -800);
      camera.fov = fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      gunfire.update(sim, camera);
      expect(gunfire.diagnostics()).toBe(calibers.length);
      for (const name of ['Aircraft tracer cores', 'Aircraft tracer envelopes', 'Aircraft tracer tips']) {
        const mesh = gunfire.root.getObjectByName(name) as InstancedMesh;
        const widths = calibers.map((_, i) => at(mesh, i).scale.x);
        expect(widths[0]).toBeGreaterThan(0);
        for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
        expect(widths[0]).toBeLessThan(widths[2] * .5);
      }
      const cores = gunfire.root.getObjectByName('Aircraft tracer cores') as InstancedMesh;
      expect(at(cores, 0).scale.y).toBeLessThan(at(cores, 2).scale.y * .6);
    }
  } finally { gunfire.dispose(); }
});

test('aircraft tracers travel in separated bursts, remain short and cannot become full target lines', () => {
  const sim = new CombatSimulation(shipPreset('enterprise-cv6')), gunfire = new AircraftGunfire();
  const camera = new PerspectiveCamera(52, 1, .5, 60000); camera.position.set(80, 140, 200); camera.lookAt(0, 100, -200); camera.updateMatrixWorld(true);
  sim.events.push({ sequence: 1, tick: 0, kind: 'aircraft-fire', shipId: 'player', message: 'Guns', position: [0, 100, 0],
    aircraft: { id: 'fighter', target: [0, 100, -500], direction: [0, 0, -1], velocity: [0, 0, -90], attitude: { heading: 0, pitch: 0, bank: 0 } } });
  try {
    const streaks = gunfire.root.getObjectByName('Aircraft tracer cores') as InstancedMesh;
    sim.tick = 4; gunfire.update(sim, camera);
    const first = at(streaks);
    expect(gunfire.diagnostics()).toBe(2); expect(first.position.z).toBeLessThan(-25);
    expect(first.scale.y).toBeLessThan(20); expect(first.scale.y).toBeGreaterThan(10);
    expect(Math.abs(first.position.x - at(streaks, 1).position.x)).toBeGreaterThan(4);
    const before = JSON.stringify(sim), matrices = [...streaks.instanceMatrix.array];
    gunfire.update(sim, camera); expect([...streaks.instanceMatrix.array]).toEqual(matrices); expect(JSON.stringify(sim)).toBe(before);
    sim.tick = 16; gunfire.update(sim, camera); expect(gunfire.diagnostics()).toBe(6);
    expect(at(streaks).position.z).toBeLessThan(first.position.z - 100);
    for (const mesh of gunfire.root.children as InstancedMesh[]) {
      expect(mesh.instanceMatrix.array.byteLength).toBeLessThanOrEqual(65536);
      expect(mesh.count).toBe(mesh.instanceMatrix.count);
    }
    sim.tick = 100; gunfire.update(sim, camera); expect(gunfire.diagnostics()).toBe(0);
    expect([...streaks.instanceMatrix.array].every(n => n === 0)).toBe(true);
    sim.reset(); gunfire.update(sim, camera); expect(gunfire.diagnostics()).toBe(0);
  } finally { gunfire.dispose(); }
});

test('ship AA uses the actual muzzle, speed and endpoint without fighter wing offsets', () => {
  const sim = new CombatSimulation(shipPreset('bismarck')), gunfire = new AircraftGunfire();
  const camera = new PerspectiveCamera(52, 1, .5, 60000);
  sim.events.push({ sequence: 1, tick: 0, kind: 'aircraft-fire', position: [0, 300, 0], shipId: 'player', message: 'AA fire',
    aircraft: { id: 'hostile', target: [0, 255.855, -2400], tracerSpeed: 800, direction: [0, 0, -1],
      airburst: { flightTime: 3, caliberM: .105 } } });
  try {
    const streaks = gunfire.root.getObjectByName('Aircraft tracer cores') as InstancedMesh;
    sim.tick = 31; gunfire.update(sim, camera);
    expect(gunfire.diagnostics()).toBe(1);
    expect(at(streaks).position.x).toBe(0); expect(at(streaks).position.y).toBeCloseTo(300 - 4.905 * .5 ** 2 + 4.905 * .5 * .011, 1);
    expect(at(streaks).position.z).toBeCloseTo(-391.2, 3);
    expect(at(streaks).scale.y).toBeLessThan(25);
    sim.tick = 121; gunfire.update(sim, camera);
    expect(gunfire.diagnostics()).toBe(1); expect(at(streaks).position.z).toBeLessThan(-1500);
    sim.tick = 181; gunfire.update(sim, camera);
    const tips = gunfire.root.getObjectByName('Aircraft tracer tips') as InstancedMesh;
    expect(at(tips).position.distanceTo(new Vector3(0, 255.855, -2400))).toBeLessThan(.001);
    sim.tick = 182; gunfire.update(sim, camera);
    expect(gunfire.diagnostics()).toBe(0);
  } finally { gunfire.dispose(); }
});
