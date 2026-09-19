import { assetUrl } from '../assetUrl';
import type { ConstructionCatalog, ConstructionEquipmentPart, ConstructionSource } from './blueprint';

/** Describe an explicit catalog update; old source revisions keep their exact catalog. */
export function constructionCatalogUpdate(source: ConstructionSource, current: ConstructionCatalog, next: ConstructionCatalog) {
  if (source.construction.catalogRevision !== current.revision) throw new Error('Load this design’s equipment revision before updating its parts library.');
  const used = new Set(source.construction.equipment.map(p => p.partId));
  const changedParts: string[] = [], missingParts: string[] = [];
  for (const id of used) {
    const before = current.equipment.find(p => p.id === id), after = next.equipment.find(p => p.id === id);
    if (!before || !after) { missingParts.push(before?.name ?? id); continue; }
    if (before.contentHash !== after.contentHash) changedParts.push(before.name);
  }
  return { changedParts, missingParts };
}

/** Call inside one editor history command, after reviewing changed fitted variants. */
export function updateConstructionCatalog(source: ConstructionSource, current: ConstructionCatalog, next: ConstructionCatalog): void {
  const { missingParts } = constructionCatalogUpdate(source, current, next);
  if (missingParts.length) throw new Error(`The new parts library is missing fitted parts: ${missingParts.join(', ')}. Keep this design’s existing library.`);
  source.construction.catalogRevision = next.revision;
}

const hashPattern=/^[a-f0-9]{64}$/;
const idPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const publicModel=/^\/models\/components\/([a-z0-9-]+)\/([a-f0-9]{64})\/model\.glb$/;

/** JSON manifest boundary only. Authoritative fit/physics validation lives in Rust. */
export function parseConstructionCatalog(value:unknown):ConstructionCatalog {
  if (!value || typeof value!=='object') throw new Error('Equipment catalog is missing');
  const c=value as ConstructionCatalog;
  if(c.schemaVersion!==1 || !hashPattern.test(c.revision) || !c.weapons || c.weapons.schemaVersion!==1 || !Array.isArray(c.weapons.parts) || !Array.isArray(c.equipment) || !c.equipment.length || c.equipment.length>256) throw new Error('Unsupported equipment catalog');
  const ids=new Set<string>();
  const vector=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
  for(const p of c.equipment) {
    if(!p || !idPattern.test(p.id) || ids.has(p.id)) throw new Error('Duplicate or invalid equipment identity');
    ids.add(p.id);
    if(typeof p.modelUrl!=='string' || publicModel.exec(p.modelUrl)?.[1]!==p.id || !hashPattern.test(p.contentHash)) throw new Error(`Invalid published asset: ${p.id}`);
    if(!vector(p.size) || p.size.some(x=>x<=0) || !vector(p.boundsCenter) || !vector(p.centerOfGravity) || !['internal','deck','underwater'].includes(p.placement)) throw new Error(`Invalid equipment dimensions: ${p.id}`);
    if(p.kind==='gun') {
      if(p.massKg!==undefined || !c.weapons.parts.some(g=>g.id===p.gunPartId)) throw new Error(`Missing canonical weapon: ${p.id}`);
    } else if(!['torpedo-launcher','engine','magazine','funnel','propeller','rudder','mast','director','deck-fitting'].includes(p.kind) || !Number.isFinite(p.massKg) || p.massKg!<=0) throw new Error(`Invalid equipment family/mass: ${p.id}`);
    if(p.wallMount && (p.kind !== 'deck-fitting' || !['door','porthole','window','vent','hardware'].includes(p.wallMount))) throw new Error(`Invalid wall fitting: ${p.id}`);
    if(p.riggingSurface && (p.riggingSurface.encoding !== 'deflate-f32-u32-v1' || typeof p.riggingSurface.data !== 'string'
      || !p.riggingSurface.data.length || p.riggingSurface.data.length > 4_000_000 || p.placement !== 'deck' || p.path || p.wallMount
      || !['mast','director','funnel','deck-fitting'].includes(p.kind))) throw new Error(`Invalid rope attachment surface: ${p.id}`);
    if(p.path && (p.kind!=='deck-fitting' || !['railing','rope','chain','ladder','inclined-ladder','framed-ladder'].includes(p.path.kind)
      || !Number.isFinite(p.path.diameterM) || p.path.diameterM<=0
      || p.path.railCount !== undefined && (p.path.kind !== 'railing' || ![2, 3].includes(p.path.railCount))
      || !Number.isFinite(p.path.massKgPerM) || p.path.massKgPerM<=0)) throw new Error(`Invalid path profile: ${p.id}`);
  }
  return c;
}

/** A saved design may request its exact retained catalog revision. No substitution. */
export async function loadConstructionCatalog(revision?:string, request:(input:string)=>Promise<Response>=fetch):Promise<ConstructionCatalog> {
  if(revision!==undefined && !hashPattern.test(revision)) throw new Error('Invalid equipment catalog revision');
  const path=revision ? `models/components/catalogs/${revision}/catalog.json` : 'models/components/catalog.json';
  const response=await request(assetUrl(path));
  if(!response.ok) throw new Error(`Equipment catalog unavailable (${response.status}); ${revision ? 'the saved revision is missing' : 'publish the construction equipment'}`);
  const result=parseConstructionCatalog(await response.json());
  if(revision && result.revision!==revision) throw new Error('Equipment catalog revision mismatch');
  return result;
}

export function constructionEquipmentPart(catalog:ConstructionCatalog,partId:string,contentHash?:string):ConstructionEquipmentPart {
  const part=catalog.equipment.find(p=>p.id===partId);
  if(!part || (contentHash!==undefined && part.contentHash!==contentHash)) throw new Error(`Equipment revision unavailable: ${partId}`);
  return part;
}

/** modelUrl remains the canonical public path for the compiler and assetUrl caller. */
export const constructionEquipmentModelUrl=(part:ConstructionEquipmentPart)=>assetUrl(part.modelUrl);

/** Replace only the original namespace; do not rename a different variant accidentally. */
export function prefixComponentNodeId(instanceId:string,nodeId:string):string {
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(instanceId)) throw new Error('Invalid equipment instance ID');
  if(!/^component\.[a-zA-Z0-9_.-]+$/.test(nodeId)) throw new Error(`Unknown component node prefix: ${nodeId}`);
  return instanceId+nodeId.slice('component'.length);
}
