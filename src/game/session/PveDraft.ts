import { LocalWorkerOperation } from './LocalWorkerOperation';
import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import type { ScenarioRequest } from '../../multiplayer/generated/ScenarioRequest';
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
function takeWorker(): LocalWorkerOperation {
  const worker = idleWorker ?? startWorker();
  idleWorker = undefined;
  return new LocalWorkerOperation(worker);
}
function parkWorker(operation: LocalWorkerOperation): void {
  if (!operation.idle) { operation.terminate(); return; }
  const worker = operation.transfer();
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
  /** `request` is the generated mission's; a scenario carries `scenario` instead and deploys its authored spawns. */
  private constructor(private worker: LocalWorkerOperation, readonly briefing: PveBriefing, readonly request?: PveRequest, readonly scenario?: ScenarioRequest) {}
  setFormation(groupId: string, formation: Formation): void { this.formations[groupId] = formation; }
  get usable(): boolean { return !this.transferred && this.worker.usable; }
  static async options(signal?: AbortSignal): Promise<PveOptions> {
    const worker = takeWorker();
    try {
      const options = await worker.request({ type: 'options' }, data => data.type === 'options' ? data.options as PveOptions : undefined,
        120000, 'Mission content took too long to load.', signal);
      parkWorker(worker);
      return options;
    } catch (error) { worker.terminate(); throw error; }
  }
  static async create(request: PveRequest, signal?: AbortSignal): Promise<PveDraft> {
    const worker = takeWorker();
    try {
      const briefing = await worker.request({ type: 'plan', request }, data => data.type === 'briefing' ? data.briefing as PveBriefing : undefined,
        120000, 'Mission preparation took too long.', signal);
      if (briefing.generationVersion !== 1 || !briefing.setup.ships.length || briefing.setup.ships.some(s => s.team !== 'a')) throw new Error('Invalid mission briefing.');
      return new PveDraft(worker, briefing, structuredClone(request));
    } catch (error) { worker.terminate(); throw error; }
  }
  /** A hand-authored action: fixed fleets on `mapId`'s chart. Only owned ships, conditions and orders come back. */
  static async scenario(request: ScenarioRequest, mapId: string, signal?: AbortSignal): Promise<PveDraft> {
    const worker = takeWorker();
    try {
      const briefing = await worker.request({ type: 'scenario', request, mapId }, data => data.type === 'briefing' ? data.briefing as PveBriefing : undefined,
        120000, 'Scenario preparation took too long.', signal);
      if (briefing.generationVersion !== 1 || !briefing.scenario || !briefing.setup.ships.length || briefing.setup.ships.some(s => s.team !== 'a' || !s.spawn)) throw new Error('Invalid scenario briefing.');
      return new PveDraft(worker, briefing, undefined, structuredClone(request));
    } catch (error) { worker.terminate(); throw error; }
  }
  /** A scenario's ships start where history put them: the briefing's own spawns. */
  get authoredPlacements(): Placement[] {
    return this.briefing.setup.ships.flatMap(ship => ship.spawn ? [{ id: ship.id, spawn: ship.spawn }] : []);
  }
  async deploy(placements: Placement[]): Promise<LocalBattleSession> {
    if (!this.usable) throw new Error('This mission has already left deployment.');
    const worker = this.worker.transfer();
    this.transferred = true;
    return LocalBattleSession.deploy(worker, this.briefing, placements, this.formations);
  }
  validate(placements: Placement[]): Promise<void> {
    if (!this.usable) return Promise.reject(new Error('This mission has already left deployment.'));
    return this.worker.request({ type: 'validate', placements }, data => data.type === 'validated' ? true : undefined,
      30000, 'Deployment validation took too long.').then(() => {});
  }

  /** Give the worker back for the next plan on this screen; the planner it holds is freed
   * when that plan replaces it. Use release() to shut the setup down for good. */
  dispose(): void { if (!this.transferred) { this.transferred = true; parkWorker(this.worker); } }
  /** Leaving mission setup: stop paying to keep a worker and its catalog resident. */
  static release(): void { idleWorker?.terminate(); idleWorker = undefined; }
}
