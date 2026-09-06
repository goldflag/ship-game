import type { Ammunition, ShipDefinition, Vec3 } from '../ships/blueprint';
import type { FleetActor } from './battle';
import { FIXED_DT, motionVelocity, type HelmCommand } from './ship';
import { add, clamp, length, localToWorld, scale, sub, wrapAngle, type Pose } from './geometry';
import { availableAmmunition, muzzleCenterWorld, solveBallistic, type MountDefinition, type MountState } from './weapons';
import { travelFactor } from './ballistics';
import { torpedoIntercept, type TubeDefinition } from './torpedoes';

export const shipVelocity = (actor: FleetActor): Vec3 => motionVelocity(actor.motion);
/** Provisional bot engagement limits, in meters; small AA fittings wait for close range. */
export const botGunRange = (mount: MountDefinition): number => mount.weapon.caliberM >= .2 ? 18000 : mount.weapon.caliberM >= .1 ? 8000 : mount.weapon.caliberM >= .03 ? 3500 : 1800;
const distance = (a: FleetActor, b: FleetActor) => Math.hypot(a.motion.x - b.motion.x, a.motion.z - b.motion.z);
const shellProtection = new WeakMap<ShipDefinition, number>();
/** Simple ammunition doctrine from authored protection, never from ship names. */
export function botAmmunition(target: FleetActor, mount: MountDefinition, state: MountState): Ammunition {
  let protection = shellProtection.get(target.definition);
  if (protection === undefined) {
    protection = Math.max(0, ...target.definition.armor.filter(a => a.exterior || a.plate?.exterior).map(a => a.thicknessMm));
    shellProtection.set(target.definition, protection);
  }
  const preferred = mount.weapon.he && (mount.weapon.caliberM < .2 || protection < 80) ? 'he' : 'ap';
  const count = mount.weapon.barrelCount ?? 2;
  if (availableAmmunition(state, preferred) >= count) return preferred;
  return preferred === 'ap' && mount.weapon.he && availableAmmunition(state, 'he') >= count ? 'he' : 'ap';
}

interface GunOrder { fireAt: number; alongHull: number; height: number; acrossError: number; rangeError: number; }
interface TargetTrack {
  id: string; fireAt: number; observedAt: number; observeAt: number;
  pose: Pose; velocity: Vec3; quality: number; focus: number; refocusAt: number;
}
/** Serializable crew memory. Randomness advances only on decisions, never while reading aim. */
export interface BotState {
  randomState: number; time: number; reactionSeconds: number; preferredRange: number;
  side: number; courseOffset: number; cruiseThrottle: number; maneuverAt: number;
  evadeUntil: number; lastIntegrity: number; openingFireAt?: number;
  submergedUntil?: number;
  track?: TargetTrack;
  guns: Record<string, GunOrder>;
}

function random(bot: BotState): number {
  let x = bot.randomState;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return (bot.randomState = x >>> 0) / 4294967296;
}
const between = (bot: BotState, min: number, max: number) => min + random(bot) * (max - min);
function reviseGunAim(bot: BotState, gun: GunOrder): void {
  gun.alongHull = between(bot, -.045, .045);
  gun.height = between(bot, .8, 3);
  gun.acrossError = between(bot, -1, 1);
  gun.rangeError = between(bot, -1, 1);
}
export function createBotState(id: string, definition: ShipDefinition, seed: number): BotState {
  let hash = seed >>> 0;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const bot: BotState = {
    randomState: hash || 1, time: 0, reactionSeconds: 1, preferredRange: 4000,
    side: 1, courseOffset: 0, cruiseThrottle: .6, maneuverAt: 0,
    evadeUntil: 0, lastIntegrity: 0, guns: {},
  };
  bot.reactionSeconds = between(bot, .9, 1.8);
  const caliber = Math.max(0, ...definition.mounts.map(m => m.weapon.caliberM));
  bot.preferredRange = caliber >= .3 ? between(bot, 4200, 5800) : between(bot, 3200, 4600);
  bot.side = random(bot) < .5 ? -1 : 1;
  for (const mount of definition.mounts) {
    const gun = { fireAt: 0, alongHull: 0, height: 1, acrossError: 0, rangeError: 0 };
    reviseGunAim(bot, gun);
    bot.guns[mount.id] = gun;
  }
  return bot;
}

