/** Battle XP. The client reports a battle summary; the accounts API validates it and computes the award
 * with this same function, so the formula lives in one place. Pure; shared with the API. */
import { NATION_IDS, presetNation, type NationId } from './techTree';

/** Who the enemy was: a bot's AI level, or a human in a 1v1. Targets that neither move nor shoot earn nothing. */
export type Opposition = 'static' | 'moving' | 'easy' | 'normal' | 'hard' | 'human';
export interface SummaryShip {
  /** Preset id; null for a player design. */
  presetId: string | null;
  /** Catalog displacement. */
  massKg: number;
  /** Sunk or permanently disabled at the end. */
  lost: boolean;
  /** Remaining hull integrity at the end, 0–1. */
  integrity: number;
  /** Enemy ships only. */
  opposition?: Opposition;
}
export interface BattleSummary {
  mode: 'custom' | 'pve' | 'duel';
  result: 'victory' | 'defeat' | 'draw';
  /** Simulated seconds from start to decision. */
  durationS: number;
  /** The player's side: the commanded ship and every friendly ship. */
  friendly: SummaryShip[];
  enemy: SummaryShip[];
}
export interface XpAward {
  total: number;
  /** XP credited to nation trees, by the share of the friendly fleet each nation fielded. */
  nations: Partial<Record<NationId, number>>;
  /** XP usable in any tree: a tenth of every award plus the share earned by player designs and ships outside the trees. */
  free: number;
  breakdown: { sinking: number; damage: number; time: number; odds: number; outcome: number };
}

/** Tuning. XP per unit of ship value, i.e. 100·√(kilotonnes): Fletcher ≈ 170, Baltimore ≈ 420, Yamato ≈ 840. */
export const XP_RULES = {
  opposition: { static: 0, moving: 0, easy: .6, normal: 1, hard: 1.3, human: 1.5 } satisfies Record<Opposition, number>,
  /** Share of a ship's value for damage that did not sink it, times the hull lost. */
  damageShare: .5,
  /** XP per minute of battle against opposition of weight 1, up to the 30-minute limit. */
  perMinute: 8,
  maxMinutes: 30,
  outcome: { victory: 1.5, draw: 1.15, defeat: 1 },
  /** √(enemy strength ÷ own strength), clamped: bringing overwhelming force earns less. */
  odds: { min: .3, max: 1.5 },
  freeShare: .1,
  maxAward: 5000,
  maxShipsPerSide: 30,
  maxMassKg: 120_000_000,
  maxDurationS: 30 * 60 + 120,
} as const;

export const shipValue = (massKg: number) => 100 * Math.sqrt(Math.max(0, massKg) / 1e6);
const weight = (ship: SummaryShip) => XP_RULES.opposition[ship.opposition ?? 'normal'];

export function awardFor(summary: BattleSummary): XpAward {
  let sinking = 0, damage = 0, enemyStrength = 0, enemyValue = 0;
  for (const enemy of summary.enemy) {
    const value = shipValue(enemy.massKg), w = weight(enemy);
    enemyStrength += value * w; enemyValue += value;
    if (enemy.lost) sinking += value * w;
    else damage += value * w * XP_RULES.damageShare * (1 - Math.min(1, Math.max(0, enemy.integrity)));
  }
  const averageWeight = enemyValue > 0 ? enemyStrength / enemyValue : 0;
  const minutes = Math.min(XP_RULES.maxMinutes, Math.max(0, summary.durationS) / 60);
  const time = XP_RULES.perMinute * minutes * averageWeight;
  const ownStrength = summary.friendly.reduce((sum, ship) => sum + shipValue(ship.massKg), 0);
  const odds = Math.min(XP_RULES.odds.max, Math.max(XP_RULES.odds.min, Math.sqrt(enemyStrength / Math.max(1, ownStrength))));
  const outcome = XP_RULES.outcome[summary.result];
  const total = Math.min(XP_RULES.maxAward, Math.round((sinking + damage + time) * odds * outcome));

  const nations: Partial<Record<NationId, number>> = {};
  let free = Math.round(total * XP_RULES.freeShare);
  const shared = total - free;
  if (shared > 0) {
    const shares = new Map<NationId | 'free', number>();
    for (const ship of summary.friendly) {
      const key = (ship.presetId && presetNation(ship.presetId)) || 'free';
      shares.set(key, (shares.get(key) ?? 0) + shipValue(ship.massKg));
    }
    const sum = [...shares.values()].reduce((a, b) => a + b, 0);
    let given = 0;
    for (const id of NATION_IDS) {
      const share = shares.get(id);
      if (!share || sum <= 0) continue;
      const amount = Math.floor(shared * share / sum);
      nations[id] = amount; given += amount;
    }
    free += shared - given;
  }
  const round = (value: number) => Math.round(value);
  return { total, nations, free, breakdown: { sinking: round(sinking), damage: round(damage), time: round(time), odds: Math.round(odds * 100) / 100, outcome } };
}

const OPPOSITIONS = Object.keys(XP_RULES.opposition) as Opposition[];
/** Checks a reported summary's shape and bounds. Throws with a short reason. */
export function validateSummary(value: unknown): BattleSummary {
  const fail = (reason: string): never => { throw new Error(`Invalid battle summary: ${reason}`); };
  if (!value || typeof value !== 'object') fail('not an object');
  const input = value as Record<string, unknown>;
  if (!['custom', 'pve', 'duel'].includes(input.mode as string)) fail('mode');
  if (!['victory', 'defeat', 'draw'].includes(input.result as string)) fail('result');
  const durationS = input.durationS;
  if (typeof durationS !== 'number' || !Number.isFinite(durationS) || durationS < 0 || durationS > XP_RULES.maxDurationS) fail('duration');
  const ships = (list: unknown, side: 'friendly' | 'enemy'): SummaryShip[] => {
    if (!Array.isArray(list) || list.length > XP_RULES.maxShipsPerSide) fail(side);
    if (side === 'friendly' && !(list as unknown[]).length) fail('no friendly ships');
    return (list as unknown[]).map(entry => {
      const ship = entry as Record<string, unknown>;
      if (!ship || typeof ship !== 'object') fail(`${side} ship`);
      if (ship.presetId !== null && (typeof ship.presetId !== 'string' || ship.presetId.length > 160)) fail(`${side} presetId`);
      if (typeof ship.massKg !== 'number' || !Number.isFinite(ship.massKg) || ship.massKg < 0 || ship.massKg > XP_RULES.maxMassKg) fail(`${side} mass`);
      if (typeof ship.lost !== 'boolean') fail(`${side} lost`);
      if (typeof ship.integrity !== 'number' || !Number.isFinite(ship.integrity) || ship.integrity < 0 || ship.integrity > 1) fail(`${side} integrity`);
      if (side === 'enemy' && ship.opposition !== undefined && !OPPOSITIONS.includes(ship.opposition as Opposition)) fail('opposition');
      return {
        presetId: ship.presetId as string | null, massKg: ship.massKg as number, lost: ship.lost as boolean, integrity: ship.integrity as number,
        ...(side === 'enemy' && ship.opposition !== undefined ? { opposition: ship.opposition as Opposition } : {}),
      };
    });
  };
  return {
    mode: input.mode as BattleSummary['mode'], result: input.result as BattleSummary['result'], durationS: durationS as number,
    friendly: ships(input.friendly, 'friendly'), enemy: ships(input.enemy, 'enemy'),
  };
}
