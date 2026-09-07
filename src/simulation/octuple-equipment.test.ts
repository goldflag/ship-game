import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/king-george-v/blueprint.json';
import prototype from '../../assets/reviews/damageable-equipment/octuple-prototype/definition.json';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ShipView } from '../game/ShipView';
import type { ShipDefinition } from '../ships/blueprint';
import catalog from '../../assets/parts/guns.json';
import { barrelIds, compileShip } from '../ships/blueprint';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from './combat';
import { muzzleLocal, muzzleCenterLocal } from './weapons';
import { updateAntiAircraft } from './antiAircraft';
import type { AirContext } from './aircraft';
import type { CombatEvent } from './combat';

const fixture = () => ({...blueprint,mounts:[...blueprint.mounts,...prototype.mounts.filter(m=>m.id.startsWith('pom-pom-')).map(({weapon: _weapon,...m})=>m)]});
const def = () => compileShip(fixture(), catalog);
test('octuple muzzles preserve a four-by-two grid through common elevation and traverse', () => {
  const mount = def().mounts.find(m => m.id === 'pom-pom-1')!;
  expect(barrelIds(mount.weapon)).toEqual(['lower-left-outer', 'lower-left', 'lower-right', 'lower-right-outer', 'upper-left-outer', 'upper-left', 'upper-right', 'upper-right-outer']);
  for (const train of [-1.4, 0, .43, 2.1]) for (const elevation of [-.17, 0, .4, 1.396]) {
    const pose = { train, elevation }, muzzles = barrelIds(mount.weapon).map((_,i) => muzzleLocal(mount, pose, i));
    const distance = (a: number,b: number) => Math.hypot(...muzzles[a].map((v,i)=>v-muzzles[b][i]));
    for (let i=0;i<4;i++) expect(distance(i,i+4)).toBeCloseTo(mount.weapon.barrelVerticalSpacing!,10);
    for (const i of [0,1,2,4,5,6]) expect(distance(i,i+1)).toBeCloseTo(mount.weapon.barrelSpacing,10);
    const center = muzzleCenterLocal(mount,pose);
    for (let axis=0;axis<3;axis++) expect(center[axis]).toBeCloseTo(muzzles.reduce((n,p)=>n+p[axis]/8,0),10);
  }
  expect(() => compileShip(fixture(),{...catalog,parts:catalog.parts.map(p=>p.id===mount.partId?{...p,barrelVerticalSpacing:undefined}:p)})).toThrow('barrelVerticalSpacing');
});

test('KGV component prototype fires eight finite rounds and destroyed mounts freeze while their neighbor fires', () => {
  const sim = new CombatSimulation(def(),{friendlyBots:[],enemies:[shipPreset('enterprise-cv6')],seed:93});
  const actor=sim.player, plane=sim.target.airWing!.planes[0];
  Object.assign(actor.motion,{x:0,y:0,z:0,heading:0,pitch:0,roll:0});
  Object.assign(plane,{phase:'outbound',hp:10000,position:[-700,250,0],velocity:[0,0,0]});
  let sequence=0;
  const events: Omit<CombatEvent,'sequence'|'tick'>[]=[];
  const ctx: AirContext={actors:sim.actors,planes:[plane],shells:[],torpedoes:[],releases:[],seed:93,nextId:()=>++sequence,emit:e=>events.push(e)};
  const indexes=['pom-pom-1','pom-pom-3'].map(id=>sim.definition.mounts.findIndex(m=>m.id===id));
  for (const index of indexes) {
    const m=sim.definition.mounts[index],state=actor.mounts[index],ammo=state.ammo;
    for (let i=0;i<1200&&state.ammo===ammo;i++) updateAntiAircraft(actor,m,state,ctx,1/60);
    expect(state.ammo).toBe(ammo-8);
    expect(events.filter(e=>e.message===`${m.name} · AA fire`)).toHaveLength(8);
  }
  const dead=actor.mounts[indexes[0]],healthy=actor.mounts[indexes[1]],remaining=healthy.ammo;
  dead.hp=0; const frozen={...dead};
  plane.position=[-700,500,100];
  for (let i=0;i<300;i++) for(const index of indexes) updateAntiAircraft(actor,sim.definition.mounts[index],actor.mounts[index],ctx,1/60);
  expect(dead).toEqual(frozen);
  expect(healthy.ammo).toBeLessThan(remaining);
});