const observedPose = (actor: FleetActor): Pose => {
  const { x, y, z, heading, roll, pitch } = actor.motion;
  return { x, y, z, heading, roll, pitch };
};

/** Observe intermittently, settle a firing solution, and hold deliberate courses between decisions. */
export function updateBot(actor: FleetActor, target: FleetActor | undefined, time: number): void {
  const bot = actor.bot!;
  bot.time = time;
  if (!target || actor.damage.sunk) { delete bot.track; return; }
  if (bot.track?.id !== target.motion.id) {
    const firstTarget = bot.openingFireAt === undefined;
    bot.openingFireAt ??= time + between(bot, 8, 14);
    // A lost contact must not let a shorter reacquisition bypass the opening grace period.
    const fireAt = firstTarget ? bot.openingFireAt : Math.max(bot.openingFireAt, time + between(bot, 3, 6));
    bot.track = {
      id: target.motion.id, fireAt, observedAt: time, observeAt: time + bot.reactionSeconds,
      pose: observedPose(target), velocity: shipVelocity(target), quality: 0,
      focus: Math.floor(random(bot) * 3), refocusAt: time + between(bot, 18, 30),
    };
    for (const gun of Object.values(bot.guns)) {
      gun.fireAt = fireAt + between(bot, 0, 2);
      reviseGunAim(bot, gun);
    }
  }
  const track = bot.track;
  track.quality = Math.min(1, track.quality + FIXED_DT / 45);
  if (time >= track.observeAt) {
    const velocity = shipVelocity(target);
    // A speed/course change spoils the solution; the crew takes several observations to catch up.
    const change = Math.hypot(...sub(velocity, track.velocity));
    track.quality = Math.max(0, track.quality - Math.min(.35, change * .035));
    track.velocity = add(scale(track.velocity, .45), scale(velocity, .55));
    track.pose = observedPose(target);
    track.observedAt = time;
    track.observeAt = time + bot.reactionSeconds;
    if (bot.lastIntegrity - actor.damage.integrity > 15) {
      bot.evadeUntil = time + between(bot, 8, 14);
      bot.maneuverAt = time;
    }
    bot.lastIntegrity = actor.damage.integrity;
  }
  if (time >= track.refocusAt) {
    track.focus = (track.focus + 1 + Math.floor(random(bot) * 2)) % 3;
    track.refocusAt = time + between(bot, 18, 30);
  }
  if (time >= bot.maneuverAt) {
    bot.courseOffset = between(bot, -.22, .22);
    bot.cruiseThrottle = between(bot, .5, .8);
    // Occasional changes of broadside are held long enough for a heavy hull to answer the helm.
    if (time > 0 && random(bot) < .18) bot.side *= -1;
    bot.maneuverAt = time + between(bot, 22, 38);
  }
}

/** Without a gun mount, only the shared target-acquisition delay applies (fixed tubes). */
export function botReadyToFire(actor: FleetActor, mount?: MountDefinition): boolean {
  const bot = actor.bot;
  return !!bot?.track && bot.time >= bot.track.fireAt && (!mount || bot.time >= bot.guns[mount.id].fireAt);
}

/** Torpedo crews lead the same delayed target observations used by gun crews. */
export function botTorpedoAim(actor: FleetActor, tube: TubeDefinition): Vec3 | null {
  const bot = actor.bot, track = bot?.track;
  if (!bot || !track) return null;
  const point = add([track.pose.x, 0, track.pose.z], scale(track.velocity, bot.time - track.observedAt));
  return torpedoIntercept(localToWorld(tube.position, actor.motion), point, track.velocity, tube.weapon.speed);
}

