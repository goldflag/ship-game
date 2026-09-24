import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspectEquipmentModel } from './equipment';
import type { ConstructionEquipmentPart, GunPart } from '../../src/ships/blueprint';
import baseline from '../../tools/ship-overlay/component-before.json';
import catalog from '../../public/models/components/catalog.json';

const root = resolve(import.meta.dir, '../..');
// Guns rebuilt to their GameModels3D visuals outgrow the retained baseline; the
// rebuilt assembly is their ceiling while the overlay still compares the baseline.
const rebuilt: Record<string, number> = { 'type94-460-triple': 7095 };
async function inspect(url: string) {
  const bytes = await readFile(resolve(root, 'public', url.slice(1)));
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return inspectEquipmentModel(bytes, doc.scenes[doc.scene ?? 0].extras.definitionHash);
}
for (const gun of catalog.weapons.parts.filter(gun => gun.caliberM >= .3048)) {
  const part = catalog.equipment.find(part => 'gunPartId' in part && part.gunPartId === gun.id);
  if (!part) continue;
  test(`${gun.id}: complete published geometry stays within its merged baseline and retains the rig`, async () => {
    const before = baseline[gun.id as keyof typeof baseline];
    expect(before).toBeDefined();
    const [oldModel, model] = await Promise.all([inspect(before.modelUrl), inspect(part.modelUrl)]);
    // The inspection visits every mesh instance and primitive, including covers
    // and fittings. Morph targets do not multiply a surface's triangle count.
    expect(oldModel.triangles).toBe(before.triangles);
    expect(model.triangles).toBeLessThanOrEqual(rebuilt[gun.id] ?? before.triangles);
    const rig = (nodes: typeof model.nodes) => nodes.filter(node => /\.(yaw|elevation|recoil|muzzle)$/.test(node.id));
    if (!(gun.id in rebuilt)) return expect(rig(model.nodes)).toEqual(rig(oldModel.nodes));
    // A rebuild moves the datums to the reference: the joints and hierarchy stay, posed against the catalog.
    const joints = (nodes: typeof model.nodes) => rig(nodes).map(({ id, parentId }) => ({ id, parentId }));
    expect(joints(model.nodes)).toEqual(joints(oldModel.nodes));
    const bytes = await readFile(resolve(root, 'public', part.modelUrl.slice(1)));
    expect(() => inspectEquipmentModel(bytes, part.contentHash, part as unknown as ConstructionEquipmentPart, gun as unknown as GunPart)).not.toThrow();
  });
}

// Legacy ship recipes must actually consume the reusable guns: a successful
// rebuild alone can still export an obsolete bespoke turret with open ports.
for (const id of ['bismarck', 'yamato', 'iowa', 'king-george-v']) {
  test(`${id}: installed capital guns retain the shared articulated closed covers`, async () => {
    const definition = JSON.parse(await readFile(resolve(root, `public/models/${id}.json`), 'utf8'));
    const bytes = await readFile(resolve(root, `public/models/${id}.glb`));
    const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    for (const mount of definition.mounts.filter((m: { weapon: { caliberM: number } }) => m.weapon.caliberM >= .3048)) {
      const covers = doc.nodes.filter((node: { extras?: { gunCoverElevationId?: string } }) =>
        node.extras?.gunCoverElevationId?.startsWith(mount.id + '.'));
      expect(covers).toHaveLength(mount.weapon.barrelCount);
      for (const cover of covers) {
        expect(Number.isFinite(cover.extras.gunCoverBaseAngle)).toBe(true);
        expect(cover.extras.gunCoverFixedVertexCount).toBeGreaterThanOrEqual(20);
        expect(doc.meshes[cover.mesh].primitives.every((p: { targets?: unknown[] }) => (p.targets?.length ?? 0) > 0)).toBe(true);
      }
    }
  });
}

test('Yamato exposes the shallow bearing as its adjustable-barbette attachment', async () => {
  const part = catalog.equipment.find(p => p.id === 'type94-460-triple')!;
  const attachment = part.sockets?.find(s => s.id === 'attachment')!;
  expect(attachment.position).toEqual([0, 2.15, 0]);
  const model = await inspect(part.modelUrl);
  // A fixed column below this plane would duplicate the player-authored support.
  expect(model.boundsCenter[1] - model.size[1] / 2).toBeCloseTo(attachment.position[1], 4);
});
