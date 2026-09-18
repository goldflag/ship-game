import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionEquipment, ConstructionResult, ConstructionSource } from './blueprint';
import { createStarterSource } from './constructionStarter';
import { fittedLadder } from './constructionLadders';
import { pathEquipment } from '../ui/shipbuilding/pathDrawing';
import { mirroredEquipment, decodeConstructionSource } from './constructionEditor';
import { applyConstructionBatch } from './constructionCommands';
import { paletteFor } from '../ui/shipbuilding/builderLayers';

const catalog=catalogJson as ConstructionCatalog;
beforeAll(async()=>{await init({module_or_path:await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm',import.meta.url)).arrayBuffer()});});
const compile=(s:ConstructionSource):ConstructionResult=>JSON.parse(compile_construction(JSON.stringify(s),JSON.stringify(catalog)));
function fixture(){const s=createStarterSource(catalog,'blank');s.construction.primitives[0].size=[8,8,20];return s;}
const ladder=()=>pathEquipment('ladder','generic-surface-ladder',[[4,-1,0],[4,2,0]],0,90);

test('service hardware mounts to walls, adds only loading mass and rejects detached placement',()=>{
  const before=compile(fixture());
  const hardware=catalog.equipment.filter(p=>p.wallMount==='hardware');
  expect(hardware.length).toBeGreaterThan(0);
  for(const p of hardware){
    const s=fixture();
    s.construction.equipment.push({id:'service-fitting',partId:p.id,position:[4,0,0],bearingDeg:90,
      wall:{version:1,widthM:p.size[0],heightM:p.size[1]}});
    const mounted=compile(s);
    expect(mounted.definition,p.id+JSON.stringify(mounted.diagnostics)).toBeDefined();
    expect(mounted.surfaces).toEqual(before.surfaces);
    expect(mounted.loading!.usableVolumeM3).toEqual(before.loading!.usableVolumeM3);
    expect(mounted.loading!.massKg-before.loading!.massKg).toBeCloseTo(p.massKg!,5);
    expect(mounted.definition!.modules).toEqual(before.definition!.modules);
    s.construction.equipment[0].position[0]+=.2;
    const detached=compile(s);
    expect(detached.definition,p.id).toBeUndefined();
    expect(detached.diagnostics.some(d=>d.code==='wall-fitting'),p.id).toBe(true);
  }
});

test('a resized hardware pair retains its mirrored wall relationship and scaled loading',()=>{
  const s=fixture(),p=catalog.equipment.find(p=>p.id==='generic-wall-cabinet')!;
  const before=compile(s);
  const right:ConstructionEquipment={id:'right',partId:p.id,position:[4,0,0],bearingDeg:90,
    wall:{version:1,widthM:p.size[0]*1.4,heightM:p.size[1]*.8,mirrorId:'left'}};
  const left={...mirroredEquipment(right),id:'left',wall:{...right.wall!,mirrorId:'right'}};
  s.construction.equipment.push(right,left);
  const resized=compile(s);
  expect(resized.definition,JSON.stringify(resized.diagnostics)).toBeDefined();
  expect(resized.loading!.massKg-before.loading!.massKg).toBeCloseTo(p.massKg!*1.4*.8*2,5);
  expect(decodeConstructionSource(JSON.parse(JSON.stringify(s)))).toEqual(JSON.parse(JSON.stringify(s)));
  left.wall.widthM+=.1;
  expect(compile(s).diagnostics.some(d=>d.code==='wall-fitting')).toBe(true);
});

test('all door variants and both wall vents compile with unchanged hull rooms',()=>{
  const before=compile(fixture());
  for(const id of ['generic-utility-door','generic-watertight-door','generic-windowed-door','generic-louvered-vent','generic-round-wall-vent']){
    const s=fixture(),p=catalog.equipment.find(p=>p.id===id)!;
    s.construction.equipment.push({id:'fitting',partId:id,position:[4,-1,0],bearingDeg:90,wall:{version:1,widthM:p.size[0],heightM:p.size[1]}});
    const r=compile(s);expect(r.definition,JSON.stringify(r.diagnostics)).toBeDefined();expect(r.surfaces).toEqual(before.surfaces);expect(r.loading!.usableVolumeM3).toEqual(before.loading!.usableVolumeM3);
  }
});
test('rungs have two wall attachments and native mass follows their actual rod length',()=>{
  const s=fixture(),e=ladder(),part=catalog.equipment.find(p=>p.id===e.partId)!;
  const plain=compile(s),layout=fittedLadder(part,e,plain.surfaces)!;
  expect(layout.anchors.length).toBe(22);expect(layout.members.length).toBe(33);
  expect(layout.anchors.every(p=>Math.abs(p[2])<1e-6)).toBe(true);
  s.construction.equipment.push(e,{...mirroredEquipment(e),id:'mirror'});
  const r=compile(s);expect(r.definition,JSON.stringify(r.diagnostics)).toBeDefined();
  const rods=layout.members.reduce((sum,[a,b])=>sum+Math.hypot(...a.map((v,k)=>v-b[k])),0);
  expect(r.loading!.massKg-plain.loading!.massKg).toBeCloseTo(2*(part.massKg!+rods*part.path!.massKgPerM),4);
  const moved=applyConstructionBatch(s,{version:1,expectedRevision:s.revision,label:'Move ladder',commands:[{op:'move',ids:['ladder'],delta:[0,.25,0]}]});
  expect(compile(moved).definition).toBeDefined();expect(decodeConstructionSource(JSON.parse(JSON.stringify(moved)))).toEqual(JSON.parse(JSON.stringify(moved)));
});
test('ladders reject missing support and paths aimed into the wall',()=>{
  for(const e of [{...ladder(),position:[4,3,0]},pathEquipment('ladder','generic-surface-ladder',[[4,0,0],[5,0,0]],0,90)] as ConstructionEquipment[]){
    const s=fixture();s.construction.equipment.push(e);const r=compile(s);expect(r.definition).toBeUndefined();expect(r.diagnostics.some(d=>d.code==='equipment-path')).toBe(true);
  }
});
test('the fitting shelf offers the drawn ladder instead of the old fixed ladder',()=>{
  const slots=paletteFor('fittings',catalog,[]).drawer;
  expect(slots.some(p=>p.id==='generic-surface-ladder')).toBe(true);expect(slots.some(p=>p.id==='generic-vertical-ladder')).toBe(false);
});

test('published door and vent originals preserve a separate relief assembly',async()=>{
  for(const id of ['generic-utility-door','generic-watertight-door','generic-windowed-door','generic-louvered-vent','generic-round-wall-vent',
    ...catalog.equipment.filter(p=>p.wallMount==='hardware').map(p=>p.id)]) {
    const part=catalog.equipment.find(p=>p.id===id)!;
    const bytes=await Bun.file('public'+part.modelUrl).arrayBuffer(),size=new DataView(bytes).getUint32(12,true);
    const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,size)));
    expect(gltf.nodes.some((n:{extras?:{wallRelief?:boolean}})=>n.extras?.wallRelief),id).toBe(true);
  }
});
