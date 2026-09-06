import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CombatSimulation } from '../../src/simulation/combat';
import { shipPreset } from '../../src/ships/presets';
import { ShipView } from '../../src/game/ShipView';

// Fixed 48-ship firing workload on actual exported meshes. Time only cosmetic
// impact projection; texture decoding, renderer submission and GPU work are excluded.

const definition = shipPreset('bismarck');
const bytes = await Bun.file(new URL('../../public/models/bismarck.glb', import.meta.url)).arrayBuffer();
const length = new DataView(bytes).getUint32(12, true);
const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
const binary = new Uint8Array(bytes, 20 + length + 8);
gltf.buffers[0].uri = 'data:application/octet-stream;base64,' + Buffer.from(binary).toString('base64');
delete gltf.images; delete gltf.textures;
for (const material of gltf.materials) {
  for (const record of [material, material.pbrMetallicRoughness]) if (record) for (const key of Object.keys(record)) if (key.endsWith('Texture')) delete record[key];
}
Object.assign(globalThis, { ProgressEvent: class { constructor(readonly type: string) {} } });
const model = (await new GLTFLoader().parseAsync(JSON.stringify(gltf), '')).scene;
const sim = new CombatSimulation(definition, { friendlyBots:Array(23).fill(definition), enemies:Array(24).fill(definition) });

const views=sim.actors.map(actor=>new ShipView(model.clone(true),definition,actor));
const times:number[]=[],spikes:{tick:number;ms:number;impacts:number}[]=[];let impacts=0,sequence=0;
for(let tick=0;tick<3600;tick++) {
 sim.step({throttle:.5,rudder:0},{aim:[3000,.5,0],fire:true,battery:'main'});
 for(const v of views)v.update();
 const start=performance.now();const budget={remainingMs:2};for(let i=0;i<views.length;i++){const v=views[(i+sim.tick)%views.length];v.impactMarks.update(sim.events,v.actor.motion.id,budget);}const ms=performance.now()-start;times.push(ms);
 let n=0;for(const e of sim.events)if(e.sequence>sequence){sequence=e.sequence;if(e.impact)n++;}impacts+=n;
 if(n)spikes.push({tick,ms,impacts:n});
}
const queued=views.reduce((n,v)=>n+v.impactMarks.pendingCount,0);for(const v of views)v.impactMarks.update([],v.actor.motion.id);
times.sort((a,b)=>a-b);spikes.sort((a,b)=>b.ms-a.ms);
console.log(JSON.stringify({impacts,queued,marks:views.reduce((n,v)=>n+v.impactMarks.count,0),medianMs:times[1800],p99Ms:times[3564],maxMs:times.at(-1),worst:spikes.slice(0,10)},null,2));

for(const view of views)view.impactMarks.dispose();
