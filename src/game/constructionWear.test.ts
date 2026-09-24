import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import type { ConstructionPrimitive, ConstructionResult, ConstructionSource, ConstructionSurface, Vec3 } from '../ships/blueprint';
import { componentMaterial } from '../ships/componentMaterials';
import { createConstructionFittingModel } from './constructionFittingModel';
import { createConstructionHull } from './constructionModel';
import { createConstructionPropellerSupports } from './constructionPropellerModel';
import { applyConstructionWear, applyPremadeWear, isConstructionPaint, wearsPaint, WEAR_NONE } from './constructionWear';
import { isPlatedPaint } from './ShipSurfaceDetail';

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

test('player-built paint both wears and draws plating, as the models name it; timber and bare steel do neither', () => {
  // A hull side under a teak deck; a design-local fitting in the installation's coat, a coat of its own and teak; a shaft and its strut.
  const hull = createConstructionHull([
    surface('side', 'hull', 'port', [[-3, 0, -10], [-3, 6, -10], [-3, 6, 10], [-3, 0, 10]], [-1, 0, 0]),
    surface('deck', 'hull', 'top', [[-3, 6, -10], [3, 6, -10], [3, 6, 10], [-3, 6, 10]], [0, 1, 0], 'teak-natural'),
  ], [primitive('hull', 'box')]);
  const box = (id: string, x: number, paint?: string) => ({ id, kind: 'box' as const, size: [2, 1, 2] as Vec3, position: [x, .5, 0] as Vec3, rotationDeg: 0, ...(paint ? { paint } : {}) });
  const fitting = createConstructionFittingModel({ id: 'fit', name: 'Fit', version: 2, attach: 'deck', massKg: 100,
    solids: [box('house', 0), box('painted', 4, 'light-gray'), box('planked', 8, 'teak-natural')], tubes: [] });
  const member = (kind: 'shaft' | 'strut') => ({ kind, start: [0, -3, -40] as Vec3, end: [0, -2, -30] as Vec3, radiusM: .3 });
  const supports = createConstructionPropellerSupports([{ equipmentId: 'screw', members: [member('shaft'), member('strut')] }]);
  const classes: Record<string, boolean[]> = {};
  for (const root of [hull, fitting, supports]) root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const material = node.material as THREE.MeshStandardMaterial;
    classes[material.name] = [isConstructionPaint(material), wearsPaint(material), isPlatedPaint(material)];
  });
  expect(classes).toEqual({
    'construction.naval-gray:false': [true, true, true], 'construction.teak-natural:true': [false, false, false],
    // Unpainted shapes take the installation's coat as a catalog part would, through their component role.
    'custom-fitting': [false, true, true], 'custom-fitting.light-gray': [true, true, true], 'custom-fitting.teak-natural': [false, false, false],
    'construction.propeller.underwater-paint': [true, true, true], 'construction.propeller.shaft-steel': [false, false, false],
  });
});

test('premade appearance paint wears where it is plated steel: not fittings, canvas, timber, linoleum or metal', () => {
  const bound = (paintId: string, surfaceFinish: string, extra: Record<string, unknown> = {}) => {
    const m = new THREE.MeshStandardMaterial({ metalness: 0 }); m.name = paintId; m.userData = { paintId, surfaceFinish, ...extra }; return m;
  };
  const wears = (m: THREE.MeshStandardMaterial) => [wearsPaint(m), isPlatedPaint(m)];
  expect(wears(bound('x-authored-hullgray', 'painted-steel'))).toEqual([true, true]);
  expect(wears(bound('x-authored-roof', 'painted-deck'))).toEqual([true, true]);
  expect(wears(bound('x-authored-antifouling', 'underwater-coating'))).toEqual([true, true]);
  // A named legacy role still follows its appearance binding, not its component role.
  expect(wears(bound('naval', 'painted-steel'))).toEqual([true, true]);
  for (const fitting of ['x-authored-edge', 'x-authored-canvas', 'x-authored-raft', 'x-authored-light']) expect(wears(bound(fitting, 'painted-steel'))).toEqual([false, false]);
  expect(wears(bound('x-authored-wood', 'wood'))).toEqual([false, false]);
  expect(wears(bound('x-authored-deck', 'wood', { deckSubstrate: 'timber' }))).toEqual([false, false]);
  expect(wears(bound('x-authored-linoleum', 'linoleum'))).toEqual([false, false]);
  const metal = bound('x-authored-naval', 'painted-steel'); metal.metalness = .5;
  expect(wears(metal)).toEqual([false, false]);
});

