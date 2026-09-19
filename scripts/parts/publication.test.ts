import { describe, test, expect } from 'bun:test';
import { mkdtemp, readFile, rm, mkdir, cp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { publishImmutable, checkPublishedEquipment, publishEquipment } from './publish';
import { readEquipment, inspectEquipmentModel } from './equipment';
const root=resolve(import.meta.dir,'../..');

describe('source-backed equipment publication',()=>{
  test('curated Oerlikon has a fixed original magazine that holds its canonical initial stock',async()=>{
    const {equipment,catalog}=await readEquipment(root);
    const gun=catalog.parts.find(p=>p.id==='us-20mm-oerlikon-mk4-hsienyang')!;
    const small=equipment.find(p=>p.id==='generic-magazine-1000')!;
    const long=equipment.find(p=>p.id==='generic-magazine-2000')!;
    const stock=gun.ammoPerBarrel*(gun.barrelCount??2);
    expect(small.ammunitionCapacity!).toBeLessThan(stock);
    expect(long.ammunitionCapacity!).toBeGreaterThanOrEqual(stock);
    expect(long.size).toEqual([3,2.5,8]);
    expect(long.massKg).toBe(3600);
    expect(small.size).toEqual([3,2.5,4]);
  });
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
  test('changing the curated selection preserves other assets and exact older catalogs',async()=>{
    const temp=await mkdtemp(join(tmpdir(),'equipment-catalog-'));
    try {
      for(const dir of ['assets/parts','assets/ships/appearance','scripts/parts','scripts/ships']) {
        await mkdir(resolve(temp,dir,'..'),{recursive:true});
        await cp(join(root,dir),join(temp,dir),{recursive:true});
      }
      const source=JSON.parse(await readFile(join(temp,'assets/parts/construction.json'),'utf8'));
      const fixture=JSON.parse(await readFile(join(root,'public/models/components/catalog.json'),'utf8'));
      for(const p of source.equipment) {
        const path=join('.build/parts',p.gunPartId ?? p.id,'model.glb');
        await mkdir(resolve(temp,path,'..'),{recursive:true});
        // Validated standalone publication is a test output-cache fixture, never authoring geometry.
        const asset=fixture.equipment.find((e:{id:string})=>e.id===p.id).modelUrl;
        await cp(join(root,'public',asset),join(temp,path));
      }
      const first=await publishEquipment(temp);
      source.equipment.pop();
      await writeFile(join(temp,'assets/parts/construction.json'),JSON.stringify(source));
      const second=await publishEquipment(temp);
      expect(second.revision).not.toBe(first.revision);
      for(const p of second.equipment) expect(p.modelUrl).toBe(first.equipment.find(e=>e.id===p.id)!.modelUrl);
      const retained=await readFile(join(temp,'public/models/components/catalogs',first.revision,'catalog.json'),'utf8');
      // Retention promises exact JSON bytes; JSON canonicalizes negative zero.
      expect(retained).toBe(JSON.stringify(first,null,2)+'\n');
    } finally {await rm(temp,{recursive:true,force:true});}
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
  test('fixed-equipment support sockets coincide with actual sole, stock and shaft bounds without hidden overlap',async()=>{
    const c=JSON.parse(await readFile(join(root,'public/models/components/catalog.json'),'utf8'));
    // Procedural paths anchor their centerline; their preview radius is not a sole.
    for(const p of c.equipment.filter((part:any)=>!part.path)) {
      const s=p.sockets.find((s:any)=>s.id==='attachment');
      const axis=s.direction.findIndex((n:number)=>Math.abs(n)===1);
      expect(axis).toBeGreaterThanOrEqual(0);
      if (s.kind === 'stock-bearing') {
        // An inserted stock attaches at its hull-exit bearing, not its hidden top.
        expect(p.kind).toBe('rudder');
        expect(s.position.every((v:number,k:number)=>Math.abs(v-p.boundsCenter[k])<=p.size[k]/2)).toBe(true);
        continue;
      }
      const authoredPlane=p.boundsCenter[axis]+s.direction[axis]*p.size[axis]/2;
      expect(Math.abs(authoredPlane-s.position[axis])).toBeLessThan(.002);
      const model=inspectEquipmentModel(await readFile(join(root,'public',p.modelUrl)),p.contentHash);
      const actualPlane=model.boundsCenter[axis]+s.direction[axis]*model.size[axis]/2;
      expect(Math.abs(actualPlane-s.position[axis])).toBeLessThan(.002);
    }
  });
  test('sparse fitting boxes must enclose every triangle of their original visible model',async()=>{
    const catalog=JSON.parse(await readFile(join(root,'public/models/components/catalog.json'),'utf8'));
    const part=catalog.equipment.find((p:any)=>p.fitting);
    const bytes=await readFile(join(root,'public',part.modelUrl));
    expect(()=>inspectEquipmentModel(bytes,part.contentHash,part)).not.toThrow();
    const missing=structuredClone(part);missing.fitting=[{center:[0,0,0],size:[.01,.01,.01]}];
    expect(()=>inspectEquipmentModel(bytes,part.contentHash,missing)).toThrow('do not enclose every visible triangle');
  });
  test('curation has original registrations and distinct internal installation space',async()=>{
    const {equipment}=await readEquipment(root);
    const gun=equipment.find(p=>p.id==='us-5in38-mk30-mod0-single')!;
    expect(gun.occupancy!.some(v=>v.center[1]<0)).toBe(true);
    expect(equipment.find(p=>p.kind==='magazine')!.placement).toBe('internal');
    expect(equipment.find(p=>p.kind==='funnel')!.powerKw).toBeUndefined();
  });
});