/** Crew cadence is additional to the shared physical reload and alignment checks. */
export function botDidFire(actor: FleetActor, mount: MountDefinition): void {
  const bot = actor.bot!, gun = bot.guns[mount.id];
  gun.fireAt = bot.time + mount.weapon.reloadSeconds + (mount.battery === 'main' ? between(bot, .8, 3.5) : between(bot, .2, 1.4));
  reviseGunAim(bot, gun);
}

/** Stable nearest-opponent selection, with hysteresis to prevent target flicker. */
export function botTarget(actor: FleetActor, actors: readonly FleetActor[]): FleetActor | undefined {
  const enemies = actors.filter(other => other.team !== actor.team && !other.damage.sunk && !other.damage.stability.combatLost);
  const nearest = enemies.reduce<FleetActor | undefined>((best, other) => !best || distance(actor, other) < distance(actor, best) ? other : best, undefined);
  const previous = enemies.find(other => other.motion.id === actor.targetId);
  return previous && nearest && distance(actor, previous) <= distance(actor, nearest) * 1.25 ? previous : nearest;
}

/** Individual engagement distances, sustained course changes, and a turn away after taking damage. */
export function botHelm(actor: FleetActor, target: FleetActor | undefined, actors: readonly FleetActor[]): HelmCommand {
  if (!target || actor.damage.sunk) return { throttle: 0, rudder: 0 };
  const range = distance(actor, target);
  const bearing = Math.atan2(target.motion.x - actor.motion.x, actor.motion.z - target.motion.z);
  const bot = actor.bot!;
  const hurt = actor.damage.integrity / actor.damage.maxIntegrity < .35;
  const preferredRange = bot.preferredRange * (hurt ? 1.35 : 1);
  const evading = bot.time < bot.evadeUntil;
  const angle = evading ? Math.PI * .74 : range > preferredRange + 700 ? Math.PI / 3 : range < preferredRange - 900 ? Math.PI * .7 : Math.PI / 2;
  let heading = bearing + bot.side * (angle + bot.courseOffset);
  const tubes = (actor.definition.torpedoTubes ?? []).filter((t, i) => (actor.torpedoTubes?.[i].ammo ?? 0) > 0 && actor.damage.modules.find(m => m.id === t.magazineId)?.hp !== 0);
  if (tubes.length && !evading && !actor.definition.torpedoLaunchers?.length) {
    const tube = tubes.reduce((a, b) => Math.abs(wrapAngle(bearing - actor.motion.heading - b.bearingDeg * Math.PI / 180)) < Math.abs(wrapAngle(bearing - actor.motion.heading - a.bearingDeg * Math.PI / 180)) ? b : a);
    const aim = botTorpedoAim(actor, tube);
    heading = (aim ? Math.atan2(aim[0] - actor.motion.x, actor.motion.z - aim[2]) : bearing) - tube.bearingDeg * Math.PI / 180;
  }
  let x = Math.sin(heading), z = -Math.cos(heading);
  for (const other of actors) {
    if (other === actor || other.motion.y < -20) continue;
    const separation = distance(actor, other);
    const clearance = (actor.definition.hull.length + other.definition.hull.length) / 2 + 180;
    if (separation > 0 && separation < clearance) {
      const weight = (1 - separation / clearance) * 4;
      x += (actor.motion.x - other.motion.x) / separation * weight;
      z += (actor.motion.z - other.motion.z) / separation * weight;
    }
  }
  heading = Math.atan2(x, -z);
  // Surface while the tubes facing the opponent reload: deck guns can contribute
  // and opponents get an attack window. Dive again for the next torpedo approach.
  const loadedAttackTubes = tubes.some(t => Math.abs(wrapAngle(bearing - actor.motion.heading - t.bearingDeg * Math.PI / 180)) < Math.PI / 2
    && (actor.torpedoTubes?.find(state => state.id === t.id)?.reload ?? 0) <= 0);
  if (actor.submarine && loadedAttackTubes && range < 5500 && actor.submarine.targetDepthM === 0) bot.submergedUntil = bot.time + 40;
  const dive = tubes.length && range < 5500 && (loadedAttackTubes || bot.time < (bot.submergedUntil ?? 0));
  return { throttle: evading ? .85 : range > preferredRange + 700 ? .8 : bot.cruiseThrottle,
    ...(actor.definition.submarine ? { depthM: dive ? actor.definition.submarine.periscopeDepthM : 0 } : {}),
    rudder: clamp(wrapAngle(heading - actor.motion.heading) * 2 - actor.motion.yawRate * 5, -1, 1) };
}

