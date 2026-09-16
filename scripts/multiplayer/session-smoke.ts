import assert from 'node:assert/strict';
import {testAccount} from './test-accounts';
import version from '../../src/generated/naval-version.json';
const base=process.env.NAVAL_TEST_URL??'http://localhost:5200';
const cookie=await testAccount(base);
const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{cookie,origin:new URL(base).origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const response=await post('/api/join',{mode:'create-invite',fleet:[{kind:'historical',presetId:'fletcher'}],version});assert.equal(response.status,200);const {ticket}=await response.json();
const socket=new WebSocket(base.replace(/^http/,'ws')+'/api/socket',{headers:{cookie,origin:new URL(base).origin}});
const closed=new Promise<number>(resolve=>socket.onclose=()=>resolve(Date.now()));
await new Promise<void>((resolve,reject)=>{socket.onopen=()=>{socket.send(JSON.stringify({type:'hello',ticket,version}));resolve();};socket.onerror=reject;});
await Bun.sleep(100);
const logout=await post('/api/auth/sign-out',{});assert.equal(logout.status,200);
const revoked=Date.now();
assert.equal((await post('/api/cancel',{ticket})).status,401);
const deadline=setTimeout(()=>{socket.close();throw new Error('Revoked session remained connected after 35 seconds');},35_000);
try {const at=await closed;assert.ok(at-revoked<35_000);console.log(JSON.stringify({ok:true,checks:['logout revocation','HTTP session rejection','open socket session recheck'],closedAfterMs:at-revoked}));}finally{clearTimeout(deadline);socket.close();}
