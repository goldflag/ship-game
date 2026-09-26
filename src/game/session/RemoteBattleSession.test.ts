import { expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { MatchConnection, RemoteBattleSession, type MatchMetadata } from './RemoteBattleSession';
import { isHit, SalvoTally } from '../SalvoTally';
import { FIXED_DT } from './motion';
import { HeadlessSession } from '../../../scripts/multiplayer/headless-session';
import { battleExitLabel } from './BattleSession';
import { decodeFrameUpdate, type FrameUpdate } from './frameDelta';
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
test('online hits retain gold local ownership for either seat after the shell disappears', async () => {
  const local = await HeadlessSession.create({ playerShipId: 'fletcher', friendlyBots: [], enemies: [{ shipId: 'fletcher', aiLevel: 'normal' }], spawnDistance: 1000, windSpeed: 0 });
  try {
    const baseline = decodeFrameUpdate(undefined, JSON.parse(local.runtime.snapshot_delta([])));
    const tallies = [new Map<string, SalvoTally>(), new Map<string, SalvoTally>()];
    const damaging = [new Set<number>(), new Set<number>()], cursors = [0, 0];
    const sessions = (['a', 'b'] as const).map((team, player) => {
      const metadata: MatchMetadata = { type: 'matched', matchId: 'ownership', player, team, connectionEpoch: 1,
        version, contentHash: '', setup: local.setup, environment: { timeOfDay: 'morning', weather: 'clear' }, baseline };
      return new RemoteBattleSession(metadata, { send: () => true, close: () => {} } as unknown as MatchConnection, baseline);
    });
    const seen = [false, false];
    let frame = baseline;
    for (let batch = 0; batch < 600 && !seen.every(Boolean); batch++) {
      const target = local.target!.motion;
      local.advance(.1, { throttle: 0, rudder: 0 }, { aim: [target.x, 2, target.z], battery: 'main', fire: true });
      frame = decodeFrameUpdate(frame, JSON.parse(local.runtime.snapshot_delta([])));
      sessions.forEach((session, seat) => {
        session.receive(frame);
        session.advance(0, { throttle: 0, rudder: 0 }, { aim: [0, 0, 0], battery: 'main', fire: false });
        const time = session.tick * FIXED_DT;
        for (const event of session.events) {
          if (event.sequence <= cursors[seat]) continue;
          cursors[seat] = event.sequence;
          const victim = session.actors.find(actor => actor.motion.id === event.shipId);
          if (!isHit(event) || !victim || victim.team === session.player.team) continue;
          expect(event.sourceId).toBe(session.ship.id);
          const tally = tallies[seat].get(event.shipId) ?? new SalvoTally();
          tallies[seat].set(event.shipId, tally);
          tally.add(event, time, event.sourceId === session.ship.id);
          const shell = event.shell?.id ?? event.impact?.shellId;
          if (shell !== undefined && (event.impact?.hullDamage ?? event.hullDamage ?? 0) > 0) damaging[seat].add(shell);
        }
        const gone = [...damaging[seat]].some(id => !session.shells.some(shell => shell.id === id));
        if (gone && [...tallies[seat].values()].some(tally => tally.read(time).damage > 0)) seen[seat] = true;
      });
    }
    expect(seen).toEqual([true, true]);
    sessions.forEach(session => session.dispose());
  } finally { local.dispose(); }
});
test('compressed handshake survives following deltas and reconnect resets command epoch', async () => {
  const names=['WebSocket','sessionStorage','location','DecompressionStream','fetch'] as const;
  const descriptors=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
  const stored=new Map([['naval-match-ticket-v1','test-ticket']]);
  const NativeDecompression=globalThis.DecompressionStream; let decodes=0;
  function DelayedDecompression(format: CompressionFormat) { const stream=new NativeDecompression(format); if(++decodes!==3) return stream; return {writable:stream.writable,readable:stream.readable.pipeThrough(new TransformStream({async transform(chunk,controller){await sleep(1500);controller.enqueue(chunk);}}))}; }
  const content=JSON.stringify({artifacts:[]});
  const contentHash=new Bun.CryptoHasher('sha256').update(content).digest('hex');
  const overrides={fetch:async()=>new Response(content),DecompressionStream:DelayedDecompression,WebSocket:Socket, sessionStorage:{getItem:(k:string)=>stored.get(k),removeItem:(k:string)=>stored.delete(k)},location:{href:'http://localhost/',protocol:'http:'}};
  for(const name of names) Object.defineProperty(globalThis,name,{value:overrides[name],configurable:true,writable:true});
  const local=await HeadlessSession.create({playerShipId:'fletcher',friendlyBots:['fletcher'],enemies:['fletcher'],spawnDistance:5000});
  // The server's transport: the Rust codec encodes every update against the
  // immutable baseline the client received with its metadata. The runtime's
  // first update is that baseline whole; later ones patch it.
  const first=JSON.parse(local.runtime.snapshot_delta([])) as FrameUpdate;
  const baseline={...decodeFrameUpdate(undefined,first),loaded:[true,true] as [boolean,boolean],connected:[true,true] as [boolean,boolean]};
  const metadata={contentHash,type:'matched',matchId:'test',player:0,team:'a',connectionEpoch:2,version,setup:local.setup,environment:{timeOfDay:'morning',weather:'clear'},baseline};
  const update=(ticks:number)=>{ local.runtime.step(ticks); return JSON.parse(local.runtime.snapshot_delta([])) as FrameUpdate; };
  const running=update(3);
  expect(running.baseTick).toBe(0); expect(running.tick).toBe(3);
  // The server forks its baseline encoder per publication; a runtime encodes
  // against what it published last. A twin of the same seeded battle, stepped
  // straight to tick 6, is a Rust-encoded update against tick 0.
  const twin=await HeadlessSession.create({playerShipId:'fletcher',friendlyBots:['fletcher'],enemies:['fletcher'],spawnDistance:5000});
  expect(JSON.parse(twin.runtime.snapshot_delta([]))).toEqual(first);
  twin.runtime.step(6);
  const later=JSON.parse(twin.runtime.snapshot_delta([])) as FrameUpdate;
  expect(later.baseTick).toBe(0); expect(later.tick).toBe(6);
  const connection=MatchConnection.resume(()=>{});
  try {
    const first=Socket.instances.at(-1)!;
    first.binary(metadata,true); first.binary(running);
    const session=await connection.matched; expect(session.tick).toBe(3); session.loadedAssets();
    // Reconnect while an old-generation frame is still decompressing. The new
    // handshake must survive subsequent latest-state frames in the bounded queue.
    first.binary({baseTick:0,tick:0});
    first.close(); await until(()=>Socket.instances.at(-1)!==first);
    const second=Socket.instances.at(-1)!;
    // Frames may be skipped: this update is against the baseline, not tick 3.
    second.binary({...metadata,connectionEpoch:3},true); second.binary(later);
    await until(()=>session.metadata.connectionEpoch===3);
    await until(()=>{session.advance(0,{throttle:0,rudder:0},{aim:[0,0,0],battery:'main',fire:false});return session.tick===6;});
    expect(second.sent.some(m=>m.type==='ready')).toBe(true);
    session.selectShip('friendly-1');
    const command=second.sent.find(m=>m.type==='command');
    expect(command.envelope.connectionEpoch).toBe(3); expect(command.envelope.sequence).toBe(1);
    session.connectionFailed('Connection lost');
    expect(battleExitLabel(session)).toBe('Return to port');
  } finally {
    connection.close(true); local.dispose(); twin.dispose();
    names.forEach((name,i)=>{ if(descriptors[i]) Object.defineProperty(globalThis,name,descriptors[i]!); else Reflect.deleteProperty(globalThis,name); });
  }
});
test('only a running online battle offers forfeiture', () => {
  for(const phase of ['loading','countdown','cancelled','finished']) expect(battleExitLabel({networked:true,phase,result:'active'})).toBe('Return to port');
  expect(battleExitLabel({networked:true,phase:'running',result:'active'})).toBe('Forfeit and return to port');
});

test('a mismatched construction manifest cannot create a session or send Ready', async () => {
  const names=['WebSocket','sessionStorage','location','fetch'] as const;
  const descriptors=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
  const stored=new Map([['naval-match-ticket-v1','hash-test-ticket']]);
  const overrides={WebSocket:Socket,sessionStorage:{getItem:(k:string)=>stored.get(k),removeItem:(k:string)=>stored.delete(k)},location:{href:'http://localhost/',protocol:'http:'},fetch:async()=>new Response(JSON.stringify({artifacts:[]}))};
  for(const name of names)Object.defineProperty(globalThis,name,{value:overrides[name],configurable:true,writable:true});
  const connection=MatchConnection.resume(()=>{});
  try {
    const socket=Socket.instances.at(-1)!;
    socket.binary({type:'matched',matchId:'hash-test',version,contentHash:'0'.repeat(64),setup:{ships:[]}},true);
    await expect(connection.matched).rejects.toThrow('content hash mismatch');
    expect(socket.sent.some(m=>m.type==='ready')).toBe(false);
  } finally {connection.close(true);names.forEach((name,i)=>{const d=descriptors[i];if(d)Object.defineProperty(globalThis,name,d);else delete(globalThis as any)[name];});}
});
