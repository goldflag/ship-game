import { localToWorld } from './geometry';
import { seaHeight } from './sea';
import { shipContacts, resolveShipContact, type Shell } from './damage';
import { burstShell } from './burst';
import { expect, test } from 'bun:test';
import blueprint from '../../assets/ships/king-george-v/blueprint.json';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type ShipBlueprint } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { equipmentCondition, mountSupport, supportPerformance } from './machinery';
import { heatModule, updateDamageControl } from './damageControl';

function fixture() {
  const b = structuredClone(blueprint) as unknown as ShipBlueprint;
  b.modules = b.modules.filter(m => m.kind !== 'fire-control');
  b.modules.push({ id: 'exposed-director', name: 'Exposed director', kind: 'fire-control', placement: 'fixed', center: [3, 12, 0], size: [2, 2, 2], hp: 65, immersionToleranceM: 1, servesMountIds: [b.mounts[0].id] });
  const def = compileShip(b, catalog), sim = new CombatSimulation(def);
  return { b, def, a: sim.player, sim, index: def.modules.length - 1 };
}

test('fixed directors need no flooding volume and explicit coverage cannot reference missing mounts', () => {
  const { b, def } = fixture();
  expect(def.compartments.length).toBe(blueprint.compartments.length);
  b.modules.at(-1)!.servesMountIds = ['missing'];
  expect(() => compileShip(b, catalog)).toThrow('coverage');
  b.modules.at(-1)!.servesMountIds = [];
  b.modules.at(-1)!.placement = undefined;
  expect(() => compileShip(b, catalog)).toThrow('compartment');
});

test('cached director coverage observes live damage, redundant coverage and unserved local control', () => {
  const { b } = fixture();
  b.modules.push({ ...b.modules.at(-1)!, id: 'backup', center: [-3, 12, 0] });
  const def = compileShip(b, catalog), a = new CombatSimulation(def).player;
  const primary = a.damage.modules.find(m => m.id === 'exposed-director')!, backup = a.damage.modules.find(m => m.id === 'backup')!;
  expect(mountSupport(a, def, def.mounts[0].id).fireControl).toBe(1);
  expect(mountSupport(a, def, def.mounts[1].id).fireControl).toBe(0);
  primary.hp = 0;
  expect(mountSupport(a, def, def.mounts[0].id).fireControl).toBe(1);
  backup.hp = 0;
  expect(mountSupport(a, def, def.mounts[0].id).fireControl).toBe(0);
  const legacy = compileShip(blueprint, catalog), old = new CombatSimulation(legacy).player;
  expect(mountSupport(old, legacy, legacy.mounts[0].id)).toEqual(supportPerformance(old, legacy));
});

test('roomless equipment handles heating, repair, destruction, immersion and reset', () => {
  const { def, a, sim, index } = fixture(), m = def.modules[index];
  a.damage.modules[index].hp = 20;
  heatModule(a, def, index, 50);
  for (let i = 0; i < 40; i++) updateDamageControl(a, def, .5, () => {});
  expect(a.damage.modules[index].hp).toBeGreaterThan(20);
  a.motion.y = -13;
  expect(equipmentCondition(a, def, m).reason).toBe('flooded');
  const hp = a.damage.modules[index].hp;
  updateDamageControl(a, def, 1, () => {});
  expect(a.damage.modules[index].hp).toBe(hp);
  a.motion.y = 0;
  expect(equipmentCondition(a, def, m).availability).toBeGreaterThan(0);
  a.damage.modules[index].hp = 0;
  updateDamageControl(a, def, 20, () => {});
  expect(a.damage.modules[index].hp).toBe(0);
  sim.reset();
  expect(sim.player.damage.modules[index].hp).toBe(m.hp);
});

