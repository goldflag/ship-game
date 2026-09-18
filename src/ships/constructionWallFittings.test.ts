import { beforeAll, expect, test } from 'bun:test';
import init, { compile_construction } from '../generated/naval-wasm/naval_wasm';
import catalogJson from '../../public/models/components/catalog.json';
import type { ConstructionCatalog, ConstructionEquipment, ConstructionResult, ConstructionSource, Vec3 } from './blueprint';
import { createStarterSource } from './constructionStarter';
import { applyConstructionBatch, type ConstructionCommand } from './constructionCommands';
import { decodeConstructionSource, mirroredEquipment } from './constructionEditor';
import { installedWallPart, wallBearing, wallFittingSupported, wallRow } from './constructionWallFittings';
import { placementCenter } from '../ui/shipbuilding/placement';
import { BuilderTool, type BuilderRevisionDoor } from '../ui/shipbuilding/builderTool';
import { DEFAULT_SNAPPING, resolveSnap, wallFrameSnapFeatures } from '../ui/shipbuilding/snapping';

const catalog = catalogJson as ConstructionCatalog;
beforeAll(async () => { await init({ module_or_path: await Bun.file(new URL('../generated/naval-wasm/naval_wasm_bg.wasm', import.meta.url)).arrayBuffer() }); });
const compile = (s: ConstructionSource): ConstructionResult => JSON.parse(compile_construction(JSON.stringify(s), JSON.stringify(catalog)));
function fixture() {
  const s = createStarterSource(catalog, 'blank');
  s.construction.primitives[0].size = [8, 6, 20];
  return s;
}
function fitting(id = 'a', partId = 'generic-porthole', position: Vec3 = [4, 0, 0], bearingDeg = 90): ConstructionEquipment {
  const p = catalog.equipment.find(p => p.id === partId)!;
  return { id, partId, position, bearingDeg, wall: { version: 1, widthM: p.size[0], heightM: p.size[1] } };
}
function paired(s = fixture()) {
  const a = fitting(), b = { ...mirroredEquipment(a), id: 'b' };
  a.wall!.mirrorId = b.id; b.wall!.mirrorId = a.id;
  s.construction.equipment.push(a,b); return s;
}
const apply = (s: ConstructionSource, commands: ConstructionCommand[]) => applyConstructionBatch(s, { version: 1, expectedRevision: s.revision, label: 'Edit wall fittings', commands });

test('all four wall fittings compile on either vertical side without changing hull geometry or floodable volume', () => {
  const plain = fixture(), before = compile(plain);
  expect(before.definition, JSON.stringify(before.diagnostics)).toBeDefined();
  for (const id of ['generic-watertight-door', 'generic-porthole', 'generic-rectangular-window', 'generic-rounded-window']) {
    const s = fixture(), a = fitting('a', id), p = catalog.equipment.find(p => p.id === id)!;
    s.construction.equipment.push(a, { ...mirroredEquipment(a), id: 'b' });
    const result = compile(s);
    expect(result.definition, `${id}: ${JSON.stringify(result.diagnostics)}`).toBeDefined();
    expect(result.surfaces).toEqual(before.surfaces);
    expect(wallFittingSupported(a, p, before.surfaces)).toBe(true);
    expect(wallFittingSupported(s.construction.equipment[1], p, before.surfaces)).toBe(true);
    expect(result.loading!.envelopeVolumeM3).toEqual(before.loading!.envelopeVolumeM3);
    expect(result.loading!.usableVolumeM3).toEqual(before.loading!.usableVolumeM3);
  }
});

test('native compilation rejects overhanging, floating and mismatched mirrored supports', () => {
  for (const position of [[4, 2.9, 0], [4.1, 0, 0], [4, 0, 9.9], [0, 3, 0]] as Vec3[]) {
    const s = fixture(); s.construction.equipment.push(fitting('a', 'generic-porthole', position));
    const r = compile(s);
    expect(r.definition).toBeUndefined(); expect(r.diagnostics.some(d => d.code === 'wall-fitting')).toBe(true);
  }
  const s = paired(); s.construction.primitives[0].position[0] = .2;
  expect(compile(s).definition).toBeUndefined();
});

test('linked edits from either side survive serialization, update once for a group move, and delete together', () => {
  let s = decodeConstructionSource(JSON.parse(JSON.stringify(paired())));
  s = apply(s, [{ op: 'move', ids: ['b'], delta: [0, .5, 2] }]);
  expect(s.construction.equipment.map(e => e.position)).toEqual([[4,.5,2],[-4,.5,2]]);
  s = apply(s, [{ op: 'move', ids: ['a','b'], delta: [0, 0, 1] }]);
  expect(s.construction.equipment.map(e => e.position[2])).toEqual([3,3]);
  const b = structuredClone(s.construction.equipment[1]); b.wall!.widthM = .8; b.wall!.heightM = .8; b.paint = 'sea-blue';
  s = apply(s, [{ op: 'equipment', value: b }]);
  expect(s.construction.equipment[0]).toMatchObject({ paint: 'sea-blue', wall: { widthM: .8, heightM: .8, mirrorId: 'b' } });
  expect(compile(s).definition, JSON.stringify(compile(s).diagnostics)).toBeDefined();
  const removed = apply(s, [{ op: 'remove', ids: ['b'] }]);
  expect(removed.construction.equipment).toHaveLength(0);
  expect(s.construction.equipment).toHaveLength(2);
});

