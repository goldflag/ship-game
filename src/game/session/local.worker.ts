import init, { LocalRuntime, PvePlanner } from '../../generated/naval-wasm/naval_wasm';
import manifestUrl from '../../../.build/naval-content/index.json?url';
import type { BattleSetup } from '../../multiplayer/generated/BattleSetup';
import type { CommandEnvelope } from '../../multiplayer/generated/CommandEnvelope';
import type { Command } from '../../multiplayer/generated/Command';
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
type ContentIndex = {
  ships: { id: string; contentHash: string; sha256: string; encoding: string; url: string }[];
  hydrostatics: { id: string }[];
  /** Baked heightfields by terrain id; each map names its own in `land.terrain`. */
  terrain: { id: string; sha256: string; url: string }[];
  maps: { maps: { id: string; land?: { terrain?: string | null } }[] };
  [key: string]: unknown;
};
let content: Promise<ContentIndex> | undefined;
let trialInit: { setup: BattleSetup; construction: LocalConstructionInput } | undefined;
const base64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
};
async function createRuntime(setup: BattleSetup, construction?: LocalConstructionInput): Promise<LocalRuntime> {
  const manifest = await loadContent(setup.ships.map((s) => s.presetId), setup.mapId);
  if (!construction) return new LocalRuntime(manifest, JSON.stringify(setup));
  const catalogs = await Promise.all(
    [...new Set(construction.sources.map((s) => s.construction.catalogRevision))].map((revision) => loadConstructionCatalog(revision)),
  );
  const next = LocalRuntime.with_construction(
    manifest,
    JSON.stringify(setup),
    JSON.stringify(construction.sources),
    JSON.stringify(catalogs),
    construction.trial,
  );
  try {
    const definitions = JSON.parse(next.construction_definitions());
    for (const [id, hash] of Object.entries(construction.expected))
      if (definitions[id]?.contentHash !== hash)
        throw new Error('A design changed since its preview. Return to the builder and compile it again.');
    return next;
  } catch (error) {
    next.free();
    throw error;
  }
}
/** The simulation manifest for one admission: the chosen designs (all of them without `ids`) and only the terrain
 * `mapId`'s land names, or none. The simulation verifies every entry's SHA-256 and refuses a map whose terrain is
 * missing only when a battle resolves that map. */
