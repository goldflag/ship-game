import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { ShipRigView } from './ShipRigView';
import { createShipState } from '../simulation/ship';
import { compileShip, type ShipDefinition } from '../ships/blueprint';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { rasterEnsign } from '../../assets/parts/ensigns';

function fixture() {
  const node = new THREE.Group(), child = new THREE.Mesh(new THREE.BoxGeometry(4, 1, .2));
  node.userData.nodeId = 'search.yaw'; node.add(child); node.position.set(0, 20, 0);
  const definition = { rig: { version: 1, ensigns: [{ id: 'ensign', design: 'us-48', position: [0, 8, 20], width: 3.8, staffHeight: 3 }],
    radars: [{ id: 'search', nodeId: 'search.yaw', rpm: 6 }] } } as ShipDefinition;
  const rig = new ShipRigView(definition, new Map([['search.yaw', node]]), 'ship-a');
  return { rig, node, hull: new THREE.Group(), motion: createShipState('ship-a') };
}

test('radar rotates its own pivot and holds through pause and sinking', () => {
  const { rig, node, hull, motion } = fixture();
  for (let i = 0; i < 50; i++) rig.update(.1, 0, 0, hull, motion, false);
  expect(rig.radars[0].angle).toBeCloseTo(Math.PI, 8);
  expect(node.position.toArray()).toEqual([0, 20, 0]);
  const q = node.quaternion.toArray(), cloth = rig.flags[0].cloth.positions.slice();
  rig.update(0, 20, 2, hull, motion, false);
  expect(node.quaternion.toArray()).toEqual(q); expect(rig.flags[0].cloth.positions).toEqual(cloth);
  rig.update(.1, 20, 2, hull, motion, true); expect(node.quaternion.toArray()).toEqual(q);
  rig.dispose();
});

test('ship speed produces apparent wind in calm weather, and immersed flags disappear', () => {
  const { rig, hull, motion } = fixture(); motion.speed = 15;
  for (let i = 0; i < 300; i++) rig.update(1 / 60, 0, 0, hull, motion, false);
  const cloth = rig.flags[0].cloth;
  expect(cloth.positions[cloth.columns * 3 + 2]).toBeGreaterThan(3);
  hull.position.y = -20;
  rig.update(1 / 60, 0, 0, hull, motion, false);
  expect(rig.flags[0].mesh.visible).toBe(false);
  rig.dispose();
});

test('rig compiler rejects unknown ensigns, duplicate joints and invalid rotation rates', () => {
  for (const alter of [
    (b: any) => b.rig.ensigns[0].design = 'modern-us-50',
    (b: any) => b.rig.radars[0].rpm = -2,
    (b: any) => b.rig.radars[1].nodeId = b.rig.radars[0].nodeId,
    (b: any) => b.rig.ensigns[0].position = [0, 200, 0],
  ]) {
    const b = structuredClone(blueprint); alter(b);
    expect(() => compileShip(b, catalog)).toThrow();
  }
});

test('US ensign has 48 distinct stars and thirteen fly stripes', () => {
  const { data, width, height } = rasterEnsign('us-48');
  const white = (x: number, y: number) => data[((height - 1 - y) * width + x) * 4] === 239;
  let stripes = 1, previous = white(width - 2, 0);
  for (let y = 1; y < height; y++) { const color = white(width - 2, y); if (color !== previous) stripes++; previous = color; }
  expect(stripes).toBe(13);
  const seen = new Set<number>(); let stars = 0;
  for (let y = 0; y < Math.floor(height * 7 / 13); y++) for (let x = 0; x < Math.floor(width * .4); x++) {
    const start = y * width + x;
    if (!white(x, y) || seen.has(start)) continue;
    stars++; const stack = [start]; seen.add(start);
    while (stack.length) {
      const at = stack.pop()!, ax = at % width, ay = Math.floor(at / width);
      for (const [bx, by] of [[ax - 1, ay], [ax + 1, ay], [ax, ay - 1], [ax, ay + 1], [ax - 1, ay - 1], [ax + 1, ay - 1], [ax - 1, ay + 1], [ax + 1, ay + 1]]) {
        const next = by * width + bx;
        if (bx >= 0 && bx < Math.floor(width * .4) && by >= 0 && by < Math.floor(height * 7 / 13) && !seen.has(next) && white(bx, by)) { seen.add(next); stack.push(next); }
      }
    }
  }
  expect(stars).toBe(48);
});
