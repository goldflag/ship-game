import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { segmentPlate, protectionTrace, plateHit } from './protection';
import { CombatSimulation } from './combat';
import { hitShip, type Shell } from './damage';
import { localToWorld } from './geometry';
const def = compileShip(blueprint, catalog);
const plate: Vec3[] = [[0,-2,-2],[0,2,-2],[0,2,2],[0,-2,2]];
test('plate crossings work in both directions, reject parallel paths and preserve the edge', () => {
  expect(segmentPlate([-10,0,0],[10,0,0],plate)?.t).toBe(.5);
  expect(segmentPlate([10,0,0],[-10,0,0],plate)?.t).toBe(.5);
  expect(segmentPlate([-1,0,0],[-1,1,0],plate)).toBeNull();
  expect(segmentPlate([-10,3,0],[10,3,0],plate)).toBeNull();
  expect(segmentPlate([-10,2,0],[10,2,0],plate)).not.toBeNull();
});
test('Bismarck broadside crosses distinct belt, backing, support and turtleback before machinery', () => {
  const trace=protectionTrace([-30,0,0],[0,0,0],def);
  expect(trace.slice(0,4).map(h=>h.id)).toEqual(['port-main-belt-2','port-teak-backing-2','port-belt-support-2','port-turtleback-2']);
  expect(trace[1].resistanceMm).toBe(0);
  expect(trace[3].resistanceMm).toBeGreaterThan(trace[3].thicknessMm*2);
  expect(trace.every((h,i)=>!i || h.t>trace[i-1].t)).toBe(true);
});
test('plunging shell meets spaced upper, battery and armored decks in order', () => {
  const trace=protectionTrace([0,15,0],[0,-5,0],def);
  expect(trace.map(h=>h.id)).toEqual(['upper-deck-2','battery-deck-2','armor-deck-2']);
  expect(trace.map(h=>h.thicknessMm)).toEqual([50,12,80]);
});
test('one physical plate consumes its thickness once across adjacent ticks', () => {
  const d=structuredClone(def);d.armor=[{id:'test',name:'test',center:[0,0,0],size:[.001,4,4],thicknessMm:100,plate:{vertices:plate,material:'Wh'}}];d.mounts=[];d.modules=[];
  const sim=new CombatSimulation(d);const shell:Shell={id:1,ownerId:'target',position:[-10,0,0],velocity:[100,0,0],age:0,penetrationMm:500,damage:10,caliberM:.1,visited:[]};
  hitShip(shell,[-10,0,0],[0,0,0],sim.player,d,()=>{});
  hitShip(shell,[0,0,0],[10,0,0],sim.player,d,()=>{});
  expect(shell.penetrationMm).toBe(400);
  expect(sim.player.damage.compartments.every(c=>c.breachAreaM2===0)).toBe(true);
});
test('turret plates follow the rear pivot and share collision/inspection local coordinates', () => {
  const a=def.armor.find(a=>a.id==='caesar-turret-side-3-a')!;const i=def.mounts.findIndex(m=>m.id==='caesar'),m=def.mounts[i];
  const p=a.plate!.vertices.reduce((s,v)=>s.map((n,j)=>n+v[j]/3) as Vec3,[0,0,0] as Vec3);
  const pose={x:m.position[0],y:m.position[1],z:m.position[2],heading:Math.PI+.7,roll:0,pitch:0};
  const from=localToWorld([p[0],p[1],-20],pose),to=localToWorld([p[0],p[1],0],pose),trains=def.mounts.map(()=>0);trains[i]=.7;
  expect(plateHit(from,to,a,def,trains)).not.toBeNull();
  expect(protectionTrace(from,to,def,trains).some(h=>h.id.startsWith('caesar-turret'))).toBe(true);
});
test('a shell at a coplanar plate seam crosses one layer, preserving spatially separated backing', () => {
  const d=structuredClone(def);d.mounts=[];d.modules=[];
  d.armor=[{id:'a',name:'a',center:[0,0,-1],size:[.001,4,2],thicknessMm:100,plate:{vertices:[[0,-2,-2],[0,2,-2],[0,2,0],[0,-2,0]],material:'Wh'}},{id:'b',name:'b',center:[0,0,1],size:[.001,4,2],thicknessMm:120,plate:{vertices:[[0,-2,0],[0,2,0],[0,2,2],[0,-2,2]],material:'Wh'}},{id:'support',name:'support',center:[1,0,0],size:[.001,4,4],thicknessMm:20,plate:{vertices:plate.map(v=>[1,v[1],v[2]]),material:'Wh'}}];
  expect(protectionTrace([-10,0,0],[10,0,0],d).map(h=>h.id)).toEqual(['b','support']);
  const sim=new CombatSimulation(d);const shell:Shell={id:1,ownerId:'target',position:[-10,0,0],velocity:[100,0,0],age:0,penetrationMm:500,damage:10,caliberM:.1,visited:[]};
  hitShip(shell,[-10,0,0],[0,0,0],sim.player,d,()=>{});
  hitShip(shell,[0,0,0],[10,0,0],sim.player,d,()=>{});
  expect(shell.penetrationMm).toBe(360);
});
test('nonplanar, concave, degenerate and unattached armor cannot enter the simulation', () => {
  for (const edit of [(a:any)=>a.plate.vertices[0][0]+=2,(a:any)=>a.plate.vertices[1]=a.plate.vertices[0],(a:any)=>a.plate.mountId='missing']) {
    const b=structuredClone(blueprint);edit(b.armor[0]);expect(()=>compileShip(b,catalog)).toThrow();
  }
});
