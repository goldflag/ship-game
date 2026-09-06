/** Plan-led revision 2. Emits apply_patch; originals and registrations stay in assets.
 * bun assets/ships/convoy/author-blueprints-v2.ts <ship-id>
 * Historical GA coordinates are measured in plans-v2.json; transverse interpolation
 * and gameplay loading remain explicitly reconstructed, not certified offsets.
 */
import { readFileSync, existsSync } from 'node:fs';
import { compileShip, type ShipBlueprint, type Vec3 } from '../../../src/ships/blueprint';
import { hydrostatics, initialMetacenter } from '../../../src/simulation/hydrostatics';
import { hullContains, interpolate } from '../../../src/simulation/hull';

const basis = 'Provisional gameplay calibration; rates, ammunition, penetration, dispersion and damage are not certified historical firing data.';
const catalogPath = 'assets/parts/guns.json';
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const target = process.argv[2];
if (!['liberty-cargo', 'liberty-collier', 'victory-cargo', 'flower-corvette'].includes(target)) throw new Error('Expected a revision 2 convoy ship ID');
const flower = target === 'flower-corvette', collier = target === 'liberty-collier', victory = target === 'victory-cargo';
const plans = JSON.parse(readFileSync('assets/ships/convoy/plans-v2.json','utf8'));
const plan = plans[target];
const {length, beam, draft} = plan;
// No cosmetic load variants in revision 2.
const b: ShipBlueprint = {
  schemaVersion: 1, id: target, name: plan.name,
  configuration: plan.configuration,
  coordinates: 'meters-y-up-bow-negative-z', modelUrl: `/models/${target}.glb`,
  hull: { kind: 'authored-stations-v1', length, beam, draft, depth: flower ? 8.5 : 15, massKg: plan.massKg, waterplaneAreaM2: 1, reserveBuoyancyM3: 1, halfBreadths: [], deckHeights: [], keelHeights: [], sections: [] },
  handling: { forwardSpeed: (flower ? 16 : victory ? 15 : 11) * .514444, reverseSpeed: flower ? 2.4 : 1.7, acceleration: flower ? .22 : victory ? .10 : .065, braking: flower ? .18 : .075, rudderRate: flower ? .28 : .14, maxYawRate: flower ? .035 : .014 },
  mounts: [], armor: [], modules: [], compartments: [], connections: [], floodRegions: [], obstructions: [], structures: [],
  structuralPlating: { hullMm: flower ? 8 : 14, superstructureMm: 5, note: 'Estimated ordinary steel shell and deckhouses, not armor. Complete blueprint section loft is shared with visible hull and CPU hits.' },
  viewpoints: { bridge: flower ? [0, 8.7, -8.7] : collier ? [0,12,-24] : [0, 12.5, -6] },
  accuracy: {
    exterior: plan.evidence,
    internals: 'Estimated watertight envelopes, permeability, machinery and magazines. Finite-angle stability calibrated to stated displacement and an estimated GM; room boundaries are not historical plans.',
    weapons: flower ? '4-inch, aft 2-pounder and two twin Lewis light mounts. Early-war representative hardware, not a certified Cobalt weapons inventory. No later Hedgehog or Type 271 lantern. Depth charges and minesweeping equipment are visual only.' : 'Representative armed merchant battery: aft 5-inch, bow 3-inch and Oerlikons. Dated weapons inventory is unresolved for the collier. Shared CPU surface gunnery; game ballistics and ammunition.',
  },
  damageControl: { version: 1, teams: 2, setupSeconds: 10, repairPoints: flower ? 75 : 100, roomFuelSeconds: 110, mountFuelSeconds: 50, suppressionPerSecond: .055, portablePumpM3PerSecond: .018, repairHpPerSecond: .45, repairCeiling: .6, patchM2PerSecond: .002, maxPatchM2: .10, flashProtection: .3, basis },
};
const fractions = [...new Set<number>([...Array.from({length:81},(_,i)=>i/80),...plan.deck.map((p:number[])=>p[0]),...plan.keel.map((p:number[])=>p[0]),...plan.breadth.map((p:number[])=>p[0])])].sort((a,b)=>a-b);
const widths: [number,number][] = plan.breadth;
// Monotone cubic interpolation rounds traced curves without overshooting the
// recorded dimensions. Deck steps intentionally remain piecewise linear.
function trace(table:[number,number][],at:number):number {
  const i=Math.max(0,Math.min(table.length-2,table.findIndex((p,j)=>j<table.length-1 && at>=p[0] && at<=table[j+1][0])));
  const slope=(j:number)=>(table[j+1][1]-table[j][1])/(table[j+1][0]-table[j][0]);
  const tangent=(j:number)=>{if(j===0)return slope(0);if(j===table.length-1)return slope(j-1);const a=slope(j-1),c=slope(j);return a*c<=0?0:2*a*c/(a+c);};
  const [x,a]=table[i],[end,c]=table[i+1],h=end-x,t=Math.max(0,Math.min(1,(at-x)/h));
  return (2*t**3-3*t*t+1)*a+(t**3-2*t*t+t)*h*tangent(i)+(-2*t**3+3*t*t)*c+(t**3-t*t)*h*tangent(i+1);
}
for (const t of fractions) {
  const station = t * length, w = trace(widths, t) * beam / 2;
  const top = interpolate(plan.deck,t), bottom = trace(plan.keel,t);
  // Flat merchant floor / tight turn of bilge; round whaler floor for Flower.
  // End sections narrow below their flare instead of reusing the maximum breadth.
  const submergedFullness=flower?interpolate([[0,.10],[.15,.72],[.32,.96],[.65,.95],[.85,.58],[1,.02]],t):interpolate([[0,.03],[.12,.6],[.27,1],[.65,1],[.84,.66],[1,.02]],t);
  const overhang=Math.max(0,Math.min(1,(bottom+2)/(top+2)));
  const fullness=submergedFullness+(Math.max(submergedFullness,.9)-submergedFullness)*overhang;
  const turn=flower?[[0,0],[.2,.018],[.4,.075],[.6,.19],[.76,.34],[.88,.52],[.96,.72],[1,1]]:[[0,0],[.3,0],[.58,.01],[.76,.03],[.88,.085],[.96,.18],[.996,.36],[1,1]];
  const shoulder=Math.max(bottom+.002,Math.min(0,top-.015));
  const points: [number,number][] = turn.map(([fw,fh])=>[w*fw*fullness,bottom+(shoulder-bottom)*fh]);
  // A ring index must describe the same surface at EVERY station. Sorting a
  // mixture of absolute and relative heights made rings exchange positions at
  // the counter, creating the diagonal creases found in the first review.
  const edgeWidth=(z:number)=>w*(fullness+(1-fullness)*Math.sin(Math.min(1,(z-shoulder)/(top-shoulder))*Math.PI/2));
  for(const [i,h] of [0,.18,.42,.8,1.3].entries()) {
    const z=Math.max(shoulder+(i+1)*.0001,Math.min(top-.006,h));
    points.push([edgeWidth(z),z]);
  }
  const upperStart=points.at(-1)![1];
  for(const ratio of [.3,.55,.8,1]) {const z=upperStart+(top-upperStart)*ratio;points.push([edgeWidth(z),z]);}
  b.hull.halfBreadths.push([station,w]); b.hull.deckHeights.push([station,top]); b.hull.keelHeights.push([station,bottom]); b.hull.sections!.push({station,points});
}
const deck = (x:number) => interpolate(b.hull.deckHeights,x+length/2);
function structure(id:string,name:string,x:number,y:number,z:number,l:number,w:number,height:number,material='naval') {
  b.structures!.push({id,name,footprint:[[-y-w/2,-x-l/2],[-y+w/2,-x-l/2],[-y+w/2,-x+l/2],[-y-w/2,-x+l/2]],baseY:z,height,material});
  b.obstructions.push({id,center:[-y,z+height/2,-x],size:[w,height,l]});
}
function mount(id:string,name:string,partId:string,battery:'main'|'secondary',x:number,y:number,z:number,bearingDeg:number,magazineId:string) { b.mounts.push({id,name,partId,battery,position:[-y,z,-x],bearingDeg,magazineId,rangefinder:false}); }
if (flower) {
  structure('aft-casing','Engine and boiler casing',-5.6,0,2.35,23.2,5.65,1.15);
  structure('bridge-house','Wheelhouse and wireless office',7.8,0,3.05,4.9,5.15,3.65);
  structure('bridge-wings','Open compass platform',7.35,0,6.70,6.05,6.8,.15);
  structure('wheelhouse','Upper conning shelter',9.00,0,6.85,2.65,2.65,1.95);
  structure('signal-house','Signal lockers and ladder trunk',5.6,0,6.85,1.25,2.9,1.15);
  structure('funnel-casing','Raised boiler ventilator casing',-1.9,0,3.5,5.6,5.1,.90);
  structure('funnel','Circular funnel',-1.9,0,4.4,2.7,2.7,7.25,'funnel');
  structure('aft-bandstand','Aft gun platform',-16.8,0,4.9,6.2,4.4,.14);
  for(const side of [-1,1]) structure('boat-platform-'+(side>0?'port':'starboard'),'Dinghy platform',-1.9,side*3.7,3.75,6.4,1.9,.13);
  mount('fore-4in','Forward 4-inch','bl-4in-mk9-single','main',16.8,0,5.40,0,'forward-magazine');
  mount('aft-pompom','Aft pom-pom','qf-2pdr-single','secondary',-16.8,0,5.04,180,'aft-magazine');
  for (const side of [-1,1]) mount(`bridge-${side>0?'port':'starboard'}`,`${side>0?'Port':'Starboard'} twin Lewis`,'lewis-303-twin','secondary',7.9,side*3.1,6.85,side>0?-90:90,'forward-magazine');
} else if(collier) {
  structure('poop-house','Long machinery poop and accommodation',-50.2,0,2.75,29.223,14.6,2.75);
  structure('boat-deck','Engineers boat-deck house',-48.7,0,5.5,19.5,10.6,2.5);
  structure('funnel','Aft funnel',-49.0,0,8.0,3.2,3.0,6.5,'funnel');
  structure('midship-house','Detached navigation house',22.5,0,2.96,8.6,9.5,2.7);
  structure('bridge-deck','Navigation accommodation',22.5,0,5.66,8.6,8.8,2.6);
  structure('wheelhouse','Navigation bridge',24.5,0,8.26,4.6,9.1,2.3);
  structure('bridge-wings','Flying bridge',24.0,0,10.56,6.3,11.6,.18);
  for(const [i,x] of [49,34,10,-8,-26].entries()) {
    for(const [j,offset] of [-3.25,3.25].entries()) structure(`hatch-${i+1}-${j+1}`,`Hold ${i+1} steel hatch ${j+1}`,x+offset,0,deck(x+offset),6.096,9.144,.9144,'hatch');
  }
} else {
  const shift=victory?-1.8:0;
  structure('midship-house','Accommodation block',-3+shift,0,deck(-3),24.8,12.2,2.7);
  structure('boat-deck','Boat deck house',-2+shift,0,deck(-3)+2.7,22.5,10.0,2.55);
  if(victory) structure('bridge-deck-house','Upper bridge-deck accommodation',-4.8,0,deck(-3)+5.25,20,8.0,2.1);
  const bridgeRise=victory?2.1:0;
  structure('wheelhouse','Navigation bridge',6+shift,0,deck(-3)+5.25+bridgeRise,5.6,10.4,2.4);
  structure('bridge-wings','Flying bridge',6+shift,0,deck(-3)+7.65+bridgeRise,6.3,13.5,.18);
  structure('funnel','Funnel jacket',-3.8+shift,0,deck(-3)+5.25+bridgeRise,3.5,3.05,victory?7.8:7.6,'funnel');
  const hatchXs=victory?[51,36.5,17.4,-24.5,-45]:[49,30,10.8,-24.5,-47];
  for (const [i,x] of hatchXs.entries()) structure(`hatch-${i+1}`,`No. ${i+1} cargo hatch`,x,0,deck(x),victory?(i<2?7.4:10.8):(i===2?6.8:10.8),victory?6.9:7.6,.9,'hatch');
  structure('poop-house','Armed guard quarters',victory?-58:-58.7,0,deck(-58),9.4,8.7,2.2);
}
if(!flower) {
  const aftX=collier?-62.3:victory?-65:-61.2, foreX=length*.459;
  const aftZ=collier?6.8:deck(aftX)+2.4;
  mount('aft-5in','Stern 5-inch','us-5in38-mk21-single','main',aftX,0,aftZ,180,'aft-magazine');
  mount('fore-3in','Bow 3-inch','us-3in50-single','secondary',foreX,0,deck(foreX)+1.3,0,'forward-magazine');
  const wings=b.structures!.find(s=>s.id==='bridge-wings')!;
  const wx=-wings.footprint.reduce((n,p)=>n+p[1],0)/wings.footprint.length;
  for(const side of [-1,1]) {
    const label=side>0?'port':'starboard',bearing=side>0?-90:90;
    mount('bow-aa-'+label,'Bow '+label+' Oerlikon','oerlikon-20mm-single','secondary',length*.406,side*4.6,deck(length*.406)+1.15,bearing,'forward-magazine');
    for(const [i,x] of (collier?[wx]:victory?[wx+1.15,-10.4]:[wx+1.75,wx-2.15]).entries()) {
      const base=victory&&i===1?deck(-3)+7.35:wings.baseY+wings.height;
      if(victory&&i===1) structure('aft-bridge-platform-'+label,'Aft bridge-deck gun sponson',x,side*5.7,base-.12,2.8,2.6,.12);
      mount(`bridge-aa-${label}-${i+1}`,`Bridge ${label} ${i+1}`,'oerlikon-20mm-single','secondary',x,side*(collier?5.05:5.9),base,bearing,'forward-magazine');
    }
    mount('aft-aa-'+label,'Aft '+label+' Oerlikon','oerlikon-20mm-single','secondary',collier?-39:-53.5,side*5.4,collier?5.65:deck(-53.5)+2.3,bearing,'aft-magazine');
  }
}
// Circular funnel footprint is also the CPU hit surface, not a box proxy.
const funnel=b.structures!.find(s=>s.id==='funnel')!;
const funnelX=-funnel.footprint.reduce((n,p)=>n+p[1],0)/funnel.footprint.length;
const funnelLength=Math.max(...funnel.footprint.map(p=>p[1]))-Math.min(...funnel.footprint.map(p=>p[1]));
const funnelWidth=Math.max(...funnel.footprint.map(p=>p[0]))-Math.min(...funnel.footprint.map(p=>p[0]));
funnel.footprint=Array.from({length:24},(_,i)=>[Math.sin(i*Math.PI/12)*funnelWidth/2,-funnelX+Math.cos(i*Math.PI/12)*funnelLength/2]);
// Longitudinal watertight spaces filled with disjoint conservative hull-contained cells.
const rooms: [string,string,number,number][] = collier ? [
 ['forepeak','Forepeak',.015,.08],['forward-magazine-room','Forward magazine',.08,.105],['hold-1','No. 1 coal hold',.105,.205],['hold-2','No. 2 coal hold',.205,.34],['hold-3','No. 3 coal hold',.34,.48],['hold-4','No. 4 coal hold',.48,.615],['hold-5','No. 5 coal hold',.615,.745],['engine-room','Aft triple-expansion engine room',.745,.835],['boiler-room','Aft raised boiler room',.835,.89],['aft-magazine-room','Armed guard magazine',.89,.923],['steering-room','Steering and shaft tunnel',.923,.975],['afterpeak','Afterpeak',.975,.988],
] : flower ? [
 ['forepeak','Forepeak',.02,.12],['forward-magazine-room','Forward magazine',.12,.25],['forward-mess','Forward mess',.25,.42],['boiler-room','Boiler room',.42,.64],['engine-room','Engine room',.64,.78],['aft-magazine-room','Aft magazine',.78,.84],['steering-room','Steering and shaft tunnel',.84,.95],['afterpeak','Afterpeak',.95,.985],
] : [['forepeak','Forepeak',.02,.085],['forward-magazine-room','Forward magazine',.085,.13],['hold-1','No. 1 hold',.13,.23],['hold-2','No. 2 hold',.23,.355],['hold-3','No. 3 hold',.355,.43],['boiler-room','Two-boiler room',.43,.52],['engine-room',victory?'Geared turbine engine room':'Triple-expansion engine room',.52,.60],['hold-4','No. 4 hold',.60,.75],['hold-5','No. 5 hold',.75,.855],['aft-magazine-room','Armed guard magazine',.855,.91],['steering-room','Steering and shaft tunnel',.91,.965],['afterpeak','Afterpeak',.965,.99]];
for(const [id,name,front,back] of rooms) {
  const z0=-length/2+length*front,z1=-length/2+length*back, sizeZ=(z1-z0)/2, dy=flower?.7:1.1, cells:{center:Vec3,size:Vec3}[]=[];
  for(let iz=0;iz<2;iz++) for(let y=-draft+.18;y+dy<Math.max(...b.hull.deckHeights.map(p=>p[1]))-.1;y+=dy) {
    const cz=z0+(iz+.5)*sizeZ;
    let lo=0,hi=beam/2;
    for(let n=0;n<16;n++){const w=(lo+hi)/2;const inside=[y,y+dy].every(h=>[-1,1].every(end=>hullContains(b.hull,[w,h,cz+end*sizeZ/2])));if(inside)lo=w;else hi=w;}
    if(lo<.16)continue;
    const w=lo-.06;
    for(const side of [-1,1]) cells.push({center:[side*w/2,y+dy/2,cz],size:[w,dy,sizeZ]});
  }
  if(!cells.length)throw new Error('Empty room '+id);
  const min=[0,1,2].map(a=>Math.min(...cells.map(c=>c.center[a]-c.size[a]/2))),max=[0,1,2].map(a=>Math.max(...cells.map(c=>c.center[a]+c.size[a]/2)));
  const center=min.map((n,a)=>(n+max[a])/2) as Vec3,size=min.map((n,a)=>max[a]-n) as Vec3;
  const permeability=id.includes('hold')?.70:.88;
  b.compartments.push({id,name,center,size,cells,capacityM3:cells.reduce((n,c)=>n+c.size[0]*c.size[1]*c.size[2],0)*permeability,pumpM3PerSecond:id.includes('room')?.025:.006});
  b.floodRegions!.push({id:id+'-shell',compartmentId:id,center:[0,(Math.max(...b.hull.deckHeights.map(p=>p[1]))-draft)/2,(z0+z1)/2],size:[beam+.2,draft+Math.max(...b.hull.deckHeights.map(p=>p[1]))+.2,z1-z0]});
}
function module(id:string,name:string,kind:'engine'|'steering'|'magazine',roomId:string,role?:'boiler'|'combined-drive'|'shaft',offset=0) {
  const room=b.compartments.find(c=>c.id===roomId)!;
  const size:Vec3=[Math.min(room.size[0]*.55,flower?2.2:4), Math.min(room.size[1]*.4,flower?1.4:2.8),Math.min(room.size[2]*.5,flower?2:4.5)];
  if(role==='shaft') { size[0]=.5; size[1]=.5; }
  // ABS describes the collier boiler platform as 21 feet above the baseline.
  const wantedY=kind==='steering'?.5:collier&&role==='boiler'?-draft+6.4008+size[1]/2:-draft+(flower?2:4);
  const center:Vec3=[offset,Math.max(room.center[1]-room.size[1]/2+size[1]/2+.1,Math.min(room.center[1]+room.size[1]/2-size[1]/2-.1,wantedY)),room.center[2]];
  for(let iteration=0;iteration<30;iteration++) {
    const inside=Array.from({length:8},(_,i)=>center.map((n,a)=>n+((i>>a)&1?1:-1)*size[a]/2) as Vec3).every(p=>hullContains(b.hull,p));
    if(inside)break;
    size.forEach((n,a)=>size[a]=n*.9);
  }
  b.modules.push({id,name,kind,compartmentId:roomId,center,size,hp:kind==='engine'?(flower?100:200):80,immersionToleranceM:Math.min(.65,size[1]),...(role?{role}:{})});
}
module('boiler-port','Port boiler','engine','boiler-room','boiler',flower?-1.15:-2.2);
module('boiler-starboard','Starboard boiler','engine','boiler-room','boiler',flower?1.15:2.2);
module('main-engine',victory?'Geared steam turbine':'Triple-expansion engine','engine','engine-room','combined-drive');
module('shaft','Single shaft','engine','steering-room','shaft');
module('steering','Steering gear','steering','steering-room');
module('forward-magazine','Forward ammunition','magazine','forward-magazine-room');
module('aft-magazine','Aft ammunition','magazine','aft-magazine-room');
b.propulsion={groups:[{id:'single-screw',share:1,boilerIds:['boiler-port','boiler-starboard'],driveIds:['main-engine'],shaftIds:['shaft']}],basis:'Two boilers supply a single drive and shaft. Victory uses a geared steam turbine; Liberty and Flower use reciprocating steam. Routing and damage aggregation are gameplay estimates.'};
for(let i=1;i<b.compartments.length;i++){const a=b.compartments[i-1],c=b.compartments[i];const position:Vec3=[0,-draft/2,(a.center[2]+a.size[2]/2+c.center[2]-c.size[2]/2)/2];b.connections.push({id:`boundary-${i}`,fromId:a.id,toId:c.id,areaM2:.12,state:'closed',position,thicknessMm:5,bounds:{center:position,size:[Math.min(a.size[0],c.size[0]),Math.min(a.size[1],c.size[1]),.08]}});}
const hydro=hydrostatics(b.hull),full=hydrostatics(b.hull,-length), gm=flower?.90:collier?1.45:victory?1.20:1.25;
b.hull.reserveBuoyancyM3=full.volume-hydro.volume;
b.hull.waterplaneAreaM2=(hydrostatics(b.hull,-.02).volume-hydrostatics(b.hull,.02).volume)/.04;
b.stability={version:1,dryCenterOfGravity:[0,initialMetacenter(b.hull)-gm,hydro.center[2]],buoyancyScale:b.hull.massKg/(1025*hydro.volume),shellThicknessMm:flower?8:14,basis:`Uniform displacement calibration at the declared draft. Estimated initial GM ${gm} m; longitudinal CG aligned to upright buoyancy center. Not an historical stability curve.`};
compileShip(b,catalog);
const folder=`assets/ships/${target}`;
function pretty(value:unknown,depth=0):string {
  const flat=JSON.stringify(value,(_,v)=>typeof v==='number'?Math.round(v*1e8)/1e8:v);
  if(flat.length<160 || !value || typeof value!=='object')return flat;
  const indent='  '.repeat(depth),child='  '.repeat(depth+1);
  return Array.isArray(value)?'[\n'+value.map(v=>child+pretty(v,depth+1)).join(',\n')+'\n'+indent+']':'{\n'+Object.entries(value).map(([k,v])=>child+JSON.stringify(k)+': '+pretty(v,depth+1)).join(',\n')+'\n'+indent+'}';
}
const output:Record<string,string>={
 [`${folder}/blueprint.json`]:pretty(b)+'\n',
 [`${folder}/build.py`]:`"""Original versioned convoy components; see the registered recipe inputs."""\nfrom pathlib import Path\nimport runpy\nrunpy.run_path(str(Path(__file__).resolve().parents[1]/'convoy/geometry-v2.py'),run_name='__main__')\n`,
 [`${folder}/recipe-inputs.json`]:JSON.stringify({version:1,files:['assets/ships/convoy/geometry-v2.py','assets/ships/convoy/plans-v2.json']},null,2)+'\n',
 [`${folder}/reports/stability.json`]:JSON.stringify({configuration:b.configuration,draftM:draft,massKg:b.hull.massKg,geometryDisplacementM3:hydro.volume,fullEnvelopeM3:full.volume,reserveM3:b.hull.reserveBuoyancyM3,buoyancyScale:b.stability.buoyancyScale,estimatedGmM:gm,dryCenterOfGravity:b.stability.dryCenterOfGravity,floodCapacityM3:b.compartments.reduce((n,c)=>n+c.capacityM3,0),basis:b.stability.basis},null,2)+'\n',
};
let patch='*** Begin Patch\n';
for(const [path,content] of Object.entries(output)) {
  if(existsSync(path)){patch+=`*** Update File: ${path}\n@@\n`+readFileSync(path,'utf8').trimEnd().split('\n').map(l=>'-'+l).join('\n')+'\n';}
  else patch+=`*** Add File: ${path}\n`;
  patch+=content.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n';
}
console.log(patch+'*** End Patch');
