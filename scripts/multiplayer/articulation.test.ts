import { beforeAll, expect, test } from 'bun:test';
import init, { preview_articulation_json } from '../../src/generated/naval-wasm/naval_wasm';
import yamato from '../../public/models/yamato.json';
import bismarck from '../../public/models/bismarck.json';
import cleveland from '../../public/models/cleveland.json';
import kongo from '../../public/models/kongo.json';
import { gunClearance } from '../../src/simulation/gunClearance';
// Yamato is published with box obstructions; her retired closed-body profile
// stays here so the swept WASM resolver keeps its real-geometry coverage.
import sweptClearance from '../../src/simulation/fixtures/yamato-swept-clearance.json';
import type { ClearancePose, ClearanceResult } from '../../src/game/articulationPreview';

beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL('../../src/generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() });
});
const initial = (def: { mounts: unknown[] }): ClearancePose[] => def.mounts.map(() => ({ train: 0, elevation: Math.PI / 180, recoil: 0 }));
function resolve(def: unknown, poses: ClearancePose[], targets: ClearancePose[]): ClearanceResult[] {
  return JSON.parse(preview_articulation_json(JSON.stringify(def), JSON.stringify(poses), JSON.stringify(targets)));
}

const sweptYamato = { ...yamato, mountClearance: sweptClearance };

test('Kongō WASM preview keeps installed barrel stops and can reverse at full recoil', () => {
  const poses = initial(kongo), targets = structuredClone(poses);
  for (const [id, train, elevation] of [['main-3', -145, 43], ['casemate-port-2', -62.4, 16.8], ['aa25-01', 0, -10]] as const) {
    const index = kongo.mounts.findIndex(m => m.id === id), mount = kongo.mounts[index];
    targets[index] = { train: train * Math.PI / 180, elevation: elevation * Math.PI / 180, recoil: 1 };
    // Roof AA can have a clear endpoint beyond a shield: the intervening
    // path must still stop, so exercise contacts along the whole request.
    expect(Math.min(...Array.from({ length: 41 }, (_, step) => {
      const t = step / 40;
      return gunClearance(mount, targets[index].train * t, poses[index].elevation + (targets[index].elevation - poses[index].elevation) * t);
    }))).toBeLessThan(0);
    const stopped = resolve(kongo, poses, targets)[index];
    expect(stopped.blocked).toBe(true);
    expect(stopped.obstructionId).toBe('travel-clearance');
    expect(gunClearance(mount, stopped.pose.train, stopped.pose.elevation)).toBeGreaterThan(0);
    expect(stopped.pose.recoil).toBe(1);
    const current = structuredClone(poses); current[index] = stopped.pose;
    const reversed = resolve(kongo, current, poses)[index];
    expect(reversed.blocked).toBe(false);
    expect(reversed.pose.train).toBeCloseTo(poses[index].train, 9);
    expect(reversed.pose.elevation).toBeCloseTo(poses[index].elevation, 9);
    targets[index] = poses[index];
  }
});

test('the swept Yamato profile stops depression at physical contact and can elevate away', () => {
  expect('mountClearance' in yamato).toBe(false);
  expect(sweptClearance.mountIds.length).toBe(yamato.mounts.length);
  const poses = initial(yamato), targets = structuredClone(poses);
  targets[1].elevation = -5 * Math.PI / 180;
  const results = resolve(sweptYamato, poses, targets);
  expect(results[1].blocked).toBe(true);
  expect(results[1].obstructionId).toBeTruthy();
  expect(results[1].pose.elevation).toBeGreaterThan(targets[1].elevation);
  const achieved = results.map(r => r.pose);
  const recoil = achieved.map(p => ({ ...p, recoil: 1 }));
  const recoiled = resolve(sweptYamato, achieved, recoil);
  expect(recoiled[1].pose.elevation).toBeCloseTo(achieved[1].elevation, 10);
  expect(recoiled[1].pose.recoil).toBe(1);
  targets[1].elevation = 20 * Math.PI / 180;
  const raised = resolve(sweptYamato, recoiled.map(r => r.pose), targets);
  expect(raised[1].blocked).toBe(false);
  expect(raised[1].pose.elevation).toBeCloseTo(targets[1].elevation, 10);
});

