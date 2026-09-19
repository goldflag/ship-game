import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionResult, ConstructionSource } from './blueprint';
import { defaults, playgroundSource } from '../ui/shipbuilding/ladder-playground/source';
import { accessLayout } from '../../assets/parts/construction/access_geometry';
import { mirroredEquipment, decodeConstructionSource } from './constructionEditor';
import { createConstructionPathModel } from '../game/constructionPathModel';
import { equipmentPathBounds } from './constructionPaths';
import { Box3, Vector3 } from 'three';

const catalog = catalogJson as ConstructionCatalog;
beforeAll(async()=>{await init({module_or_path:await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm',import.meta.url)).arrayBuffer()});});
const compile=(s:ConstructionSource):ConstructionResult=>JSON.parse(compile_construction(JSON.stringify(s),JSON.stringify(catalog)));
const accepted=(s:ConstructionSource)=>{const r=compile(s);expect(r.definition,JSON.stringify(r.diagnostics)).toBeDefined();return r;};

test('adjustable stairs and framed ladders compile together with supported attachments and loading only',()=>{
  const s=playgroundSource(catalog,defaults()), fitted=accepted(s);
  s.construction.equipment=[];const bare=accepted(s);
  expect(fitted.loading!.massKg).toBeGreaterThan(bare.loading!.massKg);
  expect(fitted.loading!.envelopeVolumeM3).toEqual(bare.loading!.envelopeVolumeM3);
  expect(fitted.surfaces).toEqual(bare.surfaces);
  expect(fitted.definition!.modules).toEqual(bare.definition!.modules);
});

test('stair settings persist and wider treads add physical mass without changing buoyancy',()=>{
  const settings=defaults('stairs'),s=playgroundSource(catalog,settings),narrow=accepted(s);
  const access=s.construction.equipment[0].path!.access!;access.widthM=1.3;access.handrails='left';
  expect(decodeConstructionSource(JSON.parse(JSON.stringify(s))).construction.equipment[0].path!.access).toEqual(access);
  expect(mirroredEquipment(s.construction.equipment[0]).path!.access!.handrails).toBe('right');
  access.handrails='both';const wide=accepted(s);
  expect(wide.loading!.massKg).toBeGreaterThan(narrow.loading!.massKg);
  expect(wide.loading!.envelopeVolumeM3).toEqual(narrow.loading!.envelopeVolumeM3);
});

test('native fitting checks reject detached feet, missing wall support, bad slopes and hull intersections',()=>{
  for(const mode of ['feet','wall','slope','buried','settings']) {
    const s=playgroundSource(catalog,defaults());
    if(mode==='feet')s.construction.equipment[0].position[1]+=.3;
    if(mode==='wall')s.construction.equipment[1].position[2]+=.4;
    if(mode==='slope')s.construction.equipment[0].path!.points[1][2]=-.2;
    if(mode==='buried')s.construction.primitives.push({id:'obstruction',kind:'box',size:[2,2,1],position:[-1.2,1,1.1],rotationDeg:0});
    if(mode==='settings')s.construction.equipment[0].path!.access!.widthM=40;
    const result=compile(s);expect(result.definition,mode).toBeUndefined();expect(result.diagnostics.some(d=>d.code==='equipment-path'),mode+JSON.stringify(result.diagnostics)).toBe(true);
  }
});

test('rendered access bounds enclose every member and native loading matches the rendered sections',()=>{
  const s=playgroundSource(catalog,defaults()),r=accepted(s);
  for(const item of s.construction.equipment) {
    const part=catalog.equipment.find(p=>p.id===item.partId)!;
    const model=createConstructionPathModel(part,item.path),actual=new Box3().setFromObject(model),bounds=equipmentPathBounds(part,item);
    for(let k=0;k<3;k++){expect(actual.min.getComponent(k)).toBeGreaterThanOrEqual(bounds.center[k]-bounds.size[k]/2-1e-6);expect(actual.max.getComponent(k)).toBeLessThanOrEqual(bounds.center[k]+bounds.size[k]/2+1e-6);}
    const kind=item.id==='stairs'?'inclined-ladder':'framed-ladder',layout=accessLayout(kind,item.path!.points,item.path!.access!)!;
    const physicalMass = 1 + layout.members.reduce((sum,m) => { const fraction=m.round?Math.PI/4*.35:m.name==='tread'?.18:m.name==='stringer'?.22:1; return sum+new Vector3(...m.a).distanceTo(new Vector3(...m.b))*m.width*m.depth*7850*fraction; },0);
    expect(r.loading!.contributions.find(c=>c.id===item.id)!.massKg).toBeCloseTo(physicalMass,5);
  }
});

test('compact and tall installations keep valid native support as counts and sections change',()=>{
  for(const [rise,run,width] of [[1,.8,.35],[3,1.2,1.5],[8,6,1.1]]) {
    const settings=defaults();settings.rise=rise;settings.run=run;settings.stairs.widthM=width;settings.stairs.handrails='none';settings.framed.widthM=width;settings.framed.standOffM=.4;settings.framed.grabHeightM=0;
    accepted(playgroundSource(catalog,settings));
  }
});