test('retained octuple export sockets agree with CPU muzzle poses at intermediate train, elevation and recoil', async () => {
  const bytes=await Bun.file(new URL('../../assets/reviews/damageable-equipment/octuple-prototype/model.glb',import.meta.url)).arrayBuffer();
  const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,new DataView(bytes).getUint32(12,true))));
  const nodes=gltf.nodes.map(({mesh:_mesh,...node}:{mesh?:number})=>node);
  const model=await new GLTFLoader().parseAsync(JSON.stringify({asset:gltf.asset,scene:gltf.scene,scenes:gltf.scenes,nodes}),'');
  const definition=prototype as unknown as ShipDefinition,sim=new CombatSimulation(definition),view=new ShipView(model.scene,definition,sim.player);
  expect(view.muzzleErrors()).toHaveLength(58);
  for(const train of [-1,-.43,0,.27,1])for(const elevation of [0,.37,.72,1])for(const recoil of [0,.4,1]) {
    Object.assign(sim.player.motion,{x:341,y:-1.5,z:-837,heading:2.6,pitch:-.08,roll:.13});
    sim.player.mounts.forEach((s,i)=>{const w=definition.mounts[i].weapon;Object.assign(s,{train:train*w.traverseDeg*Math.PI/180,elevation:(w.elevationMinDeg+elevation*(w.elevationMaxDeg-w.elevationMinDeg))*Math.PI/180,recoil});});
    view.update();expect(Math.max(...view.muzzleErrors())).toBeLessThan(.025);
  }
});

test('automatic AA uses battery coverage and generator power, preserving unrelated director redundancy', () => {
  function run(failure:'none'|'served'|'unrelated'|'power',ticks=1200) {
    const definition=def(),sim=new CombatSimulation(definition,{friendlyBots:[],enemies:[shipPreset('enterprise-cv6')],seed:93}),a=sim.player;
    Object.assign(a.motion,{x:0,y:0,z:0,heading:0,pitch:0,roll:0});
    const index=definition.mounts.findIndex(m=>m.id==='secondary-p1'),m=definition.mounts[index],state=a.mounts[index];
    definition.modules.forEach((module,i)=>{
      if(failure==='power'?module.kind==='generator':module.kind==='fire-control'&&(failure==='served'?module.servesMountIds?.includes(m.id):failure==='unrelated'&&!module.servesMountIds?.includes(m.id)))a.damage.modules[i].hp=0;
    });
    const plane=sim.target.airWing!.planes[0];Object.assign(plane,{phase:'outbound',hp:1000,position:[-500,250,-500],velocity:[0,0,0]});
    const events:Omit<CombatEvent,'sequence'|'tick'>[]=[];let id=0;
    const ctx:AirContext={seed:93,actors:sim.actors,planes:[plane],shells:[],torpedoes:[],releases:[],nextId:()=>++id,emit:e=>events.push(e)};
    for(let i=0;i<ticks&&!events.length;i++)updateAntiAircraft(a,m,state,ctx,1/60);
    return {events,train:state.train};
  }
  const healthy=run('none'),unrelated=run('unrelated'),failed=run('served');
  expect(healthy.events).toHaveLength(2);expect(unrelated.events).toEqual(healthy.events);
  expect(failed.events).toHaveLength(2);expect(failed.events[0].aircraft!.target).not.toEqual(healthy.events[0].aircraft!.target);
  expect(run('power',60).train).toBeCloseTo(run('none',60).train*.25,8);
});
