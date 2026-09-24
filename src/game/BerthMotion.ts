import { seaResponse, type SeaState } from './session/seaSurface';

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
  /** The berth sea's clock: seconds of sea the hull has ridden. */
  get seaTime(): number { return this.time; }
  update(sea: SeaState, hull: Hull, pose: Heading, dt: number): void {
    this.debt = Math.min(.25, this.debt + dt);
    for (; this.debt >= STEP; this.debt -= STEP) this.step(sea, hull, pose);
  }
  /** Ride from a still hull at sea time 0 to `time`, so the berth holds the same pose however long the page has run. */
  seek(time: number, sea: SeaState, hull: Hull, pose: Heading): void {
    this.reset(); this.time = 0;
    for (let steps = Math.round(time / STEP); steps > 0; steps--) this.step(sea, hull, pose);
    this.time = time;
  }
  private step(sea: SeaState, hull: Hull, pose: Heading): void {
    this.time += STEP;
    const wave = seaResponse(sea, hull, pose, this.time);
    this.heave += (wave.heave - this.heave) * (1 - Math.exp(-STEP / 1.5));
    // The authority's WAVE_ROLL_LEVER and WAVE_PITCH_LEVER (`stability.rs`).
    const rollArm = wave.roll * hull.beam * .07 - hull.beam * .1 * this.roll;
    const pitchArm = wave.pitch * hull.length * .8 - hull.length ** 2 / (12 * hull.draft) * this.pitch;
    this.rollRate = (this.rollRate + 9.81 * rollArm / (hull.beam * .4) ** 2 * STEP) * Math.exp(-STEP / 4);
    this.pitchRate = (this.pitchRate + 9.81 * pitchArm / (hull.length * .28) ** 2 * STEP) * Math.exp(-STEP / 3);
    this.roll += this.rollRate * STEP; this.pitch += this.pitchRate * STEP;
  }
}
type Hull = { length: number; beam: number; draft: number };
type Heading = { x: number; z: number; heading: number };
