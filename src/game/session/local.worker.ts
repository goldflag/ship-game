import init, { LocalRuntime, PvePlanner } from '../../generated/naval-wasm/naval_wasm';
import manifestUrl from '../../../.build/naval-content/manifest.json?url';
import type { BattleSetup } from '../../multiplayer/generated/BattleSetup';
import type { CommandEnvelope } from '../../multiplayer/generated/CommandEnvelope';
import type { LocalDelta } from './localSnapshotDelta';
import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import type { Placement } from '../../multiplayer/generated/Placement';
import type { Formation } from '../../multiplayer/generated/Formation';
let runtime: LocalRuntime | undefined;
let planner: PvePlanner | undefined;
let profile = false;
/** Hulls whose damage-control detail the session still reads. Empty keeps every
 * ship's, which is what the first frame after init, deploy or restart wants. */
let detail: string[] = [];
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
self.onmessage = (event: MessageEvent<{ type: 'options' } | { type: 'validate'; placements: Placement[] } | { type: 'init'; setup: BattleSetup; profile?: boolean } | { type: 'plan'; request: PveRequest; profile?: boolean } | { type: 'deploy'; placements: Placement[]; formations?: Record<string, Formation> } | { type: 'restart' } | { type: 'advance'; commands: CommandEnvelope[]; ticks: number; detailShipIds?: string[] }>) => {
  chain = chain.then(async () => {
    try {
      const message = event.data;
      if (message.type === 'init' || message.type === 'plan') profile = message.profile === true;
      const started = profile ? performance.now() : 0;
      if (message.type === 'options') {
        self.postMessage({ type: 'options', options: JSON.parse(PvePlanner.options(await loadContent())) });
        return;
      } else if (message.type === 'validate') {
        if (!planner) throw new Error('Prepare a mission before deploying.');
        planner.validate_placement(JSON.stringify(message.placements));
        self.postMessage({ type: 'validated' });
        return;
      } else if (message.type === 'plan') {
        const next = new PvePlanner(await loadContent(), JSON.stringify(message.request));
        planner?.free(); planner = next;
        self.postMessage({ type: 'briefing', briefing: JSON.parse(planner.briefing()) });
        return;
      } else if (message.type === 'deploy') {
        if (!planner) throw new Error('Prepare a mission before deploying.');
        const next = planner.start(JSON.stringify(message.placements), JSON.stringify(message.formations ?? {}));
        runtime?.free(); runtime = next; detail = [];
        planner.free(); planner = undefined;
      } else if (message.type === 'init') {
        const next = new LocalRuntime(await loadContent(), JSON.stringify(message.setup));
        runtime?.free(); runtime = next; detail = [];
      } else if (message.type === 'restart') {
        if (!runtime) throw new Error('No active mission to restart.');
        // A restarted runtime holds no baseline, so the next frame travels whole.
        runtime.restart_pve(); detail = [];
      } else {
        if (!runtime) throw new Error('Battle worker is not initialized.');
        for (const command of message.commands) {
          try {
            runtime.command(JSON.stringify(command));
            self.postMessage({ type: 'ack', sequence: command.sequence, accepted: true, command: command.command.type, shipId: command.shipId });
          } catch (error) { self.postMessage({ type: 'ack', sequence: command.sequence, accepted: false, message: String(error), command: command.command.type, shipId: command.shipId }); }
        }
        if (!Number.isInteger(message.ticks) || message.ticks < 1 || message.ticks > 24) throw new Error('Invalid local tick batch.');
        const ids = message.detailShipIds ?? [];
        if (!Array.isArray(ids) || ids.length > 4 || ids.some(id => typeof id !== 'string')) throw new Error('Invalid snapshot detail.');
        detail = ids;
        // Keep the runtime's bounded fixed-step API; high speed batches never
        // alter timestep or block the rendering/input thread.
        for (let left = message.ticks; left > 0; left -= 6) runtime.step(Math.min(6, left));
      }
      // Rust walks the frame once and writes only what moved, so the worker
      // parses a patch instead of parsing, normalizing and diffing a frame.
      const stepped = profile ? performance.now() : 0;
      const json = runtime!.snapshot_delta(detail);
      const serialized = profile ? performance.now() : 0;
      const frame = JSON.parse(json) as { baseTick: number | null; tick: number; delta?: LocalDelta };
      const decoded = profile ? performance.now() : 0;
      if (!Number.isSafeInteger(frame.tick) || frame.tick < 0) throw new Error('Invalid battle snapshot.');
      const timing = profile ? { tick: frame.tick, ticks: message.type === 'advance' ? message.ticks : 0,
        step: stepped - started, serialize: serialized - stepped, decode: decoded - serialized,
        delta: 0, bytes: json.length } : undefined;
      self.postMessage({ type: 'snapshot', reset: message.type === 'restart', baseTick: frame.baseTick ?? undefined, delta: frame.delta, timing });
    } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
  });
};