test('native linked-pair and round-window invariants cannot be bypassed by importing JSON', () => {
  const s = paired(); s.construction.equipment[1].wall!.mirrorId = 'missing';
  expect(compile(s).diagnostics.some(d => d.code === 'wall-fitting')).toBe(true);
  const p = fixture(); const a = fitting(); a.wall!.heightM = .7; p.construction.equipment.push(a);
  expect(compile(p).definition).toBeUndefined();
});

test('window resizing scales original bounds and native mass without altering wall depth', () => {
  const s = fixture(), a = fitting('a', 'generic-rectangular-window');
  s.construction.equipment.push(a);
  const before = compile(s), p = catalog.equipment.find(p => p.id === a.partId)!;
  a.wall!.widthM *= 2; a.wall!.heightM *= 2;
  const after = compile(s);
  expect(after.definition, JSON.stringify(after.diagnostics)).toBeDefined();
  const mass = (r: ConstructionResult) => r.loading!.contributions.filter(m => m.id === 'a' && m.kind === 'equipment').reduce((sum,m) => sum+m.massKg,0);
  expect(mass(after)).toBeCloseTo(mass(before)*4);
  expect(installedWallPart(p, a).size).toEqual([1.8,1.3,p.size[2]]);
});

test('wall placement seats the original attachment at arbitrary wall yaw; rows preserve height and exact spacing', () => {
  const normal: Vec3 = [Math.SQRT1_2,0,-Math.SQRT1_2], bearingDeg = wallBearing(normal);
  const p = catalog.equipment.find(p => p.id === 'generic-porthole')!;
  const start = placementCenter({ ...p, kind: 'equipment', bearingDeg, wall: { version: 1, widthM:.5, heightM:.5 } }, { point: [2,1,0], normal }, .25);
  expect(start.reduce((sum,v,k) => sum+(v-[2,1,0][k])*normal[k],0)).toBeCloseTo(0);
  const row = wallRow(start, [6,2,4], bearingDeg, 1.5);
  expect(row.length).toBeGreaterThan(2);
  for (let i=1;i<row.length;i++) { expect(row[i][1]).toBe(start[1]); expect(Math.hypot(...row[i].map((v,k)=>v-row[i-1][k]))).toBeCloseTo(1.5); }
});

test('different sized window frames snap by their top edges, with an active alignment guide', () => {
  const p = catalog.equipment.find(p => p.id === 'generic-rectangular-window')!;
  const fixed = installedWallPart(p, { wall: { version:1, widthM: .5, heightM:.5 } });
  const moving = installedWallPart(p, { wall: { version:1, widthM: 1, heightM:1 } });
  const result = resolveSnap({ raw:[4,.94,2], grid:[4,1,2], directions:[[0,1,0]],
    moving:wallFrameSnapFeatures('moving',[0,0,0],90,moving).filter(f=>f.kind!=='edge'),
    targets:wallFrameSnapFeatures('fixed',[4,1.25,0],90,fixed), settings:DEFAULT_SNAPPING, project:p=>[p[2]*20,p[1]*40] });
  expect(result.delta[1]).toBeCloseTo(1);
  expect(result.guides.some(g=>g.active && g.to[1]===1.5)).toBe(true);
});

