import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import type { PveBriefing } from '../../multiplayer/generated/PveBriefing';
import type { Placement } from '../../multiplayer/generated/Placement';
import { LocalBattleSession } from './LocalBattleSession';
import type { MissionRules } from '../../multiplayer/generated/MissionRules';
import type { Formation } from '../../multiplayer/generated/Formation';

export interface PveOptions { rules: MissionRules; eligiblePresets: string[] }

/** Starting a planner worker is expensive: wasm instantiation plus a 38 MB content manifest
 * that is fetched, parsed and hashed before it can answer anything. One worker serves a
 * whole visit to the setup screen — options, every regenerated plan, validation — and is
 * handed to the battle on deploy, so that cost is paid once instead of per step. */
let idleWorker: Worker | undefined;
const startWorker = () => new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' });
function takeWorker(): Worker {
  const worker = idleWorker ?? startWorker();
  idleWorker = undefined;
  return worker;
}
function parkWorker(worker: Worker): void {
  worker.onmessage = null; worker.onerror = null;
  if (idleWorker) worker.terminate(); else idleWorker = worker;
}

/** Only public briefing data leaves the planner's worker. The same worker owns
 * the frozen enemy from generation through deployment, battle and restart. */
export class PveDraft {
  private transferred = false;
  /** Cruising formation chosen for each task group on the deployment screen.
   * Groups left out sail in column, the mission's default. */
  readonly formations: Record<string, Formation> = {};
  private constructor(private worker: Worker, readonly briefing: PveBriefing, readonly request: PveRequest) {}
  setFormation(groupId: string, formation: Formation): void { this.formations[groupId] = formation; }
  static options(signal?: AbortSignal): Promise<PveOptions> {
    const worker = takeWorker();
    return new Promise((resolve, reject) => {
      const finish = (error?: string, options?: PveOptions) => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        // A worker that answered cleanly still holds the loaded catalog; a failed or
        // abandoned one may have a reply in flight, so it is not worth keeping.
        if (error) worker.terminate(); else parkWorker(worker);
        if (error) reject(new Error(error)); else resolve(options!);
      };
      const abort = () => finish('Mission preparation cancelled.');
      const timer = setTimeout(() => finish('Mission content took too long to load.'), 120000);
      worker.onerror = event => finish(event.message);
      worker.onmessage = event => {
        if (event.data.type === 'error') finish(event.data.message);
        else if (event.data.type === 'options') finish(undefined, event.data.options);
      };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      worker.postMessage({ type: 'options' });
    });
  }
  static create(request: PveRequest, signal?: AbortSignal): Promise<PveDraft> {
    const worker = takeWorker();
    return new Promise((resolve, reject) => {
      const abort = () => fail('Mission preparation cancelled.');
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      const fail = (message: string) => { cleanup(); worker.terminate(); reject(new Error(message)); };
      const timer = setTimeout(() => fail('Mission preparation took too long.'), 120000);
      worker.onerror = event => fail(event.message);
      worker.onmessage = event => {
        if (event.data.type === 'error') { fail(event.data.message); return; }
        if (event.data.type === 'briefing') {
          cleanup();
          const briefing = event.data.briefing as PveBriefing;
          if (briefing.generationVersion !== 1 || !briefing.setup.ships.length || briefing.setup.ships.some(s => s.team !== 'a')) { fail('Invalid mission briefing.'); return; }
          resolve(new PveDraft(worker, briefing, structuredClone(request)));
        }
      };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      worker.postMessage({ type: 'plan', request });
    });
  }
  async deploy(placements: Placement[]): Promise<LocalBattleSession> {
    if (this.transferred) throw new Error('This mission has already left deployment.');
    this.transferred = true;
    return LocalBattleSession.deploy(this.worker, this.briefing, placements, this.formations);
  }
  validate(placements: Placement[]): Promise<void> {
    if (this.transferred) return Promise.reject(new Error('This mission has already left deployment.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.dispose(); reject(new Error('Deployment validation took too long.')); }, 30000);
      this.worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
      this.worker.onmessage = event => {
        if (event.data.type === 'error') { clearTimeout(timer); reject(new Error(event.data.message)); }
        else if (event.data.type === 'validated') { clearTimeout(timer); resolve(); }
      };
      this.worker.postMessage({ type: 'validate', placements });
    });
  }
  /** Give the worker back for the next plan on this screen; the planner it holds is freed
   * when that plan replaces it. Use release() to shut the setup down for good. */
  dispose(): void { if (!this.transferred) { this.transferred = true; parkWorker(this.worker); } }
  /** Leaving mission setup: stop paying to keep a worker and its catalog resident. */
  static release(): void { idleWorker?.terminate(); idleWorker = undefined; }
}
