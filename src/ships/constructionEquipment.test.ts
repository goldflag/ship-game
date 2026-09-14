import { test,expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { assetUrl } from '../assetUrl';
import { parseConstructionCatalog,loadConstructionCatalog,constructionEquipmentPart,constructionEquipmentModelUrl,prefixComponentNodeId } from './constructionEquipment';
const raw=JSON.parse(await readFile(new URL('../../public/models/components/catalog.json',import.meta.url),'utf8'));

test('production loader resolves current and exact retained catalogs through the configured base',async()=>{
  const calls:string[]=[];
  const request=(async(url:string|URL|Request)=>{calls.push(String(url));return Response.json(raw);});
  const current=await loadConstructionCatalog(undefined,request);
  const retained=await loadConstructionCatalog(raw.revision,request);
  expect(current).toEqual(retained);
  expect(calls).toEqual([assetUrl('models/components/catalog.json'),assetUrl(`models/components/catalogs/${raw.revision}/catalog.json`)]);
  const part=constructionEquipmentPart(current,'us-5in38-mk30-mod0-single');
  expect(constructionEquipmentModelUrl(part)).toBe(assetUrl(part.modelUrl));
  expect(()=>constructionEquipmentPart(current,part.id,'f'.repeat(64))).toThrow('unavailable');
});
test('missing revisions remain visible instead of substituting current equipment',async()=>{
  const request=(async()=>new Response('missing',{status:404}));
  await expect(loadConstructionCatalog(raw.revision,request)).rejects.toThrow('saved revision is missing');
  const wrong=(async()=>Response.json(raw));
  await expect(loadConstructionCatalog('f'.repeat(64),wrong)).rejects.toThrow('revision mismatch');
});
test('rejects viewer URLs, duplicate IDs and invented gun masses',()=>{
  const duplicate=structuredClone(raw);duplicate.equipment.push(duplicate.equipment[0]);
  expect(()=>parseConstructionCatalog(duplicate)).toThrow('Duplicate');
  const preview=structuredClone(raw);preview.equipment[0].modelUrl='/api/components/preview/model.glb';
  expect(()=>parseConstructionCatalog(preview)).toThrow('Invalid published asset');
  const mass=structuredClone(raw);mass.equipment[0].massKg=1;
  expect(()=>parseConstructionCatalog(mass)).toThrow('Missing canonical weapon');
});
test('stable instance prefixes preserve complete independent joint and cover identities',()=>{
  for(const suffix of ['yaw','center.elevation','center.recoil','center.muzzle','tube-5.muzzle','socket.exhaust-out']) {
    expect(prefixComponentNodeId('mount-1','component.'+suffix)).toBe('mount-1.'+suffix);
    expect(prefixComponentNodeId('mount-2','component.'+suffix)).not.toBe(prefixComponentNodeId('mount-1','component.'+suffix));
  }
  expect(()=>prefixComponentNodeId('mount-1','different.yaw')).toThrow('prefix');
});