test('editor lays a linked row as one transaction; refuses unmatched mirror; supports undo and redo', () => {
  let source = fixture(); const past: ConstructionSource[] = [], future: ConstructionSource[] = [], listeners = new Set<() => void>();
  const changed = () => listeners.forEach(f=>f());
  const door: BuilderRevisionDoor = {
    get source() { return source; }, refusal: undefined, locked: false,
    submit(label, commands) { const next = apply(source, commands); past.push(source); source = next; changed(); return { accepted:true, changed:true, source:next }; },
    undo() { future.push(source); source=past.pop()!; changed(); }, redo() { past.push(source); source=future.pop()!; changed(); },
    setError() {}, setBusy() {}, subscribe(f) { listeners.add(f); return ()=>listeners.delete(f); },
  };
  const tool = new BuilderTool(door, { catalog:()=>catalog, compiled:()=>compile(source) });
  tool.switchLayer('fittings');
  tool.selectSlot(tool.palette.all!.find(p=>p.id==='generic-porthole')!);
  tool.setWindowRow(true); tool.setWindowSpacing(1.5);
  expect(tool.piece).toMatchObject({ rowSpacing:1.5 });
  expect(tool.placeAt([[4,0,0],[4,0,1.5],[4,0,3]],90)).toMatchObject({accepted:true});
  expect(source.construction.equipment).toHaveLength(6); expect(past).toHaveLength(1);
  tool.undo(); expect(source.construction.equipment).toHaveLength(0); tool.redo(); expect(source.construction.equipment).toHaveLength(6);
  const before = source;
  expect(tool.placeAt([[4,2.95,0]],90)).toMatchObject({accepted:false}); expect(source).toBe(before);
  tool.toggleMirror();
  expect(tool.placeAt([[4,-1,-6]],90)).toMatchObject({accepted:true});
  const single = source.construction.equipment.at(-1)!;
  tool.selectOnly([single.id]);
  expect(tool.copy(true)).toMatchObject({accepted:true});
  const linked = source.construction.equipment.find(e=>e.id===single.id)!;
  expect(linked.wall!.mirrorId).toBeDefined();
  tool.selectOnly([single.id]);
  expect(tool.copy(false)).toMatchObject({accepted:true});
  const selected = [...tool.getSnapshot().selected].map(id=>source.construction.equipment.find(e=>e.id===id));
  expect(selected).toHaveLength(2);
  expect(selected.every(e=>e && selected.some(t=>t?.id===e.wall?.mirrorId))).toBe(true);
  expect(compile(source).definition, JSON.stringify(compile(source).diagnostics)).toBeDefined();
  tool.dispose();
});

test('a porthole seats on the actual sloped Fletcher hull and compiles with its linked mirror', () => {
  const s = createStarterSource(catalog, 'fletcher-hull'), before = compile(s);
  const face = before.surfaces.filter(f => f.normal[0] > .9 && Math.abs(f.normal[1]) < .7).sort((a,b) => Math.abs(a.vertices[0][2])-Math.abs(b.vertices[0][2]))[0];
  const point = face.vertices.reduce((a,v) => a.map((n,k)=>n+v[k]/face.vertices.length) as Vec3, [0,0,0]);
  const a = fitting('a', 'generic-porthole', point, wallBearing(face.normal)); a.wall!.widthM = a.wall!.heightM = .3;
  const b = {...mirroredEquipment(a), id:'b'}; a.wall!.mirrorId='b';b.wall!.mirrorId='a';
  expect(wallFittingSupported(a, catalog.equipment.find(p=>p.id===a.partId)!, before.surfaces)).toBe(true);
  s.construction.equipment.push(a,b);
  const result = compile(s);
  expect(result.definition, JSON.stringify(result.diagnostics)).toBeDefined();
  expect(result.surfaces).toEqual(before.surfaces);
});

test('arrow keys resize the cursor and linked selections once, with fine steps and undo', () => {
  let source=paired(), past:ConstructionSource[]=[];
  const door:BuilderRevisionDoor={get source(){return source;},locked:false,refusal:undefined,
    submit(_label,commands){past.push(source);source=apply(source,commands);return {accepted:true,changed:true,source};},
    undo(){source=past.pop()!;},redo(){},setError(){},setBusy(){},subscribe(){return ()=>{};}};
  const tool=new BuilderTool(door,{catalog:()=>catalog,compiled:()=>compile(source)});
  const press=(key:string,shiftKey=false)=>tool.key({key,shiftKey,ctrlKey:false,metaKey:false,altKey:false,repeat:false,preventDefault(){}},{dismiss:()=>false,toggleDrawer(){},toggleWarnings(){},slotChosen(){}});
  tool.switchLayer('fittings'); tool.selectOnly(['a','b']);
  const before=structuredClone(source);
  press('ArrowRight');expect(source.construction.equipment.map(e=>e.wall!.widthM)).toEqual([.6,.6]);expect(source.construction.equipment.map(e=>e.wall!.heightM)).toEqual([.6,.6]);
  expect(source.construction.equipment.map(e=>e.position)).toEqual(before.construction.equipment.map(e=>e.position));
  press('ArrowDown',true);expect(source.construction.equipment.map(e=>e.wall!.heightM)).toEqual([.59,.59]);
  tool.undo();expect(source.construction.equipment[0].wall!.widthM).toBe(.6);
  tool.selectSlot(tool.palette.all!.find(p=>p.id==='generic-rectangular-window')!);
  press('ArrowRight');press('ArrowUp',true);
  expect(tool.piece).toMatchObject({wall:{widthM:1,heightM:.66}});
  tool.selectSlot(tool.palette.all!.find(p=>p.id==='generic-watertight-door')!);
  press('ArrowLeft');press('ArrowDown');
  const part=catalog.equipment.find(p=>p.id==='generic-watertight-door')!;
  expect(tool.piece).toMatchObject({wall:{widthM:part.size[0]-.1,heightM:part.size[1]-.1}});
  tool.dispose();
});
