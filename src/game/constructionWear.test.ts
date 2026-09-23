import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import type { ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSurface, Vec3 } from '../ships/blueprint';
import { componentMaterial } from '../ships/componentMaterials';
import { createConstructionHull } from './constructionModel';
import { applyConstructionWear, WEAR_NONE } from './constructionWear';

const surface = (id: string, primitiveId: string, face: string, vertices: Vec3[], normal: Vec3, paint = 'naval-gray', panelId?: string): ConstructionSurface =>
  ({ id, primitiveId, face, vertices, normal, paint, panelId, areaM2: 1, thicknessMm: 10, material: 'steel', open: false });
const primitive = (id: string, kind: string) => ({ id, kind, position: [0, 0, 0], size: [1, 1, 1], rotationDeg: 0 }) as unknown as ConstructionPrimitive;
const component = (role: 'naval' | 'glass') => { const spec = componentMaterial(role); const m = new THREE.MeshStandardMaterial({ roughness: spec.roughness, metalness: spec.metallic }); m.userData = spec.userData; return m; };

/** Every `shipWear` value at a ship-frame position, over the meshes under `root`. */
function wearAt(root: THREE.Object3D, point: Vec3): number[][] {
  const found: number[][] = [], at = new THREE.Vector3(...point), p = new THREE.Vector3();
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh) || !node.geometry.hasAttribute('shipWear')) return;
    const position = node.geometry.getAttribute('position'), wear = node.geometry.getAttribute('shipWear');
    for (let v = 0; v < position.count; v++) if (p.fromBufferAttribute(position, v).applyMatrix4(node.matrixWorld).distanceTo(at) < 1e-4) found.push([wear.getX(v), wear.getY(v), wear.getZ(v), wear.getW(v)]);
  });
  return found;
}

