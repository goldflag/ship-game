import { expect, test } from 'bun:test';
import { shipPresets, shipPreset } from '../ships/presets';
import { localToWorld, segmentBox, worldToLocal } from './geometry';
import { mayReachHull, shellHullRadius } from './spatial';
import type { Vec3 } from '../ships/blueprint';

test('fleet shell rejection retains swept hits through rotated, listing and sinking hulls', () => {
  for (const id of Object.keys(shipPresets)) {
    const def = shipPreset(id), radius = shellHullRadius(def);
    const box = {center:[0, 10, 0] as Vec3, size:[def.hull.beam + 30, 60, def.hull.length + 40] as Vec3};
    for (let i = 0; i < 80; i++) {
      const pose = {x:7000, y:-i, z:-9000, heading:i*.19, roll:i*.03, pitch:-i*.02};
      const from = localToWorld([-500, 10, 0], pose), to = localToWorld([500, 10, 0], pose);
      expect(segmentBox(worldToLocal(from, pose), worldToLocal(to, pose), box)).not.toBeNull();
      expect(mayReachHull(from, to, pose, radius)).toBe(true);
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
        const corner = localToWorld([x*box.size[0]/2, 10+y*30, z*box.size[2]/2], pose);
        expect(mayReachHull(corner, corner, pose, radius)).toBe(true);
      }
      expect(mayReachHull([0, 0, 0], [10, 0, 10], pose, radius)).toBe(false);
    }
  }
});
