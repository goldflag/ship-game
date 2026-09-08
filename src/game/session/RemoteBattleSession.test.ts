import { expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { MatchConnection } from './RemoteBattleSession';
import { HeadlessSession } from '../../../scripts/multiplayer/headless-session';
import { battleExitLabel } from './BattleSession';
import version from '../../generated/naval-version.json';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(read: () => boolean) { for(let i=0;i<300;i++) { if(read()) return; await sleep(10); } throw new Error('Timed out'); }
class Socket {
  static OPEN = 1; static instances: Socket[] = [];
  readyState = 1; bufferedAmount = 0; binaryType = ''; sent: any[] = [];
  onopen?: () => void; onclose?: () => void; onmessage?: (event: {data: unknown}) => void;
  constructor(_url: unknown) { Socket.instances.push(this); queueMicrotask(() => { if(this.readyState===1) this.onopen?.(); }); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { if(this.readyState===3) return; this.readyState=3; this.onclose?.(); }
  binary(value: unknown, metadata = false) { const gzip=gzipSync(JSON.stringify(value)); const bytes=new Uint8Array(gzip.length+(metadata?1:0)); bytes.set(gzip,metadata?1:0); this.onmessage?.({data:bytes.buffer}); }
}
test('compressed handshake survives following deltas and reconnect resets command epoch', async () => {
  const names=['WebSocket','sessionStorage','location'] as const;
  const descriptors=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
  const stored=new Map([['naval-match-ticket-v1','test-ticket']]);
  const overrides={WebSocket:Socket, sessionStorage:{getItem:(k:string)=>stored.get(k),removeItem:(k:string)=>stored.delete(k)},location:{href:'http://localhost/',protocol:'http:'}};
  for(const name of names) Object.defineProperty(globalThis,name,{value:overrides[name],configurable:true,writable:true});
  const local=await HeadlessSession.create({playerShipId:'fletcher',friendlyBots:['fletcher'],enemies:['fletcher'],spawnDistance:5000});
  const baseline=JSON.parse(local.runtime.snapshot());
  const metadata={type:'matched',matchId:'test',player:0,team:'a',connectionEpoch:2,version,setup:local.setup,environment:{timeOfDay:'morning',weather:'clear'},baseline};
  const frame={...baseline,tick:3,phase:'running',loaded:[true,true],connected:[true,true]};
  const connection=MatchConnection.resume(()=>{});
  try {
    const first=Socket.instances.at(-1)!;
    first.binary(metadata,true); first.binary({type:'snapshot-delta',patches:[[[],frame]]});
    const session=await connection.matched; expect(session.tick).toBe(3); session.loadedAssets();
    first.close(); await until(()=>Socket.instances.at(-1)!==first);
    const second=Socket.instances.at(-1)!;
    second.binary({...metadata,connectionEpoch:3},true); second.binary({type:'snapshot-delta',patches:[[[],{...frame,tick:6}]]});
    await until(()=>session.metadata.connectionEpoch===3);
    await until(()=>{session.advance(0,{throttle:0,rudder:0},{aim:[0,0,0],battery:'main',fire:false});return session.tick===6;});
    expect(second.sent.some(m=>m.type==='ready')).toBe(true);
    session.selectShip('friendly-1');
    const command=second.sent.find(m=>m.type==='command');
    expect(command.envelope.connectionEpoch).toBe(3); expect(command.envelope.sequence).toBe(1);
    session.connectionFailed('Connection lost');
    expect(battleExitLabel(session)).toBe('Return to port');
  } finally {
    connection.close(true); local.dispose();
    names.forEach((name,i)=>{ if(descriptors[i]) Object.defineProperty(globalThis,name,descriptors[i]!); else Reflect.deleteProperty(globalThis,name); });
  }
});
test('only a running online battle offers forfeiture', () => {
  for(const phase of ['loading','countdown','cancelled','finished']) expect(battleExitLabel({networked:true,phase,result:'active'})).toBe('Return to port');
  expect(battleExitLabel({networked:true,phase:'running',result:'active'})).toBe('Forfeit and return to port');
});
