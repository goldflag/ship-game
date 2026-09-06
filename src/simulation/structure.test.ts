import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/bismarck/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { hitShip, type Shell } from './damage';
import { localToWorld } from './geometry';
import { inspectionEntries } from '../ships/inspection';
import { sightAim } from '../game/aiming';
import { protectionTrace } from './protection';
import { shipPreset } from '../ships/presets';

const definition = () => compileShip(blueprint, catalog);
const shell = (): Shell => ({ id:1, ownerId:'player', position:[0,0,0], velocity:[820,0,0], age:0, penetrationMm:1000, damage:70, caliberM:.38, visited:[] });

for (const [name, y, z] of [['bow',4,-115], ['stern',3,119], ['bridge',15,-18]] as const) {
  test(`fixed-tick shell flight registers unarmored ${name} contact`,()=>{
    const sim=new CombatSimulation(definition());sim.player.motion.x=-1000;Object.assign(sim.target.motion,{x:0,z:0});
    sim.shells.push({...shell(),position:[-30,y,z]});
    for(let i=0;i<5;i++)sim.step({throttle:0,rudder:0},{aim:[0,0,0],fire:false,battery:'main'});
    expect(sim.events.some(e=>e.kind==='penetration'&&e.message.includes('plating'))).toBe(true);
    expect(sim.events.some(e=>e.surfaceImpact && e.impact?.penetrationAfterMm! < e.impact?.penetrationBeforeMm!)).toBe(true);
    expect(sim.target.damage.sunk).toBe(false);
    expect(sim.shells).toHaveLength(1);
  });
  test(`unarmored ${name} registers a swept hit and damage under the actual ship pose`, () => {
    const def=definition(), sim=new CombatSimulation(def), round=shell(), events:string[]=[];
    Object.assign(sim.target.motion,{x:230,y:-.2,z:-450,heading:1.2,roll:.1,pitch:-.03});
    const from=localToWorld([-30,y,z],sim.target.motion), to=localToWorld([30,y,z],sim.target.motion);
    expect(hitShip(round,from,to,sim.target,def,e=>events.push(e.message))).toBe(false); // AP can exit thin structure.
    expect(events.length).toBeGreaterThan(0);
    expect(round.penetrationMm).toBeLessThan(1000);
    expect(round.penetrationMm).toBeGreaterThan(800);
    const integrity=sim.target.damage.integrity, penetration=round.penetrationMm;
    hitShip(round,from,to,sim.target,def,()=>{});
    expect(sim.target.damage.integrity).toBe(integrity);
    expect(round.penetrationMm).toBe(penetration);
    expect(sim.target.damage.compartments.every(c=>c.waterM3===0)).toBe(true);
  });
}

test('aiming and inspection include the same unarmored bow surface as combat', () => {
  const def=definition(), sim=new CombatSimulation(def);
  const point=sightAim([-30,4,-115],[1,0,0],{pose:sim.player.motion,armor:def.armor,definition:def});
  expect(point[0]).toBeGreaterThan(-10);expect(point[0]).toBeLessThan(0);expect(point[1]).toBe(4);
  expect(inspectionEntries(def).some(e=>e.id==='structure:hull')).toBe(true);
  expect(inspectionEntries(def).some(e=>e.id==='structure:bridge-lower')).toBe(true);
});

test('thin underwater hull hits breach the forebody, while air above the sheer remains a miss', () => {
  const def=definition(), sim=new CombatSimulation(def), round=shell();
  hitShip(round,[-30,-1,-115],[30,-1,-115],sim.player,def,()=>{});
  expect(sim.player.damage.compartments.some(c=>c.breachAreaM2>0)).toBe(true);
  const miss=shell(), events:string[]=[];
  hitShip(miss,[-30,12,-115],[30,12,-115],sim.player,def,e=>events.push(e.message));
  expect(events).toEqual([]);
});

