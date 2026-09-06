import type { Vec3 } from '../ships/blueprint';
import type { Aircraft } from './aircraft';
import type { FleetActor } from './battle';
import { add, clamp, dot, length, normalize, scale, sub } from './geometry';
import { flyAircraft } from './aircraftFlight';

export interface AirPilot {
  think: number; hostileId?: string; aimTime: number;
  breakTime: number; breakCooldown: number; breakPoint?: Vec3;
  attackHeading?: number; attackStage?: 'ingress' | 'run' | 'egress';
  attempts: number; recoveryStage?: 'marshal' | 'final';
}
export const initialAirPilot = (): AirPilot => ({ think: 0, aimTime: 0, breakTime: 0, breakCooldown: 0, attempts: 0 });
const inFlight = (p: Aircraft) => ['outbound', 'attack', 'returning', 'landing', 'takeoff'].includes(p.phase) && p.hp > 0;

/** Reassess periodically; retain a useful target instead of switching every tick.
 * Loaded strike aircraft closing on our carrier take priority over distant fighters. */
export function fighterTarget(p: Aircraft, planes: Aircraft[], carrier: Vec3, dt: number): Aircraft | undefined {
  const pilot = p.pilot;
  pilot.think -= dt;
  const current = planes.find(other => other.id === pilot.hostileId && other.team !== p.team && inFlight(other));
  if (pilot.think > 0 && current && length(sub(current.position, p.position)) < 6500 && length(sub(current.position, carrier)) < 7500) return current;
  pilot.think = .65;
  let best: Aircraft | undefined, bestScore = Infinity;
  for (const other of planes) {
    if (other.team === p.team || !inFlight(other)) continue;
    const distance = length(sub(other.position, p.position)), homeDistance = length(sub(other.position, carrier));
    if (distance > 6500 || homeDistance > 7500) continue;
    const inbound = dot(other.velocity, sub(carrier, other.position)) > 0;
    const threat = other.payload && inbound && homeDistance < 4500 ? .5 : 1;
    const engaged = planes.filter(ally => ally !== p && ally.team === p.team && inFlight(ally) && ally.pilot.hostileId === other.id).length;
    const score = (distance + homeDistance * .15) * threat * (other === current ? .7 : 1) * (1 + engaged * .35);
    if (score < bestScore) { best = other; bestScore = score; }
  }
  if (pilot.hostileId !== best?.id) pilot.aimTime = 0;
  pilot.hostileId = best?.id;
  return best;
}

/** Bullet interception relative to the firing aircraft; used for aim AND eligibility. */
export function fighterGunAim(p: Aircraft, hostile: Aircraft) {
  const relative = sub(hostile.position, p.position), velocity = sub(hostile.velocity, p.velocity);
  const a = dot(velocity, velocity) - 720 ** 2, b = 2 * dot(relative, velocity), c = dot(relative, relative);
  const discriminant = b * b - 4 * a * c;
  const times = discriminant >= 0 ? [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)].filter(t => t > 0 && Number.isFinite(t)) : [];
  const time = times.length ? Math.min(...times) : length(relative) / 720;
  const direction = normalize(add(relative, scale(velocity, time)));
  const forward: Vec3 = [Math.sin(p.heading) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.heading) * Math.cos(p.pitch)];
  return { alignment: dot(forward, direction), direction, distance: length(relative), point: add(hostile.position, scale(hostile.velocity, time)) };
}

export function clearFighterLane(p: Aircraft, aim: Vec3, planes: Aircraft[]) {
  const ray = sub(aim, p.position), distance = length(ray), direction = normalize(ray);
  return !planes.some(other => {
    if (other === p || other.team !== p.team || !inFlight(other)) return false;
    const relative = sub(other.position, p.position), along = dot(relative, direction);
    return along > 0 && along < distance && length(sub(relative, scale(direction, along))) < 18;
  });
}

export function steerFighter(p: Aircraft, hostile: Aircraft, planes: Aircraft[], dt: number) {
  const pilot = p.pilot, delta = sub(hostile.position, p.position), distance = length(delta);
  pilot.breakCooldown = Math.max(0, pilot.breakCooldown - dt);
  const forward = normalize(p.velocity);
  const threatened = planes.some(other => other.team !== p.team && other.role === 'fighter' && inFlight(other)
    && length(sub(other.position, p.position)) < 450 && dot(forward, normalize(sub(other.position, p.position))) < -.65
    && dot(normalize(other.velocity), normalize(sub(p.position, other.position))) > .9);
  if (pilot.breakTime <= 0 && pilot.breakCooldown <= 0 && (distance < 160 || threatened)) {
    pilot.breakTime = 4; pilot.breakCooldown = 11;
    const side = p.id.charCodeAt(p.id.length - 1) % 2 ? 1 : -1;
    pilot.breakPoint = add(p.position, [Math.sin(p.heading + side * .85) * 1100, p.position[1] < 200 ? 90 : 40, -Math.cos(p.heading + side * .85) * 1100]);
  }
  if (pilot.breakTime > 0 && pilot.breakPoint) {
    pilot.breakTime -= dt; pilot.aimTime = 0;
    flyAircraft(p, pilot.breakPoint, 116, dt);
    return false;
  }
  // Lead pursuit at distance, ease off when closing behind a slower opponent.
  const aim = add(hostile.position, scale(hostile.velocity, clamp(distance / 220, .15, 2.5)));
  const tailChase = dot(forward, normalize(hostile.velocity)) > .6 && dot(forward, normalize(delta)) > .7;
  const speed = tailChase && distance < 400 ? clamp(length(hostile.velocity) + (distance - 220) * .07, 65, 115) : 115;
  flyAircraft(p, aim, speed, dt);
  return true;
}

/** Follow the tangent of a real orbit; a time-driven moving waypoint can outrun
 * the aircraft and produce loops which never settle into patrol. */
export function orbitPoint(p: Aircraft, anchor: Vec3, radius: number, side = 1): Vec3 {
  const angle = Math.atan2(p.position[0] - anchor[0], p.position[2] - anchor[2]) + side * .65;
  return add(anchor, [Math.sin(angle) * radius, 0, Math.cos(angle) * radius]);
}

export function strikeIngress(p: Aircraft, target: FleetActor, targetPoint: Vec3): Vec3 {
  if (p.pilot.attackHeading === undefined) {
    if (p.role === 'torpedo-bomber') {
      // Commit to the nearer beam approach; don't orbit a constantly moving intercept.
      const side = (p.position[0] - targetPoint[0]) * Math.cos(target.motion.heading) + (p.position[2] - targetPoint[2]) * Math.sin(target.motion.heading) > 0 ? -1 : 1;
      p.pilot.attackHeading = target.motion.heading + side * Math.PI / 2;
    } else p.pilot.attackHeading = Math.atan2(targetPoint[0] - p.position[0], p.position[2] - targetPoint[2]);
    p.pilot.attackStage = 'ingress';
  }
  const heading = p.pilot.attackHeading, standOff = p.role === 'torpedo-bomber' ? 2600 : 1250;
  return [targetPoint[0] - Math.sin(heading) * standOff, p.role === 'torpedo-bomber' ? 90 : 850, targetPoint[2] + Math.cos(heading) * standOff];
}
