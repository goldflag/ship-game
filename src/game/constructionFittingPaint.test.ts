import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { paintConstructionFitting } from './constructionFittingPaint';
import { componentMaterial } from '../ships/componentMaterials';
import { createConstructionPathModel } from './constructionPathModel';
import catalog from '../../public/models/components/catalog.json';
import type { ConstructionEquipmentPart } from '../ships/blueprint';

test('ship sheen affects coatings only and preserves original paint and protected materials', () => {
  const geometry = new THREE.BoxGeometry(), model = new THREE.Group();
  const materials = (['naval', 'roof', 'wood', 'bronze', 'glass', 'canvas'] as const).map(name => {
    const spec = componentMaterial(name);
    const material = new THREE.MeshStandardMaterial({ color: '#123456', roughness: .9 });
    material.name = name; material.userData = spec.userData; return material;
  });
  const mesh = new THREE.Mesh(geometry, materials); model.add(mesh);
  const owned = paintConstructionFitting(model, undefined, true, 'semi-gloss');
  const finished = mesh.material as THREE.MeshStandardMaterial[];
  expect(owned).toHaveLength(2);
  for (let i = 0; i < 2; i++) {
    expect(finished[i].roughness).toBe(.34); expect(finished[i].metalness).toBe(0);
    expect(finished[i].color.equals(materials[i].color)).toBe(true);
    expect(materials[i].roughness).toBe(.9);
  }
  for (let i = 2; i < materials.length; i++) expect(finished[i]).toBe(materials[i]);
  owned.forEach(m => m.dispose()); materials.forEach(m => m.dispose()); geometry.dispose();
});

test('fitting coating isolates shared materials and retains glass, texture detail and joints', () => {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff' });
  material.userData = componentMaterial('naval').userData;
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

test('painting a mixed gun preserves mechanisms, opaque optics, cloth and roof finish across recolors', () => {
  const model = new THREE.Group();
  const roles = ['naval', 'roof', 'edge', 'dark', 'canvas', 'glass', 'wood', 'rope', 'bronze'] as const;
  const originals = roles.map(role => {
    const spec = componentMaterial(role);
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...spec.color as [number, number, number]), roughness: spec.roughness, metalness: spec.metallic });
    material.name = role; material.userData = spec.userData;
    return material;
  });
  const geometry = new THREE.BoxGeometry();
  const joint = new THREE.Group(); joint.name = 'component.barrel.elevation';
  joint.rotation.x = .7;
  joint.add(new THREE.Mesh(geometry, originals)); model.add(joint);
  const copy = model.clone(true), mesh = copy.children[0].children[0] as THREE.Mesh;
  const owned = paintConstructionFitting(copy, 'red-oxide');
  const painted = mesh.material as THREE.MeshStandardMaterial[];
  expect(owned).toHaveLength(2);
  expect(painted[0].color.getHexString()).toBe('80483c');
  expect(painted[1].roughness).toBe(componentMaterial('roof').roughness);
  for (let i = 2; i < originals.length; i++) expect(painted[i]).toBe(originals[i]);
  expect(originals[0].color.equals(painted[0].color)).toBe(false);
  paintConstructionFitting(copy, 'sea-blue', false);
  expect(painted[0].color.getHexString()).toBe('405d70');
  expect(copy.children[0].rotation.x).toBe(.7);
  expect(mesh.geometry).toBe(geometry);
  owned.forEach(m => m.dispose()); originals.forEach(m => m.dispose()); geometry.dispose();
});

test('retained catalogs use exact legacy names; unknown and explicitly protected materials stay untouched', () => {
  const model = new THREE.Group(), geometry = new THREE.BoxGeometry();
  const materials = ['naval', 'roof', 'hullgray', 'edge', 'dark', 'canvas', 'deck-fittings.glass', 'custom-naval', 'naval'].map(name => {
    const material = new THREE.MeshStandardMaterial({ color: '#123456', roughness: .91 }); material.name = name; return material;
  });
  materials.at(-1)!.userData = componentMaterial('canvas').userData;
  const mesh = new THREE.Mesh(geometry, materials); model.add(mesh);
  const owned = paintConstructionFitting(model, 'sea-blue');
  expect(owned).toHaveLength(3);
  const painted = mesh.material as THREE.MeshStandardMaterial[];
  for (let i = 0; i < 3; i++) { expect(painted[i].color.getHexString()).toBe('405d70'); expect(painted[i].roughness).toBe(.91); }
  for (let i = 3; i < materials.length; i++) expect(painted[i]).toBe(materials[i]);
  owned.forEach(m => m.dispose()); materials.forEach(m => m.dispose()); geometry.dispose();
});

test('procedural rope and chain retain their materials while railing follows component paint', () => {
  for (const kind of ['rope', 'chain', 'railing']) {
    const part = catalog.equipment.find(p => 'path' in p && p.path?.kind === kind)! as ConstructionEquipmentPart;
    const model = createConstructionPathModel(part);
    const material = (model.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const before = material.color.clone();
    paintConstructionFitting(model, 'red-oxide', false);
    expect(material.color.equals(before)).toBe(kind !== 'railing');
    model.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose(); }); material.dispose();
  }
});
