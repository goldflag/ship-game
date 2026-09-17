import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { paintConstructionFitting } from '../../src/game/constructionFittingPaint';
import { followsComponentPaint, validateComponentMaterials } from '../../src/ships/componentMaterials';

test('published mixed-material fittings retain fixed surfaces after GLTF loading and painting', async () => {
  const root = resolve(import.meta.dir, '../..');
  const catalog = JSON.parse(await readFile(join(root, 'public/models/components/catalog.json'), 'utf8'));
  const loader = new GLTFLoader();
  for (const id of ['us-5in38-mk30-mod0-single', 'us-20mm-oerlikon-mk24-hsienyang', 'generic-lifeboat-davits', 'fletcher-propeller-starboard']) {
    const part = catalog.equipment.find((p: { id: string }) => p.id === id);
    const bytes = await readFile(join(root, 'public', part.modelUrl));
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    validateComponentMaterials(json.materials);
    const { scene } = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const materials = new Set<THREE.MeshStandardMaterial>();
    scene.traverse(node => { if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material); });
    const before = [...materials].map(material => ({ material, color: material.color.clone(), roughness: material.roughness, metalness: material.metalness, paint: followsComponentPaint(material.name, material.userData) }));
    expect(before.some(m => !m.paint)).toBe(true);
    paintConstructionFitting(scene, 'red-oxide', false);
    for (const original of before) {
      expect(original.material.color.getHexString()).toBe(original.paint ? '80483c' : original.color.getHexString());
      expect(original.material.roughness).toBe(original.roughness);
      expect(original.material.metalness).toBe(original.metalness);
    }
    scene.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
    materials.forEach(material => material.dispose());
  }
});