test('legacy definitions without directors preserve the no-director default even without power', () => {
  const { b }=fixture(); b.modules=b.modules.filter(m=>m.kind!=='fire-control');
  const def=compileShip(b,catalog),a=new CombatSimulation(def).player;
  def.modules.forEach((m,i)=>{if(m.kind==='generator')a.damage.modules[i].hp=0;});
  expect(mountSupport(a,def,def.mounts[0].id)).toEqual({power:0,fireControl:1});
});

test('exposed immersion uses the equipment position under heel, trim and CPU waves', () => {
  const {def,a,sim,index}=fixture(),m=def.modules[index];
  Object.assign(a.motion,{x:120,z:-50,y:-11,heading:.7,pitch:.15,roll:.4});
  const datum=localToWorld([m.center[0],m.center[1]-m.size[1]/2+m.immersionToleranceM!,m.center[2]],a.motion);
  a.sea={state:{amplitudeM:3,wavelengthM:40,direction:.3,windMps:20,phase:0},time:5};
  const level=seaHeight(a.sea.state,datum[0],datum[2],a.sea.time);
  a.motion.y+=level-datum[1]-.01;
  expect(equipmentCondition(a,def,m).reason).toBe('flooded');
  a.motion.y+=.02;
  expect(equipmentCondition(a,def,m).reason).toBe('operational');
  sim.reset(); expect(a.sea).toEqual({state:sim.sea,time:0});
});

test('direct and burst hits damage an exposed director without manufacturing floodwater', () => {
  const {def,a,index}=fixture(),m=def.modules[index];
  const from=localToWorld([m.center[0]+10,m.center[1],m.center[2]],a.motion),to=localToWorld(m.center,a.motion);
  const shot: Shell={id:1,ownerId:'other',position:from,velocity:[-700,0,0],age:0,penetrationMm:500,damage:100,caliberM:.15,visited:[]};
  const hit=shipContacts(shot,from,to,a,def).find(h=>h.kind==='module'&&h.index===index)!;
  expect(hit).toBeDefined(); resolveShipContact(shot,hit,a,def,()=>{});
  expect(a.damage.modules[index].hp).toBeLessThan(m.hp);
  a.damage.modules[index].hp=m.hp;
  shot.position=localToWorld([m.center[0]+m.size[0]/2+.1,m.center[1],m.center[2]],a.motion);
  shot.visited=[];shot.he={explosiveKg:20,fragmentPenetrationMm:100,damage:200,stockFraction:.5,basis:'test'};
  burstShell(shot,[a],()=>{});
  expect(a.damage.modules[index].hp).toBeLessThan(m.hp);
  expect(a.damage.compartments.every(c=>c.waterM3===0)).toBe(true);
});

test('authored enclosure protection stops weak hits and outside fragments, while an internal burst bypasses the skin', () => {
  const {b}=fixture(); const module=b.modules.at(-1)!;
  module.center=[10,80,0]; module.protectionMm=60;
  const def=compileShip(b,catalog),a=new CombatSimulation(def).player,index=def.modules.length-1;
  Object.assign(a.motion,{x:0,y:0,z:0,heading:0,pitch:0,roll:0});
  const shot: Shell={id:1,ownerId:'other',position:[8.9,80,0],velocity:[700,0,0],age:0,penetrationMm:50,damage:100,caliberM:.15,visited:[]};
  const hit=shipContacts(shot,shot.position,[10,80,0],a,def).find(h=>h.kind==='module'&&h.index===index)!;
  expect(resolveShipContact(shot,hit,a,def,()=>{})).toBe(true);
  expect(a.damage.modules[index].hp).toBe(module.hp);
  shot.he={explosiveKg:5,fragmentPenetrationMm:40,damage:100,stockFraction:.5,basis:'test'};
  for(const x of [8.9,9]) {shot.position=[x,80,0];burstShell(shot,[a],()=>{});expect(a.damage.modules[index].hp).toBe(module.hp);}
  shot.position=[10,80,0];burstShell(shot,[a],()=>{});
  expect(a.damage.modules[index].hp).toBeLessThan(module.hp);
});
