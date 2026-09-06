import { expect, test } from 'bun:test';
import yamato from '../../assets/ships/yamato/blueprint.json';
import baltimore from '../../assets/ships/baltimore/blueprint.json';
import enterprise from '../../assets/ships/enterprise-cv6/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { hitShip, updateFlooding, type Shell } from './damage';
import { insideHull, structuralHits, structuralSurfaces } from './structure';
import { localToWorld } from './geometry';
import { inspectionEntries } from '../ships/inspection';
import { sightAim } from '../game/aiming';

const definitions=[yamato,baltimore,enterprise].map(b=>compileShip(b,catalog));
const round=():Shell=>({id:7301,ownerId:'player',position:[0,0,0],velocity:[850,0,0],age:0,penetrationMm:2200,damage:35,caliberM:.2032,visited:[]});
const cases=[{bowY:5,sternY:3,bridgeY:26,bridgeZ:3},{bowY:6,sternY:3,bridgeY:16,bridgeZ:-20},{bowY:10,sternY:7,bridgeY:22,bridgeZ:-15}];

definitions.forEach((def,index)=>{
  const c=cases[index];
  for(const [part,y,z] of [['bow',c.bowY,-def.hull.length/2+8],['stern',c.sternY,def.hull.length/2-8],['bridge',c.bridgeY,c.bridgeZ]] as const){
    test(`${def.id}: posed swept ${part} hit, AP exit, sight and inspection agree`,()=>{
      const sim=new CombatSimulation(def),s=round(),events:string[]=[];
      Object.assign(sim.player.motion,{x:450,y:.2,z:-310,heading:1.05,roll:.035,pitch:-.02});
      const a:Vec3=[-45,y,z],b:Vec3=[45,y,z];
      expect(hitShip(s,localToWorld(a,sim.player.motion),localToWorld(b,sim.player.motion),sim.player,def,e=>events.push(e.message))).toBe(false);
      expect(events.some(e=>e.includes('plating'))).toBe(true);
      expect(sim.player.damage.integrity).toBeLessThan(sim.player.damage.maxIntegrity);
      expect(s.penetrationMm).toBeGreaterThan(1700);
      expect(sim.player.damage.compartments.every(c=>c.breachAreaM2===0)).toBe(true);
      const hit=structuralHits(a,b,def)[0];
      expect(inspectionEntries(def).some(e=>e.id==='structure:'+hit.surface.id)).toBe(true);
      const pose={...sim.player.motion,x:0,y:0,z:0,heading:0,pitch:0,roll:0};
      const sight=sightAim(a,[1,0,0],{pose,armor:def.armor,definition:def});
      expect(sight[0]).toBeCloseTo(hit.point[0],4);
    });
  }
  test(`${def.id}: waterline crossing, hull breach, flooding and empty air`,()=>{
    const sim=new CombatSimulation(def);Object.assign(sim.target.motion,{x:0,z:0,heading:0});sim.player.motion.x=-1000;
    expect(insideHull([0,0,-30],def)).toBe(true);
    sim.shells.push({...round(),position:[0,.06,-30],velocity:[0,-12,0]});
    sim.step({throttle:0,rudder:0},{aim:[0,0,0],fire:false,battery:'main'});
    expect(sim.events.some(e=>e.kind==='splash')).toBe(false);
    const events:string[]=[];
    hitShip(round(),[-40,-.5,0],[40,-.5,0],sim.target,def,e=>events.push(e.message));
    expect(sim.target.damage.compartments.some(c=>c.breachAreaM2>0)).toBe(true);
    updateFlooding(sim.target,def,2);
    expect(sim.target.damage.compartments.some(c=>c.waterM3>0)).toBe(true);
    expect(events.some(e=>e.includes('Hull shell'))).toBe(false); // Exterior belt replaces ordinary skin.
    const air:string[]=[];hitShip(round(),[-40,65,0],[40,65,0],sim.target,def,e=>air.push(e.message));
    expect(air).toEqual([]);
  });
});

test('Baltimore transom is a hit surface across its full breadth',()=>{
  const def=definitions[1],end=def.hull.length/2;
  const hits=structuralHits([0,3,end+4],[0,3,end-3],def);
  expect(hits.some(h=>h.surface.hull&&Math.abs(h.point[2]-end)<1e-6)).toBe(true);
});

test('Yamato recurved stem has air above its bulb, not a centerline sheet',()=>{
  const def=definitions[0],z=def.hull.length/2-259;
  expect(insideHull([0,0,z],def)).toBe(false);
  expect(structuralHits([-2,0,z],[2,0,z],def)).toEqual([]);
  expect(structuralHits([-10,-8,z],[10,-8,z],def).some(h=>h.surface.hull)).toBe(true);
});

test('Enterprise hangar openings remain air between actual portal frames',()=>{
  const def=definitions[2];
  expect(structuralHits([-20,11,50],[20,11,50],def)).toEqual([]);
  expect(structuralHits([-20,11,69],[20,11,69],def).some(h=>h.surface.id.startsWith('portal-'))).toBe(true);
});

test('Yamato shell rooms are above the lower propellant stores with stable magazine bindings',()=>{
  const def=definitions[0];
  for(let i=1;i<=3;i++){
    const magazine=def.modules.find(m=>m.id==='magazine-'+i)!;
    const shell=def.compartments.find(c=>c.id==='shell-room-'+i)!;
    expect(magazine.center[1]+magazine.size[1]/2).toBeLessThan(shell.center[1]-shell.size[1]/2);
    expect(def.mounts.find(m=>m.id==='main-'+i)?.magazineId).toBe(magazine.id);
  }
  expect(def.modules.filter(m=>m.kind==='engine')).toHaveLength(4);
  expect(def.compartments.filter(c=>c.id.startsWith('boiler-'))).toHaveLength(12);
});

test('Enterprise closed elevators replace deck holes without a second flight-deck skin',()=>{
  const def=definitions[2];
  for(const s of def.structures!.filter(s=>s.id.startsWith('elevator'))){
    const x=s.footprint.reduce((n,p)=>n+p[0],0)/s.footprint.length,z=s.footprint.reduce((n,p)=>n+p[1],0)/s.footprint.length;
    const hits=structuralHits([x,18,z],[x,15,z],def);
    expect(hits.some(h=>h.surface.id===s.id)).toBe(true);
    expect(hits.some(h=>h.surface.id==='flight-deck')).toBe(false);
  }
});

test('all fleet presets retain their distinct definitions and structural impact evidence',()=>{
  const sim=new CombatSimulation(definitions[0],{friendlyBots:[definitions[1]],enemies:[definitions[2]]});
  sim.player.motion.x=-1000;
  Object.assign(sim.target.motion,{x:0,z:0,heading:0});sim.target.controller='idle';
  sim.shells.push({...round(),position:[-40,22,-15]});
  for(let i=0;i<7;i++)sim.step({throttle:0,rudder:0},{aim:[0,0,0],fire:false,battery:'main'});
  const e=sim.events.find(e=>e.kind==='penetration'&&e.message.includes('plating'));
  expect(e?.shipId).toBe(sim.target.motion.id);
  expect(e?.normal?.every(Number.isFinite)).toBe(true);
  expect(e?.shell?.caliberM).toBe(.2032);
  expect(structuralSurfaces(definitions[1]).some(s=>s.id==='bridge-pilot-house')).toBe(true);
  expect(structuralSurfaces(definitions[2]).some(s=>s.id==='navigation-bridge')).toBe(true);
});
