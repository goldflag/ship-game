import { expect, spyOn, test } from 'bun:test';
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as models from '../../game/loadShipModel';
import catalogJson from '../../../public/models/components/catalog.json';
import type { ConstructionCatalog } from '../../ships/blueprint';
import { createStarterSource } from '../../ships/constructionStarter';
import { EquipmentPreview } from './equipmentPreview';

const catalog = catalogJson as ConstructionCatalog;
function fixture() {
  const source = createStarterSource(catalog);
  source.construction.equipment = source.construction.equipment.filter(item => item.id === 'funnel');
  const part = catalog.equipment.find(part => part.id === source.construction.equipment[0].partId)!;
  const geometry = new THREE.CylinderGeometry(1, 1, 4), material = new THREE.MeshStandardMaterial();
  const model = new THREE.Group(); model.userData.definitionHash = part.contentHash;
  model.add(new THREE.Mesh(geometry, material));
  return { source, model, geometry };
}
const settled = async () => { await Promise.resolve(); await Promise.resolve(); };

test('equipment survives source edits and shares one loaded asset across installations and ghosts', async () => {
  const { source, model, geometry } = fixture();
  let current = source, disposed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  const loader = spyOn(models, 'loadShipModel').mockResolvedValue({ scene: model } as GLTF);
  const preview = new EquipmentPreview(() => preview.update(current, catalog), message => { if (message) throw new Error(message); });
  try {
    preview.update(current, catalog); await settled();
    const first = preview.group.children[0];
    expect(first).toBeDefined();
    current = structuredClone(source); current.revision = 'pending-hull-compile';
    current.construction.primitives[0].size[0] += 1;
    preview.update(current, catalog);
    expect(preview.group.children[0]).toBe(first); expect(disposed).toBe(0);
    current.construction.equipment.push({ ...current.construction.equipment[0], id: 'copy', position: [3, 4, 5] });
    preview.update(current, catalog);
    expect(preview.group.children).toHaveLength(2);
    expect(preview.group.children[1].position.toArray()).toEqual([3, 4, 5]);
    expect(preview.clone(source.construction.equipment[0].partId, true)).toBeDefined();
    expect(loader).toHaveBeenCalledTimes(1);
    current.construction.equipment.shift(); preview.update(current, catalog);
    expect(preview.group.children).toHaveLength(1); expect(disposed).toBe(0);
    preview.dispose(); expect(disposed).toBe(1);
  } finally { preview.dispose(); loader.mockRestore(); }
});

test('a model finishing after viewport disposal releases its resources and never attaches', async () => {
  const { source, model, geometry } = fixture();
  let finish!: (asset: GLTF) => void, disposed = 0, changed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  const loader = spyOn(models, 'loadShipModel').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const preview = new EquipmentPreview(() => changed++, () => {});
  try {
    preview.update(source, catalog); preview.dispose();
    finish({ scene: model } as GLTF); await settled();
    expect(preview.group.children).toHaveLength(0); expect(changed).toBe(0); expect(disposed).toBe(1);
  } finally { preview.dispose(); loader.mockRestore(); }
});

test('compiled propeller supports update independently and release obsolete geometry', () => {
  const { source } = fixture(); source.construction.equipment = [];
  const preview = new EquipmentPreview(() => {}, () => {});
  const support = { equipmentId: 'screw', members: [{ start: [0, -3, 5] as [number, number, number], end: [0, -3, 1] as [number, number, number], radiusM: .1, kind: 'shaft' as const }] };
  try {
    preview.update(source, catalog, [support]);
    const mesh = preview.group.getObjectByName('screw.support-0') as THREE.Mesh;
    expect(mesh.userData.sourceId).toBe('screw');
    expect(mesh.position.toArray()).toEqual([0, -3, 3]);
    let disposed = 0; mesh.geometry.addEventListener('dispose', () => disposed++);
    preview.update(source, catalog, [support]);
    expect(preview.group.getObjectByName(mesh.name)).toBe(mesh);
    preview.update(source, catalog);
    expect(disposed).toBe(1);
    expect(preview.group.getObjectByName(mesh.name)).toBeUndefined();
  } finally { preview.dispose(); }
});