/** Lead the last observed track. Aim errors persist between salvos and shrink as tracking settles. */
export function botAim(actor: FleetActor, target: FleetActor, mount: MountDefinition, state: MountState): Vec3 {
  const bot = actor.bot, track = bot?.track, gun = bot?.guns[mount.id] ?? { alongHull: 0, height: .8, rangeError: 0, acrossError: 0 };
  const pose = track?.pose ?? target.motion;
  const velocity = track?.velocity ?? shipVelocity(target), inherited = shipVelocity(actor);
  const alongHull = ((track?.focus ?? 1) - 1) * .23 + gun.alongHull;
  const point = add(localToWorld([0, gun.height + (mount.battery === 'secondary' ? 2 : 0), alongHull * target.definition.hull.length], pose), scale(velocity, (bot?.time ?? 0) - (track?.observedAt ?? bot?.time ?? 0)));
  point[1] = Math.max(.5, point[1]);
  const from = muzzleCenterWorld(mount, state, actor.motion);
  const dx = point[0] - from[0], dz = point[2] - from[2];
  const range = Math.max(1, Math.hypot(dx, dz));
  const error = (4 + range * .003) * (1 + 3 * (1 - (track?.quality ?? 0)));
  point[0] += (dx * gun.rangeError - dz * gun.acrossError * .6) / range * error;
  point[2] += (dz * gun.rangeError + dx * gun.acrossError * .6) / range * error;
  const cached = state.leadCache && length(sub(point, state.leadCache.point)) < 10 ? state.leadCache : undefined;
  let time = cached?.time ?? Math.hypot(point[0] - from[0], point[2] - from[2]) / mount.weapon.muzzleSpeed;
  const drag = mount.weapon.ballistics?.dragPerSecond ?? 0;
  for (let i = 0; i < (cached ? 1 : 3); i++) {
    const solution = solveBallistic(from, sub(add(point, scale(velocity, time)), scale(inherited, travelFactor(time, drag))), mount.weapon.muzzleSpeed, drag);
    if (!solution) break;
    time = solution.time;
  }
  state.leadCache = { time, point: [...point] };
  return add(point, scale(velocity, time));
}

/** Conservatively hold fire when a friendly hull occupies the firing lane. */
export function clearFiringLane(actor: FleetActor, target: FleetActor, actors: readonly FleetActor[]): boolean {
  const dx = target.motion.x - actor.motion.x, dz = target.motion.z - actor.motion.z;
  const squaredRange = dx * dx + dz * dz;
  if (squaredRange < 1) return false;
  return !actors.some(other => {
    if (other === actor || other.team !== actor.team || other.motion.y < -20) return false;
    const along = ((other.motion.x - actor.motion.x) * dx + (other.motion.z - actor.motion.z) * dz) / squaredRange;
    if (along <= 0 || along >= 1) return false;
    return Math.hypot(other.motion.x - actor.motion.x - along * dx, other.motion.z - actor.motion.z - along * dz) < other.definition.hull.length / 2 + 35;
  });
}
