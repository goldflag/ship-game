import init, { LocalRuntime, PvePlanner } from '../../generated/naval-wasm/naval_wasm';
import manifestUrl from '../../../.build/naval-content/index.json?url';
import type { BattleSetup } from '../../multiplayer/generated/BattleSetup';
import type { CommandEnvelope } from '../../multiplayer/generated/CommandEnvelope';
import { assetUrl } from '../../assetUrl';
import type { FrameUpdate } from './frameDelta';
import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import type { Placement } from '../../multiplayer/generated/Placement';
import type { Formation } from '../../multiplayer/generated/Formation';
import type { LocalConstructionInput, TrialAction } from './localConstruction';
import { loadConstructionCatalog } from '../../ships/constructionEquipment';
let runtime: LocalRuntime | undefined;
let wasmMemory: WebAssembly.Memory | undefined;
let planner: PvePlanner | undefined;
let profile = false;
/** Hulls whose damage-control detail the session still reads. Empty keeps every
 * ship's, which is what the first frame after init, deploy or restart wants. */
let detail: string[] = [];
type ContentIndex = { ships: { id: string; contentHash: string; sha256: string; encoding: string; url: string }[]; hydrostatics: { id: string }[]; [key: string]: unknown };
let content: Promise<ContentIndex> | undefined;
let trialInit: { setup: BattleSetup; construction: LocalConstructionInput } | undefined;
async function createRuntime(setup: BattleSetup, construction?: LocalConstructionInput): Promise<LocalRuntime> {
  const manifest = await loadContent(setup.ships.map(s => s.presetId));
  if (!construction) return new LocalRuntime(manifest, JSON.stringify(setup));
  const catalogs = await Promise.all([...new Set(construction.sources.map(s => s.construction.catalogRevision))].map(revision => loadConstructionCatalog(revision)));
  const next = LocalRuntime.with_construction(manifest, JSON.stringify(setup), JSON.stringify(construction.sources), JSON.stringify(catalogs), construction.trial);
  try {
    const definitions = JSON.parse(next.construction_definitions());
    for (const [id, hash] of Object.entries(construction.expected)) if (definitions[id]?.contentHash !== hash) throw new Error('A design changed since its preview. Return to the builder and compile it again.');
    return next;
  } catch (error) { next.free(); throw error; }
}
async function loadContent(ids?: string[]): Promise<Uint8Array> {
  const index = await (content ??= (async () => {
    const [, response] = await Promise.all([init().then(wasm => { wasmMemory = wasm.memory; }), fetch(manifestUrl)]);
    if (!response.ok) throw new Error('Unable to load battle content.');
    return response.json() as Promise<ContentIndex>;
  })());
  // Custom battles/trials fetch only admitted historical designs. The mission
  // planner needs the eligible roster; that path explicitly requests all designs.
  let selected = ids ? index.ships.filter(s => ids.includes(s.id)) : index.ships;
  if (!selected.length) selected = index.ships.filter(s => s.id === 'bismarck'); // Bootstrap trusted environment for an all-local fleet.
  const ships = [];
  for (const { url, ...entry } of selected) {
    const response = await fetch(assetUrl(url));
    if (!response.ok) throw new Error('Unable to load battle ship: ' + entry.id);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    ships.push({ ...entry, json: btoa(binary) });
  }
  // No persistent full manifest/definition strings in the worker after admission.
  return new TextEncoder().encode(JSON.stringify({ ...index, ships,
    hydrostatics: index.hydrostatics.filter(t => selected.some(s => s.id === t.id)) }));
}
// Requests are serialized: initialization cannot race a queued tick batch.
// LocalWorkerOperation correlates setup replies by this order and retires the
// worker if a reply is abandoned; never publish unsolicited setup replies.
let chain = Promise.resolve();
self.onmessage = (event: MessageEvent<{ type: 'options' } | { type: 'validate'; placements: Placement[] } | { type: 'init'; setup: BattleSetup; profile?: boolean; construction?: LocalConstructionInput } | { type: 'plan'; request: PveRequest; profile?: boolean } | { type: 'deploy'; placements: Placement[]; formations?: Record<string, Formation> } | { type: 'restart' } | { type: 'trial-reset' } | { type: 'trial-action'; action: TrialAction } | { type: 'advance'; commands: CommandEnvelope[]; ticks: number; detailShipIds?: string[] }>) => {
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
        const next = await createRuntime(message.setup, message.construction);
        runtime?.free(); runtime = next; detail = [];
        trialInit = message.construction?.trial ? { setup: message.setup, construction: message.construction } : undefined;
      } else if (message.type === 'trial-reset') {
        if (!trialInit || !runtime) throw new Error('No local trial to reset.');
        runtime.reset_trial(); detail = [];
      } else if (message.type === 'trial-action') {
        if (!trialInit || !runtime) throw new Error('Trial controls are unavailable.');
        runtime.trial_action(JSON.stringify(message.action)); runtime.step(1); detail = [];
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
      // parses a FrameUpdate instead of parsing, normalizing and diffing a frame.
      const stepped = profile ? performance.now() : 0;
      const json = runtime!.snapshot_delta(detail);
      const serialized = profile ? performance.now() : 0;
      const update = JSON.parse(json) as FrameUpdate;
      const decoded = profile ? performance.now() : 0;
      if (!Number.isSafeInteger(update.tick) || update.tick < 0) throw new Error('Invalid battle snapshot.');
      const timing = profile ? { tick: update.tick, ticks: message.type === 'advance' ? message.ticks : 0,
        step: stepped - started, serialize: serialized - stepped, decode: decoded - serialized,
        delta: 0, bytes: json.length, wasmMemoryBytes: wasmMemory?.buffer.byteLength } : undefined;
      self.postMessage({ type: 'snapshot', reset: message.type === 'restart' || message.type === 'trial-reset' || (message.type === 'trial-action' && update.baseTick == null), trialAction: message.type === 'trial-action', update, timing });
    } catch (error) { self.postMessage({ type: event.data.type === 'trial-action' ? 'trial-error' : 'error', message: String(error) }); }
  });
};
