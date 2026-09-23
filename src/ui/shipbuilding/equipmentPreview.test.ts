import { expect, spyOn, test } from 'bun:test';
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as models from '../../game/loadShipModel';
import catalogJson from '../../../public/models/components/catalog.json';
import type { ConstructionCatalog } from '../../ships/blueprint';
import { createStarterSource } from '../../ships/constructionStarter';
import { EquipmentPreview } from './equipmentPreview';
import { componentMaterial } from '../../ships/componentMaterials';
import { roofShade } from '../../ships/constructionPaints';

const catalog = catalogJson as ConstructionCatalog;
function fixture() {
  const source = createStarterSource(catalog);
  source.construction.equipment = source.construction.equipment.filter(item => item.id === 'funnel');
  const part = catalog.equipment.find(part => part.id === source.construction.equipment[0].partId)!;
  const geometry = new THREE.CylinderGeometry(1, 1, 4), material = new THREE.MeshStandardMaterial();
  material.name = 'naval';
  material.userData = componentMaterial('naval').userData;
  const model = new THREE.Group(); model.userData.definitionHash = part.contentHash;
  model.add(new THREE.Mesh(geometry, material));
  return { source, model, geometry };
}
const settled = async () => { await Promise.resolve(); await Promise.resolve(); };
test('rope preview restores its natural color even when the removed override matches ship paint', () => {
  const source = createStarterSource(catalog);
  source.construction.paint = 'sea-blue';
  source.construction.equipment = [{ id: 'rope', partId: 'generic-rope', position: [0, 0, 0], bearingDeg: 0, path: { points: [[0, 0, 0], [0, 0, -4]] } }];
  const preview = new EquipmentPreview(() => {}, () => {});
  const color = () => {
    let result = '';
    preview.group.getObjectByName('rope')!.traverse(node => { if (node instanceof THREE.Mesh) result = (node.material as THREE.MeshStandardMaterial).color.getHexString(); });
    return result;
  };
  try {
    preview.update(source, catalog); const original = color();
    source.construction.equipment[0].paint = 'sea-blue'; preview.update(source, catalog);
    expect(color()).toBe('405d70'); expect(color()).not.toBe(original);
    delete source.construction.equipment[0].paint; preview.update(source, catalog);
    expect(color()).toBe(original);
  } finally { preview.dispose(); }
});