test('a shell crossing the waterline inside the hull continues through the interior', () => {
  const def=definition(), sim=new CombatSimulation(def);
  Object.assign(sim.target.motion,{x:0,z:0});sim.player.motion.x=-1000;
  sim.shells.push({...shell(),position:[0,.06,-115],velocity:[0,-12,0]});
  sim.step({throttle:0,rudder:0},{aim:[0,0,0] as Vec3,fire:false,battery:'main'});
  expect(sim.events.some(e=>e.kind==='splash')).toBe(false);
  expect(sim.shells).toHaveLength(1);
});

test('main gunhouse armor covers the rear overhang but leaves air outside its narrower sides', () => {
  const def=definition(), m=def.mounts[0];
  const pose={x:m.position[0],y:m.position[1],z:m.position[2],heading:0,roll:0,pitch:0};
  const trace=(a:Vec3,b:Vec3)=>protectionTrace(localToWorld(a,pose),localToWorld(b,pose),def).filter(h=>h.id.startsWith('anton-turret'));
  expect(trace([-10,1.4,7],[10,1.4,7]).length).toBeGreaterThan(0);
  expect(trace([4.7,1.4,-20],[4.7,1.4,20])).toEqual([]);
  const front=trace([0,3.1,-20],[0,3.1,0]);
  expect(front[0].id).toContain('slope-3');expect(front[0].thicknessMm).toBe(180);
});

test('invalid or open component facets cannot become armor or enter the Blender recipe', () => {
  for(const mutate of [(g:any)=>g.gunhouseMesh.faces.pop(),(g:any)=>g.gunhouseMesh.faces[0].indices[0]=10000]){
    const c=structuredClone(catalog);mutate(c.parts[0]);expect(()=>compileShip(blueprint,c)).toThrow();
  }
});

test('the exterior belt replaces ordinary hull plating at the faired midship surface', () => {
  const def=definition(), sim=new CombatSimulation(def), events:string[]=[];
  hitShip(shell(),[-40,0,0],[0,0,0],sim.player,def,e=>events.push(e.message));
  expect(events.some(message=>message.includes('Main Belt'))).toBe(true);
  expect(events.some(message=>message.includes('Hull shell'))).toBe(false);
});

test('mixed fleets use each hull definition for structural hits and waterline crossing', () => {
  const sim=new CombatSimulation(shipPreset('baltimore'),{friendlyBots:[],enemies:[definition()]});
  sim.player.motion.x=-1000;
  Object.assign(sim.target.motion,{x:0,z:0,heading:0});sim.target.controller='idle';
  sim.shells.push({...shell(),position:[-30,4,-115]});
  for(let i=0;i<5;i++)sim.step({throttle:0,rudder:0},{aim:[0,0,0],fire:false,battery:'main'});
  const event=sim.events.find(e=>e.kind==='penetration'&&e.message.includes('Hull shell'));
  expect(event?.shipId).toBe(sim.target.motion.id);
  expect(event?.shell?.caliberM).toBe(.38);
  expect(Math.hypot(...event!.normal!)).toBeCloseTo(1,5);
  sim.shells.length=0;sim.events.length=0;
  sim.shells.push({...shell(),position:[0,.06,-115],velocity:[0,-12,0]});
  sim.step({throttle:0,rudder:0},{aim:[0,0,0],fire:false,battery:'main'});
  expect(sim.events.some(e=>e.kind==='splash')).toBe(false);
  expect(sim.shells).toHaveLength(1);
});

test('fleet sight aiming finds the nearer structural bow regardless of contact order', () => {
  const def=definition(),sim=new CombatSimulation(def);
  const near={pose:sim.player.motion,armor:def.armor,definition:def};
  const far={...near,pose:{...near.pose,x:100}};
  const hit=sightAim([-30,4,-115],[1,0,0],[far,near]);
  expect(hit).toEqual(sightAim([-30,4,-115],[1,0,0],near));
  expect(hit).toEqual(sightAim([-30,4,-115],[1,0,0],[near,far]));
});
