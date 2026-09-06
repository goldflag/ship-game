import { heatModule, heatMount } from './damageControl';
import type { ShipDefinition, Vec3, Volume } from '../ships/blueprint';
import { contactArmor, nearbyContacts, shipContacts, type Combatant, type DamageEvent, type Shell } from './damage';
import { clamp, dot, length, localToWorld, normalize, segmentOverlapsBox, sub, worldToLocal } from './geometry';
import { plateResponse } from './protection';

/** Calibrated, bounded target rays. Closed steel blocks pressure; fragments pay
 * each intervening layer. No unoccluded sphere damage or stochastic ray swarm.
 * One nearest-point ray per nearby equipment volume / watertight portal is an
 * explicit approximation: partial occlusion and detailed spall are not modeled. */
export function burstShell(shell: Shell, actors: (Combatant & { definition: ShipDefinition })[], emit: (event: DamageEvent) => void): void {
  const charge = shell.he ?? shell.ap;
  if (!charge) return;
  const name = shell.he ? 'HE' : 'AP';
  const radius = clamp(3 * Math.cbrt(charge.explosiveKg), .5, 15);
  let rays = 0;
  let burstShip = shell.lodged?.shipId ?? shell.lastHitShipId ?? '';
  const base = { shell: { id: shell.id, caliberM: shell.caliberM, velocity: [...shell.velocity] as Vec3, ammunition: shell.ammunition, type: shell.type ?? (shell.he ? 'HE' as const : 'AP' as const) }, position: [...shell.position] as Vec3 };
  // The sphere contains every target ray. Filter the complete fleet once, then
  // reuse local candidate indices and sampled train angles for all rays.
  const shields = actors.filter(a => {
    const p = worldToLocal(shell.position, a.motion);
    return Math.abs(p[0]) <= a.definition.hull.beam / 2 + radius + 15 && Math.abs(p[2]) <= a.definition.hull.length / 2 + radius + 20;
  }).map(actor => ({ actor, candidates: nearbyContacts(shell.position, radius, actor, actor.definition) }));
  for (const actor of actors) {
    if (actor.motion.y < -40) continue;
    const def = actor.definition, origin = worldToLocal(shell.position, actor.motion);
    if (Math.abs(origin[0]) > def.hull.beam / 2 + radius + 15 || Math.abs(origin[2]) > def.hull.length / 2 + radius + 20) continue;
    const candidates = shields.find(s => s.actor === actor)!.candidates;
    const targets: { kind: 'module' | 'mount' | 'boundary'; index: number; id: string; name: string; point: Vec3; distance: number }[] = [];
    const target = (kind: 'module' | 'mount' | 'boundary', index: number, id: string, name: string, point: Vec3) => {
      const distance = length(sub(point, origin));
      if (distance < radius) targets.push({ kind, index, id, name, point, distance });
    };
    const nearest = (v: Pick<Volume, 'center' | 'size'>): Vec3 => origin.map((n, i) => clamp(n, v.center[i] - v.size[i] / 2, v.center[i] + v.size[i] / 2)) as Vec3;
    candidates.modules.forEach(index => { const m = def.modules[index]; target('module', index, m.id, m.name, nearest(m)); });
    def.mounts.forEach((m, index) => {
      // Center ray includes the complete gunhouse protection, including rotated plates.
      target('mount', index, m.id, m.name, [m.position[0], m.position[1] + m.weapon.gunhouseSize[2] / 2, m.position[2]]);
    });
    candidates.connections.forEach(index => {
      const c = def.connections[index];
      target('boundary', index, actor.damage.connections[index].id, 'Watertight boundary', nearest(c.bounds!));
    });
    targets.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    for (const target of targets) {
      const distance = target.distance;
      if (rays >= 128) break;
      rays++;
      let budget = charge.fragmentPenetrationMm, blockedPressure = false;
      // Fresh visited set: armor crossed by the projectile still shields blast.
      const probe: Shell = { ...shell, visited: [] };
      const destination = localToWorld(target.point, actor.motion);
      for (const { actor: shield, candidates } of shields) {
        const protection = shield.definition, from = worldToLocal(shell.position, shield.motion), to = worldToLocal(destination, shield.motion);
        if (!segmentOverlapsBox(from, to, { center: [0, 10, 0], size: [protection.hull.beam + 30, 60, protection.hull.length + 40] })) continue;
        const direction = normalize(sub(to, from));
        for (const hit of shipContacts(probe, shell.position, destination, shield, protection, candidates)) {
          if (hit.kind === 'module') {
            if (shield === actor && target.kind === 'module' && hit.index === target.index) continue;
            budget -= 50; blockedPressure = true;
          } else {
            const armor = hit.kind === 'armor' ? contactArmor(protection,hit) : undefined;
            const thickness = armor?.thicknessMm ?? (hit.kind === 'mount' ? protection.mounts[hit.index].weapon.armorMm : protection.connections[hit.index].thicknessMm!);
            // A burst on/inside a portal's bounds has no entry normal or ray
            // length. Its direct fragments still pay normal plate resistance.
            const incidence = distance > 1e-8 && length(hit.normal) > 0 ? Math.abs(dot(direction, hit.normal)) : 1;
            const response = plateResponse(thickness, armor?.plate?.material ?? 'steel', incidence, .01);
            budget -= response.resistanceMm;
            blockedPressure ||= response.resistanceMm > 0;
          }
          if (budget <= 0) break;
        }
        if (budget <= 0) break;
      }
      if (budget <= 0) continue;
      const exposure = blockedPressure ? .35 * budget / charge.fragmentPenetrationMm : 1;
      const amount = (shell.he ? shell.he.damage : shell.damage * .75) * (1 - distance / radius) * exposure;
      let damage = 0, connectionIds: string[] | undefined;
      if (target.kind === 'module') {
        const state = actor.damage.modules[target.index]; damage = Math.min(state.hp, amount); state.hp -= damage;
        heatModule(actor, def, target.index, amount);
      } else if (target.kind === 'mount') {
        const state = actor.mounts[target.index]; damage = Math.min(state.hp, amount); state.hp -= damage;
        heatMount(actor, target.index, amount);
      } else {
        const state = actor.damage.connections[target.index], c = def.connections[target.index];
        const area = shell.caliberM ** 2 * (1 - distance / radius) * exposure;
        state.state = 'damaged'; state.damageAreaM2 = Math.min(c.areaM2, state.damageAreaM2 + area); connectionIds = [state.id];
      }
      if (!damage && !connectionIds) continue;
      burstShip ||= actor.motion.id;
      emit({ ...base, kind: 'burst', shipId: actor.motion.id, message: `${name} burst · ${target.name}`,
        impact: { shellId: shell.id, shipId: actor.motion.id, targetId: target.id, targetName: target.name, kind: target.kind,
          position: target.point, penetrationBeforeMm: charge.fragmentPenetrationMm, penetrationAfterMm: Math.max(0, budget),
          outcome: 'damaged', damage, connectionIds, fuze: 'armed', fuzeRemainingSeconds: 0 } });
    }
  }
  const actor = actors.find(a => a.motion.id === burstShip);
  emit({ ...base, kind: 'burst', shipId: burstShip, message: `${name} shell burst`, detonation: true, blastRadiusM: radius,
    impact: { shellId: shell.id, shipId: burstShip, targetId: `${name.toLowerCase()}-burst`, targetName: actor ? `${name} shell burst` : 'Burst outside ship', kind: 'burst',
      position: actor ? worldToLocal(shell.position, actor.motion) : [...shell.position], penetrationBeforeMm: shell.penetrationMm,
      penetrationAfterMm: 0, outcome: 'detonation', terminal: true, fuze: 'armed', fuzeRemainingSeconds: 0 } });
}
