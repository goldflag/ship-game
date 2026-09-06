import { expect, test } from 'bun:test';
import catalog from '../../assets/parts/guns.json';
import { compileShip, type Battery, type Vec3 } from '../ships/blueprint';
import { CombatSimulation } from './combat';
import { hullContains } from './hull';
import { hydrostatics, initialMetacenter, flotation, rightingArms } from './hydrostatics';
import { systemHealth, hitShip, updateFlooding, type Shell } from './damage';
import { updateStability } from './stability';
import { createShipState, stepShip } from './ship';
import { shipStatistics } from '../ships/statistics';

const ids = ['liberty-cargo', 'liberty-collier', 'victory-cargo', 'flower-corvette'];
const definitions = await Promise.all(ids.map(async id => compileShip(await Bun.file(`assets/ships/${id}/blueprint.json`).json(), catalog)));
const idle = { throttle: 0, rudder: 0 };

test('merchant designs differ in hull, machinery, superstructure and cargo gear, not deck loads', () => {
  const [cargo, collier, victory, flower] = definitions;
  expect(cargo.mounts).toHaveLength(10);
  expect(collier.structures!.filter(s => s.id.startsWith('hatch-'))).toHaveLength(10);
  expect(cargo.structures!.filter(s => s.id.startsWith('hatch-'))).toHaveLength(5);
  const engineZ=(def:typeof cargo)=>def.modules.find(m=>m.id==='main-engine')!.center[2];
  expect(engineZ(collier)).toBeGreaterThan(collier.hull.length*.25);
  expect(Math.abs(engineZ(cargo))).toBeLessThan(cargo.hull.length*.1);
  const boiler=collier.modules.find(m=>m.id==='boiler-port')!;
  expect(boiler.center[1]-boiler.size[1]/2).toBeGreaterThan(-collier.hull.draft+6);
  const navigation=collier.structures!.find(s=>s.id==='midship-house')!;
  const bridgeEnds=navigation.footprint.map(p=>p[1]);
  for(const hatch of collier.structures!.filter(s=>s.id.startsWith('hatch-'))) {
    const ends=hatch.footprint.map(p=>p[1]);
    expect(Math.max(...ends)<=Math.min(...bridgeEnds)||Math.min(...ends)>=Math.max(...bridgeEnds)).toBe(true);
  }
  expect(victory.modules.find(m=>m.id==='main-engine')!.name).toBe('Geared steam turbine');
  const centerZ=(def:typeof cargo,id:string)=>def.structures!.find(s=>s.id===id)!.footprint.reduce((n,p)=>n+p[1],0)/def.structures!.find(s=>s.id===id)!.footprint.length;
  expect(Math.abs(centerZ(collier,'funnel')-centerZ(collier,'wheelhouse'))).toBeGreaterThan(65);
  expect(Math.abs(centerZ(cargo,'funnel')-centerZ(cargo,'wheelhouse'))).toBeLessThan(15);
  expect(victory.hull.length).toBeCloseTo(455.25*.3048,4);
  expect(victory.hull.beam).toBeCloseTo(62*.3048,4);
  expect(victory.hull.sections).not.toEqual(cargo.hull.sections);
  expect(victory.handling.forwardSpeed).toBeGreaterThan(cargo.handling.forwardSpeed);
  expect(definitions.every(d=>!d.structures!.some(s=>s.id.startsWith('deck-load-')||s.id.startsWith('troop-shelter-')))).toBe(true);
  expect(flower.hull.length).toBeCloseTo(205*.3048,4);
  expect(cargo.hull.length).toBeCloseTo(134.5692, 4);
  expect(flower.handling.forwardSpeed).toBeGreaterThan(cargo.handling.forwardSpeed);
  expect(flower.handling.maxYawRate).toBeGreaterThan(cargo.handling.maxYawRate);
});

