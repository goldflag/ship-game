import { expect, test } from 'bun:test';
import { InstancedMesh, Matrix4, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import { AircraftGunfire } from './AircraftGunfire';

const at = (mesh: InstancedMesh, index = 0) => {
  const matrix = new Matrix4(); mesh.getMatrixAt(index, matrix);
  return { position: new Vector3().setFromMatrixPosition(matrix), scale: new Vector3().setFromMatrixScale(matrix) };
};
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
  sim.events.push({ sequence: 1, tick: 0, kind: 'aircraft-fire', position: [0, 20, 0], shipId: 'player', message: 'AA fire',
    aircraft: { id: 'hostile', target: [0, 20, -2400], tracerSpeed: 800 } });
  try {
    const streaks = gunfire.root.getObjectByName('Aircraft tracer cores') as InstancedMesh;
    sim.tick = 31; gunfire.update(sim, camera);
    expect(gunfire.diagnostics()).toBe(1);
    expect(at(streaks).position.x).toBe(0); expect(at(streaks).position.y).toBe(20);
    expect(at(streaks).position.z).toBeCloseTo(-391.2, 3);
    expect(at(streaks).scale.y).toBeLessThan(25);
    sim.tick = 121; gunfire.update(sim, camera);
    expect(gunfire.diagnostics()).toBe(1); expect(at(streaks).position.z).toBeLessThan(-1500);
    sim.tick = 182; gunfire.update(sim, camera);
    expect(gunfire.diagnostics()).toBe(0);
  } finally { gunfire.dispose(); }
});
