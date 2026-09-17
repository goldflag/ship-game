import type { ShipDefinition, Vec3 } from '../ships/blueprint';
import type { FleetActor } from './battle';
import { motionVelocity } from '../game/session/motion';
import { clamp, length, wrapAngle, type Pose } from '../game/geometry';
import { crewSkill, DEFAULT_AI_LEVEL, isShipAiLevel, type ShipAiLevel } from '../game/session/aiLevels';

export { shipVelocity } from '../game/session/motion';
interface GunOrder { fireAt: number; alongHull: number; height: number; acrossError: number; rangeError: number; }
interface TargetTrack {
  id: string; fireAt: number; observedAt: number; observeAt: number;
  pose: Pose; velocity: Vec3; quality: number; focus: number; refocusAt: number;
  aimPoints?: Vec3[];
}
/** Serializable crew memory. Randomness advances only on decisions, never while reading aim. */
export interface BotState {
  aiLevel: ShipAiLevel;
  patrolHeading?: number;
  randomState: number; time: number; reactionSeconds: number; preferredRange: number;
  side: number; courseOffset: number; cruiseThrottle: number; maneuverAt: number;
  evadeUntil: number; lastIntegrity: number; openingFireAt?: number;
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
export function createBotState(id: string, definition: ShipDefinition, seed: number, aiLevel: ShipAiLevel = DEFAULT_AI_LEVEL): BotState {
  if (!isShipAiLevel(aiLevel)) throw new Error('Choose an available AI level for each ship.');
  let hash = seed >>> 0;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const bot: BotState = {
    aiLevel, randomState: hash || 1, time: 0, reactionSeconds: 1, preferredRange: 4000,
    side: 1, courseOffset: 0, cruiseThrottle: .6, maneuverAt: 0,
    evadeUntil: 0, lastIntegrity: 0, guns: {},
  };
  bot.reactionSeconds = between(bot, .9, 1.8) * crewSkill(aiLevel).reactionScale;
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
