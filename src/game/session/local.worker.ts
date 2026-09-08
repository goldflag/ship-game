import init, { LocalRuntime } from '../../generated/naval-wasm/naval_wasm';
import manifestUrl from '../../../.build/naval-content/manifest.json?url';
import type { BattleSetup } from '../../multiplayer/generated/BattleSetup';
import type { CommandEnvelope } from '../../multiplayer/generated/CommandEnvelope';
import { decodeSnapshot } from './snapshotCodec';
import { localDelta } from './localSnapshotDelta';
import type { Snapshot } from './SnapshotSession';
let runtime: LocalRuntime | undefined;
let previous: Snapshot | undefined;
let profile = false;
// Requests are serialized: initialization cannot race a queued tick batch.
let chain = Promise.resolve();
self.onmessage = (event: MessageEvent<{ type: 'init'; setup: BattleSetup; profile?: boolean } | { type: 'advance'; commands: CommandEnvelope[]; ticks: number }>) => {
  chain = chain.then(async () => {
    try {
      const message = event.data;
      if (message.type === 'init') profile = message.profile === true;
      const started = profile ? performance.now() : 0;
      if (message.type === 'init') {
        const [, response] = await Promise.all([init(), fetch(manifestUrl)]);
        if (!response.ok) throw new Error('Unable to load battle content.');
        runtime?.free(); runtime = new LocalRuntime(new Uint8Array(await response.arrayBuffer()), JSON.stringify(message.setup));
      } else {
        if (!runtime) throw new Error('Battle worker is not initialized.');
        for (const command of message.commands) {
          try { runtime.command(JSON.stringify(command)); }
          catch (error) { self.postMessage({ type: 'rejected', sequence: command.sequence, message: String(error) }); }
        }
        runtime.step(message.ticks);
      }
      const stepped = profile ? performance.now() : 0;
      const json = runtime!.snapshot();
      const serialized = profile ? performance.now() : 0;
      const frame = decodeSnapshot(json);
      const decoded = profile ? performance.now() : 0;
      const delta = localDelta(previous, frame);
      const timing = profile ? { tick: frame.tick, ticks: message.type === 'advance' ? message.ticks : 0,
        step: stepped - started, serialize: serialized - stepped, decode: decoded - serialized,
        delta: performance.now() - decoded, bytes: json.length } : undefined;
      self.postMessage({ type: 'snapshot', baseTick: previous?.tick, delta, timing });
      previous = frame;
    } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
  });
};