test('construction wear measures runoff from real edges, funnel soot and the rest waterline, on paint only', () => {
  // A built hull whose sheer rises from 6 m aft to 8 m forward, its side in two panel rows; a deckhouse wall on deck.
  const surfaces = [
    surface('deck', 'hull', 'top', [[-3, 6, -10], [3, 6, -10], [3, 8, 10], [-3, 8, 10]], [0, .995, -.0995], 'teak-natural'),
    surface('upper', 'hull', 'port', [[-3, 3, -10], [-3, 6, -10], [-3, 8, 10], [-3, 3, 10]], [-1, 0, 0], 'naval-gray', 'upper'),
    surface('lower', 'hull', 'port', [[-3, 0, -10], [-3, 3, -10], [-3, 3, 10], [-3, 0, 10]], [-1, 0, 0], 'naval-gray', 'lower'),
    surface('wall', 'house', 'port', [[-1, 8, 0], [-1, 11, 0], [-1, 11, 4], [-1, 8, 4]], [-1, 0, 0]),
  ];
  const primitives = [primitive('hull', 'custom-hull'), primitive('house', 'box')];
  const group = createConstructionHull(surfaces, primitives);
  // A funnel casing whose top is 12 m up, glass in a window, and one fitting drawn at two poses and a double height.
  const funnel = new THREE.Group(), casing = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), component('naval'));
  casing.position.set(0, 10, -5); funnel.add(casing);
  funnel.traverse(node => { node.userData.sourceId = 'funnel-1'; node.userData.constructionEquipmentKind = 'funnel'; });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 1, .1), component('glass')); glass.position.set(0, 9, 0);
  const box = new THREE.BoxGeometry(1, 1, 1), paint = component('naval');
  const fore = new THREE.Mesh(box, paint), turned = new THREE.Mesh(box, paint), tall = new THREE.Group(), stretched = new THREE.Mesh(box, paint);
  fore.position.set(0, 8.5, 5); turned.position.set(2, 8.5, 5); turned.rotation.y = 1.1; tall.position.set(-2, 9, 5); tall.scale.set(1, 2, 1); tall.add(stretched);
  group.add(funnel, glass, fore, turned, tall); group.updateMatrixWorld(true);
  const source = { construction: { primitives, wear: 'battle-worn' } } as unknown as ConstructionSource;
  applyConstructionWear(group, source, { loading: { waterlineY: 2 } } as ConstructionResult);

  // Hull sides hang from the sheer at their station, not from their own panel's top.
  expect(wearAt(group, [-3, 3, 10]).length).toBeGreaterThan(1);
  for (const w of wearAt(group, [-3, 3, 10])) expect(w[1]).toBeCloseTo(5, 5);
  for (const w of wearAt(group, [-3, 3, -10])) expect(w[1]).toBeCloseTo(3, 5);
  for (const w of wearAt(group, [-3, 0, 10])) { expect(w[1]).toBeCloseTo(8, 5); expect(w[3]).toBeCloseTo(-2, 5); expect(w[0]).toBe(1); expect(w[2]).toBe(WEAR_NONE); }
  // A block's wall hangs from its own top: 0 there, its full 3 m height at its foot.
  for (const w of wearAt(group, [-1, 11, 4])) expect(w[1]).toBeCloseTo(0, 5);
  for (const w of wearAt(group, [-1, 8, 0])) expect(w[1]).toBeCloseTo(3, 5);
  // Timber decking wears nothing; the deck carries no runoff.
  const deck = wearAt(group, [3, 6, -10]);
  expect(deck.length).toBeGreaterThan(0);
  for (const w of deck) { expect(w[0]).toBe(0); expect(w[1]).toBe(WEAR_NONE); }
  // The funnel soots down from its top, and its walls hang from it; its roof carries no runoff.
  const top = wearAt(group, [1, 12, -4]), foot = wearAt(group, [1, 8, -4]);
  for (const w of top) expect(w[2]).toBeCloseTo(0, 5);
  for (const w of foot) expect(w[2]).toBeCloseTo(4, 5);
  expect(top.map(w => w[1]).sort((a, b) => a - b)).toEqual([0, 0, WEAR_NONE]);
  expect(foot.map(w => w[1]).sort((a, b) => a - b)).toEqual([4, 4, WEAR_NONE]);
  // Glass wears nothing.
  for (const w of wearAt(group, [.5, 9.5, .05])) expect(w[0]).toBe(0);
  // A fitting turned about the vertical shares its geometry; stretched, its walls measure in ship metres.
  expect(turned.geometry).toBe(fore.geometry);
  expect(stretched.geometry).not.toBe(fore.geometry);
  const walls = (point: Vec3) => wearAt(group, point).map(w => w[1]).filter(drop => drop < WEAR_NONE);
  expect(walls([-2.5, 8, 4.5])).toEqual([2, 2]);
  expect(walls([.5, 8, 4.5])).toEqual([1, 1]);
});

test('a vertex shared by a wall and a roof is split so each keeps its own drop', () => {
  // A 2 m wall meeting a roof along a shared, indexed edge.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 2, 0, 0, 2, 4, 0, 0, 4, 2, 2, 0, 2, 2, 4], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(0), 3));
  geometry.setIndex([0, 2, 1, 0, 3, 2, 1, 2, 5, 1, 5, 4]);
  const root = new THREE.Group(), mesh = new THREE.Mesh(geometry, component('naval')); root.add(mesh); root.updateMatrixWorld(true);
  applyConstructionWear(root, { construction: { primitives: [] } } as unknown as ConstructionSource, {} as ConstructionResult);
  expect(mesh.geometry.getAttribute('position').count).toBe(8);
  const drops = wearAt(root, [0, 2, 0]).map(w => w[1]).sort((a, b) => a - b);
  expect(drops).toEqual([0, WEAR_NONE]);
  for (const w of wearAt(root, [0, 0, 4])) expect(w[1]).toBeCloseTo(2, 5);
});
