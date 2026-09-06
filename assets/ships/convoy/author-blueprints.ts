/** Original convoy hull/layout authoring. Emits apply_patch input; never overwrites assets.
 * bun assets/ships/convoy/author-blueprints.ts <ship-id|catalog>
 * Edit the versioned blueprint directly for subsequent per-ship refinements.
 */
import { readFileSync, existsSync } from 'node:fs';
import { compileShip, type ShipBlueprint, type GunPart, type Vec3 } from '../../../src/ships/blueprint';
import { hydrostatics, initialMetacenter } from '../../../src/simulation/hydrostatics';
import { hullContains, interpolate } from '../../../src/simulation/hull';

const basis = 'Provisional gameplay calibration; rates, ammunition, penetration, dispersion and damage are not certified historical firing data.';
const catalogPath = 'assets/parts/guns.json';
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const newParts: GunPart[] = [
  { id: 'us-3in50-single', name: '3-inch/50 defensive gun', caliberM: .0762, massKg: 3000, barbetteRadius: .85, gunhouseSize: [2.5, 1.9, 1.6], pivotHeight: 1.3, trunnionForward: .2, muzzleForward: 3.35, barrelBaseRadius: .10, traverseDeg: 155, elevationMaxDeg: 85, reloadSeconds: 5, muzzleSpeed: 823, projectileMassKg: 5.9, penetrationMm: 38, damage: 7, recoilM: .28, ammoPerBarrel: 240, armorMm: 4 },
  { id: 'bl-4in-mk9-single', name: 'BL 4-inch Mk IX shielded gun', caliberM: .1016, massKg: 6000, barbetteRadius: 1.05, gunhouseSize: [3.15, 2.55, 2.15], pivotHeight: 1.45, trunnionForward: .25, muzzleForward: 4.1, barrelBaseRadius: .13, traverseDeg: 145, elevationMaxDeg: 30, reloadSeconds: 6, muzzleSpeed: 732, projectileMassKg: 14.1, penetrationMm: 55, damage: 12, recoilM: .36, ammoPerBarrel: 240, armorMm: 6 },
  { id: 'qf-2pdr-single', name: 'QF 2-pounder pom-pom', caliberM: .04, massKg: 650, barbetteRadius: .65, gunhouseSize: [1.6, 1.3, 1.7], pivotHeight: 1.25, trunnionForward: .12, muzzleForward: 1.85, barrelBaseRadius: .065, traverseDeg: 165, elevationMaxDeg: 80, reloadSeconds: .8, muzzleSpeed: 585, projectileMassKg: .91, penetrationMm: 15, damage: 2.2, recoilM: .10, ammoPerBarrel: 1000, armorMm: 3 },
].map(p => ({ kind: 'gun', barrelCount: 1, mountingStyle: 'open-pedestal', barrelSpacing: .1, traverseRateDeg: 18, elevationMinDeg: -10, elevationRateDeg: 15, ...p,
  ballistics: { dragPerSecond: p.caliberM < .05 ? .13 : p.caliberM < .08 ? .10 : .065, dispersionRad: .0015, muzzleSpeedSigmaFraction: .003, penetrationReferenceSpeedMps: p.muzzleSpeed * .7, basis },
  ...(p.caliberM > .05 ? { ap: { armingResistanceMm: p.caliberM * 1000 / 6, fuzeDelaySeconds: .02, explosiveKg: p.projectileMassKg * .025, fragmentPenetrationMm: p.caliberM * 80, basis } } : {}),
  he: { explosiveKg: p.projectileMassKg * .08, fragmentPenetrationMm: p.caliberM * 1000 / 6, damage: p.damage * 2, stockFraction: .6, basis },
})) as GunPart[];
const target = process.argv[2];
if (target === 'catalog') {
  const missing = newParts.filter(p => !catalog.parts.some((v: GunPart) => v.id === p.id));
  if (!missing.length) throw new Error('Convoy catalog parts already exist');
  const entries = missing.map(p => JSON.stringify(p, null, 2).split('\n').map(l => '    ' + l).join('\n')).join(',\n');
  console.log('*** Begin Patch\n*** Update File: ' + catalogPath + '\n@@\n-    }\n-  ],\n-  "torpedoes": [\n+    },\n' + entries.split('\n').map(l=>'+'+l).join('\n') + '\n+  ],\n+  "torpedoes": [\n*** End Patch');
  process.exit(0);
}
if (!['liberty-cargo', 'liberty-deck-cargo', 'liberty-troopship', 'flower-corvette'].includes(target)) throw new Error('Expected a convoy ship ID or catalog');
const flower = target === 'flower-corvette', troop = target === 'liberty-troopship', cargo = target === 'liberty-deck-cargo';
const length = flower ? 62.5 : 134.5692, beam = flower ? 10.1 : 17.0688, draft = flower ? 3.5 : 8.46;
const b: ShipBlueprint = {
  schemaVersion: 1, id: target, name: flower ? 'Flower Corvette' : troop ? 'Liberty Troopship' : cargo ? 'Liberty Deck Cargo' : 'Liberty Cargo',
  configuration: flower ? 'Flower class, extended forecastle, 1943–44 representative escort; surface combat' : `EC2-S-C1 Liberty, 1943–44 representative ${troop ? 'limited-capacity troop transport' : cargo ? 'vehicle deck cargo' : 'general cargo'} fit`,
  coordinates: 'meters-y-up-bow-negative-z', modelUrl: `/models/${target}.glb`,
  hull: { kind: 'authored-stations-v1', length, beam, draft, depth: flower ? 8 : 13.3, massKg: flower ? 965200 : 14478000, waterplaneAreaM2: 1, reserveBuoyancyM3: 1, halfBreadths: [], deckHeights: [], keelHeights: [], sections: [] },
  handling: { forwardSpeed: (flower ? 16 : 11) * .514444, reverseSpeed: flower ? 2.4 : 1.7, acceleration: flower ? .22 : .065, braking: flower ? .18 : .075, rudderRate: flower ? .28 : .14, maxYawRate: flower ? .035 : .014 },
  mounts: [], armor: [], modules: [], compartments: [], connections: [], floodRegions: [], obstructions: [], structures: [],
  structuralPlating: { hullMm: flower ? 8 : 14, superstructureMm: 5, note: 'Estimated ordinary steel shell and deckhouses, not armor. Complete blueprint section loft is shared with visible hull and CPU hits.' },
  viewpoints: { bridge: flower ? [0, 8.5, -6.4] : [0, 12.5, -9.5] },
  accuracy: {
    exterior: flower ? 'Original representative extended-forecastle Flower. RCN Sackville dimensions; interpreted hull sections and fittings. Generic Western Approaches colors, not a dated camouflage reconstruction.' : 'Original representative Liberty EC2-S-C1. Published length/beam and five holds; interpreted sections, cargo, fittings and loading. No claim to reproduce a specific named ship.',
    internals: 'Estimated watertight envelopes, permeability, machinery and magazines. Finite-angle stability calibrated to stated displacement and an estimated GM; room boundaries are not historical plans.',
    weapons: flower ? '4-inch, 2-pounder and two Oerlikons use shared CPU gunnery. Hedgehog and depth charges are visual only; no sonar or antisubmarine weapons simulation. Gun shields, ballistics and ammunition are approximations.' : 'Aft 5-inch main battery; forward 3-inch and eight Oerlikons in secondary battery. Troop fit adds two aft 3-inch guns. Surface fire only; ballistics and ammunition are gameplay approximations.',
  },
  damageControl: { version: 1, teams: flower ? 2 : troop ? 3 : 2, setupSeconds: 10, repairPoints: flower ? 75 : 100, roomFuelSeconds: cargo ? 170 : 110, mountFuelSeconds: 50, suppressionPerSecond: .055, portablePumpM3PerSecond: .018, repairHpPerSecond: .45, repairCeiling: .6, patchM2PerSecond: .002, maxPatchM2: .10, flashProtection: .3, basis },
};
const fractions = [0,.018,.04,.075,.12,.18,.25,.32,.4,.47,.50,.53,.57,.62,.68,.75,.82,.88,.93,.965,.985,1];
const widths: [number,number][] = [[0,0],[.018,.18],[.04,.43],[.075,.64],[.12,.82],[.18,.94],[.25,.995],[.32,1],[.57,1],[.68,.96],[.75,.88],[.82,.74],[.88,.55],[.93,.34],[.965,.17],[.985,.055],[1,0]];
for (const t of fractions) {
  const station = t * length, w = interpolate(widths, t) * beam / 2;
  const top = flower ? interpolate([[0,2.1],[.4,1.8],[.47,1.8],[.5,4.1],[.82,4.2],[1,4.5]],t) : interpolate([[0,4.1],[.15,3.05],[.6,3.05],[.82,3.3],[1,4.84]],t);
  const bottom = -draft + (t < .12 ? (.12-t)/.12 * (draft-1) : t > .88 ? (t-.88)/.12 * (draft-.9) : 0);
  const points: [number,number][] = [[0,bottom],[w*.40,bottom*.98],[w*.7,bottom*.86],[w*.9,bottom*.62],[w*.985,Math.min(-.31,bottom*.3)],[w,-.3],[w,0],[w*.995,.45],[w*.98,top*.65],[w*.96,top]];
  b.hull.halfBreadths.push([station,w]); b.hull.deckHeights.push([station,top]); b.hull.keelHeights.push([station,bottom]); b.hull.sections!.push({station,points});
}
const deck = (x:number) => interpolate(b.hull.deckHeights,x+length/2);
function structure(id:string,name:string,x:number,y:number,z:number,l:number,w:number,height:number,material='naval') {
  b.structures!.push({id,name,footprint:[[-y-w/2,-x-l/2],[-y+w/2,-x-l/2],[-y+w/2,-x+l/2],[-y-w/2,-x+l/2]],baseY:z,height,material});
  b.obstructions.push({id,center:[-y,z+height/2,-x],size:[w,height,l]});
}
function mount(id:string,name:string,partId:string,battery:'main'|'secondary',x:number,y:number,z:number,bearingDeg:number,magazineId:string) { b.mounts.push({id,name,partId,battery,position:[-y,z,-x],bearingDeg,magazineId,rangefinder:false}); }
if (flower) {
  structure('bridge-house','Wheelhouse',4.4,0,4.1,7,5.5,2.3);
  structure('bridge-wings','Bridge wings',5.1,0,6.4,4.8,8.3,.24);
  structure('aft-casing','Machinery casing',-7,0,deck(-7),12,4.5,1.5);
  structure('funnel','Funnel jacket',-1.8,0,4.2,2.1,1.9,5.3,'funnel');
  mount('fore-4in','Forward 4-inch','bl-4in-mk9-single','main',20,0,deck(20)+.3,0,'forward-magazine');
  mount('aft-pompom','Aft pom-pom','qf-2pdr-single','secondary',-14,0,deck(-14)+2.1,180,'aft-magazine');
  for (const side of [-1,1]) mount(`bridge-${side>0?'port':'starboard'}`,`${side>0?'Port':'Starboard'} Oerlikon`,'oerlikon-20mm-single','secondary',4.8,side*3.65,6.64,side>0?-90:90,'forward-magazine');
} else {
  structure('midship-house','Accommodation block',-1.3,0,3.05,25,11.4,2.7);
  structure('boat-deck','Boat deck house',.3,0,5.75,20,9.2,2.55);
  structure('wheelhouse','Navigation bridge',8,0,8.3,5.4,10.6,2.5);
  structure('bridge-wings','Flying bridge',8,0,10.8,6.2,13.5,.25);
  structure('funnel','Funnel jacket',-3.8,0,8.3,3.6,3,6.5,'funnel');
  for (const [i,x] of [49,30,16,-27,-46].entries()) structure(`hatch-${i+1}`,`No. ${i+1} cargo hatch`,x,0,deck(x),i===2?7:11,7,.9,'hatch');
  structure('poop-house','Armed guard quarters',-57,0,deck(-57),10,8.5,2.1);
  mount('aft-5in','Stern 5-inch','us-5in38-mk21-single','main',-57,0,deck(-57)+2.3,180,'aft-magazine');
  mount('fore-3in','Bow 3-inch','us-3in50-single','secondary',59,0,deck(59)+1.25,0,'forward-magazine');
  for (const side of [-1,1]) {
    const label=side>0?'port':'starboard', bearing=side>0?-90:90;
    mount(`bow-aa-${label}`,`Bow ${label} Oerlikon`,'oerlikon-20mm-single','secondary',55,side*3.5,deck(55)+1,bearing,'forward-magazine');
    for(const [index,x] of [10.1,5.8].entries()) mount(`bridge-aa-${label}-${index+1}`,`Bridge ${label} ${index+1}`,'oerlikon-20mm-single','secondary',x,side*5.9,11.05,bearing,'forward-magazine');
    mount(`aft-aa-${label}`,`Aft ${label} Oerlikon`,'oerlikon-20mm-single','secondary',-50,side*5.1,deck(-50)+2.2,bearing,'aft-magazine');
    if(troop) mount(`aft-3in-${label}`,`Aft ${label} 3-inch`,'us-3in50-single','secondary',-56,side*4.4,deck(-56)+2.3,bearing,'aft-magazine');
  }
  if(cargo) for (const [i,x] of [49,30,-27,-46].entries()) for(const side of [-1,1]) structure(`deck-load-${i}-${side>0?'port':'starboard'}`,'Lashed vehicle cargo',x,side*2,deck(x)+.9,5.8,2.4,2.4,'cargo');
  if(troop) for(const [i,x] of [30,-27].entries()) structure(`troop-shelter-${i+1}`,'Troop deck shelter',x,0,deck(x)+.9,9,6.4,1.8,'canvas');
}
// Longitudinal watertight spaces filled with disjoint conservative hull-contained cells.
const rooms: [string,string,number,number][] = flower ? [
 ['forepeak','Forepeak',.02,.12],['forward-magazine-room','Forward magazine',.12,.25],['forward-mess','Forward mess',.25,.42],['boiler-room','Boiler room',.42,.57],['engine-room','Engine room',.57,.72],['aft-magazine-room','Aft magazine',.72,.82],['steering-room','Steering and shaft tunnel',.82,.95],['afterpeak','Afterpeak',.95,.985],
] : [['forepeak','Forepeak',.02,.085],['forward-magazine-room','Forward magazine',.085,.13],['hold-1','No. 1 hold',.13,.23],['hold-2',troop?'No. 2 troop accommodation':'No. 2 hold',.23,.355],['hold-3','No. 3 hold',.355,.43],['boiler-room','Two-boiler room',.43,.52],['engine-room','Triple-expansion engine room',.52,.60],['hold-4',troop?'No. 4 troop accommodation':'No. 4 hold',.60,.75],['hold-5','No. 5 hold',.75,.855],['aft-magazine-room','Armed guard magazine',.855,.91],['steering-room','Steering and shaft tunnel',.91,.965],['afterpeak','Afterpeak',.965,.99]];
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
  const permeability=id.includes('hold')?(troop?.82:.70):.88;
  b.compartments.push({id,name,center,size,cells,capacityM3:cells.reduce((n,c)=>n+c.size[0]*c.size[1]*c.size[2],0)*permeability,pumpM3PerSecond:id.includes('room')?.025:.006});
  b.floodRegions!.push({id:id+'-shell',compartmentId:id,center:[0,(Math.max(...b.hull.deckHeights.map(p=>p[1]))-draft)/2,(z0+z1)/2],size:[beam+.2,draft+Math.max(...b.hull.deckHeights.map(p=>p[1]))+.2,z1-z0]});
}
function module(id:string,name:string,kind:'engine'|'steering'|'magazine',roomId:string,role?:'boiler'|'combined-drive'|'shaft',offset=0) {
  const room=b.compartments.find(c=>c.id===roomId)!;
  const size:Vec3=[Math.min(room.size[0]*.55,flower?2.2:4), Math.min(room.size[1]*.4,flower?1.4:2.8),Math.min(room.size[2]*.5,flower?2:4.5)];
  if(role==='shaft') { size[0]=.5; size[1]=.5; }
  const wantedY=kind==='steering'?.5:-draft+(flower?2:4);
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
module('main-engine','Triple-expansion engine','engine','engine-room','combined-drive');
module('shaft','Single shaft','engine','steering-room','shaft');
module('steering','Steering gear','steering','steering-room');
module('forward-magazine','Forward ammunition','magazine','forward-magazine-room');
module('aft-magazine','Aft ammunition','magazine','aft-magazine-room');
b.propulsion={groups:[{id:'single-screw',share:1,boilerIds:['boiler-port','boiler-starboard'],driveIds:['main-engine'],shaftIds:['shaft']}],basis:'Two boilers supply one reciprocating steam engine and one shaft. Routing and damage aggregation are gameplay estimates.'};
for(let i=1;i<b.compartments.length;i++){const a=b.compartments[i-1],c=b.compartments[i];const position:Vec3=[0,-draft/2,(a.center[2]+a.size[2]/2+c.center[2]-c.size[2]/2)/2];b.connections.push({id:`boundary-${i}`,fromId:a.id,toId:c.id,areaM2:.12,state:'closed',position,thicknessMm:5,bounds:{center:position,size:[Math.min(a.size[0],c.size[0]),Math.min(a.size[1],c.size[1]),.08]}});}
const hydro=hydrostatics(b.hull),full=hydrostatics(b.hull,-length), gm=flower?.85:troop?1.05:cargo?1.1:1.25;
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
 [`${folder}/build.py`]:`"""Original versioned convoy components; see the registered recipe inputs."""\nfrom pathlib import Path\nimport runpy\nrunpy.run_path(str(Path(__file__).resolve().parents[1]/'convoy/geometry-v1.py'),run_name='__main__')\n`,
 [`${folder}/recipe-inputs.json`]:JSON.stringify({version:1,files:['assets/ships/convoy/geometry-v1.py']},null,2)+'\n',
 [`${folder}/reports/stability.json`]:JSON.stringify({configuration:b.configuration,draftM:draft,massKg:b.hull.massKg,geometryDisplacementM3:hydro.volume,fullEnvelopeM3:full.volume,reserveM3:b.hull.reserveBuoyancyM3,buoyancyScale:b.stability.buoyancyScale,estimatedGmM:gm,dryCenterOfGravity:b.stability.dryCenterOfGravity,floodCapacityM3:b.compartments.reduce((n,c)=>n+c.capacityM3,0),basis:b.stability.basis},null,2)+'\n',
};
let patch='*** Begin Patch\n';
for(const [path,content] of Object.entries(output)) {
  if(existsSync(path)){patch+=`*** Update File: ${path}\n@@\n`+readFileSync(path,'utf8').trimEnd().split('\n').map(l=>'-'+l).join('\n')+'\n';}
  else patch+=`*** Add File: ${path}\n`;
  patch+=content.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n';
}
console.log(patch+'*** End Patch');
