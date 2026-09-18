export const RANGEFINDING_SECONDS = 3;

export interface RangeObservation {
  id: string;
  name: string;
  rangeM: number;
  nearSight: boolean;
}
export interface RangefinderState {
  phase: 'idle' | 'no-target' | 'measuring' | 'tracking' | 'lost';
  targetId?: string;
  targetName?: string;
  rangeM?: number;
  progress: number;
  locked: boolean;
}

/** A crew's optical measurement, separate from gun ballistics and target selection.
 * Only visible observations enter here; losing sight never reads hidden positions. */
export class Rangefinder {
  readonly state: RangefinderState = { phase: 'idle', progress: 0, locked: false };

  reset(): void {
    Object.assign(this.state, { phase: 'idle', targetId: undefined, targetName: undefined, rangeM: undefined, progress: 0, locked: false });
  }
  start(target?: RangeObservation): void {
    this.reset();
    if (!target?.nearSight) { this.state.phase = 'no-target'; return; }
    Object.assign(this.state, { phase: 'measuring', targetId: target.id, targetName: target.name });
  }
  update(seconds: number, target?: RangeObservation): void {
    const state = this.state;
    if (seconds <= 0 || !Number.isFinite(seconds) || !['measuring', 'tracking'].includes(state.phase)) return;
    if (!target || target.id !== state.targetId || !Number.isFinite(target.rangeM) || target.rangeM <= 0 ||
      (state.phase === 'measuring' && !target.nearSight)) {
      state.phase = 'lost';
      return;
    }
    if (state.phase === 'measuring') {
      state.progress = Math.min(1, state.progress + seconds / RANGEFINDING_SECONDS);
      if (state.progress < 1 - 1e-9) return;
      state.progress = 1;
      state.rangeM = target.rangeM;
      state.phase = 'tracking';
    } else {
      // Crew updates settle over half a second rather than jumping between snapshots.
      state.rangeM! += (target.rangeM - state.rangeM!) * -Math.expm1(-seconds / .5);
    }
  }
  toggleLock(): void {
    if (this.state.rangeM !== undefined) this.state.locked = !this.state.locked;
  }
}
