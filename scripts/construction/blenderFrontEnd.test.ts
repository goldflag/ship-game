import { expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ConstructionSource, Vec3 } from '../../src/ships/blueprint';
import { applyConstructionBatch } from '../../src/ships/constructionCommands';
import { createStarterSource } from '../../src/ships/constructionStarter';
import { parseConstructionCatalog } from '../../src/ships/constructionEquipment';
import { blenderVersion, runBlender } from '../build/blender';
import { blenderExport, blenderImport } from './blenderFrontEnd';
import { compileConstruction } from './compiler';
import { digest } from './files';

// The worked example of docs/construction-authoring.md#blender-front-end, end to end through real
// Blender and the native compiler. The source lives in memory; only `.build/` is written.
const root = resolve(import.meta.dir, '../..');
const scratch = join(root, '.build/construction-blender/blender-example-test');
const blender = blenderVersion();
const current = (source: ConstructionSource) => {
  const json = JSON.stringify(source, null, 2) + '\n';
  return { source, hash: digest(json) };
};

/** A starter hull, a deckhouse with a bridge on it, a 5-inch gun and a stores load. */
async function example(): Promise<ConstructionSource> {
  const catalog = parseConstructionCatalog(JSON.parse(await readFile(join(root, 'public/models/components/catalog.json'), 'utf8')));
  const source = createStarterSource(catalog, 'destroyer-hull');
  source.id = 'blender-example';
  const deck = 4.05;
  source.construction.primitives.push(
    { id: 'deckhouse', kind: 'box', size: [4, 2.4, 10], position: [0, deck + 1.2, 6], rotationDeg: 0 },
    { id: 'bridge', kind: 'vertex', size: [3, 1.6, 4], position: [0, deck + 3.2, 4], rotationDeg: 0 },
  );
  source.construction.equipment.push({ id: 'gun-a', partId: 'us-5in38-mk30-mod0-single', position: [0, 4.55, -25], bearingDeg: 0 });
  source.construction.loads.push({ id: 'stores', name: 'Stores', center: [0, deck - 2, 12], size: [2, 1, 3], massKg: 8000 });
  return source;
}

/** Edits a person would make in Blender, as Blender Python: move a block, duplicate one, add two, turn the gun. */
const EDIT = `
import bpy, math, os
bpy.ops.wm.open_mainfile(filepath=os.environ['CONSTRUCTION_BLEND'])
scene = bpy.context.scene
by_id = {o['constructionId']: o for o in scene.objects if o.get('constructionRole') in ('block', 'equipment', 'load')}
by_id['deckhouse'].location.x -= 1.0                 # 1 m aft (Blender +X is the bow)
copy = by_id['bridge'].copy()                       # a duplicate carries the bridge's properties
copy.data = by_id['bridge'].data.copy()
bpy.data.collections['Blocks'].objects.link(copy)
copy.location.x -= 5.0
def block(name, verts, faces, at, paint):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    bpy.data.collections['Blocks'].objects.link(obj)   # the collection gives it the block role
    obj.location = at
    obj.data.materials.append(bpy.data.materials[paint])
    return obj
box = [(x, y, z) for z in (-0.5, 0.5) for y in (-1, 1) for x in (-1, 1)]
block('Searchlight platform', box, [(0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)], (-20.0, -3.5, 4.55), 'dark-gray')
ring = [(math.cos(a * math.pi / 4), math.sin(a * math.pi / 4)) for a in range(8)]
octagon = [(x, y, z) for z in (-1.0, 1.0) for x, y in ring]
faces = [tuple(reversed(range(8))), tuple(range(8, 16))] + [(i, (i + 1) % 8, (i + 1) % 8 + 8, i + 8) for i in range(8)]
block('Ready locker', octagon, faces, (-20.0, 3.5, 5.05), 'naval-gray')
by_id['gun-a'].rotation_euler.z = math.radians(-30)  # bearing 30, clockwise from the bow
bpy.ops.wm.save_mainfile()
`;

