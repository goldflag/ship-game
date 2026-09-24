import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Pool } from 'pg';
import { makeAuth } from './auth';
import { createApp } from './app';
import { ShipStorage } from './storage';
import { ProgressStorage, readAward } from './progress';
import { emptyProfile } from '../../src/progression/rules';
import { awardFor, type BattleSummary } from '../../src/progression/xp';
const enabled=!!process.env.TEST_API_DATABASE_URL;
const db=new Pool({connectionString:process.env.TEST_API_DATABASE_URL,options:'-c search_path=auth'});
const admin=new Pool({connectionString:process.env.TEST_ADMIN_DATABASE_URL});
const origin='http://localhost:8788',secret='test-service-secret-at-least-32-characters';
const auth=makeAuth(db,origin,'test-auth-secret-at-least-32-characters');
const storage=new ShipStorage(db,2,4096),progress=new ProgressStorage(db),app=createApp(auth,storage,secret,origin,'http://127.0.0.1:1',progress);
let a='',b='',owner='',other='';
const cookies=(response:Response)=>response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
async function request(path:string,cookie='',method='GET',body?:unknown,headers:Record<string,string>={}) {
 return app.request(origin+path,{method,headers:{origin,cookie,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
}
beforeAll(async()=>{
 if(!enabled)return;
 for(const name of ['a','b']) {
  const response=await request('/api/auth/sign-up/email','','POST',{name,email:`${name}-${crypto.randomUUID()}@example.test`,password:'Test123!'},{origin:name==='a'?'http://localhost:5173':'http://127.0.0.1:5201'});
  expect(response.status).toBe(200);const value=await response.json();if(name==='a'){a=cookies(response);owner=value.user.id;}else {b=cookies(response);other=value.user.id;}
 }
});
afterAll(async()=>{await db.end();await admin.end();});
const integration=enabled?test:test.skip;
const input=(id='design-'+crypto.randomUUID())=>({designId:id,name:'Invalid draft is saveable',schemaVersion:1,catalogRevision:'a'.repeat(64),expectedRevisionId:null as string|null,source:{schemaVersion:1,id,revision:crypto.randomUUID(),construction:{catalogRevision:'a'.repeat(64),primitives:[],equipment:[]}}});
integration('signup rejects passwords shorter than eight characters',async()=>{
 const response=await request('/api/auth/sign-up/email','','POST',{name:'short-password',email:`short-${crypto.randomUUID()}@example.test`,password:'Test12!'});
 expect(response.status).toBe(400);
 expect((await response.json()).code).toBe('PASSWORD_TOO_SHORT');
});
integration('anonymous, forged account headers, internal secrets and cross-account references fail closed',async()=>{
 expect((await request('/api/ships')).status).toBe(401);
 expect((await request('/api/ships',b,'GET',undefined,{'x-account-id':owner})).status).toBe(401);
 expect((await request('/internal/session',a)).status).toBe(403);
 expect((await request('/internal/session',a,'GET',undefined,{'x-service-secret':secret})).status).toBe(200);
 const value=input(),key=crypto.randomUUID();
 const save=await request('/api/ships/'+value.designId,a,'PUT',value,{'idempotency-key':key});expect(save.status).toBe(200);
 const revision=await save.json();expect(revision.designId).not.toBe(value.designId);
 expect((await request('/api/ships/'+revision.designId,b)).status).toBe(404);
 expect((await request('/api/ships/'+revision.designId+'/revisions',b)).status).toBe(404);
 const prepare=await request('/internal/prepare',b,'POST',{fleet:[{kind:'custom',designId:revision.designId,revisionId:revision.id}]},{'x-service-secret':secret});expect(prepare.status).toBe(404);
 await storage.remove(owner,revision.designId,revision.id);
});
integration('local proxy origins can save drafts while foreign and production origins remain restricted',async()=>{
 const value=input();
 const saved=await request('/api/ships/'+value.designId,a,'PUT',value,{'idempotency-key':crypto.randomUUID(),origin:'http://[::1]:5202'});
 expect(saved.status).toBe(200);const revision=await saved.json();
 await storage.remove(owner,revision.designId,revision.id);
 for(const blocked of ['https://evil.example','http://localhost.evil.example:5173','http://localhost:5173@evil.example','null']) {
  expect((await request('/api/auth/sign-out',a,'POST',{}, {origin:blocked})).status).toBe(403);
  expect((await request('/api/ships/'+value.designId,a,'PUT',value, {origin:blocked})).status).toBe(403);
 }
 const production='https://ships.tomato.gg';
 const productionAuth=makeAuth(db,production,'test-auth-secret-at-least-32-characters');
 const productionApp=createApp(productionAuth,storage,secret,production,'http://127.0.0.1:1',progress);
 for(const path of ['/api/auth/sign-out','/api/ships/test','/api/progress/unlocks']) {
  const response=await productionApp.request(production+path,{method:path.includes('/ships/')?'PUT':'POST',headers:{cookie:a,origin:'http://localhost:5173','content-type':'application/json'},body:'{}'});
  expect(response.status).toBe(403);
 }
});
integration('cross-device reads, immutable history, stale revisions, retry idempotency, deletion tombstones and quotas',async()=>{
 const value=input(),key=crypto.randomUUID();const first=await storage.save(owner,key,value);
 expect((await storage.save(owner,key,value)).id).toBe(first.id);
 expect((await storage.load(owner,first.designId)).revision.sourceJson).toBe(JSON.stringify(value.source));
 await expect(storage.save(owner,crypto.randomUUID(),value)).rejects.toMatchObject({code:'conflict'});
 const second=await storage.save(owner,crypto.randomUUID(),{...value,expectedRevisionId:first.id,source:{...value.source,revision:crypto.randomUUID()}});
 expect((await storage.revisions(owner,first.designId)).length).toBe(2);
 expect((await storage.revision(owner,first.designId,first.id)).sourceJson).toBe(first.sourceJson);
 await expect(storage.remove(owner,first.designId,first.id)).rejects.toMatchObject({code:'conflict'});
 const other=await storage.save(owner,crypto.randomUUID(),input());
 await expect(storage.save(owner,crypto.randomUUID(),input())).rejects.toMatchObject({code:'quota'});
 await expect(storage.save(owner,crypto.randomUUID(),{...value,expectedRevisionId:second.id,source:{...value.source,padding:'x'.repeat(5000)}})).rejects.toMatchObject({code:'quota'});
 await storage.remove(owner,first.designId,second.id);
 await expect(storage.save(owner,key,value)).rejects.toMatchObject({status:410});
 expect((await db.query('SELECT * FROM ships.revisions WHERE design_id=$1',[first.designId])).rowCount).toBe(0);
 await storage.remove(owner,other.designId,other.id);
});
const battle=(result:BattleSummary['result']='victory'):BattleSummary=>({mode:'custom',result,durationS:600,
 friendly:[{presetId:'fletcher',massKg:2_924_000,lost:false,integrity:.6}],enemy:[{presetId:'fletcher',massKg:2_924_000,lost:true,integrity:0,opposition:'normal'}]});
const profileOf=async(cookie:string)=>(await (await request('/api/progress',cookie)).json()).profile;
integration('research progress reads empty, pays each battle once and refuses conflicting retries',async()=>{
 expect(await profileOf(a)).toEqual(emptyProfile());
 expect((await db.query('SELECT 1 FROM progress.profiles WHERE owner_id=$1',[owner])).rowCount).toBe(0);
 const id=crypto.randomUUID(),expected=awardFor(battle());
 const paid=await request('/api/progress/awards',a,'POST',{id,summary:battle(),award:{total:5000,nations:{usa:5000},free:0}});
 expect(paid.status).toBe(200);const first=await paid.json();
 expect(first.award).toEqual(expected);expect(first.profile.earned).toBe(expected.total);expect(first.profile.xp.usa).toBe(expected.nations.usa);
 const retry=await request('/api/progress/awards',a,'POST',{id,summary:battle()});
 expect(retry.status).toBe(200);expect(await retry.json()).toEqual(first);
 const conflict=await request('/api/progress/awards',a,'POST',{id,summary:battle('defeat')});
 expect(conflict.status).toBe(409);expect((await conflict.json()).code).toBe('conflict');
 const race=crypto.randomUUID();
 const racing=await Promise.all([0,1,2,3].map(()=>request('/api/progress/awards',a,'POST',{id:race,summary:battle()})));
 expect(racing.map(r=>r.status)).toEqual([200,200,200,200]);
 expect((await profileOf(a)).earned).toBe(expected.total*2);
 expect((await db.query('SELECT count(*)::int AS n FROM progress.awards WHERE owner_id=$1',[owner])).rows[0].n).toBe(2);
 // Battle ids and profiles are per account.
 expect((await request('/api/progress/awards',b,'POST',{id,summary:battle('defeat')})).status).toBe(200);
 expect((await profileOf(a)).earned).toBe(expected.total*2);
 const bad=await request('/api/progress/awards',a,'POST',{id:crypto.randomUUID(),summary:{...battle(),durationS:99999}});
 expect(bad.status).toBe(400);expect((await bad.json()).code).toBe('invalid');
 expect((await request('/api/progress',b,'GET',undefined,{'x-account-id':owner})).status).toBe(401);
});
integration('research unlocks spend XP; developer grants need PROGRESS_DEV_ACCOUNTS; stored profiles are repaired',async()=>{
 const short=await request('/api/progress/unlocks',a,'POST',{nodeId:'baltimore'});
 expect(short.status).toBe(409);expect((await short.json()).code).toBe('insufficient-xp');
 const refused=await request('/api/progress/dev',a,'POST',{xp:5000});
 expect(refused.status).toBe(403);expect((await refused.json()).code).toBe('forbidden');
 const before=await profileOf(a);
 const dev=createApp(auth,storage,secret,origin,'http://127.0.0.1:1',new ProgressStorage(db,other));
 const devRequest=(cookie:string,body:unknown)=>dev.request(origin+'/api/progress/dev',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
 expect((await devRequest(a,{xp:5000})).status).toBe(403);
 const granted=await devRequest(b,{xp:2000});expect(granted.status).toBe(200);
 expect((await granted.json()).profile.freeXp).toBeGreaterThanOrEqual(2000);
 expect(await profileOf(a)).toEqual(before);
 const unlocked=await request('/api/progress/unlocks',b,'POST',{nodeId:'fletcher'});
 expect(unlocked.status).toBe(200);const value=await unlocked.json();
 expect(value.spent.nation).toBe('usa');expect(value.profile.unlocked).toEqual(['fletcher']);
 expect((await request('/api/progress/unlocks',b,'POST',{nodeId:'fletcher'})).status).toBe(409);
 await admin.query(`UPDATE progress.profiles SET profile=profile||'{"freeXp":-50,"unlocked":["fletcher","nowhere"]}'::jsonb WHERE owner_id=$1`,[other]);
 const repaired=await profileOf(b);expect(repaired.freeXp).toBe(0);expect(repaired.unlocked).toEqual(['fletcher']);
 expect((await (await devRequest(b,{reset:true})).json()).profile).toEqual(emptyProfile());
 expect(await profileOf(b)).toEqual(emptyProfile());
});
integration('deleting an account removes its research progress',async()=>{
 // Created directly: Better Auth rate-limits a further sign-up here.
 const id=crypto.randomUUID();await admin.query('INSERT INTO auth."user"(id,name,email) VALUES($1,$2,$3)',[id,'c',`c-${id}@example.test`]);
 await progress.award(id,readAward({id:crypto.randomUUID(),summary:battle()}));
 expect((await db.query('SELECT 1 FROM progress.awards WHERE owner_id=$1',[id])).rowCount).toBe(1);
 await admin.query('DELETE FROM auth."user" WHERE id=$1',[id]);
 expect((await admin.query('SELECT 1 FROM progress.profiles WHERE owner_id=$1 UNION ALL SELECT 1 FROM progress.awards WHERE owner_id=$1',[id])).rowCount).toBe(0);
});
integration('runtime roles cannot migrate or read other service schemas; terminal records cannot change',async()=>{
 await expect(db.query('SELECT * FROM results.matches')).rejects.toThrow();
 await expect(db.query('CREATE TABLE ships.unauthorized(id int)')).rejects.toThrow();
 await expect(db.query('UPDATE ships.revisions SET source_json=source_json WHERE false')).rejects.toThrow();
 await expect(db.query('DELETE FROM ships.operations WHERE false')).rejects.toThrow();
 await expect(db.query('CREATE TABLE progress.unauthorized(id int)')).rejects.toThrow();
 await expect(db.query('UPDATE progress.awards SET digest=digest WHERE false')).rejects.toThrow();
 await expect(db.query('DELETE FROM progress.awards WHERE false')).rejects.toThrow();
 await expect(db.query('DELETE FROM progress.profiles WHERE false')).rejects.toThrow();
 const id=crypto.randomUUID();await admin.query('INSERT INTO results.matches VALUES($1,$2,true,NULL,NULL)',[id,{status:'finished'}]);
 await admin.query('UPDATE results.matches SET record=$2,finished=false WHERE id=$1',[id,{status:'running'}]);
 expect((await admin.query('SELECT * FROM results.matches WHERE id=$1',[id])).rows[0].record).toEqual({status:'finished'});
});
integration('expired sessions and an unavailable authentication database fail closed',async()=>{
 await admin.query(`UPDATE auth.session SET "expiresAt"=now()-interval '1 second' WHERE "userId"=$1`,[other]);
 expect((await request('/internal/session',b,'GET',undefined,{'x-service-secret':secret})).status).toBe(401);
 const unavailable=new Pool({connectionString:'postgres://no:access@127.0.0.1:1/missing',connectionTimeoutMillis:100});
 const offline=createApp(makeAuth(unavailable,origin,'test-auth-secret-at-least-32-characters'),storage,secret,origin,'http://127.0.0.1:1',progress);
 const response=await offline.request(origin+'/internal/session',{headers:{cookie:a,'x-service-secret':secret}});expect(response.status).toBe(503);await unavailable.end();
});
integration('logout revokes database sessions immediately',async()=>{
 expect((await request('/api/auth/sign-out',a,'POST',{})).status).toBe(200);
 expect((await request('/internal/session',a,'GET',undefined,{'x-service-secret':secret})).status).toBe(401);
 expect((await request('/api/ships',a)).status).toBe(401);
});
