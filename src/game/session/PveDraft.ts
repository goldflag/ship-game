import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import type { PveBriefing } from '../../multiplayer/generated/PveBriefing';
import type { Placement } from '../../multiplayer/generated/Placement';
import { LocalBattleSession } from './LocalBattleSession';

/** Only public briefing data leaves the planner's worker. The same worker owns
 * the frozen enemy from generation through deployment, battle and restart. */
export class PveDraft {
  private transferred = false;
  private constructor(private worker: Worker, readonly briefing: PveBriefing) {}
  static create(request: PveRequest, signal?: AbortSignal): Promise<PveDraft> {
    const worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' });
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
          resolve(new PveDraft(worker, briefing));
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
    return LocalBattleSession.deploy(this.worker, this.briefing, placements);
  }
  dispose(): void { if (!this.transferred) { this.transferred = true; this.worker.terminate(); } }
}