test('Flower follows registered Cobalt 1941 GA landmarks and early-war equipment',()=>{
  const flower=definitions[3];
  expect(flower.mounts.map(m=>m.weapon.caliberM)).toEqual([.1016,.04,.0077,.0077]);
  expect(flower.mounts[2].weapon.barrelCount).toBe(2);
  expect(flower.mounts[0].position).toEqual([0,5.4,-16.8]);
  const stack=flower.structures!.find(s=>s.id==='funnel')!;
  expect(stack.baseY+stack.height).toBeCloseTo(11.65,2);
  const jumps=flower.hull.deckHeights.filter((p,i,a)=>i>0&&p[1]-a[i-1][1]>1.5);
  expect(jumps).toHaveLength(1);
  expect(jumps[0][0]/flower.hull.length).toBeCloseTo(.707,3);
  expect(flower.structures!.find(s=>s.id==='bridge-wings')!.baseY).toBeCloseTo(6.7,2);
  expect(flower.configuration).toContain('1941');
  // The GA's propeller aperture is above the shaft, not a solid continuation
  // of the lower keel line. Every point of the 3.14 m screw clears the hull.
  for(let i=0;i<24;i++) {
    const a=i*Math.PI/12;
    expect(hullContains(flower.hull,[Math.sin(a)*1.57,-1.85+Math.cos(a)*1.57,26])).toBe(false);
  }
});

