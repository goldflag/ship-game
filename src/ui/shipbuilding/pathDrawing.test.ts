import { expect, test } from 'bun:test';
import * as THREE from 'three';
import type { ConstructionCatalog, ConstructionEquipmentPart, Vec3 } from '../../ships/blueprint';
import { createStarterSource } from '../../ships/constructionStarter';
import { copyConstructionSelection, decodeConstructionSource, mirroredEquipment, moveConstructionSelection, rotateConstructionSelection } from '../../ships/constructionEditor';
import { createConstructionHistory, editConstruction, undoConstruction, redoConstruction } from '../../ships/constructionHistory';
import { equipmentPathBounds, pathProblem, pathSlackLimit, pathWorldPoint } from '../../ships/constructionPaths';
import { pathDistance, railingPosts, samplePath } from '../../../assets/parts/construction/path_geometry';
import { createConstructionPathModel } from '../../game/constructionPathModel';
import { disposeConstructionModel } from '../../game/constructionModel';
import { EquipmentPreview } from './equipmentPreview';
import { appendPathPoint, pathAnchor, pathEquipment } from './pathDrawing';
import { formatTonnes, paletteFor } from './builderLayers';

const fitting = (kind: 'railing' | 'rope' | 'chain'): ConstructionEquipmentPart => ({ id: kind, name: `${kind} fitting`, kind: 'deck-fitting', placement: 'deck', size: [.2, 1.1, 4], boundsCenter: [0, .55, -2], centerOfGravity: [0, .55, -2], massKg: 2, modelUrl: '/models/components/test.glb', contentHash: 'test', path: { kind, diameterM: kind === 'chain' ? .035 : .04, heightM: 1.1, postSpacingM: 1.5, massKgPerM: 3, postMassKg: 2 } });
const catalog: ConstructionCatalog = { schemaVersion: 1, revision: 'path-test', weapons: { schemaVersion: 1, parts: [] }, equipment: ['railing', 'rope', 'chain'].map(kind => fitting(kind as 'rope')) };

test('connected click preview commits the complete route as one undoable source edit', () => {
  const source = createStarterSource(catalog, 'blank');
  let history = createConstructionHistory(source), points: Vec3[] = [];
  for (const p of [[1, 2, 3], [1, 2, -1], [4, 3, -1]] as Vec3[]) points = appendPathPoint(points, p);
  expect(history.source.construction.equipment).toHaveLength(0);
  expect(appendPathPoint(points, points.at(-1)!)).toEqual(points); // second click of a double-click
  expect(points).toHaveLength(3);
  const item = pathEquipment('route', 'rope', points, .3);
  expect(item.path?.points[0]).toEqual([0, 0, 0]);
  history = editConstruction(history, 'Draw rope path', draft => { draft.construction.equipment.push(item); });
  expect(history.past).toHaveLength(1);
  expect(history.source.construction.equipment[0].path?.points).toHaveLength(3);
  expect(undoConstruction(history).source.construction.equipment).toHaveLength(0);
  expect(redoConstruction(undoConstruction(history)).source).toEqual(history.source);
  expect(decodeConstructionSource(JSON.parse(JSON.stringify(history.source)))).toEqual(history.source);
});

test('route translation, bearing, copy and mirror preserve every local point and slack', () => {
  const source = createStarterSource(catalog, 'blank'), original = pathEquipment('route', 'rope', [[2, 3, 4], [5, 4, -2], [6, 2, -5]], .25);
  original.bearingDeg = 35; source.construction.equipment = [original];
  const world = original.path!.points.map(p => pathWorldPoint(original, p));
  const mirror = mirroredEquipment(original);
  mirror.path!.points.forEach((p, i) => expect(pathDistance(pathWorldPoint(mirror, p), [-world[i][0], world[i][1], world[i][2]])).toBeLessThan(1e-8));
  expect(mirroredEquipment(mirror)).toEqual(original);
  copyConstructionSelection(source, new Set(['route']));
  source.construction.equipment[1].path!.points[1][0] += 9;
  expect(original.path!.points[1][0]).toBe(3);
  moveConstructionSelection(source, new Set(['route']), [2, 0, -1]);
  rotateConstructionSelection(source, new Set(['route']), 15);
  expect(original.bearingDeg).toBe(50);
  expect(original.position).toEqual([4, 3, 3]);
  expect(original.path!.slackM).toBe(.25);
});

