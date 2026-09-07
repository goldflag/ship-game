import type { CombatSimulation } from '../simulation/combat';
import type { Vec3 } from '../ships/blueprint';
import { worldToLocal } from '../simulation/geometry';
import { FIXED_DT } from '../simulation/ship';

export interface HitCue {
  id: number; shipId: string; projectileIds: number[]; position: Vec3;
  part: string; result: string; damage: number; time: number; opacity: number; priority: number;
}
const DURATION = 3.2;
const outcomes = { penetrated: 'Penetration', ricochet: 'Ricochet', stopped: 'Armor stopped', damaged: 'Damaged', destroyed: 'Destroyed', detonation: 'Detonation', backing: 'Backing struck' };

/** Consume actual impact evidence once, merging armor layers and nearby salvo hits. */
export class HitFeedback {
  private source?: CombatSimulation;
  private sequence = 0;
  private tick = 0;
  private cues: HitCue[] = [];

  update(sim: CombatSimulation): readonly HitCue[] {
    if (this.source !== sim || sim.tick < this.tick) { this.cues = []; this.sequence = 0; }
    this.source = sim; this.tick = sim.tick;
    const time = sim.tick * FIXED_DT;
    this.cues = this.cues.filter(c => time - c.time < DURATION);
    for (const event of sim.events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      const actor = sim.actors.find(a => a.motion.id === event.shipId);
      const impact = event.impact;
      if (!actor || actor.team === sim.player.team || (!impact && !['torpedo-hit', 'torpedo-dud', 'depth-charge-hit'].includes(event.kind))) continue;
      const hitTime = event.tick * FIXED_DT;
      if (time - hitTime >= DURATION) continue;
      const position = worldToLocal(event.position, actor.motion);
      const projectile = event.shell?.id ?? event.torpedo?.id ?? event.depthCharge?.id ?? impact?.shellId ?? event.sequence;
      const part = impact?.targetName ?? event.message.split(' · ')[1] ?? 'Hull';
      const result = impact ? `${outcomes[impact.outcome]}${impact.breachAreaM2 ? ' · Flooding' : ''}` : event.kind === 'torpedo-dud' ? 'Unarmed impact' : 'Flooding breach';
      const priority = impact ? (impact.kind === 'module' || impact.kind === 'mount' ? 3 : impact.kind === 'burst' ? 2 : 1) + (impact.outcome === 'destroyed' ? 3 : 0) : 4;
      const damage = Math.max(0, impact?.hullDamage ?? event.hullDamage ?? 0);
      const existing = this.cues.find(c => c.shipId === actor.motion.id && (c.projectileIds.includes(projectile) || (hitTime - c.time <= .35 && c.part === part && Math.hypot(...c.position.map((v, i) => v - position[i])) < 35)));
      if (existing) {
        existing.damage += damage; existing.time = hitTime;
        if (!existing.projectileIds.includes(projectile)) existing.projectileIds.push(projectile);
        if (priority >= existing.priority) { existing.part = part; existing.result = result; existing.priority = priority; }
        if (impact?.breachAreaM2 && !existing.result.includes('Flooding')) existing.result += ' · Flooding';
      } else this.cues.push({ id: event.sequence, shipId: actor.motion.id, projectileIds: [projectile], position, part, result, priority, damage, time: hitTime, opacity: 1 });
    }
    this.cues = this.cues.slice(-12);
    for (const cue of this.cues) cue.opacity = Math.min(1, Math.max(0, (DURATION - (time - cue.time)) / .8));
    return this.cues;
  }
}