test('ship finish refreshes every fitting and restores original materials without reloading assets', async () => {
  const { source, model } = fixture();
  const original = (model.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  source.construction.equipment.push({ ...source.construction.equipment[0], id: 'copy', paint: 'sea-blue' });
  const loader = spyOn(models, 'loadShipModel').mockResolvedValue({ scene: model } as GLTF);
  const preview = new EquipmentPreview(() => preview.update(source, catalog), () => {});
  const material = (id: string) => (preview.group.getObjectByName(id)!.children[0].children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  try {
    preview.update(source, catalog); await settled();
    const blue = material('copy');
    source.construction.finish = 'semi-gloss'; preview.update(source, catalog);
    expect(material('funnel').roughness).toBe(.34);
    expect(material('copy').roughness).toBe(.34);
    expect(material('copy').color.equals(blue.color)).toBe(true);
    expect(original.roughness).toBe(1);
    delete source.construction.finish; preview.update(source, catalog);
    expect(material('funnel')).toBe(original);
    expect(material('copy')).toBe(blue);
    expect(loader).toHaveBeenCalledTimes(1);
  } finally { preview.dispose(); loader.mockRestore(); }
});

test('authored roofs take the ship roof colour, or their own paint shade, and follow a roof paint change', async () => {
  const { source, model } = fixture();
  const roof = new THREE.MeshStandardMaterial(); roof.name = 'roof'; roof.userData = componentMaterial('roof').userData;
  const mesh = model.children[0] as THREE.Mesh; mesh.material = [mesh.material as THREE.Material, roof];
  source.construction.paint = 'light-gray';
  source.construction.equipment.push({ ...source.construction.equipment[0], id: 'copy', paint: 'red-oxide' });
  const loader = spyOn(models, 'loadShipModel').mockResolvedValue({ scene: model } as GLTF);
  const preview = new EquipmentPreview(() => preview.update(source, catalog), () => {});
  const colors = (id: string) => ((preview.group.getObjectByName(id)!.children[0].children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial[])
    .map(material => '#' + material.color.getHexString());
  try {
    preview.update(source, catalog); await settled();
    expect(colors('funnel')).toEqual(['#b5bfbc', roofShade('#b5bfbc')]);
    expect(colors('copy')).toEqual(['#80483c', roofShade('#80483c')]);
    source.construction.roofPaint = 'deck-gray'; preview.update(source, catalog);
    expect(colors('funnel')).toEqual(['#b5bfbc', '#64716f']);
    expect(colors('copy')).toEqual(['#80483c', roofShade('#80483c')]);
    expect(loader).toHaveBeenCalledTimes(1);
  } finally { preview.dispose(); loader.mockRestore(); }
});

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

test('invalid tint is isolated per installation and restores when the part becomes valid', async () => {
  const { source, model } = fixture();
  source.construction.equipment.push({ ...source.construction.equipment[0], id: 'copy' });
  const invalid = new Set(['funnel']);
  const loader = spyOn(models, 'loadShipModel').mockResolvedValue({ scene: model } as GLTF);
  const preview = new EquipmentPreview(() => preview.update(source, catalog, undefined, invalid), () => {});
  const material = (id: string) => (preview.group.getObjectByName(id)!.children[0].children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  try {
    preview.update(source, catalog, undefined, invalid); await settled();
    const normal = material('copy'), red = material('funnel');
    expect(red.color.getHexString()).toBe('ffb5a6');
    expect(normal.color.getHexString()).toBe('ffffff');
    expect(red).not.toBe(normal);
    let disposed = 0; red.addEventListener('dispose', () => disposed++);
    invalid.clear(); preview.update(source, catalog, undefined, invalid);
    expect(material('funnel')).toBe(normal);
    expect(loader).toHaveBeenCalledTimes(1);
    preview.dispose(); expect(disposed).toBe(1);
  } finally { preview.dispose(); loader.mockRestore(); }
});

test('painted installations keep colors independent, refresh after undo and dispose only their own materials', async () => {
  const { source, model, geometry } = fixture();
  source.construction.equipment.push({ ...source.construction.equipment[0], id: 'copy' });
  source.construction.equipment[0].paint = 'sea-blue';
  const loader = spyOn(models, 'loadShipModel').mockResolvedValue({ scene: model } as GLTF);
  const preview = new EquipmentPreview(() => preview.update(source, catalog), () => {});
  const material = (id: string) => (preview.group.getObjectByName(id)!.children[0].children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
  try {
    preview.update(source, catalog); await settled();
    const blue = material('funnel'), original = material('copy');
    expect(blue.color.getHexString()).toBe('405d70'); expect(original.color.getHexString()).toBe('ffffff');
    let disposed = 0, geometryDisposed = 0;
    blue.addEventListener('dispose', () => disposed++); geometry.addEventListener('dispose', () => geometryDisposed++);
    delete source.construction.equipment[0].paint; preview.update(source, catalog);
    expect(material('funnel')).toBe(original); expect(geometryDisposed).toBe(0);
    source.construction.equipment[0].paint = 'sea-blue'; preview.update(source, catalog);
    expect(material('funnel')).toBe(blue); expect(loader).toHaveBeenCalledTimes(1);
    preview.dispose(); expect(disposed).toBe(1); expect(geometryDisposed).toBe(1);
  } finally { preview.dispose(); loader.mockRestore(); }
});

test('inspection fades exterior fittings without changing shared assets or placement ghosts', async () => {
  const { source, model } = fixture();
  const loader = spyOn(models, 'loadShipModel').mockResolvedValue({ scene: model } as GLTF);
  const preview = new EquipmentPreview(() => preview.update(source, catalog), () => {});
  const material = () => (preview.group.getObjectByName('funnel')!.children[0].children[0] as THREE.Mesh).material as THREE.Material;
  try {
    preview.update(source, catalog); await settled();
    const original = material();
    for (const display of ['internals', 'armor'] as const) {
      preview.setDisplay(display, source, catalog);
      expect(material().opacity).toBe(.12); expect(material().depthWrite).toBe(false);
      expect(original.opacity).toBe(1);
      preview.setDisplay('paint', source, catalog);
      expect(material()).toBe(original);
    }
    const internalCatalog = { ...catalog, equipment: catalog.equipment.map(part => ({ ...part, placement: 'internal' as const })) };
    preview.setDisplay('internals', source, internalCatalog);
    expect(material()).toBe(original);
    preview.setDisplay('armor', source, internalCatalog);
    expect(material().opacity).toBe(.12);
  } finally { preview.dispose(); loader.mockRestore(); }
});
