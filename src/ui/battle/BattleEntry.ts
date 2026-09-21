import type { BattleProgress } from '../../game/Game';

/** One Game's launch lifecycle. A replacement Game gets a new entry, so an old
 * preparation cannot release its lock or publish progress into the new harbor. */
export class BattleEntry {
  private running = false;

  constructor(
    private readonly active: () => boolean,
    private readonly progress: BattleProgress,
    private readonly failed: () => void,
  ) {}

  get pending(): boolean {
    return this.running;
  }

  async run(prepare: (progress: BattleProgress) => Promise<void>, commit: () => void, discard: () => void = () => {}): Promise<void> {
    if (this.running || !this.active()) throw new Error('The port is still preparing.');
    this.running = true;
    // Some loaders can finish reporting after preparation has settled.
    let settled = false;
    try {
      await prepare((label, fraction) => {
        if (!settled && this.active()) this.progress(label, fraction);
      });
      if (this.active()) commit();
      else discard();
    } catch (error) {
      if (this.active()) this.failed();
      throw error;
    } finally {
      settled = true;
      this.running = false;
    }
  }
}