async function loadContent(ids?: string[], mapId?: string): Promise<Uint8Array> {
  const index = await (content ??= (async () => {
    const [, response] = await Promise.all([
      init().then((wasm) => {
        wasmMemory = wasm.memory;
      }),
      fetch(manifestUrl),
    ]);
    if (!response.ok) throw new Error('Unable to load battle content.');
    return response.json() as Promise<ContentIndex>;
  })());
  // Custom battles/trials fetch only admitted historical designs. The mission
  // planner needs the eligible roster; that path explicitly requests all designs.
  let selected = ids ? index.ships.filter((s) => ids.includes(s.id)) : index.ships;
  if (!selected.length) selected = index.ships.filter((s) => s.id === 'bismarck'); // Bootstrap trusted environment for an all-local fleet.
  const ships = [];
  for (const { url, ...entry } of selected) {
    const response = await fetch(assetUrl(url));
    if (!response.ok) throw new Error('Unable to load battle ship: ' + entry.id);
    ships.push({ ...entry, json: base64(new Uint8Array(await response.arrayBuffer())) });
  }
  const terrainId = mapId === undefined ? undefined : index.maps.maps.find((m) => m.id === mapId)?.land?.terrain;
  const terrain = [];
  for (const { url, ...entry } of index.terrain.filter((t) => t.id === terrainId)) {
    const response = await fetch(assetUrl(url));
    if (!response.ok) throw new Error('Unable to load battle terrain: ' + entry.id);
    terrain.push({ ...entry, data: base64(new Uint8Array(await response.arrayBuffer())) });
  }
  // No persistent full manifest/definition strings in the worker after admission.
  return new TextEncoder().encode(
    JSON.stringify({ ...index, ships, terrain, hydrostatics: index.hydrostatics.filter((t) => selected.some((s) => s.id === t.id)) }),
  );
}
/** A development order for any ship, applied as its owner's when the battle reaches `tick` (`LocalRuntime::direct`). */
export interface DirectedOrder { shipId: string; command: Command; tick: number }
function direct({ shipId, command, tick }: DirectedOrder): void {
  try {
    runtime!.direct(shipId, JSON.stringify(command));
    self.postMessage({ type: 'direct', shipId, command: command.type, tick, accepted: true });
  } catch (error) {
    self.postMessage({ type: 'direct', shipId, command: command.type, tick, accepted: false, message: String(error) });
  }
}
// Requests are serialized: initialization cannot race a queued tick batch.
// LocalWorkerOperation correlates setup replies by this order and retires the
// worker if a reply is abandoned; never publish unsolicited setup replies.
let chain = Promise.resolve();
self.onmessage = (
  event: MessageEvent<
    | { type: 'options' }
    | { type: 'validate'; placements: Placement[] }
    | { type: 'init'; setup: BattleSetup; profile?: boolean; construction?: LocalConstructionInput }
    | { type: 'plan'; request: PveRequest; profile?: boolean }
    | { type: 'deploy'; placements: Placement[]; formations?: Record<string, Formation> }
    | { type: 'restart' }
    | { type: 'trial-reset' }
    | { type: 'trial-action'; action: TrialAction }
    | { type: 'advance'; commands: CommandEnvelope[]; ticks: number; detailShipIds?: string[]; wind?: { speed: number; direction: number }; direct?: DirectedOrder[] }
  >,
) => {
  chain = chain.then(async () => {
    try {
      const message = event.data;
      if (message.type === 'init' || message.type === 'plan') profile = message.profile === true;
      const started = performance.now();
      if (message.type === 'options') {
        self.postMessage({ type: 'options', options: JSON.parse(PvePlanner.options(await loadContent())) });
        return;
      } else if (message.type === 'validate') {
        if (!planner) throw new Error('Prepare a mission before deploying.');
        planner.validate_placement(JSON.stringify(message.placements));
        self.postMessage({ type: 'validated' });
        return;
      } else if (message.type === 'plan') {
        const next = new PvePlanner(await loadContent(undefined, message.request.mapId), JSON.stringify(message.request));
        planner?.free();
        planner = next;
        self.postMessage({ type: 'briefing', briefing: JSON.parse(planner.briefing()) });
        return;
      } else if (message.type === 'deploy') {
        if (!planner) throw new Error('Prepare a mission before deploying.');
        const next = planner.start(JSON.stringify(message.placements), JSON.stringify(message.formations ?? {}));
        runtime?.free();
        runtime = next;
        detail = [];
        planner.free();
        planner = undefined;
      } else if (message.type === 'init') {
        const next = await createRuntime(message.setup, message.construction);
        runtime?.free();
        runtime = next;
        detail = [];
        trialInit = message.construction?.trial ? { setup: message.setup, construction: message.construction } : undefined;
      } else if (message.type === 'trial-reset') {
        if (!trialInit || !runtime) throw new Error('No local trial to reset.');
        runtime.reset_trial();
        detail = [];
      } else if (message.type === 'trial-action') {
        if (!trialInit || !runtime) throw new Error('Trial controls are unavailable.');
        runtime.trial_action(JSON.stringify(message.action));
        runtime.step(1);
        detail = [];
      } else if (message.type === 'restart') {
        if (!runtime) throw new Error('No active mission to restart.');
        // A restarted runtime holds no baseline, so the next frame travels whole.
        runtime.restart_pve();
        detail = [];
      } else {
        if (!runtime) throw new Error('Battle worker is not initialized.');
        // A developer console wind change reshapes the sea from this batch on.
        if (message.wind) runtime.set_wind(message.wind.speed, message.wind.direction);
        for (const command of message.commands) {
          try {
            runtime.command(JSON.stringify(command));
            self.postMessage({
              type: 'ack',
              sequence: command.sequence,
              accepted: true,
              command: command.command.type,
              shipId: command.shipId,
            });
          } catch (error) {
            self.postMessage({
              type: 'ack',
              sequence: command.sequence,
              accepted: false,
              message: String(error),
              command: command.command.type,
              shipId: command.shipId,
            });
          }
        }
        if (!Number.isInteger(message.ticks) || message.ticks < 1 || message.ticks > 24) throw new Error('Invalid local tick batch.');
        const ids = message.detailShipIds ?? [];
        if (!Array.isArray(ids) || ids.length > 4 || ids.some((id) => typeof id !== 'string')) throw new Error('Invalid snapshot detail.');
        detail = ids;
        // Keep the runtime's bounded fixed-step API; high speed batches never
        // alter timestep or block the rendering/input thread.
        // Directed orders (the film driver) land at their own tick whatever the batch size, so a battle stepped a tick at a
        // time and one stepped six at a time receive them at the same moment.
        const due = [...(message.direct ?? [])].sort((a, b) => a.tick - b.tick);
        for (let left = message.ticks; left > 0;) {
          const now = runtime.tick();
          while (due.length && due[0].tick <= now) direct(due.shift()!);
          const ticks = Math.min(6, left, due.length ? due[0].tick - now : 6);
          runtime.step(ticks);
          left -= ticks;
        }
        due.forEach(direct);
      }
      // Rust walks the frame once and writes only what moved, so the worker
      // parses a FrameUpdate instead of parsing, normalizing and diffing a frame.
      const stepped = performance.now();
      const json = runtime!.snapshot_delta(detail);
      const serialized = profile ? performance.now() : 0;
      const update = JSON.parse(json) as FrameUpdate;
      const decoded = performance.now();
      if (!Number.isSafeInteger(update.tick) || update.tick < 0) throw new Error('Invalid battle snapshot.');
      const timing = profile
        ? {
            tick: update.tick,
            ticks: message.type === 'advance' ? message.ticks : 0,
            step: stepped - started,
            serialize: serialized - stepped,
            decode: decoded - serialized,
            delta: 0,
            bytes: json.length,
            wasmMemoryBytes: wasmMemory?.buffer.byteLength,
          }
        : undefined;
      // Always-on worker cost for the in-game simulation readout.
      const cost =
        message.type === 'advance' ? { ticks: message.ticks, stepMs: stepped - started, snapshotMs: decoded - stepped } : undefined;
      self.postMessage({
        type: 'snapshot',
        cost,
        reset: message.type === 'restart' || message.type === 'trial-reset' || (message.type === 'trial-action' && update.baseTick == null),
        trialAction: message.type === 'trial-action',
        update,
        timing,
      });
    } catch (error) {
      self.postMessage({ type: event.data.type === 'trial-action' ? 'trial-error' : 'error', message: String(error) });
    }
  });
};
