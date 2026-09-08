import init, { LocalRuntime } from '../../generated/naval-wasm/naval_wasm';
import manifestUrl from '../../../.build/naval-content/manifest.json?url';
import type { BattleSetup } from '../../multiplayer/generated/BattleSetup';
import type { CommandEnvelope } from '../../multiplayer/generated/CommandEnvelope';
let runtime: LocalRuntime | undefined;
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
          try { runtime.command(JSON.stringify(command)); }
          catch (error) { self.postMessage({ type: 'rejected', sequence: command.sequence, message: String(error) }); }
        }
        runtime.step(message.ticks);
      }
      self.postMessage({ type: 'snapshot', json: runtime!.snapshot() });
    } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
  });
};
