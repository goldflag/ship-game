// Worker-side cost of a two-ship custom battle: step / snapshot / decode / delta per batch.
import init, { LocalRuntime } from '../../src/generated/naval-wasm/naval_wasm';
import { decodeSnapshot } from '../../src/game/session/snapshotCodec';
import { localDelta } from '../../src/game/session/localSnapshotDelta';
import { runtimeSetup } from '../../src/game/session/LocalBattleSession';
const wasm = Bun.argv[2] ?? 'src/generated/naval-wasm/naval_wasm_bg.wasm';
const player = Bun.argv[3] ?? 'bismarck', enemy = Bun.argv[4] ?? 'bismarck';
await init({ module_or_path: await Bun.file(wasm).arrayBuffer() });
const setup = runtimeSetup({ playerShipId: player, friendlyBots: [], enemies: [{ shipId: enemy, aiLevel: 'easy' }], spawnDistance: 8000, mapId: 'north-atlantic' } as any, 1234);
const runtime = new LocalRuntime(await Bun.file('.build/naval-content/manifest.json').bytes(), JSON.stringify(setup));
let previous = decodeSnapshot(runtime.snapshot());
for (let window = 0; window < 3; window++) {
  const ms = { step: 0, serialize: 0, decode: 0, delta: 0 }; let bytes = 0, batches = 0, shells = 0;
  const start = performance.now();
  for (let tick = 0; tick < 3600; tick += 1) {
    let t = performance.now(); runtime.step(1); ms.step += performance.now() - t;
    t = performance.now(); const json = runtime.snapshot(); ms.serialize += performance.now() - t; bytes += json.length;
    t = performance.now(); const next = decodeSnapshot(json); ms.decode += performance.now() - t;
    t = performance.now(); structuredClone(localDelta(previous, next)); ms.delta += performance.now() - t;
    previous = next; batches++; shells = Math.max(shells, next.shells.length);
  }
  console.log(JSON.stringify({ window, wallMs: Math.round(performance.now() - start), perTickMs: { step: +(ms.step / batches).toFixed(3), serialize: +(ms.serialize / batches).toFixed(3), decode: +(ms.decode / batches).toFixed(3), delta: +(ms.delta / batches).toFixed(3) }, bytesPerSnapshot: Math.round(bytes / batches), peakShells: shells }));
}
runtime.free();
