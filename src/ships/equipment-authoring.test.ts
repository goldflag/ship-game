import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { expect, test } from 'bun:test';
import { authorLocalDamage, mergeEquipmentDamage, writeLocalDamage } from '../../assets/ships/author-local-damage';
import kgv from '../../assets/ships/king-george-v/blueprint.json';
import type { ShipBlueprint } from './blueprint';

test('local damage reruns preserve authored directors and generators without recreating proxies', () => {
  const original = structuredClone(kgv) as unknown as ShipBlueprint;
  const director = original.modules.find(m => m.kind === 'fire-control')!;
  director.id = 'authored-director';
  const generator = original.modules.find(m => m.kind === 'generator')!;
  generator.id = 'authored-generator';
  original.modules = original.modules.filter(m => !['fire-control', 'generator'].includes(m.kind) || m === director || m === generator);
  const before = JSON.stringify(original);
  const first = authorLocalDamage(original), second = authorLocalDamage(first);
  expect(second).toEqual(first);
  expect(first.modules.filter(m => m.kind === 'fire-control')).toEqual([director]);
  expect(first.modules.filter(m => m.kind === 'generator')).toEqual([generator]);
  expect(JSON.stringify(original)).toBe(before);
});

test('legacy support equipment survives repeated authoring with stable IDs', () => {
  const legacy = structuredClone(kgv) as unknown as ShipBlueprint;
  legacy.modules = legacy.modules.filter(m => m.kind !== 'fire-control');
  const first = authorLocalDamage(legacy);
  expect(authorLocalDamage(first)).toEqual(first);
  expect(first.modules.filter(m => m.id.startsWith('support-')).map(m => m.id)).toEqual(['support-generator-1', 'support-generator-2', 'support-director']);
});

test('equipment rollout preserves omitted legacy gun budgets and room fire calibration', () => {
  const b = structuredClone(kgv) as unknown as ShipBlueprint;
  const previous = new Set(b.mounts.map(m => m.id));
  b.localDamage!.regions = b.localDamage!.regions.filter(r => !r.mountId);
  const regions = structuredClone(b.localDamage!.regions), rooms = structuredClone(b.compartments);
  b.mounts.push({ ...b.mounts[0], id: 'new-gun' });
  b.modules.push({ id: 'new-launcher', name: 'Launcher', kind: 'launcher', placement: 'fixed', center: [0, 10, 0], size: [1, 1, 1], hp: 50 });
  mergeEquipmentDamage(b, previous);
  expect(b.localDamage!.regions.slice(0, regions.length)).toEqual(regions);
  expect(b.localDamage!.regions.filter(r => r.mountId).map(r => r.mountId)).toEqual(['new-gun']);
  expect(b.localDamage!.regions.filter(r => r.moduleId).map(r => r.moduleId)).toEqual(['new-launcher']);
  expect(b.compartments).toEqual(rooms);
  const first = structuredClone(b);
  mergeEquipmentDamage(b, new Set(b.mounts.map(m => m.id)));
  expect(b).toEqual(first);
});


test('scoped regeneration leaves unrelated ship files byte-identical and failed batches write nothing', async () => {
  const root=await mkdtemp(`${tmpdir()}/equipment-authoring-`), base=pathToFileURL(root+'/');
  try {
    for(const id of ['king-george-v','unrelated']) {await mkdir(new URL(id+'/',base));await writeFile(new URL(id+'/blueprint.json',base),JSON.stringify(kgv));}
    const catalogUrl=new URL('../../assets/parts/guns.json',import.meta.url), untouched=await readFile(new URL('unrelated/blueprint.json',base),'utf8');
    await writeLocalDamage(['king-george-v'],base,catalogUrl);
    expect(await readFile(new URL('unrelated/blueprint.json',base),'utf8')).toBe(untouched);
    const first=await readFile(new URL('king-george-v/blueprint.json',base),'utf8');
    await writeLocalDamage(['king-george-v'],base,catalogUrl);
    expect(await readFile(new URL('king-george-v/blueprint.json',base),'utf8')).toBe(first);
    await expect(writeLocalDamage(['king-george-v','missing'],base,catalogUrl)).rejects.toThrow();
    expect(await readFile(new URL('king-george-v/blueprint.json',base),'utf8')).toBe(first);
  } finally {await rm(root,{recursive:true,force:true});}
});
