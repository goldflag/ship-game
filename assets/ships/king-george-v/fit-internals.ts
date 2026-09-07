/** Refit the retained gameplay envelopes after the original hull-line revision.
 * Run after author-blueprint.py, before author-flood-spaces / author-stability.
 * Stable room/module/armor IDs and machinery relationships are retained.
 */
import { hullContains } from '../../../src/simulation/hull';
import type { ShipBlueprint, Vec3 } from '../../../src/ships/blueprint';
const path=new URL('./blueprint.json',import.meta.url);
const b=await Bun.file(path).json() as ShipBlueprint;
const changes:object[]=[];
for(const room of b.compartments){
 const original=[...room.size];
 const fits=(factor:number)=>Array.from({length:8},(_,i)=>room.center.map((n,j)=>n+room.size[j]/2*(j<2?factor:1)*(i&(1<<j)?1:-1)) as Vec3).every(p=>hullContains(b.hull,p));
 if(fits(1))continue;
 let lo=0,hi=1;for(let i=0;i<30;i++){const mid=(lo+hi)/2;if(fits(mid))lo=mid;else hi=mid;}
 if(lo<.35)throw new Error(`Room needs a deliberate relocation: ${room.id}, scale=${lo}`);
 const factor=lo*.98;room.size=[room.size[0]*factor,room.size[1]*factor,room.size[2]];room.capacityM3*=factor*factor;
 for(const module of b.modules.filter(m=>m.compartmentId===room.id))module.size=[module.size[0]*factor,module.size[1]*factor,module.size[2]];
 changes.push({id:room.id,before:original,after:room.size});
}
function halfWidth(z:number,y:number){
 let lo=0,hi=b.hull.beam/2;for(let i=0;i<30;i++){const x=(lo+hi)/2;if(hullContains(b.hull,[x,y,z]))lo=x;else hi=x;}return Math.max(0,lo-.03);
}
for(const a of b.armor){
 if(!a.plate||a.id.includes('barbette'))continue;
 const vs=a.plate.vertices;
 for(const v of vs){
  const w=a.id.startsWith('belt-')?Math.min(...vs.filter(p=>p[2]===v[2]).map(p=>halfWidth(p[2],p[1]))):halfWidth(v[2],v[1]);
  v[0]=Math.sign(v[0])*Math.min(Math.abs(v[0]),w);
 }
 const lo=[0,1,2].map(i=>Math.min(...vs.map(v=>v[i]))),hi=[0,1,2].map(i=>Math.max(...vs.map(v=>v[i])));
 a.center=lo.map((n,i)=>(n+hi[i])/2) as Vec3;a.size=lo.map((n,i)=>Math.max(.001,hi[i]-n)) as Vec3;
}
await Bun.write(path,JSON.stringify(b,null,2)+'\n');
await Bun.write(new URL('./reports/hull-refit.json',import.meta.url),JSON.stringify({method:'Conservative corner containment of original room envelopes; reduce transverse and vertical extent together, retain stations and stable IDs. Hull-side armor clipped to the same authored sections.',changes},null,2)+'\n');
console.log('Refit',changes.length,'retained rooms to the revised hull');
