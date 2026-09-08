import init, { LocalRuntime } from '../../generated/naval-wasm/naval_wasm';
import manifestUrl from '../../../.build/naval-content/manifest.json?url';
import type { BattleSetup } from '../../multiplayer/generated/BattleSetup';
import type { CommandEnvelope } from '../../multiplayer/generated/CommandEnvelope';
import { decodeSnapshot } from './snapshotCodec';
import { localDelta } from './localSnapshotDelta';
import type { Snapshot } from './SnapshotSession';
let runtime: LocalRuntime | undefined;
let previous: Snapshot | undefined;
// Requests are serialized: initialization cannot race a queued tick batch.
let chain = Promise.resolve();
self.onmessage = (event: MessageEvent<{ type: 'init'; setup: BattleSetup } | { type: 'advance'; commands: CommandEnvelope[]; ticks: number }>) => {
  chain = chain.then(async () => {
    try {
      const message = event.data;
      if (message.type === 'init') {
        const [, response] = await Promise.all([init(), fetch(manifestUrl)]);
        if (!response.ok) throw new Error('Unable to load battle content.');
        runtime?.free(); runtime = new LocalRuntime(new Uint8Array(await response.arrayBuffer()), JSON.stringify(message.setup));
      } else {
        if (!runtime) throw new Error('Battle worker is not initialized.');
        for (const command of message.commands) {
          try {
            runtime.command(JSON.stringify(command));
            self.postMessage({ type: 'ack', sequence: command.sequence, accepted: true, command: command.command.type, shipId: command.shipId });
          } catch (error) { self.postMessage({ type: 'ack', sequence: command.sequence, accepted: false, message: String(error), command: command.command.type, shipId: command.shipId }); }
        }
        runtime.step(message.ticks);
      }
      const frame = decodeSnapshot(runtime!.snapshot());
      self.postMessage({ type: 'snapshot', baseTick: previous?.tick, delta: localDelta(previous, frame) });
      previous = frame;
    } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
  });
};
