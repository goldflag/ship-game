import { beforeAll, expect, test } from 'bun:test';
import init, { preview_articulation_json } from '../../src/generated/naval-wasm/naval_wasm';
import yamato from '../../public/models/yamato.json';
import bismarck from '../../public/models/bismarck.json';
import type { ClearancePose, ClearanceResult } from '../../src/game/articulationPreview';

beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL('../../src/generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() });
});
const initial = (def: typeof yamato | typeof bismarck): ClearancePose[] => def.mounts.map(() => ({ train: 0, elevation: Math.PI / 180, recoil: 0 }));
function resolve(def: typeof yamato | typeof bismarck, poses: ClearancePose[], targets: ClearancePose[]): ClearanceResult[] {
  return JSON.parse(preview_articulation_json(JSON.stringify(def), JSON.stringify(poses), JSON.stringify(targets)));
}

test('published Yamato preview stops depression at physical contact and can elevate away', () => {
  expect(yamato.mountClearance.mountIds.length).toBe(yamato.mounts.length);
  const poses = initial(yamato), targets = structuredClone(poses);
  targets[1].elevation = -5 * Math.PI / 180;
  const results = resolve(yamato, poses, targets);
  expect(results[1].blocked).toBe(true);
  expect(results[1].obstructionId).toBeTruthy();
  expect(results[1].pose.elevation).toBeGreaterThan(targets[1].elevation);
  const achieved = results.map(r => r.pose);
  const recoil = achieved.map(p => ({ ...p, recoil: 1 }));
  const recoiled = resolve(yamato, achieved, recoil);
  expect(recoiled[1].pose.elevation).toBeCloseTo(achieved[1].elevation, 10);
  expect(recoiled[1].pose.recoil).toBe(1);
  targets[1].elevation = 20 * Math.PI / 180;
  const raised = resolve(yamato, recoiled.map(r => r.pose), targets);
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