test.skipIf(!blender)('Blender import, edit and export round-trip to a guarded batch with stable IDs', async () => {
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  const blend = join(scratch, 'scene.blend');
  const start = current(await example());
  expect((await compileConstruction(root, start.source)).definition).toBeDefined();

  const imported = await blenderImport(root, start, { out: blend });
  expect(imported.objects).toEqual({ reference: 1, block: 2, equipment: 1, load: 1 });
  expect(JSON.parse(await readFile(imported.scene, 'utf8')).imported.sort()).toEqual(['bridge', 'deckhouse', 'gun-a', 'stores']);

  // Exporting the untouched scene proposes nothing.
  const idle = await blenderExport(root, start, blend);
  expect(idle.report.failures).toEqual([]);
  expect(idle.batch).toBeUndefined();
  expect(idle.report.unchanged.sort()).toEqual(['bridge', 'deckhouse', 'gun-a', 'stores']);

  // A person edits the scene; meanwhile the editor nudges the bridge, which Blender does not touch.
  const script = join(scratch, 'edit.py');
  await writeFile(script, EDIT);
  await runBlender(script, { CONSTRUCTION_BLEND: blend });
  const edited = structuredClone(start.source);
  edited.revision = 'edited-in-the-editor';
  edited.construction.primitives.find((p) => p.id === 'bridge')!.position[0] = 0.25;
  const now = current(edited);

  const exported = await blenderExport(root, now, blend);
  expect(exported.report.failures).toEqual([]);
  expect(exported.report.moved).toEqual(['deckhouse']);
  expect(exported.report.added.map((a) => a.id).sort()).toEqual(['bridge-copy', 'ready-locker', 'searchlight-platform']);
  expect(exported.report.reassigned).toEqual([{ object: 'bridge.001', from: 'bridge', to: 'bridge-copy' }]);
  expect(Object.fromEntries(exported.report.reshaped.map((r) => [r.id, r.as]))).toEqual({
    'ready-locker': 'compound solid',
    'searchlight-platform': 'eight-corner block',
  });
  expect(exported.report.removed).toEqual([]);
  expect(exported.seating.map((s) => [s.id, s.status])).toEqual([['gun-a', expect.stringMatching(/seated|kept/)]]);
  expect(exported.candidate?.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(exported.candidate?.definition).toBeDefined();
  const batch = exported.batch!;
  expect(batch.expectedRevision).toBe('edited-in-the-editor');
  expect(batch.expectedFileHash).toBe(now.hash);

  const applied = applyConstructionBatch(now.source, batch);
  const piece = (id: string) => applied.construction.primitives.find((p) => p.id === id)!;
  const close = (a: readonly number[], b: readonly number[]) => a.forEach((n, k) => expect(n).toBeCloseTo(b[k], 6));
  close(piece('deckhouse').position, [0, 5.25, 7]);
  expect(piece('deckhouse').kind).toBe('box');
  close(piece('bridge').position, [0.25, 7.25, 4]); // the editor's edit survives
  close(piece('bridge-copy').position, [0, 7.25, 9]);
  expect(piece('bridge-copy').kind).toBe('vertex');
  close(piece('searchlight-platform').size, [2, 1, 2] as Vec3);
  close(piece('searchlight-platform').position, [3.5, 4.55, 20]);
  expect(piece('ready-locker').solid?.parts.length).toBeGreaterThan(0);
  expect(applied.construction.surfaces.filter((s) => s.primitiveId === 'searchlight-platform').every((s) => s.paint === 'dark-gray')).toBe(true);
  const gun = applied.construction.equipment.find((e) => e.id === 'gun-a')!;
  expect(gun.bearingDeg).toBeCloseTo(30, 6);
  close(gun.position, [0, 4.55, -25]);
  expect(applied.construction.loads).toEqual(now.source.construction.loads);
  expect((await compileConstruction(root, applied)).definition).toBeDefined();

  // A fresh import of the applied source exports to nothing: IDs and hashes do not churn.
  const again = current(applied);
  const second = join(scratch, 'second.blend');
  await blenderImport(root, again, { out: second });
  const repeat = await blenderExport(root, again, second);
  expect(repeat.report.failures).toEqual([]);
  expect(repeat.batch).toBeUndefined();
  await rm(scratch, { recursive: true, force: true });
}, 300_000);

test.skipIf(!!blender)('Blender front end example (skipped: no Blender; set BLENDER_BIN)', () => {});
