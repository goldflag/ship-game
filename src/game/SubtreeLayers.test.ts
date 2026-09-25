import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { projectedLayers, SubtreeLayers, subtreePruning } from './SubtreeLayers';
import { collectShadowCasters } from './ShadowCasterPass';

type Push = unknown[];
/** Three's own projection (`Renderer._projectObject`) on a stand-in renderer, recording what it pushes. */
function projector() {
  const renderer = { sortObjects: true, backend: {}, _projectObject: (THREE.Renderer.prototype as unknown as { _projectObject: unknown })._projectObject } as unknown as
    { _projectObject(object: THREE.Object3D, camera: THREE.Camera, groupOrder: number, list: unknown, clipping: unknown): void };
  const pruning = subtreePruning(renderer);
  const project = (scene: THREE.Object3D, camera: THREE.Camera) => {
    const pushes: Push[] = [];
    const list = { push: (...a: unknown[]) => pushes.push(a), pushLight: (light: unknown) => pushes.push(['light', light]), pushBundle: (b: unknown) => pushes.push(['bundle', b]) };
    renderer._projectObject(scene, camera, 0, list, null);
    return pushes;
  };
  return { renderer, pruning, project };
}

/** A hull-like tree: assemblies of sockets holding surfaces, most of which a batch has masked out. */
function hull(material: THREE.Material) {
  const root = new THREE.Group(), model = new THREE.Group(), geometry = new THREE.BoxGeometry();
  root.add(model);
  const surfaces: THREE.Mesh[] = [];
  for (let a = 0; a < 6; a++) {
    const assembly = new THREE.Object3D(); model.add(assembly);
    for (let s = 0; s < 3; s++) {
      const socket = new THREE.Object3D(); assembly.add(socket);
      for (let m = 0; m < 2; m++) { const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.layers.enable(20); socket.add(mesh); surfaces.push(mesh); }
    }
  }
  return { root, model, surfaces };
}

test('only drawables, lights and LOD switches act on their own layers; a bundle group acts on all', () => {
  const mesh = new THREE.Mesh(); mesh.layers.set(3);
  expect(projectedLayers(mesh)).toBe(1 << 3);
  expect(projectedLayers(new THREE.Group())).toBe(0);
  expect(projectedLayers(new THREE.Object3D())).toBe(0);
  expect(projectedLayers(new THREE.PointLight())).toBe(1);
  expect(projectedLayers(new THREE.LOD())).toBe(1);
  expect(projectedLayers(new THREE.Sprite())).toBe(1);
  expect(projectedLayers(new THREE.BundleGroup())).toBe(-1);
});

test('skipped subtrees leave three\'s render list unchanged through masks, hidden parts and new children', () => {
  const { pruning, project } = projector(), material = new THREE.MeshBasicMaterial();
  const scene = new THREE.Scene(), ships = [hull(material), hull(material)], loose = new THREE.Mesh(new THREE.BoxGeometry(), material);
  loose.frustumCulled = false; scene.add(loose, ...ships.map(s => s.root));
  const index = new SubtreeLayers(), subtrees = ships.map(s => index.add(s.root));
  pruning.subtrees = index;
  const camera = new THREE.PerspectiveCamera(), occlusion = camera.clone(); occlusion.layers.set(20);
  // Mask every surface but one per ship, as a batch does.
  for (const { surfaces } of ships) surfaces.forEach((mesh, i) => { if (i !== 7) mesh.layers.mask = 0; });
  index.refresh(); subtrees.forEach(s => index.layersChanged(s)); index.refresh();
  expect(index.verify()).toEqual([]);
  const compare = () => {
    for (const view of [camera, occlusion]) {
      pruning.enabled = false; const full = project(scene, view);
      pruning.enabled = true; const pruned = project(scene, view);
      expect(pruned.length).toBe(full.length);
      pruned.forEach((push, i) => { expect(push.length).toBe(full[i].length); push.forEach((value, j) => expect(value).toBe(full[i][j])); });
    }
  };
  compare();
  expect(project(scene, camera).map(p => p[0])).toEqual([loose, ships[0].surfaces[7], ships[1].surfaces[7]]);
  // Five of six assemblies hold nothing drawable: the walk skips them whole.
  expect(index.skips(ships[0].model.children[0], camera.layers.mask)).toBe(true);
  expect(index.skips(ships[0].model.children[1], camera.layers.mask)).toBe(false);
  // A hidden part changes nothing that is published: three's own visibility test applies.
  ships[0].surfaces[7].parent!.visible = false; compare(); ships[0].surfaces[7].parent!.visible = true;
  // An impact mark on a masked surface withdraws that ship's entries until the next refresh.
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(), material); mark.frustumCulled = false;
  ships[1].surfaces[0].add(mark);
  expect(index.skips(ships[1].model.children[0], camera.layers.mask)).toBe(false);
  expect(index.skips(ships[0].model.children[0], camera.layers.mask)).toBe(true);
  compare();
  expect(project(scene, camera).map(p => p[0])).toContain(mark);
  index.refresh(); expect(index.verify()).toEqual([]); compare();
  mark.removeFromParent(); compare(); index.refresh(); expect(index.verify()).toEqual([]); compare();
  // A layer change is published once reported.
  ships[0].surfaces[0].layers.mask = 1; index.layersChanged(subtrees[0]); index.refresh();
  expect(index.verify()).toEqual([]); compare();
  // The shadow caster walk skips the same subtrees and keeps the same casters.
  for (const { surfaces } of ships) surfaces.forEach(mesh => { mesh.castShadow = true; });
  loose.castShadow = true;
  expect(collectShadowCasters(scene, 1, undefined, pruning)).toEqual(collectShadowCasters(scene, 1));
  index.dispose(); pruning.subtrees = undefined;
  expect(index.skips(ships[0].model.children[0], camera.layers.mask)).toBe(false);
  ships[0].surfaces[0].add(mark); // No listener remains.
});

test('chain visibility reads every ancestor, above the root too, with a stand-in for one node', () => {
  const scene = new THREE.Scene(), { root, model, surfaces } = hull(new THREE.MeshBasicMaterial());
  scene.add(root);
  const index = new SubtreeLayers(), subtree = index.add(root); index.refresh();
  const visible = (mesh: THREE.Object3D) => subtree.visible[subtree.slotOf(mesh)] === 1;
  const walk = (mesh: THREE.Object3D, substitute?: THREE.Object3D, substituteVisible = true) => {
    for (let o: THREE.Object3D | null = mesh; o; o = o.parent) if (!(o === substitute ? substituteVisible : o.visible)) return false;
    return true;
  };
  const check = (substitute?: THREE.Object3D, substituteVisible = true) => {
    subtree.updateVisibility(substitute, substituteVisible);
    for (const mesh of surfaces) expect(visible(mesh)).toBe(walk(mesh, substitute, substituteVisible));
  };
  check();
  surfaces[3].visible = false; surfaces[4].parent!.visible = false; model.children[5].visible = false; check();
  model.visible = false; check(); check(model, true);
  model.visible = true; scene.visible = false; check(); scene.visible = true; check();
  expect(subtree.slotOf(new THREE.Object3D())).toBe(-1);
  index.dispose();
});
