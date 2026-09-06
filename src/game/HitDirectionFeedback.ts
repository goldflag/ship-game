import type { CombatSimulation } from '../simulation/combat';
import { FIXED_DT } from '../simulation/ship';

export interface HitDirectionCue { id: number; angle: number; opacity: number; }
type Impact = { id: number; bearing: number; time: number };
const HOLD_SECONDS = 1.2, FADE_SECONDS = 1, MAX_CUES = 6;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Incoming shell bearings, kept in world space so cues follow camera turns.
 * Presentation only; armor contacts count even when they cause no hull HP loss.
 */
export class HitDirectionFeedback {
  private source?: CombatSimulation;
  private tick = 0;
  private sequence = 0;
  private impacts: Impact[] = [];
  private seen = new Map<number, number>();

  update(simulation: CombatSimulation, viewBearing: number): HitDirectionCue[] {
    const time = simulation.tick * FIXED_DT;
    if (this.source !== simulation || simulation.tick < this.tick) {
      this.impacts = []; this.seen.clear(); this.sequence = 0;
    }
    this.source = simulation; this.tick = simulation.tick;
    this.impacts = this.impacts.filter(hit => time - hit.time < HOLD_SECONDS + FADE_SECONDS);
    for (const [id, hitTime] of this.seen) if (time - hitTime > 60) this.seen.delete(id);
    for (const event of simulation.events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      if (event.shipId !== simulation.player.motion.id || !['penetration', 'stopped', 'ricochet', 'module', 'torpedo-hit', 'depth-charge-hit'].includes(event.kind)) continue;
      const shell = event.shell ?? event.torpedo ?? (event.depthCharge ? { id: event.depthCharge.id, velocity: [simulation.ship.x - event.position[0], 0, simulation.ship.z - event.position[2]] } : undefined), hitTime = event.tick * FIXED_DT;
      if (!shell || this.seen.has(shell.id) || time - hitTime >= HOLD_SECONDS + FADE_SECONDS || !shell.velocity.every(Number.isFinite) || Math.hypot(shell.velocity[0], shell.velocity[2]) < .001) continue;
      this.seen.set(shell.id, hitTime);
      // One projectile can report several armor layers and modules.
      if (this.seen.size > 256) this.seen.delete(this.seen.keys().next().value!);
      const bearing = Math.atan2(-shell.velocity[0], shell.velocity[2]);
      const nearby = this.impacts.find(hit => Math.abs(wrap(hit.bearing - bearing)) < Math.PI / 9);
      if (nearby) { nearby.bearing = bearing; nearby.time = hitTime; }
      else {
        if (this.impacts.length >= MAX_CUES) this.impacts.splice(this.impacts.reduce((oldest, hit, i, hits) => hit.time < hits[oldest].time ? i : oldest, 0), 1);
        this.impacts.push({ id: event.sequence, bearing, time: hitTime });
      }
    }
    return this.impacts.map(hit => ({ id: hit.id, angle: wrap(hit.bearing - viewBearing), opacity: Math.min(1, Math.max(0, 1 - (time - hit.time - HOLD_SECONDS) / FADE_SECONDS)) }));
  }
}
