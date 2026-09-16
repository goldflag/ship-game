import assert from 'node:assert/strict';
export async function testAccount(base:string) {
  for(let attempt=0;attempt<8;attempt++) {
  const response=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{'Content-Type':'application/json',origin:new URL(base).origin},body:JSON.stringify({name:'Fleet test',email:`naval-test-${crypto.randomUUID()}@example.test`,password:crypto.randomUUID()+crypto.randomUUID()})});
  if(response.status===429) { await Bun.sleep(10_000);continue; }
  assert.equal(response.status,200,await response.clone().text());
  return response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  }
  throw new Error('Test account registration remained rate limited');
}
export async function verifyMatchContent(base:string,cookie:string,ticket:string,hash:string,parse=true) {
  const response=await fetch(base+'/api/match-content',{method:'POST',headers:{'Content-Type':'application/json',origin:new URL(base).origin,cookie},body:JSON.stringify({ticket})});
  assert.equal(response.status,200);
  const bytes=await response.arrayBuffer();const actual=new Bun.CryptoHasher('sha256').update(bytes).digest('hex');assert.equal(actual,hash);
  return parse ? JSON.parse(new TextDecoder().decode(bytes)) : undefined;
}
