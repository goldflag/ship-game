import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { float } from 'three/tsl';
import { SHIP_OCCLUSION_LAYER, ShipOcclusion } from './ShipOcclusion';

const box = () => new THREE.BoxGeometry();

test('ship surfaces join the occlusion layer and share one occlusion node that Off removes', () => {
  const occlusion = new ShipOcclusion(new THREE.PerspectiveCamera(), true);
  const paint = new THREE.MeshStandardNodeMaterial(), deck = new THREE.MeshStandardNodeMaterial();
  const glass = new THREE.MeshStandardNodeMaterial({ transparent: true });
  const flag = new THREE.MeshStandardNodeMaterial(); flag.positionNode = float(0) as never;
  const ship = new THREE.Group();
  const [hull, planks, window, ensign] = [paint, deck, glass, flag].map(material => new THREE.Mesh(box(), material));
  ship.add(hull, planks, window, ensign);

  occlusion.adopt(ship);
  expect([hull, planks, window, ensign].map(mesh => mesh.layers.isEnabled(SHIP_OCCLUSION_LAYER))).toEqual([true, true, false, false]);
  // The default layer stays, so the scene pass draws them exactly as before.
  expect(hull.layers.isEnabled(0)).toBe(true);
  expect(paint.aoNode).toBeNull();

  const version = paint.version;
  occlusion.setLevel('low');
  expect(paint.aoNode).not.toBeNull();
  expect(deck.aoNode).toBe(paint.aoNode);
  expect(glass.aoNode).toBeNull();
  expect(paint.version).toBe(version + 1);

  // Changing the sample budget is a uniform, not a recompile.
  occlusion.setLevel('high');
  expect(paint.version).toBe(version + 1);

  occlusion.setLevel('off');
  expect(paint.aoNode).toBeNull();
  expect(deck.aoNode).toBeNull();

  // A hull adopted while occlusion is on is connected at once.
  occlusion.setLevel('low');
  const later = new THREE.MeshStandardNodeMaterial();
  occlusion.adopt(new THREE.Mesh(box(), later));
  expect(later.aoNode).toBe(paint.aoNode);
  occlusion.dispose();
});
