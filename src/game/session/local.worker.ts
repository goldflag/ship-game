import init, { LocalRuntime, PvePlanner } from '../../generated/naval-wasm/naval_wasm';
import manifestUrl from '../../../.build/naval-content/manifest.json?url';
import type { BattleSetup } from '../../multiplayer/generated/BattleSetup';
import type { CommandEnvelope } from '../../multiplayer/generated/CommandEnvelope';
import { decodeSnapshot } from './snapshotCodec';
import { localDelta } from './localSnapshotDelta';
import type { Snapshot } from './SnapshotSession';
import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import type { Placement } from '../../multiplayer/generated/Placement';
let runtime: LocalRuntime | undefined;
let planner: PvePlanner | undefined;
let previous: Snapshot | undefined;
let content: Promise<Uint8Array> | undefined;
function loadContent() {
  return content ??= (async () => {
    const [, response] = await Promise.all([init(), fetch(manifestUrl)]);
    if (!response.ok) throw new Error('Unable to load battle content.');
    return new Uint8Array(await response.arrayBuffer());
  })();
}
// Requests are serialized: initialization cannot race a queued tick batch.
let chain = Promise.resolve();
self.onmessage = (event: MessageEvent<{ type: 'init'; setup: BattleSetup } | { type: 'plan'; request: PveRequest } | { type: 'deploy'; placements: Placement[] } | { type: 'restart' } | { type: 'advance'; commands: CommandEnvelope[]; ticks: number }>) => {
  chain = chain.then(async () => {
    try {
      const message = event.data;
      if (message.type === 'plan') {
        const next = new PvePlanner(await loadContent(), JSON.stringify(message.request));
        planner?.free(); planner = next;
        self.postMessage({ type: 'briefing', briefing: JSON.parse(planner.briefing()) });
        return;
      } else if (message.type === 'deploy') {
        if (!planner) throw new Error('Prepare a mission before deploying.');
        const next = planner.start(JSON.stringify(message.placements));
        runtime?.free(); runtime = next; previous = undefined;
        planner.free(); planner = undefined;
      } else if (message.type === 'init') {
        const next = new LocalRuntime(await loadContent(), JSON.stringify(message.setup));
        runtime?.free(); runtime = next; previous = undefined;
      } else if (message.type === 'restart') {
        if (!runtime) throw new Error('No active mission to restart.');
        runtime.restart_pve(); previous = undefined;
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
      self.postMessage({ type: 'snapshot', reset: message.type === 'restart', baseTick: previous?.tick, delta: localDelta(previous, frame) });
      previous = frame;
    } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
  });
};
