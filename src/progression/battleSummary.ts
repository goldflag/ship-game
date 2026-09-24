/** Builds the battle summary the XP award is computed from, out of the settled debrief and what the client
 * recorded when the battle started. Client-only (the accounts API receives the summary, not this file). */
import type { BattleDebrief, BattleResult, DebriefShip } from '../game/session/BattleSession';
import { BATTLE_RULES, type BattleOutcome } from '../game/session/battleRules';
import { botSelection, type BattleSetup } from '../game/session/battleSetup';
import { XP_RULES, type BattleSummary, type Opposition, type SummaryShip } from './xp';

export type BattleKind = BattleSummary['mode'];
/** What the client knew when a battle started: its XP claim id, the mode and, for custom battles, each enemy bot's AI level. */
export interface BattleStart {
  /** A fresh UUID per battle, and per PvE restart: the accounts API pays each id once. */
  id: string;
  mode: BattleKind;
  /** Enemy opposition by debrief ship id. Ships not listed fall back to the mode's default. */
  opposition?: Readonly<Record<string, Opposition>>;
}
/** Enemies whose level the client does not record: PvE mission fleets count as Normal, a 1v1 opponent as a human. */
const DEFAULT_OPPOSITION: Record<BattleKind, Opposition> = { custom: 'normal', pve: 'normal', duel: 'human' };

/** Custom-battle enemy bots by the ids the Rust battle gives them (`runtimeSetup`: `enemy-1`, `enemy-2`…). The AI
 * levels are the XP opposition levels: 1 Static target, 2 Moving target, 3 Easy, 4 Normal, 5 Hard. */
export const customOpposition = (setup: Pick<BattleSetup, 'enemies'>): Record<string, Opposition> =>
  Object.fromEntries(setup.enemies.map((entry, index) => [`enemy-${index + 1}`, botSelection(entry).aiLevel]));

export function startBattle(mode: BattleKind, setup?: Pick<BattleSetup, 'enemies'>, id: string = crypto.randomUUID()): BattleStart {
  return { id, mode, ...(mode === 'custom' && setup ? { opposition: customOpposition(setup) } : {}) };
}
/** A UUID that is always the same for the same text: a 1v1's id comes from its match and team, so
 * reconnecting to a finished match cannot be paid twice. Four seeded 32-bit FNV-1a lanes; not cryptographic. */
export function stableBattleId(text: string) {
  const lanes = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map(seed => {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, '0');
  }).join('');
  return `${lanes.slice(0, 8)}-${lanes.slice(8, 12)}-${lanes.slice(12, 16)}-${lanes.slice(16, 20)}-${lanes.slice(20, 32)}`;
}

/** A decided battle earns XP; one interrupted by the servers or abandoned does not. */
export const earnsXp = (result: BattleResult | undefined, outcome: Pick<BattleOutcome, 'reason'> | undefined): result is Exclude<BattleResult, 'active'> =>
  !!result && result !== 'active' && !!outcome && outcome.reason !== 'infrastructure' && outcome.reason !== 'abandoned';

const clamp = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

function summaryShip(ship: DebriefShip): SummaryShip {
  return {
    // Player designs are `local-…` definitions; the award credits them to free XP.
    presetId: ship.presetId.startsWith('local-') ? null : ship.presetId,
    massKg: clamp(ship.definition?.hull.massKg ?? 0, 0, XP_RULES.maxMassKg),
    lost: ship.status !== 'operational',
    integrity: clamp(ship.integrity, 0, 1),
  };
}

/** The summary for `awardFor`, or undefined when this battle earns nothing. Bounded to what `validateSummary` accepts:
 * a mission can outlast the custom limit, and the award stops counting at 30 minutes anyway. */
export function battleSummary(start: BattleStart, result: BattleResult | undefined, outcome: Pick<BattleOutcome, 'reason' | 'finalTick'> | undefined,
  debrief: Pick<BattleDebrief, 'ships'> | undefined): BattleSummary | undefined {
  if (!earnsXp(result, outcome) || !debrief) return undefined;
  const side = (team: DebriefShip['team']) => debrief.ships.filter(ship => ship.team === team).slice(0, XP_RULES.maxShipsPerSide);
  const friendly = side('friendly').map(summaryShip);
  if (!friendly.length) return undefined;
  const fallback = DEFAULT_OPPOSITION[start.mode];
  const enemy = side('enemy').map(ship => ({ ...summaryShip(ship),
    opposition: start.mode === 'custom' ? start.opposition?.[ship.id] ?? fallback : fallback }));
  return { mode: start.mode, result, durationS: clamp(outcome!.finalTick / BATTLE_RULES.tickRate, 0, XP_RULES.maxDurationS), friendly, enemy };
}

/** Why a battle paid nothing, when the reason is the opposition: targets that neither move nor shoot are worth no XP. */
export const passiveOpposition = (summary: BattleSummary) =>
  summary.enemy.length > 0 && summary.enemy.every(ship => XP_RULES.opposition[ship.opposition ?? 'normal'] === 0);
