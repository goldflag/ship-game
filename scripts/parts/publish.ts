import { mkdir, readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ConstructionCatalog, ConstructionEquipmentPart } from '../../src/ships/blueprint';
import { readEquipment, equipmentHash, buildEquipment, inspectEquipmentModel, digest } from './equipment';
import type { EquipmentSource, EquipmentNode } from './equipment';

const root = resolve(import.meta.dir,'../..');
const sourceDocumentation = 'assets/parts/construction/README.md';
export interface PublishedEquipmentManifest {
  schemaVersion: 1; partId: string; revision: string; contentHash: string; modelSha256: string;
  nodePrefix: 'component'; modelUrl: string; boundsCenter: number[]; size: number[];
  triangles: number; textureCount: number; nodes: EquipmentNode[];
  review: 'unreviewed' | 'accepted'; limitations: string; basis: string;
}
const json = (value:unknown) => JSON.stringify(value,null,2)+'\n';

/** Existing content-addressed directories are immutable, including their manifest. */
export async function publishImmutable(directory:string, files:Record<string,string|Uint8Array>) {
  if (existsSync(directory)) {
    const names=await readdir(directory);
    if (names.length !== Object.keys(files).length) throw new Error(`Immutable publication conflict: ${directory}`);
    for (const [name,bytes] of Object.entries(files)) if (!Buffer.from(await readFile(join(directory,name))).equals(Buffer.from(bytes))) throw new Error(`Immutable publication conflict: ${directory}/${name}`);
    return;
  }
  await mkdir(resolve(directory,'..'),{recursive:true});
  const stage=directory+'.staging';
  await mkdir(stage).catch(()=>{throw new Error(`Publication already running/interrupted: ${stage}`);});
  for (const [name,bytes] of Object.entries(files)) await writeFile(join(stage,name),bytes);
  await rename(stage,directory);
}
async function catalogSourceIdentity(taskRoot:string) {
  const {equipment,catalog,library,registry}=await readEquipment(taskRoot);
  const hashes=await Promise.all(equipment.map(p=>equipmentHash(taskRoot,p)));
  const publishing=await Promise.all(['scripts/parts/publish.ts','scripts/parts/equipment.ts',sourceDocumentation].map(p=>readFile(join(taskRoot,p),'utf8')));
  return {equipment,catalog,library,registry,hashes,identity:digest(JSON.stringify([1,equipment,catalog,hashes,registry,publishing]))};
}
export async function publishEquipment(taskRoot=root, rebuild=false) {
  const publicRoot=join(taskRoot,'public/models/components');
  await mkdir(publicRoot,{recursive:true});
  const lock=join(taskRoot,'.build/parts/publication.lock');
  await mkdir(resolve(lock,'..'),{recursive:true});
  await mkdir(lock).catch(()=>{throw new Error(`Publication running/interrupted: ${lock}`);});
  await writeFile(join(lock,'owner.json'),json({pid:process.pid}));
  try {
    const before=await catalogSourceIdentity(taskRoot);
    const published:ConstructionEquipmentPart[]=[];
    for (const [i,p] of before.equipment.entries()) {
      const hash=before.hashes[i];
      const model=join(taskRoot,'.build/parts',p.gunPartId ?? p.id,'model.glb');
      let bytes:Buffer;
      try {
        if (rebuild) throw new Error('Explicit clean build');
        bytes=await readFile(model);
        inspectEquipmentModel(bytes,hash,p,before.catalog.parts.find(g=>g.id===p.gunPartId));
      } catch {
        await buildEquipment(taskRoot,p);
        bytes=await readFile(model);
      }
      const inspection=inspectEquipmentModel(bytes,hash,p,before.catalog.parts.find(g=>g.id===p.gunPartId));
      for (let k=0;k<3;k++) if (Math.abs(inspection.boundsCenter[k]-p.boundsCenter[k])+inspection.size[k]/2 > p.size[k]/2+.025) throw new Error(`${p.id}: visible model exceeds authored size/boundsCenter on axis ${k}; review dimensions before publishing`);
      const modelSha256=digest(bytes), revision=digest(JSON.stringify([1,p,hash,modelSha256,before.identity]));
      const modelUrl=`/models/components/${p.id}/${revision}/model.glb`;
      const entry:ConstructionEquipmentPart={...p,modelUrl,contentHash:hash};
      const review=p.kind==='gun' ? before.library.components.find(e=>e.partId===p.gunPartId) : before.registry.components.find(e=>e.partId===p.id);
      const manifest:PublishedEquipmentManifest={schemaVersion:1,partId:p.id,revision,contentHash:hash,modelSha256,nodePrefix:'component',modelUrl,...inspection,review:review?.review ?? 'unreviewed',limitations:review?.limitations ?? 'Original source adaptation or generic engineering package; package mass/capabilities are provisional and installed clearance remains design-specific.',basis:sourceDocumentation};
      await publishImmutable(join(publicRoot,p.id,revision),{'model.glb':bytes,'manifest.json':json(manifest)});
      published.push(entry);
      console.log(`${p.id}: published ${revision.slice(0,12)} (${inspection.triangles} triangles, ${inspection.nodes.length} joints/sockets)`);
    }
    const after=await catalogSourceIdentity(taskRoot);
    if (after.identity!==before.identity) throw new Error('Equipment source changed during publication; catalog not replaced');
    const revision=digest(JSON.stringify([1,before.identity,published]));
    const catalog:ConstructionCatalog={schemaVersion:1,revision,weapons:before.catalog,equipment:published};
    await publishImmutable(join(publicRoot,'catalogs',revision),{'catalog.json':json(catalog)});
    // Current pointer changes last; exact older catalogs and assets remain loadable.
    const temp=join(publicRoot,'catalog.json.tmp');
    await writeFile(temp,json(catalog));await rename(temp,join(publicRoot,'catalog.json'));
    return catalog;
  } finally { await rm(lock,{recursive:true,force:true}); }
}
export async function checkPublishedEquipment(taskRoot=root) {
  const catalog=JSON.parse(await readFile(join(taskRoot,'public/models/components/catalog.json'),'utf8')) as ConstructionCatalog;
  const expected=await catalogSourceIdentity(taskRoot);
  if (catalog.schemaVersion!==1 || JSON.stringify(catalog.weapons)!==JSON.stringify(expected.catalog) || catalog.equipment.length!==expected.equipment.length) throw new Error('Published equipment catalog is stale');
  for (const [i,p] of catalog.equipment.entries()) {
    const {modelUrl,contentHash,...source}=p;
    if (JSON.stringify(source)!==JSON.stringify(expected.equipment[i]) || contentHash!==expected.hashes[i]) throw new Error(`Stale equipment metadata: ${p.id}`);
    if (!/^\/models\/components\/[a-z0-9-]+\/[a-f0-9]{64}\/model.glb$/.test(modelUrl)) throw new Error('Non-production equipment URL');
    const directory=join(taskRoot,'public',modelUrl.replace(/^\//,''),'..');
    const bytes=await readFile(join(directory,'model.glb'));
    const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')) as PublishedEquipmentManifest;
    const inspection=inspectEquipmentModel(bytes,contentHash,source,beforeWeapon(catalog,source));
    const revision=digest(JSON.stringify([1,source,contentHash,digest(bytes),expected.identity]));
    const review=source.kind==='gun' ? expected.library.components.find(e=>e.partId===source.gunPartId) : expected.registry.components.find(e=>e.partId===source.id);
    const expectedManifest:PublishedEquipmentManifest={schemaVersion:1,partId:p.id,revision,contentHash,modelSha256:digest(bytes),nodePrefix:'component',modelUrl,...inspection,review:review?.review ?? 'unreviewed',limitations:review?.limitations ?? 'Original source adaptation or generic engineering package; package mass/capabilities are provisional and installed clearance remains design-specific.',basis:sourceDocumentation};
    if (!modelUrl.includes('/'+revision+'/') || JSON.stringify(manifest)!==JSON.stringify(expectedManifest)) throw new Error(`Published equipment integrity failure: ${p.id}`);
  }
  if (catalog.revision!==digest(JSON.stringify([1,expected.identity,catalog.equipment]))) throw new Error('Stale equipment catalog revision');
  const retained=await readFile(join(taskRoot,'public/models/components/catalogs',catalog.revision,'catalog.json'),'utf8');
  if (retained!==json(catalog)) throw new Error('Immutable equipment catalog differs');
  console.log(`Published equipment: ${catalog.equipment.length} current original assets`);
  return catalog;
}
const beforeWeapon=(catalog:ConstructionCatalog,p:EquipmentSource)=>catalog.weapons.parts.find(g=>g.id===p.gunPartId);
if(import.meta.main) {
  const action=process.argv[2] ?? 'publish';
  if(action==='publish') await publishEquipment(root,process.argv.includes('--rebuild'));
  else if(action==='check') await checkPublishedEquipment(root);
  else throw new Error('Usage: bun scripts/parts/publish.ts publish [--rebuild] | check');
}
