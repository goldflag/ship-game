import { expect, spyOn, test } from 'bun:test';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three/webgpu';
import { disposeObjects, disposeObjectsExcept } from './disposeObjects';

const hull = (geometry = new BoxGeometry(), material = new MeshStandardMaterial()) => {
  const root = new Group(); root.add(new Mesh(geometry, material)); return root;
};

test('a retired fleet releases its geometry, materials and textures once', () => {
  const map = new Texture(), material = new MeshStandardMaterial({ map });
  const geometry = new BoxGeometry(), root = hull(geometry, material);
  root.add(new Mesh(geometry, material)); // a second draw of the same resources
  const geometrySpy = spyOn(geometry, 'dispose'), materialSpy = spyOn(material, 'dispose'), textureSpy = spyOn(map, 'dispose');
  disposeObjects(root);
  expect(geometrySpy).toHaveBeenCalledTimes(1);
  expect(materialSpy).toHaveBeenCalledTimes(1);
  expect(textureSpy).toHaveBeenCalledTimes(1);
});

test('resources a kept hull still needs survive its clones being retired', () => {
  const map = new Texture(), shared = new MeshStandardMaterial({ map }), geometry = new BoxGeometry();
  const template = hull(geometry, shared);
  // A ShipView clones the node tree and the materials, but goes on sharing the geometry.
  const view = hull(geometry, shared.clone());
  const geometrySpy = spyOn(geometry, 'dispose'), sharedSpy = spyOn(shared, 'dispose'), textureSpy = spyOn(map, 'dispose');
  const cloneSpy = spyOn((view.children[0] as Mesh).material as MeshStandardMaterial, 'dispose');
  disposeObjectsExcept({ roots: [template], materials: [shared] }, view);
  expect(cloneSpy).toHaveBeenCalledTimes(1);
  expect(geometrySpy).not.toHaveBeenCalled();
  expect(sharedSpy).not.toHaveBeenCalled();
  expect(textureSpy).not.toHaveBeenCalled();
});

test('an evicted hull is released even while a palette material it used is kept', () => {
  const shared = new MeshStandardMaterial({ map: new Texture() });
  const evicted = new BoxGeometry(), retained = new BoxGeometry();
  const evictedSpy = spyOn(evicted, 'dispose'), retainedSpy = spyOn(retained, 'dispose'), sharedSpy = spyOn(shared, 'dispose');
  disposeObjectsExcept({ roots: [hull(retained, shared)], materials: [shared] }, hull(evicted, shared));
  expect(evictedSpy).toHaveBeenCalledTimes(1);
  expect(retainedSpy).not.toHaveBeenCalled();
  expect(sharedSpy).not.toHaveBeenCalled();
});
