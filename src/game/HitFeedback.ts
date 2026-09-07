import type { CombatSimulation } from '../simulation/combat';
import type { Vec3 } from '../ships/blueprint';
import { worldToLocal } from '../simulation/geometry';
import { FIXED_DT } from '../simulation/ship';

export interface HitCue {
  id: number; shipId: string; projectileIds: number[]; position: Vec3;
  partId: string; part: string; result: string; damage: number; time: number; opacity: number; priority: number;
}
const DURATION = 3.2;
const outcomes = { penetrated: 'Penetration', ricochet: 'Ricochet', stopped: 'Armor stopped', damaged: 'Damaged', destroyed: 'Destroyed', detonation: 'Detonation', backing: 'Backing struck' };

/** Consume each projectile's layers once, then group matching visible component results. */
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
      const partId = impact?.targetId ?? part;
      const local = impact?.localDamage;
      // Equipment loss stays the headline; structural context explains reduced hull damage.
      const explanation = impact?.outcome === 'destroyed' ? `${outcomes.destroyed}${impact.throughWreckage ? ' · Through wreckage' : ''}`
        : impact?.throughWreckage && (impact.damage ?? 0) > 0 ? 'Through wreckage · Equipment damaged'
        : local && local.condition < .05 ? 'Destroyed section · Minimal damage'
        : local && local.multiplier < 1 ? 'Damaged section · Reduced damage' : impact ? outcomes[impact.outcome] : '';
      const result = impact ? `${impact.outcome === 'stopped' || impact.outcome === 'ricochet' ? outcomes[impact.outcome] : explanation}${impact.breachAreaM2 ? ' · New opening' : ''}` : event.kind === 'torpedo-dud' ? 'Unarmed impact' : 'Flooding breach';
      const priority = impact ? (impact.kind === 'module' || impact.kind === 'mount' ? 3 : impact.kind === 'burst' ? 2 : 1) + (impact.outcome === 'destroyed' ? 3 : 0) : 4;
      const damage = Math.max(0, impact?.hullDamage ?? event.hullDamage ?? 0);
      const existing = this.cues.find(c => c.shipId === actor.motion.id && c.projectileIds.includes(projectile));
      if (existing) {
        existing.damage += damage; existing.time = hitTime;
        if (priority >= existing.priority) { existing.partId = partId; existing.part = part; existing.result = result; existing.priority = priority; }
        if (impact?.breachAreaM2 && !existing.result.includes('New opening')) existing.result += ' · New opening';
      } else this.cues.push({ id: event.sequence, shipId: actor.motion.id, projectileIds: [projectile], position, partId, part, result, priority, damage, time: hitTime, opacity: 1 });
    }
    // Keep projectile evidence separate so a later module hit only changes that shell's headline.
    const groups = new Map<string, HitCue>();
    for (const cue of this.cues) {
      const key = JSON.stringify([cue.shipId, cue.partId, cue.result]);
      const group = groups.get(key);
      if (group) {
        group.damage += cue.damage;
        group.projectileIds.push(...cue.projectileIds);
        group.time = Math.max(group.time, cue.time);
      } else groups.set(key, { ...cue, projectileIds: [...cue.projectileIds] });
    }
    const visible = [...groups.values()].sort((a, b) => a.time - b.time).slice(-12);
    for (const cue of visible) cue.opacity = Math.min(1, Math.max(0, (DURATION - (time - cue.time)) / .8));
    return visible;
  }
}
