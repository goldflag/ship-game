import { describe, test, expect } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { publishImmutable, checkPublishedEquipment } from './publish';
import { readEquipment, inspectEquipmentModel } from './equipment';
const root=resolve(import.meta.dir,'../..');

describe('source-backed equipment publication',()=>{
  test('current production assets preserve source variants and authoritative joint transforms',async()=>{
    const catalog=await checkPublishedEquipment(root);
    expect(catalog.equipment.some(p=>p.kind==='torpedo-launcher')).toBe(true);
    expect(catalog.equipment.some(p=>p.kind==='engine')).toBe(true);
    for(const part of catalog.equipment.filter(p=>p.kind==='gun')) {
      expect(part.massKg).toBeUndefined();
      expect(catalog.weapons.parts.find(g=>g.id===part.gunPartId)).toBeDefined();
    }
  });
  test('immutable assets are idempotent and reject overwrite without damaging accepted bytes',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'equipment-publication-'));
    const target=join(dir,'revision');
    try {
      await publishImmutable(target,{'model.glb':new Uint8Array([1,2,3]),'manifest.json':'{}'});
      await publishImmutable(target,{'model.glb':new Uint8Array([1,2,3]),'manifest.json':'{}'});
      await expect(publishImmutable(target,{'model.glb':new Uint8Array([4,5,6]),'manifest.json':'{}'})).rejects.toThrow('Immutable publication conflict');
      expect([...await readFile(join(target,'model.glb'))]).toEqual([1,2,3]);
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  test('rejects a stale hash, lost socket and external runtime texture dependency',async()=>{
    const catalog=JSON.parse(await readFile(join(root,'public/models/components/catalog.json'),'utf8'));
    const p=catalog.equipment.find((p:any)=>p.kind==='torpedo-launcher');
    const bytes=await readFile(join(root,'public',p.modelUrl));
    expect(()=>inspectEquipmentModel(bytes,'f'.repeat(64),p)).toThrow('Stale');
    const end=20+bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,end).toString());
    const rewrite=(d:any)=>{
      const source=Buffer.from(JSON.stringify(d)),padding=Buffer.alloc((4-source.length%4)%4,32),text=Buffer.concat([source,padding]);
      const result=Buffer.concat([bytes.subarray(0,12),Buffer.alloc(8),text,bytes.subarray(end)]);
      result.writeUInt32LE(result.length,8);result.writeUInt32LE(text.length,12);result.writeUInt32LE(0x4e4f534a,16);return result;
    };
    const lost=structuredClone(doc);delete lost.nodes.find((n:any)=>n.extras?.nodeId==='component.tube-1.muzzle').extras.nodeId;
    expect(()=>inspectEquipmentModel(rewrite(lost),p.contentHash,p)).toThrow('Missing equipment joint/socket');
    doc.images=[{uri:'/api/texture/preview-only.png'}];
    expect(()=>inspectEquipmentModel(rewrite(doc),p.contentHash,p)).toThrow('embed all');
  });
  test('curation has original registrations and distinct internal installation space',async()=>{
    const {equipment}=await readEquipment(root);
    const gun=equipment.find(p=>p.id==='us-5in38-mk30-mod0-single')!;
    expect(gun.occupancy!.some(v=>v.center[1]<0)).toBe(true);
    expect(equipment.find(p=>p.kind==='magazine')!.placement).toBe('internal');
    expect(equipment.find(p=>p.kind==='funnel')!.powerKw).toBeUndefined();
  });
});
