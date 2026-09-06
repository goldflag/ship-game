import type { AircraftRole, ShipDefinition, TorpedoPart, Vec3 } from '../ships/blueprint';
import type { FleetActor, Team } from './battle';
import type { CombatEvent } from './combat';
import type { Shell } from './damage';
import { add, clamp, dot, length, localToWorld, normalize, scale, sub, wrapAngle } from './geometry';
import { equipmentCondition } from './machinery';
import { motionVelocity } from './ship';
import { clearTorpedoLane, torpedoIntercept, type Torpedo } from './torpedoes';

export type FlightPhase = 'ready' | 'queued' | 'takeoff' | 'outbound' | 'attack' | 'returning' | 'landing' | 'rearming' | 'lost';
export interface Aircraft {
  id: string; ownerId: string; team: Team; squadronId: string; modelId: string; role: AircraftRole;
  phase: FlightPhase; position: Vec3; previousPosition: Vec3; velocity: Vec3;
  heading: number; pitch: number; bank: number; hp: number; ammo: number; payload: boolean;
  timer: number; flightTime: number; cooldown: number; targetId?: string; kills: number;
}
export interface AirWingState { planes: Aircraft[]; launchCooldown: number; }
export interface AirRelease { id: number; ownerId: string; position: Vec3; velocity: Vec3; }
export const MAX_AIRBORNE = 144;
const deckClearance = (p: Aircraft) => p.role === 'fighter' ? 1.755 : p.role === 'dive-bomber' ? 1.941 : 2.24445;
export const airborne = (p: Aircraft) => ['takeoff', 'outbound', 'attack', 'returning', 'landing'].includes(p.phase);
export function createAirWing(def: ShipDefinition, ownerId: string, team: Team): AirWingState | undefined {
  if (!def.airWing) return;
  return { launchCooldown: 0, planes: def.airWing.squadrons.flatMap(s => Array.from({ length: s.count }, (_, i) => ({
    id: `${ownerId}/${s.id}/${i + 1}`, ownerId, team, squadronId: s.id, modelId: s.modelId, role: s.role,
    phase: 'ready' as const, position: [0, 0, 0] as Vec3, previousPosition: [0, 0, 0] as Vec3, velocity: [0, 0, 0] as Vec3,
    heading: 0, pitch: 0, bank: 0, hp: 100, ammo: s.role === 'fighter' ? 16 : 0, payload: s.role !== 'fighter', timer: 0, flightTime: 0, cooldown: 0, kills: 0,
  }))) };
}
export function airServiceAvailable(actor: FleetActor): boolean {
  const wing = actor.definition.airWing;
  const module = wing && actor.definition.modules.find(m => m.id === wing.serviceModuleId);
  return !!module && !actor.damage.sunk && !actor.damage.stability.combatLost && Math.abs(actor.motion.roll) < .22 && Math.abs(actor.motion.pitch) < .15 && actor.motion.y > -3 && equipmentCondition(actor, actor.definition, module).availability > 0;
}
export function launchSquadron(actor: FleetActor, squadronId: string, target?: FleetActor): number {
  if (!airServiceAvailable(actor)) return 0;
  const planes = actor.airWing?.planes.filter(p => p.squadronId === squadronId && p.phase === 'ready').slice(0, 3) ?? [];
  if (planes.some(p => p.role !== 'fighter') && (!target || target.team === actor.team || target.damage.sunk || target.damage.stability.combatLost || target.motion.y < -8)) return 0;
  for (const plane of planes) { plane.phase = 'queued'; plane.targetId = target?.motion.id; }
  return planes.length;
}
export function recallAircraft(actor: FleetActor): void {
  for (const p of actor.airWing?.planes ?? []) {
    if (p.phase === 'queued') p.phase = 'ready';
    else if (airborne(p) && p.phase !== 'landing') p.phase = 'returning';
  }
}
export const AIR_TORPEDO: TorpedoPart = {
  id: 'mark-13-game', name: 'Air-dropped torpedo', kind: 'torpedo', diameterM: .57, lengthM: 4.1,
  speed: 23, rangeM: 4500, armingDistanceM: 180, runningDepthM: 2, reloadSeconds: 35,
  launchIntervalSeconds: 3, damage: 480, breachAreaM2: .55,
};
export interface AirContext {
  actors: FleetActor[]; planes: Aircraft[]; shells: Shell[]; torpedoes: Torpedo[]; releases: AirRelease[];
  nextId: () => number; emit: (e: Omit<CombatEvent, 'sequence' | 'tick'>) => void;
}
function fly(p: Aircraft, point: Vec3, speed: number, dt: number) {
  const desired = Math.atan2(point[0] - p.position[0], p.position[2] - point[2]);
  const turn = clamp(wrapAngle(desired - p.heading), -dt * (p.role === 'fighter' ? .75 : .38), dt * (p.role === 'fighter' ? .75 : .38));
  p.heading = wrapAngle(p.heading + turn); p.bank = clamp(-turn / dt * .8, -.8, .8);
  const vertical = clamp((point[1] - p.position[1]) * .5, -32, 22);
  p.velocity = [Math.sin(p.heading) * speed, vertical, -Math.cos(p.heading) * speed];
  p.pitch = Math.atan2(vertical, speed); p.position = add(p.position, scale(p.velocity, dt));
}
function lose(p: Aircraft, ctx: AirContext) {
  p.hp = 0; p.phase = 'lost';
  ctx.emit({ kind: 'aircraft-lost', position: [...p.position], shipId: p.ownerId, message: `${p.modelId} shot down`, aircraft: { id: p.id } });
}
export function stepAircraft(ctx: AirContext, dt: number, time: number) {
  let flying = ctx.planes.filter(airborne).length;
  for (const actor of ctx.actors) {
    const state = actor.airWing, wing = actor.definition.airWing;
    if (!state || !wing) continue;
    state.launchCooldown = Math.max(0, state.launchCooldown - dt);
    if (actor.controller === 'bot' && time >= 5) {
      const validTarget = (a: FleetActor) => a.team !== actor.team && !a.damage.sunk && !a.damage.stability.combatLost && a.motion.y > -8;
      const target = ctx.actors.find(a => a.motion.id === actor.targetId && validTarget(a)) ?? ctx.actors.find(validTarget);
      for (const squadron of wing.squadrons) if (!state.planes.some(p => p.squadronId === squadron.id && (airborne(p) || p.phase === 'queued'))) launchSquadron(actor, squadron.id, target);
    }
    for (const [i, p] of state.planes.entries()) {
      p.previousPosition = [...p.position]; p.cooldown = Math.max(0, p.cooldown - dt);
      if (p.phase === 'lost') continue;
      if (actor.damage.sunk && !airborne(p)) { p.hp = 0; p.phase = 'lost'; continue; }
      if (p.phase === 'ready' || p.phase === 'queued' || p.phase === 'rearming') {
        // Stowed aircraft have no collision actor; only queued aircraft occupy the launch datum.
        p.position = localToWorld(add(wing.launchPosition, [0, deckClearance(p), 0]), actor.motion); p.previousPosition = [...p.position]; p.heading = actor.motion.heading;
        if (p.phase === 'rearming' && airServiceAvailable(actor)) {
          p.timer -= dt;
          if (p.timer <= 0) { p.phase = 'ready'; p.ammo = p.role === 'fighter' ? 16 : 0; p.payload = p.role !== 'fighter'; p.hp = 100; }
        }
        if (p.phase === 'queued' && state.launchCooldown <= 0 && flying < MAX_AIRBORNE && airServiceAvailable(actor)) {
          flying++; p.phase = 'takeoff'; p.timer = 0; p.flightTime = 0; state.launchCooldown = wing.launchIntervalSeconds;
          ctx.emit({ kind: 'aircraft-launch', position: [...p.position], shipId: p.ownerId, message: `${p.modelId} launched`, aircraft: { id: p.id } });
        } else continue;
      }
      p.flightTime += dt; p.timer += dt;
      if (p.flightTime > 650) { lose(p, ctx); continue; }
      if ((p.flightTime > 470 || p.hp < 25) && p.phase !== 'landing') p.phase = 'returning';
      const carrier = localToWorld(add(wing.recoveryPosition, [0, deckClearance(p), 0]), actor.motion);
      // Approximate AA envelope from surviving, supplied light gun mounts. No render/GPU input.
      for (const enemy of ctx.actors) {
        if (enemy.team === p.team || enemy.damage.sunk || enemy.damage.stability.combatLost || enemy.motion.y < -1) continue;
        const distance = length(sub(p.position, [enemy.motion.x, enemy.motion.y, enemy.motion.z]));
        if (distance > 1100) continue;
        const guns = enemy.definition.mounts.filter((m, index) => m.weapon.caliberM <= .04 && enemy.mounts[index].hp > 0 && enemy.mounts[index].ammo > 0 && (!m.magazineId || equipmentCondition(enemy, enemy.definition, enemy.definition.modules.find(v => v.id === m.magazineId)!).availability > 0)).length;
        p.hp -= Math.min(4, guns * .24) * (1 - distance / 1300) * dt;
      }
      if (p.hp <= 0) { lose(p, ctx); continue; }
      if (p.phase === 'takeoff') {
        const point = localToWorld([wing.launchPosition[0], wing.launchPosition[1] + deckClearance(p) + (p.timer > 2.5 ? 60 : 0), -600], actor.motion);
        fly(p, point, Math.min(80, 25 + p.timer * 12), dt);
        if (p.timer > 6) { p.phase = 'outbound'; p.timer = 0; }
        continue;
      }
      if (p.phase === 'returning' || p.phase === 'landing') {
        if (actor.damage.sunk) { fly(p, [carrier[0], 180, carrier[2]], 80, dt); continue; }
        const approach = localToWorld([wing.recoveryPosition[0], wing.recoveryPosition[1] + 45, wing.recoveryPosition[2] + 450], actor.motion);
        if (p.phase === 'returning' && length(sub(p.position, approach)) < 90) p.phase = 'landing';
        if (p.phase === 'landing' && length(sub(p.position, carrier)) < 30 && airServiceAvailable(actor)) {
          p.phase = 'rearming'; p.timer = wing.rearmSeconds;
          ctx.emit({ kind: 'aircraft-recovered', position: carrier, shipId: p.ownerId, message: `${p.modelId} recovered · rearming`, aircraft: { id: p.id } });
          continue;
        }
        if (p.phase === 'landing' && !airServiceAvailable(actor)) p.phase = 'returning';
        fly(p, p.phase === 'landing' ? carrier : approach, p.phase === 'landing' ? 40 : 85, dt);
        continue;
      }
      if (p.role === 'fighter') {
        const hostile = ctx.planes.filter(other => other.team !== p.team && airborne(other) && other.hp > 0)
          .map(other => ({ other, distance: length(sub(other.position, p.position)) })).filter(v => v.distance < 6000).sort((a, b) => a.distance - b.distance)[0];
        if (!p.ammo || p.flightTime > 160) { p.phase = 'returning'; continue; }
        if (hostile) {
          p.phase = 'attack';
          const aim = add(hostile.other.position, scale(hostile.other.velocity, Math.min(2, hostile.distance / 300)));
          fly(p, aim, 110, dt);
          if (hostile.distance < 650 && dot(normalize(p.velocity), normalize(sub(hostile.other.position, p.position))) > .55 && p.cooldown <= 0) {
            p.ammo--; p.cooldown = .65; hostile.other.hp -= 18;
            ctx.emit({ kind: 'aircraft-fire', position: [...p.position], shipId: p.ownerId, message: 'Fighter guns', aircraft: { id: p.id, target: [...hostile.other.position] } });
            if (hostile.other.hp <= 0) { p.kills++; lose(hostile.other, ctx); }
          }
        } else {
          p.phase = 'outbound';
          const target = ctx.actors.find(a => a.motion.id === p.targetId && !a.damage.sunk);
          const anchor: Vec3 = target ? [(carrier[0] + target.motion.x) / 2, 350, (carrier[2] + target.motion.z) / 2] : [carrier[0], 350, carrier[2]];
          const angle = time * .12 + i * 2;
          fly(p, add(anchor, [Math.sin(angle) * 600, i * 12, Math.cos(angle) * 600]), 100, dt);
        }
        continue;
      }
      const target = ctx.actors.find(a => a.motion.id === p.targetId && a.team !== p.team && !a.damage.sunk && !a.damage.stability.combatLost && a.motion.y > -8);
      if (!target || !p.payload) { p.phase = 'returning'; continue; }
      const targetPoint: Vec3 = [target.motion.x, Math.max(0, target.motion.y + target.definition.hull.depth - target.definition.hull.draft), target.motion.z];
      const distance = Math.hypot(targetPoint[0] - p.position[0], targetPoint[2] - p.position[2]);
      p.phase = distance < 1800 ? 'attack' : 'outbound';
      if (p.role === 'dive-bomber') {
        const height = Math.max(0, p.position[1] - targetPoint[1]);
        const fall = (p.velocity[1] + Math.sqrt(p.velocity[1] ** 2 + 19.62 * height)) / 9.81;
        const aim = add(targetPoint, scale(motionVelocity(target.motion), fall));
        fly(p, [aim[0], distance < 1600 ? 160 : 520, aim[2]], 90, dt);
        const landing = add(p.position, scale(p.velocity, fall));
        const error = Math.hypot(landing[0] - aim[0], landing[2] - aim[2]);
        if (p.phase === 'attack' && error < 18 && p.position[1] > targetPoint[1] + 40 && ctx.shells.length < 256) {
          const id = ctx.nextId();
          ctx.shells.push({ id, ownerId: p.ownerId, position: add(p.position, [0, -1, 0]), velocity: [...p.velocity], age: 0, penetrationMm: 0, damage: 380, caliberM: .35, visited: [], ammunition: 'he', type: 'HE', he: { explosiveKg: 120, fragmentPenetrationMm: 75, damage: 380, stockFraction: 1, basis: 'Provisional 500 lb gameplay bomb; contact fuze' } });
          p.payload = false; p.phase = 'returning';
          ctx.emit({ kind: 'bomb-release', position: [...p.position], shipId: p.ownerId, message: 'Bomb away', shell: { id, caliberM: .35, velocity: [...p.velocity], ammunition: 'he', type: 'HE' }, aircraft: { id: p.id } });
        }
      } else {
        const aim = torpedoIntercept(p.position, targetPoint, motionVelocity(target.motion), AIR_TORPEDO.speed) ?? targetPoint;
        fly(p, [aim[0], distance < 2000 ? 20 : 260, aim[2]], 75, dt);
        const aligned = dot(normalize([p.velocity[0], 0, p.velocity[2]]), normalize([aim[0] - p.position[0], 0, aim[2] - p.position[2]])) > .998;
        if (distance < 900 && distance > 650 && p.position[1] < 35 && aligned && ctx.releases.length + ctx.torpedoes.length < 128 && clearTorpedoLane(actor, p.position, aim, AIR_TORPEDO.speed, ctx.actors)) {
          ctx.releases.push({ id: ctx.nextId(), ownerId: p.ownerId, position: [...p.position], velocity: [p.velocity[0], -3, p.velocity[2]] });
          p.payload = false; p.phase = 'returning';
          ctx.emit({ kind: 'aircraft-release', position: [...p.position], shipId: p.ownerId, message: 'Torpedo away', aircraft: { id: p.id } });
        }
        if (distance < 300) p.phase = 'returning'; // Abort unsafe, unaligned runs with payload retained.
      }
    }
  }
  for (let i = ctx.releases.length - 1; i >= 0; i--) {
    const release = ctx.releases[i]; release.velocity[1] -= 9.81 * dt;
    release.position = add(release.position, scale(release.velocity, dt));
    if (release.position[1] <= 0) {
      const velocity = scale(normalize([release.velocity[0], 0, release.velocity[2]]), AIR_TORPEDO.speed);
      const position: Vec3 = [release.position[0], -AIR_TORPEDO.runningDepthM, release.position[2]];
      ctx.torpedoes.push({ id: release.id, ownerId: release.ownerId, tubeId: 'aircraft.payload', position, velocity, distance: 0, age: 0, weapon: AIR_TORPEDO });
      ctx.emit({ kind: 'torpedo-launch', position, shipId: release.ownerId, message: 'Air torpedo entered water', torpedo: { id: release.id, velocity, diameterM: AIR_TORPEDO.diameterM } });
      ctx.releases.splice(i, 1);
    }
  }
}