test('unconfigured previews preserve independent poses and catalog limits', () => {
  const poses = initial(bismarck), targets = structuredClone(poses);
  targets[0] = { train: 100, elevation: -100, recoil: 2 };
  targets[1] = { train: -.4, elevation: .2, recoil: .5 };
  const results = resolve(bismarck, poses, targets);
  expect(results[0].pose.train).toBeCloseTo(bismarck.mounts[0].weapon.traverseDeg * Math.PI / 180, 10);
  expect(results[0].pose.elevation).toBeCloseTo(bismarck.mounts[0].weapon.elevationMinDeg * Math.PI / 180, 10);
  expect(results[0].pose.recoil).toBe(1);
  expect(results[1].pose).toEqual(targets[1]);
  expect(results.every(r => !r.blocked)).toBe(true);
  expect(() => resolve(bismarck, [], targets)).toThrow('one pose per mount');
});

test('preview applies installed asymmetric traverse stops', () => {
  const definition = structuredClone(bismarck);
  Object.assign(definition.mounts[0], { traverseLimitsDeg: [-35, 80] });
  const poses = initial(definition), targets = structuredClone(poses);
  targets[0].train = 100;
  expect(resolve(definition, poses, targets)[0].pose.train).toBeCloseTo(80 * Math.PI / 180, 10);
  targets[0].train = -100;
  expect(resolve(definition, poses, targets)[0].pose.train).toBeCloseTo(-35 * Math.PI / 180, 10);
});

test('preview rejects mixed and incomplete clearance profiles before dispatching either resolver', () => {
  const poses = initial(cleveland);
  const profiles = [
    [{ ...cleveland.mountClearance, mountIds: sweptClearance.mountIds, bodies: sweptClearance.bodies }, 'exactly one geometry encoding'],
    [{ ...cleveland.mountClearance, structures: undefined }, 'requires mounts, structures and neighbors'],
    [{ ...cleveland.mountClearance, neighbors: undefined }, 'requires mounts, structures and neighbors'],
  ] as const;
  for (const [mountClearance, message] of profiles) {
    expect(() => resolve({ ...cleveland, mountClearance }, poses, poses)).toThrow(message);
  }
});

test('published Cleveland preview stops under the platform and can turn away before elevating', () => {
  const i = cleveland.mounts.findIndex(m => m.id === 'secondary-2');
  expect(i).toBeGreaterThanOrEqual(0);
  let poses = initial(cleveland);
  const move = (train: number, elevation: number) => {
    const targets = structuredClone(poses);
    targets[i] = { train: train * Math.PI / 180, elevation: elevation * Math.PI / 180, recoil: 1 };
    const results = resolve(cleveland, poses, targets);
    poses = results.map(r => r.pose);
    return results[i];
  };
  const stopped = move(0, 85);
  expect(stopped.blocked).toBe(true);
  expect(stopped.pose.elevation).toBeGreaterThan(35 * Math.PI / 180);
  expect(stopped.pose.elevation).toBeLessThan(70 * Math.PI / 180);
  expect(stopped.pose.recoil).toBe(1);
  expect(move(-90, stopped.pose.elevation * 180 / Math.PI).blocked).toBe(false);
  expect(move(-90, 85).blocked).toBe(false);
  // Both end poses are within nominal arcs, but the returning motion crosses the platform.
  expect(move(0, 85).blocked).toBe(true);
  expect(move(poses[i].train * 180 / Math.PI, 1).blocked).toBe(false);
  expect(move(0, 1).blocked).toBe(false);
});

test('published Cleveland preview respects independently posed neighboring main guns', () => {
  const poses = initial(cleveland), targets = structuredClone(poses);
  poses[1].elevation = targets[1].elevation = -2 * Math.PI / 180;
  targets[0] = { train: -155 * Math.PI / 180, elevation: 29 * Math.PI / 180, recoil: 1 };
  const stopped = resolve(cleveland, poses, targets);
  expect(stopped[0].blocked).toBe(true);
  // The independent neighbor remains at its requested pose throughout the sweep.
  expect(stopped[1].pose).toEqual(targets[1]);
  poses[1].train = targets[1].train = Math.PI / 2;
  const cleared = resolve(cleveland, poses, targets);
  expect(cleared[0].blocked).toBe(false);
  expect(cleared[0].pose).toEqual(targets[0]);
});
