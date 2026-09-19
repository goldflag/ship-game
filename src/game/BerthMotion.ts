import { seaResponse, type SeaState } from './session/sea';

const STEP = 1 / 60;
/** Presentation-only motion for the hull on show. The port session is never
 * stepped, so the berth rides the same two-component sea a battle would, through
 * the authority's own response: heave eases over 1.5 s, and the wave slope works
 * a damped righting arm in roll and pitch. Stiffness comes from hull-form
 * estimates (GM ≈ 0.1 B, GML ≈ L² / 12 T) rather than the hydrostatic table, so
 * this is the look of a battle's motion, not its physics. Nothing here reaches
 * the session. */
export class BerthMotion {
  heave = 0; roll = 0; pitch = 0;
  private rollRate = 0; private pitchRate = 0; private time = 0; private debt = 0;
  reset(): void { this.heave = this.roll = this.pitch = this.rollRate = this.pitchRate = this.debt = 0; }
  update(sea: SeaState, hull: { length: number; beam: number; draft: number }, pose: { x: number; z: number; heading: number }, dt: number): void {
    this.debt = Math.min(.25, this.debt + dt);
    for (; this.debt >= STEP; this.debt -= STEP) {
      this.time += STEP;
      const wave = seaResponse(sea, hull, pose, this.time);
      this.heave += (wave.heave - this.heave) * (1 - Math.exp(-STEP / 1.5));
      // The authority's WAVE_ROLL_LEVER and WAVE_PITCH_LEVER (`stability.rs`).
      const rollArm = wave.roll * hull.beam * .14 - hull.beam * .1 * this.roll;
      const pitchArm = wave.pitch * hull.length * .8 - hull.length ** 2 / (12 * hull.draft) * this.pitch;
      this.rollRate = (this.rollRate + 9.81 * rollArm / (hull.beam * .4) ** 2 * STEP) * Math.exp(-STEP / 4);
      this.pitchRate = (this.pitchRate + 9.81 * pitchArm / (hull.length * .28) ** 2 * STEP) * Math.exp(-STEP / 3);
      this.roll += this.rollRate * STEP; this.pitch += this.pitchRate * STEP;
    }
  }
}