for (const def of definitions) {
  test(`${def.id}: hull-contained flood cells, machinery, positive reserve and restoring stability`, () => {
    for (const room of def.compartments) for (const cell of room.cells!) for (let i=0;i<8;i++) {
      const point=cell.center.map((n,a)=>n+((i>>a)&1?1:-1)*cell.size[a]/2) as Vec3;
      expect(hullContains(def.hull,point)).toBe(true);
    }
    for(const module of def.modules) for(let i=0;i<8;i++) expect(hullContains(def.hull,module.center.map((n,a)=>n+((i>>a)&1?1:-1)*module.size[a]/2) as Vec3)).toBe(true);
    const h=hydrostatics(def.hull),s=def.stability!;
    expect(h.volume*1025*s.buoyancyScale).toBeCloseTo(def.hull.massKg,0);
    expect(initialMetacenter(def.hull)-s.dryCenterOfGravity[1]).toBeGreaterThan(.75);
    const angle=.10,f=flotation(def.hull,h.volume,angle);
    expect(rightingArms(f.center,s.dryCenterOfGravity,angle,0).roll).toBeLessThan(0);
    expect(def.compartments.reduce((n,c)=>n+c.capacityM3,0)).toBeGreaterThan(def.hull.reserveBuoyancyM3*s.buoyancyScale);
    const stats=shipStatistics(def);
    expect(stats.find(s=>s.id==='mobility')!.headline).toBe(def.id==='flower-corvette'?'16.0':def.id==='victory-cargo'?'15.0':'11.0');
    expect(stats.find(s=>s.id==='secondary-battery')!.rows.length).toBeGreaterThan(0);
  });

  for (const battery of ['main','secondary'] as Battery[]) {
    test(`${def.id}: ${battery} trains, fires from clear sockets, reloads and resets`, () => {
      const sim=new CombatSimulation(def);
      const intent={aim:[1200,0,0] as Vec3,fire:false,battery};
      for(let i=0;i<1000;i++)sim.step(idle,intent);
      const ready=sim.player.mounts.filter((m,i)=>def.mounts[i].battery===battery&&m.status==='ready');
      expect(ready.length).toBeGreaterThan(0);
      const ammo=sim.player.mounts.reduce((n,m)=>n+m.ammo,0);
      sim.step(idle,{...intent,fire:true});
      const barrels=ready.reduce((n,m)=>n+(def.mounts.find(d=>d.id===m.id)!.weapon.barrelCount??2),0);
      expect(sim.events.filter(e=>e.kind==='shot'&&e.shipId==='player').length).toBe(barrels);
      expect(sim.player.mounts.reduce((n,m)=>n+m.ammo,0)).toBe(ammo-barrels);
      for(let i=0;i<450;i++)sim.step(idle,intent);
      expect(ready.some(m=>m.reload===0)).toBe(true);
      sim.reset();
      expect(sim.shells).toHaveLength(0);
      expect(sim.player.mounts.reduce((n,m)=>n+m.ammo,0)).toBe(ammo);
    });
  }

  test(`${def.id}: machinery damage, positional flooding and loss of flotation use shared simulation`, () => {
    const sim=new CombatSimulation(def),actor=sim.player;
    actor.damage.modules.find(m=>m.id==='main-engine')!.hp=0;
    expect(systemHealth(actor,def,'engine')).toBe(0);
    sim.reset();
    const index=def.compartments.findIndex(c=>c.id==='engine-room');
    actor.damage.compartments[index].waterM3=def.compartments[index].capacityM3*.4;
    updateStability(actor,def,1/60);
    expect(actor.damage.stability.targetY).toBeLessThan(0);
    expect(actor.damage.stability.water[index].volume).toBeGreaterThan(0);
    for(let i=0;i<def.compartments.length;i++)actor.damage.compartments[i].waterM3=def.compartments[i].capacityM3;
    updateStability(actor,def,.5);
    expect(actor.damage.sunk).toBe(true);
    expect(actor.damage.defeatCause).toBe('flooding');
    sim.reset();
    expect(actor.damage.sunk).toBe(false);
    expect(actor.damage.compartments.every(c=>c.waterM3===0)).toBe(true);
  });

  test(`${def.id}: underway motion and steering remain finite`,()=>{
    const state=createShipState('trial');
    for(let i=0;i<3600;i++)stepShip(state,{throttle:1,rudder:.4},def.handling);
    expect(state.speed).toBeGreaterThan(0);
    expect(Number.isFinite(state.heading)).toBe(true);
    expect(Math.hypot(state.x,state.z)).toBeGreaterThan(10);
  });

  test(`${def.id}: thin shell registers hits on all six sides and feeds local flood spaces`,()=>{
    for(const direction of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as Vec3[]) {
      const sim=new CombatSimulation(def),from=direction.map(n=>n*(def.hull.length+20)) as Vec3;
      const to:Vec3=[0,0,0];
      if(direction[1]===0)from[1]=to[1]=-.7;
      const shell:Shell={id:1,ownerId:'enemy',position:from,velocity:direction.map(n=>-n*800) as Vec3,age:0,penetrationMm:1000,damage:10,caliberM:.38,visited:[]};
      hitShip(shell,from,to,sim.player,def,()=>{});
      expect(sim.player.damage.compartments.reduce((n,c)=>n+c.breachAreaM2,0)).toBeGreaterThan(0);
      if(direction[1]===0){
        for(let i=0;i<60;i++)updateFlooding(sim.player,def,1/60);
        expect(sim.player.damage.compartments.reduce((n,c)=>n+c.waterM3,0)).toBeGreaterThan(0);
      }
    }
  });
}

test('convoy ships deploy on both teams with independent damage and bots that fire',()=>{
  const sim=new CombatSimulation(definitions[3],{friendlyBots:definitions.slice(0,3),enemies:definitions,spawnDistance:1200,seed:12345});
  for(let i=0;i<2400;i++)sim.step(idle,{aim:[1200,0,0],battery:'main',fire:false});
  expect(sim.actors).toHaveLength(8);
  expect(sim.events.some(e=>e.kind==='shot'&&e.shipId.startsWith('enemy-'))).toBe(true);
  expect(sim.events.some(e=>e.kind==='shot'&&e.shipId.startsWith('friendly-'))).toBe(true);
  expect(sim.actors.every(a=>Number.isFinite(a.motion.heading)&&Number.isFinite(a.motion.y))).toBe(true);
  expect(sim.actors[1].damage).not.toBe(sim.actors[4].damage);
  sim.reset();
  expect(sim.events).toHaveLength(0);
  expect(sim.actors.every(a=>a.damage.compartments.every(c=>c.waterM3===0))).toBe(true);
}, 30000);
