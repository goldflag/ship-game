import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Pool } from 'pg';
import { makeAuth } from './auth';
import { createApp } from './app';
import { ShipStorage } from './storage';
const enabled=!!process.env.TEST_API_DATABASE_URL;
const db=new Pool({connectionString:process.env.TEST_API_DATABASE_URL,options:'-c search_path=auth'});
const admin=new Pool({connectionString:process.env.TEST_ADMIN_DATABASE_URL});
const origin='http://localhost:8788',secret='test-service-secret-at-least-32-characters';
const auth=makeAuth(db,origin,'test-auth-secret-at-least-32-characters');
const storage=new ShipStorage(db,2,4096),app=createApp(auth,storage,secret,origin,'http://127.0.0.1:1');
let a='',b='',owner='',other='';
const cookies=(response:Response)=>response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
async function request(path:string,cookie='',method='GET',body?:unknown,headers:Record<string,string>={}) {
 return app.request(origin+path,{method,headers:{origin,cookie,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
}
beforeAll(async()=>{
 if(!enabled)return;
 for(const name of ['a','b']) {
  const response=await request('/api/auth/sign-up/email','','POST',{name,email:`${name}-${crypto.randomUUID()}@example.test`,password:'Test123!'});
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
integration('runtime roles cannot migrate or read other service schemas; terminal records cannot change',async()=>{
 await expect(db.query('SELECT * FROM results.matches')).rejects.toThrow();
 await expect(db.query('CREATE TABLE ships.unauthorized(id int)')).rejects.toThrow();
 await expect(db.query('UPDATE ships.revisions SET source_json=source_json WHERE false')).rejects.toThrow();
 await expect(db.query('DELETE FROM ships.operations WHERE false')).rejects.toThrow();
 const id=crypto.randomUUID();await admin.query('INSERT INTO results.matches VALUES($1,$2,true,NULL,NULL)',[id,{status:'finished'}]);
 await admin.query('UPDATE results.matches SET record=$2,finished=false WHERE id=$1',[id,{status:'running'}]);
 expect((await admin.query('SELECT * FROM results.matches WHERE id=$1',[id])).rows[0].record).toEqual({status:'finished'});
});
integration('expired sessions and an unavailable authentication database fail closed',async()=>{
 await admin.query(`UPDATE auth.session SET "expiresAt"=now()-interval '1 second' WHERE "userId"=$1`,[other]);
 expect((await request('/internal/session',b,'GET',undefined,{'x-service-secret':secret})).status).toBe(401);
 const unavailable=new Pool({connectionString:'postgres://no:access@127.0.0.1:1/missing',connectionTimeoutMillis:100});
 const offline=createApp(makeAuth(unavailable,origin,'test-auth-secret-at-least-32-characters'),storage,secret,origin,'http://127.0.0.1:1');
 const response=await offline.request(origin+'/internal/session',{headers:{cookie:a,'x-service-secret':secret}});expect(response.status).toBe(503);await unavailable.end();
});
integration('logout revokes database sessions immediately',async()=>{
 expect((await request('/api/auth/sign-out',a,'POST',{})).status).toBe(200);
 expect((await request('/internal/session',a,'GET',undefined,{'x-service-secret':secret})).status).toBe(401);
 expect((await request('/api/ships',a)).status).toBe(401);
});
