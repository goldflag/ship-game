import { describe, test, expect } from 'bun:test';
import { resolve, join, dirname } from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { componentHash, componentItems, installationsFor, readLibrary, recipeInputs, validateLibrary } from './library';
import { shipPresets } from '../../src/ships/presets';
import type { ShipDefinition } from '../../src/ships/blueprint';
const root = resolve(import.meta.dir, '../..');
const { library, catalog } = await readLibrary(root);

describe('original component library', () => {
  test('non-gun equipment is discoverable with its real family and no fabricated weapon', async () => {
    const items = await componentItems(root, []);
    const director = items.find(p => p.partId === 'fletcher-mk37-director')!;
    const rope = items.find(p => p.partId === 'generic-rope')!;
    expect(director.equipment?.kind).toBe('director');
    expect(director.weapon).toBeUndefined();
    expect(rope.equipment?.path?.kind).toBe('rope');
    expect(rope.family).toBe('rope');
    expect(rope.weapon).toBeUndefined();
    expect(new Set(items.map(p => p.partId)).size).toBe(items.length);
  });
  test('every catalog part has explicit metadata and only real usage is listed', () => {
    expect(() => validateLibrary(library, catalog)).not.toThrow();
    const usages = installationsFor('oerlikon-20mm-single', Object.values(shipPresets) as unknown as ShipDefinition[]);
    expect(usages.some(i => i.shipId === 'enterprise-cv6')).toBe(true);
    expect(usages.some(i => i.shipId === 'iowa')).toBe(false); // distinct accepted source variant
  });
  test('rejects ambiguous identities and non-original builder paths', () => {
    const duplicate = structuredClone(library); duplicate.components.push(duplicate.components[0]);
    expect(() => validateLibrary(duplicate, catalog)).toThrow('Duplicate');
    const bad = structuredClone(library); bad.builders['ijn-aa'].path = '.build/reference.py';
    expect(() => validateLibrary(bad, catalog)).toThrow('Invalid original');
    bad.builders['ijn-aa'].path = 'assets/parts/../../reference.py';
    expect(() => validateLibrary(bad, catalog)).toThrow('Invalid original');
  });
  test('component hashes track their definition and builder, not unrelated variants', async () => {
    const entry = library.components.find(e => e.partId === 'type96-25-triple')!;
    const part = catalog.parts.find(p => p.id === entry.partId)!;
    const hash = await componentHash(root, library, entry, part);
    expect(await componentHash(root, library, entry, { ...part, muzzleForward: part.muzzleForward + .1 })).not.toBe(hash);
    const other = structuredClone(library); other.components[0].limitations += ' Different review.';
    expect(await componentHash(root, other, entry, part)).toBe(hash);
    expect(recipeInputs(library, entry)).toContain('assets/parts/ijn-carrier-guns/geometry.py');
    expect(recipeInputs(library, entry).every(p => p.startsWith('assets/'))).toBe(true);
  });
});


test('component export helpers invalidate previews and missing dependencies fail closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'component-dependencies-'));
  const entry = library.components.find(e => e.partId === 'type96-25-triple')!;
  const part = catalog.parts.find(p => p.id === entry.partId)!;
  const builder = library.builders[entry.builder!];
  const helper = 'scripts/ships/blender_batching.py';
  try {
    for (const path of ['assets/parts/library.py', builder.path, ...builder.inputs, 'scripts/parts/build.py', 'scripts/ships/export.py', helper]) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), await readFile(join(root, path)));
    }
    const before = await componentHash(directory, library, entry, part);
    await writeFile(join(directory, helper), 'changed batching dependency');
    expect(await componentHash(directory, library, entry, part)).not.toBe(before);
    await rm(join(directory, helper));
    await expect(componentHash(directory, library, entry, part)).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
