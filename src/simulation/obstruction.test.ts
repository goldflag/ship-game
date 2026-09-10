import { expect, test } from 'bun:test';
import { segmentBox } from './geometry';
import { BarrelObstructionTree, gunMountObstructions, segmentIntersectsBox } from './obstruction';
import { shipPreset, shipPresets } from '../ships/presets';
import { muzzleLocal, createMountState } from './weapons';
import { add, normalize, scale, sub } from './geometry';
import type { Vec3 } from '../ships/blueprint';

test('boolean gun obstruction query agrees with swept hits, including tangency and starts inside', () => {
  let seed = 19;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000 - .5) * 50;
  const point = (): Vec3 => [random(), random(), random()];
  for (let i = 0; i < 10000; i++) {
    const center = point(), size = point().map(n => Math.abs(n)) as Vec3;
    const from = i % 3 === 0 ? center : point(), to = point();
    if (i % 4 === 0) { from[0] = center[0] + size[0] / 2; to[0] = from[0]; }
    expect(segmentIntersectsBox(from, to, { center, size })).toBe(!!segmentBox(from, to, { center, size }));
  }
});

test('obstruction tree matches every hull and gunhouse during intermediate traverse and elevation', () => {
  for (const id of Object.keys(shipPresets)) {
    const definition = shipPreset(id);
    const entries = [
      ...definition.obstructions.map(box => ({ box, mountId: undefined as string | undefined })),
      ...definition.mounts.flatMap(gunMountObstructions),
    ];
    const tree = new BarrelObstructionTree(entries);
    for (const mount of definition.mounts) for (const fraction of [-1, -.73, -.21, 0, .31, .69, 1]) {
      const state = createMountState(mount);
      state.train = fraction * mount.weapon.traverseDeg * Math.PI / 180;
      state.elevation = (.4 + fraction * .4) * mount.weapon.elevationMaxDeg * Math.PI / 180;
      const from = add(mount.position, [0, mount.weapon.pivotHeight, 0]);
      for (let barrel = 0; barrel < (mount.weapon.barrelCount ?? 2); barrel++) {
        const muzzle = muzzleLocal(mount, state, barrel);
        const to = add(muzzle, scale(normalize(sub(muzzle, from)), definition.hull.length));
        expect(tree.intersects(from, to, mount.id)).toBe(entries.some(e => e.mountId !== mount.id && segmentIntersectsBox(from, to, e.box)));
      }
    }
  }
});

test('open bow AA mount blocks its mechanism and side sights but leaves the upper center open', () => {
  const mount = shipPreset('baltimore').mounts.find(m => m.id === 'bofors-01')!;
  const tree = new BarrelObstructionTree(gunMountObstructions(mount));
  const crosses = (x: number, height: number, firingMount = 'main-1') => tree.intersects(
    add(mount.position, [x, height, 5]), add(mount.position, [x, height, -5]), firingMount);
  expect(crosses(0, .5)).toBe(true);
  expect(crosses(0, 1.4)).toBe(true);
  expect(crosses(0, 1.7)).toBe(false);
  expect(crosses(1.16, 1.7)).toBe(true);
  expect(crosses(-1.16, 1.7)).toBe(true);
  expect(crosses(0, .5, mount.id)).toBe(false);
});

test('Bismarck forward deck obstructions cover the taper and leave the bow AA platforms clear', () => {
  const definition = shipPreset('bismarck');
  for (const id of ['forward-battery-deck', 'forward-shelter-deck']) {
    const tree = new BarrelObstructionTree(definition.obstructions
      .filter(box => box.id === id || box.id.startsWith(`${id}-`)).map(box => ({ box })));
    for (const side of [-1, 1]) {
      const crosses = (x: number, z: number) => tree.intersects([side * x, 7, z], [side * x, 14, z], 'probe');
      // Samples inside both the angled nose and the full-width aft end.
      for (const [x, z] of [[2.8, -41.3], [4.15, -39.5], [6.2, -37], [7.4, -35.4], [7.5, -12]]) {
        expect(crosses(x, z)).toBe(true);
      }
      // The relocated 37 mm platform and the empty corners beside the taper.
      for (const [x, z] of [[5.64, -41.53], [5.64, -41.2], [7.4, -39.5]]) {
        expect(crosses(x, z)).toBe(false);
      }
    }
  }
});
