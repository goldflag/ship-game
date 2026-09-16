import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { testAccount,verifyMatchContent } from './test-accounts';
import { createStarterSource } from '../../src/ships/constructionStarter';
import version from '../../src/generated/naval-version.json';
const base=process.env.NAVAL_TEST_URL??'http://localhost:5200';
const [a,b]=await Promise.all([testAccount(base),testAccount(base)]);
const post=(path:string,cookie:string,body:unknown,method='POST',headers:Record<string,string>={})=>fetch(base+path,{method,headers:{cookie,origin:new URL(base).origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const catalog=await Bun.file('public/models/components/catalog.json').json();
const source=createStarterSource(catalog,'patrol');
const input={designId:source.id,name:source.name,source,schemaVersion:1,catalogRevision:catalog.revision,expectedRevisionId:null};
const save=await post('/api/ships/'+source.id,a,input,'PUT',{'idempotency-key':crypto.randomUUID()});assert.equal(save.status,200,await save.clone().text());const revision=await save.json();
// Saving malformed drafts is permitted; online preparation rejects forged data.
const forged={...input,designId:'forged-'+crypto.randomUUID()};forged.source={...source,id:forged.designId,definition:{massKg:1},catalog:{revision:catalog.revision}} as any;
const fake=await post('/api/ships/'+forged.designId,a,forged,'PUT',{'idempotency-key':crypto.randomUUID()});assert.equal(fake.status,200);const fakeRevision=await fake.json();
const fakeJoin=await post('/api/join',a,{fleet:[{kind:'custom',designId:fakeRevision.designId,revisionId:fakeRevision.id}],version,mode:'queue'});assert.equal(fakeJoin.ok,false);assert.match((await fakeJoin.json()).error,/derived definitions, mass or catalogs/);
// The other account can author a copy with the same source ID; server-issued
// identities keep its two saved revisions distinct from the first account.
const bFirst=await (await post('/api/ships/'+source.id,b,input,'PUT',{'idempotency-key':crypto.randomUUID()})).json();
const bNextInput={...input,expectedRevisionId:bFirst.id,source:{...source,revision:crypto.randomUUID()}};
const bNext=await (await post('/api/ships/'+source.id,b,bNextInput,'PUT',{'idempotency-key':crypto.randomUUID()})).json();
const fleet=[{kind:'custom',designId:revision.designId,revisionId:revision.id},{kind:'historical',presetId:'fletcher'},{kind:'custom',designId:revision.designId,revisionId:revision.id}];
assert.equal((await post('/api/join','',{fleet,version,mode:'queue'})).status,401);
const denied=await post('/api/join',b,{fleet,version,mode:'queue'});assert.equal(denied.ok,false);
const admitted=await post('/api/join',a,{fleet,version,mode:'create-invite'});assert.equal(admitted.status,200,await admitted.clone().text());const first=await admitted.json();
assert.equal((await post('/api/join',a,{fleet:[{kind:'historical',presetId:'fletcher'}],version,mode:'join-invite',inviteCode:first.inviteCode})).ok,false);
assert.equal((await post('/api/cancel',b,{ticket:first.ticket})).status,403);
assert.equal((await post('/api/match-content',b,{ticket:first.ticket})).status,404);
// Neither an edit nor deletion changes the admitted revision.
const edit=await post('/api/ships/'+source.id,a,{...input,expectedRevisionId:revision.id,source:{...source,revision:crypto.randomUUID()}},'PUT',{'idempotency-key':crypto.randomUUID()});assert.equal(edit.status,200);const newer=await edit.json();
const deleted=await fetch(base+'/api/ships/'+revision.designId,{method:'DELETE',headers:{cookie:a,origin:new URL(base).origin,'if-match':newer.id}});assert.equal(deleted.status,204);
const joined=await post('/api/join',b,{fleet:[{kind:'custom',designId:bFirst.designId,revisionId:bFirst.id},{kind:'custom',designId:bNext.designId,revisionId:bNext.id},{kind:'historical',presetId:'fletcher'}],version,mode:'join-invite',inviteCode:first.inviteCode});assert.equal(joined.status,200,await joined.clone().text());const second=await joined.json();
const clients:any[]=[];
async function connect(cookie:string,ticket:string) {
 const socket=new WebSocket(base.replace(/^http/,'ws')+'/api/socket',{headers:{cookie,origin:new URL(base).origin}});socket.binaryType='arraybuffer';
 const client={socket,metadata:undefined as any,frames:[] as any[],errors:[] as any[],content:undefined as any};clients.push(client);
 socket.onopen=()=>socket.send(JSON.stringify({type:'hello',ticket,version}));
 socket.onmessage=async e=>{const bytes=typeof e.data==='string'?null:new Uint8Array(e.data);const m=bytes?JSON.parse(gunzipSync(bytes[0]===0?bytes.subarray(1):bytes).toString()):JSON.parse(e.data);if(m.type==='matched'){client.content=await verifyMatchContent(base,cookie,ticket,m.contentHash);client.metadata=m;}else if(m.type==='error')client.errors.push(m);else client.frames.push(m);};
 return client;
}
async function until(fn:()=>boolean){for(let i=0;i<1200;i++){if(fn())return;await Bun.sleep(25);}throw new Error('Timed out');}
try {
 const stolen=await connect(b,first.ticket);await until(()=>stolen.errors.length>0);stolen.socket.close();
 let ca=await connect(a,first.ticket);const cb=await connect(b,second.ticket);await until(()=>!!ca.metadata&&!!cb.metadata);
 const wrong=ca;wrong.socket.send(JSON.stringify({type:'ready',version,contentHash:'0'.repeat(64)}));
 await until(()=>wrong.socket.readyState===WebSocket.CLOSED);
 ca=await connect(a,first.ticket);await until(()=>!!ca.metadata);
 assert.equal(ca.content.artifacts.length,3);
 assert.deepEqual(new Set(ca.content.artifacts.map((a:any)=>a.source.revision)),new Set([revision.id,bFirst.id,bNext.id]));
 assert.equal(ca.metadata.setup.ships.find((s:any)=>s.team===ca.metadata.team).presetId.startsWith('local-'),true);
 assert.deepEqual(ca.content,cb.content);
 for(const c of [ca,cb])c.socket.send(JSON.stringify({type:'ready',version,contentHash:c.metadata.contentHash}));
 await until(()=>ca.frames.some((f:any)=>f.type==='snapshot-delta'));
 await Bun.sleep(3500);
 ca.socket.send(JSON.stringify({type:'surrender'}));await Bun.sleep(1000);
 assert.equal(ca.errors.length+cb.errors.length,0);
 console.log(JSON.stringify({ok:true,checks:['account requirement','copied revision rejection','self-match rejection','copied ticket rejection','custom command ship','repeated custom ship','mixed fleets','edit/delete after admission','different saved revisions','forged stats/catalog rejection','Ready hash mismatch and custom reconnect','participant content hash','ready and battle'],matchId:ca.metadata.matchId}));
} finally {await post('/api/cancel',a,{ticket:first.ticket});clients.forEach(c=>c.socket.close());}