test('premade wear: hull sides hang from the sheer, walls from their tops, funnels soot from their top, all know the waterline', () => {
  const paint = (paintId: string, extra: Record<string, unknown> = {}) => {
    const m = new THREE.MeshStandardMaterial({ roughness: .78, metalness: 0 }); m.userData = { paintId, surfaceFinish: 'painted-steel', ...extra }; return m;
  };
  const box = (size: Vec3, at: Vec3, material: THREE.Material) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.set(...at); return mesh; };
  // A glTF node of several primitives: a group with the node's extras over one mesh per material. The sheer falls from 8 m
  // at the bow (z −10) to 6 m aft; the timber deck on top wears nothing.
  const hull = new THREE.Group(); hull.userData = { assemblyId: 'hull', nodeId: 'hull.surface' };
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute([3, -3, -10, 3, 8, -10, 3, -3, 0, 3, 7, 0, 3, -3, 10, 3, 6, 10], 3));
  side.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5]);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(6, 20).rotateX(-Math.PI / 2).translate(0, 7, 0), paint('x-authored-deck', { surfaceFinish: 'wood', deckSubstrate: 'timber' }));
  hull.add(new THREE.Mesh(side, paint('x-authored-hullgray')), deck);
  const house = box([4, 4, 4], [0, 10, 0], paint('x-authored-naval')); house.userData.assemblyId = 'superstructure';
  // A funnel: its jacket, the base under it and the cap on it stand as one; the gallery round it is not the funnel.
  const funnel = (assemblyId: string, size: Vec3, at: Vec3) => { const mesh = box(size, at, paint('x-authored-naval')); mesh.userData.assemblyId = assemblyId; return mesh; };
  const jacket = funnel('funnel-jacket', [3, 8, 4], [0, 16, 2]), base = funnel('funnel-base', [4, 4, 5], [0, 10, 2]);
  const cap = funnel('funnel-cap', [3, .5, 4], [0, 20.25, 2]), gallery = funnel('funnel-searchlight-gallery', [6, 1, 7], [0, 16, 2]);
  const rail = box([.1, 1, 6], [2.9, 8.5, -3], paint('x-authored-edge'));
  const root = new THREE.Group(); root.add(hull, house, jacket, base, cap, gallery, rail); root.updateMatrixWorld(true);
  applyPremadeWear(root, .4);

  for (const w of wearAt(root, [3, 0, -10])) { expect(w[0]).toBe(.4); expect(w[1]).toBeCloseTo(8, 1); expect(w[2]).toBe(WEAR_NONE); expect(w[3]).toBeCloseTo(0, 5); }
  for (const w of wearAt(root, [3, 0, 0])) expect(w[1]).toBeCloseTo(7, 1);
  for (const w of wearAt(root, [3, 6, 10])) expect(w[1]).toBeCloseTo(0, 1);
  for (const w of wearAt(root, [3, -3, 10])) expect(w[3]).toBeCloseTo(-3, 5);
  for (const w of wearAt(root, [3, 7, -10])) expect(w[0]).toBe(0);
  // A deckhouse wall hangs from its own top and knows its height above the waterline.
  const foot = wearAt(root, [2, 8, 2]).filter(w => w[1] < WEAR_NONE);
  expect(foot.length).toBeGreaterThan(0);
  for (const w of foot) { expect(w[1]).toBeCloseTo(4, 5); expect(w[3]).toBeCloseTo(8, 5); expect(w[2]).toBe(WEAR_NONE); }
  // The jacket and its base soot from the cap's top; the gallery is not the funnel.
  expect(wearAt(root, [1.5, 20, 4]).length).toBeGreaterThan(0);
  for (const w of wearAt(root, [1.5, 20, 4])) expect(w[2]).toBeCloseTo(.5, 5);
  for (const w of wearAt(root, [2, 12, 4.5])) expect(w[2]).toBeCloseTo(8.5, 5);
  for (const w of wearAt(root, [3, 16.5, 5.5])) expect(w[2]).toBe(WEAR_NONE);
  // Fitting paint wears nothing.
  for (const w of wearAt(root, [2.95, 9, 0])) expect(w[0]).toBe(0);

  // No wear writes nothing, so the palette's zeros draw the model as before.
  const plain = new THREE.Group(), mesh = box([4, 4, 4], [0, 10, 0], paint('x-authored-naval')); plain.add(mesh);
  applyPremadeWear(plain, 0);
  expect(mesh.geometry.hasAttribute('shipWear')).toBe(false);
});
