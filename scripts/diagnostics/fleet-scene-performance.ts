import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CombatSimulation } from '../../src/simulation/combat';
import { shipPreset } from '../../src/ships/presets';
import { ShipView } from '../../src/game/ShipView';
import { Group } from 'three/webgpu';

// CPU scene traversal only: actual exported geometry/materials, without texture
// decoding or GPU submission. This does not measure GPU time or predict FPS.
const View = process.argv[2] ? (await import(new URL(process.argv[2], import.meta.url).href)).ShipView : ShipView;
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
const root = new Group();
const start = performance.now();
for (const actor of sim.actors) root.add(new View(model.clone(true), definition, actor).root);
const creationMs = performance.now() - start;
let nodes = 0;
const materials = new Set();
root.traverse((o: any) => {nodes++; if(o.material) for(const m of Array.isArray(o.material)?o.material:[o.material]) materials.add(m);});
const samples = [];
for(let i=0;i<150;i++) {const start=performance.now();root.updateMatrixWorld(true);if(i>=30)samples.push(performance.now()-start);}
samples.sort((a,b)=>a-b);
console.log(JSON.stringify({ships:48,nodes,materials:materials.size,creationMs,matrixUpdateMs:{median:samples[60],p95:samples[114]}},null,2));
