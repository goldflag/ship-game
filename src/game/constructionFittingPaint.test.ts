import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { paintConstructionFitting } from './constructionFittingPaint';

test('fitting coating isolates shared materials and retains glass, texture detail and joints', () => {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff' });
  const glass = new THREE.MeshStandardMaterial({ color: '#abcdef', transparent: true, opacity: .3 });
  const texture = new THREE.Texture(); material.map = texture;
  const model = new THREE.Group(), joint = new THREE.Group(); joint.name = 'barrel.recoil';
  const geometry = new THREE.BoxGeometry(), mesh = new THREE.Mesh(geometry, [material, glass]);
  joint.add(mesh); model.add(joint);
  const copy = model.clone(true), owned = paintConstructionFitting(copy, 'sea-blue');
  const painted = copy.getObjectByName('barrel.recoil')!.children[0] as THREE.Mesh;
  const materials = painted.material as THREE.MeshStandardMaterial[];
  expect(owned).toHaveLength(1); expect(materials[0].color.getHexString()).toBe('405d70');
  expect(material.color.getHexString()).toBe('ffffff');
  expect(materials[0].map).toBe(texture); expect(materials[1]).toBe(glass);
  expect(painted.geometry).toBe(geometry);
  expect(paintConstructionFitting(model)).toEqual([]);
  owned.forEach(m => m.dispose()); material.dispose(); glass.dispose(); texture.dispose(); geometry.dispose();
});
