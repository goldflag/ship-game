import { expect, test } from 'bun:test';
import { segmentBox } from './geometry';
import { BarrelObstructionTree, segmentIntersectsBox } from './obstruction';
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
      ...definition.mounts.map(m => ({ mountId: m.id, box: {
        center: add(m.position, [0, m.weapon.gunhouseSize[2] / 2, 0]),
        size: [m.weapon.gunhouseSize[1], m.weapon.gunhouseSize[2], m.weapon.gunhouseSize[0]] as Vec3,
      } })),
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
