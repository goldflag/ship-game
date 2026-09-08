import rules from '../../assets/gameplay/battle-rules.v1.json';
import type { ShipDefinition } from '../ships/blueprint';
import type { Combatant } from './damage';

export const BATTLE_RULES = Object.freeze(rules);
export type MatchTeam = 'a' | 'b';
export type PhysicalLoss = 'hull-failure' | 'flooding' | 'capsize';
export interface Survivor { team: MatchTeam; displacementKg: number; physicalLoss?: PhysicalLoss | null; }
export interface BattleOutcome { winnerTeamId: MatchTeam | null; reason: 'destruction' | 'time-limit' | 'forfeit' | 'abandoned' | 'infrastructure'; finalTick: number; afloatKg: [number, number]; }
export function matchDisplacementKg(massKg: number): number {
  if (!Number.isFinite(massKg) || massKg < .5 || massKg > 1e12) throw new Error('Invalid ship displacement.');
  return Math.round(massKg);
}
/** Weapon availability and intentional submarine depth do not determine survival. */
export function physicalLoss(actor: Pick<Combatant, 'damage'>): PhysicalLoss | undefined {
  if (actor.damage.integrity <= 0) return 'hull-failure';
  if (!actor.damage.sunk) return;
  return actor.damage.defeatCause === 'capsize' ? 'capsize' : actor.damage.defeatCause === 'hull-failure' ? 'hull-failure' : 'flooding';
}
export function afloatKg(ships: readonly Survivor[]): [number, number] {
  const totals: [number, number] = [0, 0];
  for (const ship of ships) if (!ship.physicalLoss) totals[ship.team === 'a' ? 0 : 1] += ship.displacementKg;
  return totals;
}
export function evaluateOutcome(completedTick: number, ships: readonly Survivor[]): BattleOutcome | undefined {
  const totals = afloatKg(ships);
  const reason = totals.includes(0) ? 'destruction' : completedTick >= rules.tickRate * rules.durationSeconds ? 'time-limit' : undefined;
  if (!reason) return;
  return { winnerTeamId: totals[0] === totals[1] ? null : totals[0] > totals[1] ? 'a' : 'b', reason, finalTick: completedTick, afloatKg: totals };
}
export interface FleetBudget { displacementKg: number; vessels: number; carriers: number; error?: string; }
export function fleetBudget(ids: readonly string[], definitions: ReadonlyMap<string, ShipDefinition>): FleetBudget {
  let displacementKg = 0, carriers = 0;
  for (const id of ids) {
    const definition = definitions.get(id);
    if (!definition) return { displacementKg, carriers, vessels: ids.length, error: `Ship unavailable: ${id}. Choose a registered vessel.` };
    displacementKg += matchDisplacementKg(definition.hull.massKg);
    carriers += Number(!!definition.airWing);
  }
  const error = !ids.length ? 'Choose at least one vessel.' : ids.length > rules.maxVessels ? `Choose no more than ${rules.maxVessels} vessels.` : carriers > rules.maxCarriers ? `Choose no more than ${rules.maxCarriers} carriers.` : displacementKg > rules.maxFleetKg ? 'Remove ships to stay within 200,000 tonnes.' : undefined;
  return { displacementKg, vessels: ids.length, carriers, error };
}
export function mix32(value: number): number {
  let x = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}
export function selectEnvironment(seed: number, maps: readonly string[], weatherIds: readonly string[]) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid battle seed.');
  const weather = weatherIds.filter(id => id !== 'map');
  if (!maps.length || !weather.length) throw new Error('No eligible battle conditions.');
  let draw = mix32(seed ^ 0x54494d45) % rules.times.reduce((n, t) => n + t.weight, 0);
  const time = rules.times.find(t => { if (draw < t.weight) return true; draw -= t.weight; return false; })!;
  return { mapId: maps[mix32(seed ^ 0x4d415053) % maps.length], weather: weather[mix32(seed ^ 0x57454154) % weather.length], timeOfDay: time.id, seaSeed: mix32(seed ^ 0x53454153), firstPlayerTeam: (mix32(seed ^ 0x53494445) & 1 ? 'b' : 'a') as MatchTeam };
}
