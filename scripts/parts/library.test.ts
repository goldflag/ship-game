import { describe, test, expect } from 'bun:test';
import { resolve } from 'node:path';
import { componentHash, installationsFor, readLibrary, recipeInputs, validateLibrary } from './library';
import { shipPresets } from '../../src/ships/presets';
import type { ShipDefinition } from '../../src/ships/blueprint';
const root = resolve(import.meta.dir, '../..');
const { library, catalog } = await readLibrary(root);

describe('original component library', () => {
  test('every catalog part has explicit metadata and only real usage is listed', () => {
    expect(() => validateLibrary(library, catalog)).not.toThrow();
    const usages = installationsFor('oerlikon-20mm-single', Object.values(shipPresets) as unknown as ShipDefinition[]);
    expect(usages.some(i => i.shipId === 'enterprise-cv6')).toBe(true);
    expect(usages.some(i => i.shipId === 'iowa')).toBe(false); // distinct accepted source variant
    expect(usages.some(i => i.shipId === 'liberty-troopship')).toBe(false); // retired preset
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