test('rope sag matches 16-interval native sampling and railing joins share one post', () => {
  const points: Vec3[] = [[0, 2, 0], [0, 2, -4], [4, 2, -4]], sampled = samplePath(points, .6);
  expect(sampled).toHaveLength(33);
  expect(sampled[0]).toEqual(points[0]); expect(sampled[16]).toEqual(points[1]); expect(sampled[32]).toEqual(points[2]);
  expect(sampled[8]).toEqual([0, 1.4, -2]);
  expect(railingPosts(points, 1.5)).toHaveLength(7);
  expect(railingPosts(points, 1.5).filter(p => pathDistance(p, points[1]) < 1e-8)).toHaveLength(1);
  expect(pathSlackLimit(points)).toBe(2);
  expect(pathProblem(points, 2.1)).toContain('Reduce rope slack');
  expect(pathProblem(points, NaN)).toContain('Reduce rope slack');
  expect(pathProblem(points, Infinity)).toContain('Reduce rope slack');
  expect(pathProblem([[0, 0, 0], [0, 0, .01]])).toContain('5 cm');
  expect(pathProblem([[0, 0, 0], [0, 0, 501]])).toContain('500 m');
});

test('hull anchors keep support plane and explicit fitting sockets use their transformed position', () => {
  const source = createStarterSource(catalog, 'blank'), rope = fitting('rope');
  const hull = { id: 'hull', point: [.34, .5, -.31] as Vec3, normal: [0, 1, 0] as Vec3, axis: 1 as const };
  expect(pathAnchor(rope, source, catalog, hull, .25)).toEqual([.25, .52, -.25]);
  expect(pathAnchor(fitting('railing'), source, catalog, hull, .25)).toEqual([.25, .5, -.25]);
  expect(pathAnchor(fitting('chain'), source, catalog, hull, .25)?.[1]).toBeCloseTo(.57);
  const support: ConstructionEquipmentPart = { ...rope, id: 'cleat', path: undefined, sockets: [{ id: 'attachment', kind: 'support', position: [0, 0, 0], direction: [0, -1, 0] }, { id: 'tie-eye', kind: 'rigging', position: [1, 2, 0], direction: [1, 0, 0] }] };
  const item = { id: 'cleat1', partId: 'cleat', position: [4, .5, 6] as Vec3, bearingDeg: 90 };
  source.construction.equipment.push(item);
  expect(pathAnchor(rope, source, { ...catalog, equipment: [...catalog.equipment, support] }, { ...hull, id: item.id }, .25)).toEqual(pathWorldPoint(item, [1, 2, 0]));
  expect(pathAnchor(fitting('railing'), source, catalog, { ...hull, id: item.id }, .25)).toBeUndefined();
});

