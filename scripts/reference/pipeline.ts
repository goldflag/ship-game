import { readFile, writeFile, mkdir, readdir, rename, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dir,'../..'),[action='check',ship='bismarck']=process.argv.slice(2);
if(!['reference','compare','check','independence'].includes(action)||!/^[a-z][a-z0-9-]{0,63}$/.test(ship))throw new Error('Usage: bun scripts/reference/pipeline.ts reference|compare|check|independence <ship>');
const source=join(root,'assets/ships',ship),stage=join(root,'.build/reference-work',ship),output=join(source,'generated/comparison'),reference=join(source,'references/gamemodels3d'),published=join(root,'public/ship-reference',ship);
const blender=process.env.BLENDER_BIN??(existsSync('/Applications/Blender.app/Contents/MacOS/Blender')?'/Applications/Blender.app/Contents/MacOS/Blender':'blender');
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
async function run(argv:string[],name:string){
 const child=Bun.spawn(argv,{cwd:root,env:{...process.env,REFERENCE_SHIP:ship},stdout:'pipe',stderr:'pipe'});
 const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
 await writeFile(join(stage,name+'.log'),out+err);if(code)throw new Error(`${name} failed:\n${(out+err).slice(-5000)}`);console.log(name+' passed');
}
async function files(folder:string):Promise<string[]>{
 const results:string[]=[];
 for(const e of await readdir(folder,{withFileTypes:true})) {const p=join(folder,e.name);if(e.isDirectory())results.push(...await files(p));else if(e.isFile()&&e.name!=='build.json')results.push(p);}
 return results.sort();
}
async function inputHash(){
 const ref=JSON.parse(await readFile(join(reference,'manifest.json'),'utf8'));
 const captureHash=sha(Buffer.concat(await Promise.all(['capture.py','render_views.py'].map(f=>readFile(join(root,'scripts/reference',f))))));
 if(captureHash!==ref.captureRecipeSha256)throw new Error('Reference capture recipe changed. Run ship:reference before ship:build.');
 const paths=[join(root,'public/models',ship+'.glb'),join(root,'public/models',ship+'.json'),join(source,'generated/source.blend'),join(source,'modeling-spec.json'),join(source,'blueprint.json'),join(source,'references/sources.json'),join(source,'references/capture-plan.json'),join(reference,'manifest.json'),...ref.captures.map((c:any)=>{
   if(!/^[a-z0-9-]+\.png$/.test(c.image))throw new Error('Invalid reference image path');return join(reference,c.image);
 }),...(await files(join(root,'assets/reference-ui'))),...(await files(join(source,'references/historical'))),...(await files(join(root,'scripts/reference'))).filter(p=>!p.includes('__pycache__')&&!p.endsWith('.pyc')),join(root,'src/simulation/protection.ts'),join(root,'src/simulation/geometry.ts')].sort();
 const h=createHash('sha256');for(const path of paths){h.update(path.slice(root.length));h.update(await readFile(path));}return h.digest('hex');
}
if(action==='check'){
 const record=JSON.parse(await readFile(join(output,'build.json'),'utf8'));
 if(record.inputHash!==await inputHash())throw new Error('Comparison artifacts are stale. Run ship:compare '+ship);
 for(const [path,hash]of Object.entries(record.files)){
  if(sha(await readFile(join(output,path)))!==hash||sha(await readFile(join(published,path)))!==hash)throw new Error('Stale or corrupt comparison artifact: '+path);
 }
 console.log('Matched comparisons, probes, source pack and portable archive are current');
}else{
 await mkdir(stage,{recursive:true});const lock=stage+'.lock';await mkdir(lock).catch(()=>{throw new Error('Reference pipeline already running: '+lock);});
 try{
  if(action==='reference'){
   const register=JSON.parse(await readFile(join(source,'references/sources.json'),'utf8'));
   const entry=register.sources.find((s:any)=>s.id.startsWith('gm-'));
   if(!entry)throw new Error('Source register needs a gm-<vehicle> source');
   await run(['python3',join(root,'scripts/reference/fetch.py'),ship,'--vehicle',entry.id.slice(3)],'fetch');
   await run([blender,'--background','--factory-startup','--python-exit-code','1','--python',join(root,'scripts/reference/capture.py')],'reference-capture');
   await run(['python3',join(root,'scripts/reference/index.py'),ship],'reference-index');
  }else if(action==='independence'){
   // Move the complete game cache out of its expected location, then run the real build.
   const cache=join(root,'.build/reference-cache'),hidden=join(root,'.build/reference-cache-unavailable');
   if(existsSync(hidden))throw new Error('Previous unavailable cache exists; inspect before proceeding');
   const existed=existsSync(cache);if(existed)await rename(cache,hidden);
   try{
    // Build invokes compare, which has its own lock. Release this lock before that child.
    await rm(lock,{recursive:true});
    await run(['bun','run','ship:build',ship],'independence-build');
    const current=JSON.parse(await readFile(join(root,'public/models',ship+'.json'),'utf8'));
    await writeFile(join(source,'reports/independence.json'),JSON.stringify({schemaVersion:1,contentHash:current.contentHash,passed:true,rawCacheAvailableDuringBuild:false,cacheMovedForTest:existed,command:'bun run ship:build '+ship,authoringReadAudit:'.build/ships/'+ship+'/authoring-reads.json',note:'Full original asset build and raster comparison succeeded without the raw game cache. Python authoring reads additionally reject raw model formats and cache paths.'},null,2)+'\n');
   }finally{if(existed)await rename(hidden,cache);}
  }else{
   const hash=await inputHash();
   await run(['bun',join(root,'scripts/reference/measure.ts'),ship],'measure');
   await run([blender,'--background','--factory-startup','--python-exit-code','1','--python',join(root,'scripts/reference/render_authored.py')],'authored-capture');
   await run(['python3',join(root,'scripts/reference/compare.py'),ship],'comparison-sheets');
   if(hash!==await inputHash())throw new Error('Reference/authoring inputs changed during comparison');
   const outputs:Record<string,string>={};for(const path of await files(output))outputs[path.slice(output.length+1)]=sha(await readFile(path));
   await writeFile(join(output,'build.json'),JSON.stringify({schemaVersion:1,inputHash:hash,files:outputs},null,2)+'\n');
   await mkdir(resolve(published,'..'),{recursive:true});const temp=published+'.tmp';await rm(temp,{recursive:true,force:true});await cp(output,temp,{recursive:true});
   await rm(published,{recursive:true,force:true});await rename(temp,published);
   console.log('Local review page: /ship-reference/'+ship+'/');
  }
 }finally{await rm(lock,{recursive:true,force:true});}
}