test('path rendering uses bounded instancing and actual bounds, with three rails and foot plates', () => {
  const rail = createConstructionPathModel(fitting('railing'), { points: [[0, 0, 0], [0, 0, -4], [4, 0, -4]] });
  try {
    expect(rail.children).toHaveLength(3);
    expect((rail.children[0] as THREE.InstancedMesh).count).toBe(7);
    expect((rail.children[2] as THREE.InstancedMesh).count).toBe(7);
    const bounds = new THREE.Box3().setFromObject(rail);
    expect(bounds.min.y).toBeCloseTo(0); expect(bounds.max.y).toBeGreaterThan(1.1);
    const sourceBounds = equipmentPathBounds(fitting('railing'), { path: { points: [[0, 0, 0], [0, 0, -4], [4, 0, -4]] } });
    const selection = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...sourceBounds.center), new THREE.Vector3(...sourceBounds.size)).expandByScalar(1e-6);
    // Inspect actual instanced vertices, including the wide foot plates and
    // thicker posts, rather than only the nominal route centerline.
    for (const child of rail.children as THREE.InstancedMesh[]) {
      const positions = child.geometry.getAttribute('position'), matrix = new THREE.Matrix4();
      for (let i = 0; i < (child instanceof THREE.InstancedMesh ? child.count : 1); i++) {
        if (child instanceof THREE.InstancedMesh) child.getMatrixAt(i, matrix); else matrix.identity();
        for (let v = 0; v < positions.count; v++) expect(selection.containsPoint(new THREE.Vector3().fromBufferAttribute(positions, v).applyMatrix4(matrix))).toBe(true);
      }
    }
    expect(sourceBounds.size[0]).toBeCloseTo(4.12);
    expect(sourceBounds.size[2]).toBeCloseTo(4.12);
  } finally { disposeConstructionModel(rail); }
  const chain = createConstructionPathModel(fitting('chain'), { points: [[0, 1, 0], [0, 1, -500]] });
  try { expect(chain.children).toHaveLength(1); expect((chain.children[0] as THREE.InstancedMesh).count).toBeLessThan(5000); } finally { disposeConstructionModel(chain); }
  const bounds = equipmentPathBounds(fitting('rope'), { path: { points: [[0, 3, 0], [0, 3, -10]], slackM: 1 } });
  expect(bounds.center[2]).toBe(-5); expect(bounds.size[2]).toBeCloseTo(10.04); expect(bounds.size[1]).toBeCloseTo(1.04);
  for (const points of [[[0, 0, 0], [0, 0, 0]], [[0, 0, -1000], [0, 0, 1000]]] as Vec3[][]) {
    const invalid = createConstructionPathModel(fitting('railing'), { points });
    expect(invalid.children).toHaveLength(1); expect(invalid.children[0]).toBeInstanceOf(THREE.Line);
    disposeConstructionModel(invalid);
  }
});

test('procedural installed previews update route geometry and release replaced buffers', () => {
  const source = createStarterSource(catalog, 'blank'); source.construction.equipment.push(pathEquipment('route', 'rope', [[0, 2, 0], [0, 2, -4]], .2));
  const preview = new EquipmentPreview(() => {}, message => { if (message) throw new Error(message); });
  preview.update(source, catalog);
  const first = preview.group.children[0], geometry = (first.children[0].children[0] as THREE.Mesh).geometry;
  let disposed = 0; geometry.addEventListener('dispose', () => disposed++);
  source.construction.equipment[0].path!.points[1][2] = -8;
  preview.update(source, catalog);
  expect(preview.group.children[0]).not.toBe(first); expect(disposed).toBe(1);
  preview.dispose();
  expect(preview.group.children).toHaveLength(0);
});

test('deck fittings are discoverable and light parts retain readable kilogram mass', () => {
  expect(paletteFor('fittings', catalog).drawer.map(p => p.name)).toEqual(expect.arrayContaining(['rope fitting', 'chain fitting', 'railing fitting']));
  expect(formatTonnes(2.5)).toBe('2.5 kg'); expect(formatTonnes(100_000)).toBe('100 t');
});


test('two-rail height is reflected in mesh, picking bounds and saved copies', () => {
  const part = fitting('railing'), path = { points: [[0, 0, 0], [0, 0, -4]] as Vec3[], heightM: 1.8, railCount: 2 as const };
  const model = createConstructionPathModel(part, path);
  const bounds = new THREE.Box3().setFromObject(model);
  expect(bounds.max.y).toBeCloseTo(1.82, 2);
  expect(equipmentPathBounds(part, { path }).size[1]).toBeCloseTo(1.84);
  expect((model.children[1] as THREE.Mesh).geometry.index!.count / 3).toBe(40);
  const source = createStarterSource(catalog, 'blank');
  const item = { ...pathEquipment('railing', part.id, path.points), path };
  source.construction.equipment.push(item);
  expect(decodeConstructionSource(JSON.parse(JSON.stringify(source))).construction.equipment[0].path).toEqual(path);
  expect(mirroredEquipment(item).path).toMatchObject({ heightM: 1.8, railCount: 2 });
  disposeConstructionModel(model);
});
