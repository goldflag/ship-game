/** Which ships may sail in the player's own fleet: the commanded ship and every friendly lane, task group or 1v1 berth.
 * Enemy lanes take any ship. Player designs are always the player's; research decides the historical classes
 * (`canCommandPreset`, which keeps them open while progress is loading or unreachable); fictional presets and
 * merchant ships sail only with the enemy. */
import { canCommandPreset, type ProgressSnapshot } from '../../progression/store';
import { presetPlace } from '../../progression/techTree';
import { availableShipIds, isLocalShipId, localShips } from '../../ships/localShips';
import type { PveRequest } from '../../multiplayer/generated/PveRequest';
import { botSelection, type BattleSetup } from '../../game/session/battleSetup';

export type FleetAccess = 'open' | 'locked' | 'enemy-only';
/** A ship's standing for the own fleet. */
export type FleetRule = (id: string) => FleetAccess;
export const openFleet: FleetRule = () => 'open';

export function fleetRule(snapshot: ProgressSnapshot): FleetRule {
  return id => isLocalShipId(id) || canCommandPreset(snapshot, id) ? 'open' : presetPlace(id) ? 'locked' : 'enemy-only';
}
/** The catalog card's mark. */
export const ACCESS_LABEL: Record<Exclude<FleetAccess, 'open'>, string> = { locked: 'Unlock in the tech tree', 'enemy-only': 'Enemy only' };
/** Why a ship cannot join the own fleet, in a sentence for the status line. */
export function accessRefusal(access: FleetAccess, name: string): string {
  return access === 'locked' ? `${name} is locked. Unlock it in the tech tree to sail it in your fleet.`
    : access === 'enemy-only' ? `${name} sails only with the enemy.` : '';
}

/** A replacement for a command berth whose ship may not sail: the ship on show in port, then the player's designs,
 * then the first open preset. Undefined only when nothing at all is open. */
export function commandFallback(rule: FleetRule, preferred: readonly string[], presets: readonly string[]): string | undefined {
  const available = new Set(availableShipIds());
  return [...preferred, ...localShips().map(ship => ship.definition.id), ...presets].find(id => available.has(id) && rule(id) === 'open');
}

export interface FleetRemoval { id: string; access: FleetAccess }
/** Custom battle: the command berth takes a fallback, friendly bots that may not sail leave the lane. */
export function openCustomFleet(setup: BattleSetup, rule: FleetRule, fallback: () => string | undefined): { setup: BattleSetup; removed: FleetRemoval[] } {
  const removed: FleetRemoval[] = [];
  let next = setup;
  const command = rule(setup.playerShipId);
  if (command !== 'open') {
    const replacement = fallback();
    if (replacement) { removed.push({ id: setup.playerShipId, access: command }); next = { ...next, playerShipId: replacement }; }
  }
  const kept: number[] = [];
  setup.friendlyBots.forEach((entry, index) => {
    const access = rule(botSelection(entry).shipId);
    if (access === 'open') kept.push(index); else removed.push({ id: botSelection(entry).shipId, access });
  });
  if (kept.length !== setup.friendlyBots.length) {
    // Slot 0 of the friendly spawns is the command berth; the bots' plotted positions follow them.
    next = { ...next, friendlyBots: kept.map(index => setup.friendlyBots[index]),
      spawns: setup.spawns && { ...setup.spawns, friendly: [setup.spawns.friendly[0], ...kept.map(index => setup.spawns!.friendly[index + 1])] } };
  }
  return { setup: removed.length ? next : setup, removed };
}
/** Fleet command: ships that may not sail leave their task groups. */
export function openPveFleet(request: PveRequest, rule: FleetRule): { request: PveRequest; removed: FleetRemoval[] } {
  const removed = request.ships.filter(ship => rule(ship.presetId) !== 'open').map(ship => ({ id: ship.presetId, access: rule(ship.presetId) }));
  return { request: removed.length ? { ...request, ships: request.ships.filter(ship => rule(ship.presetId) === 'open') } : request, removed };
}
/** 1v1: ships that may not sail leave their berths; an emptied fleet takes the fallback command ship. */
export function openDuelFleet(fleet: string[], rule: FleetRule, fallback: () => string | undefined): { fleet: string[]; removed: FleetRemoval[] } {
  const removed = fleet.filter(id => rule(id) !== 'open').map(id => ({ id, access: rule(id) }));
  if (!removed.length) return { fleet, removed };
  const kept = fleet.filter(id => rule(id) === 'open'), replacement = kept.length ? undefined : fallback();
  return { fleet: replacement ? [replacement] : kept, removed };
}
/** Whether every ship the player brings may sail. The launch buttons use it as a last guard. */
export const ownFleetOpen = (ids: readonly string[], rule: FleetRule) => ids.every(id => rule(id) === 'open');
export const customOwnFleet = (setup: BattleSetup) => [setup.playerShipId, ...setup.friendlyBots.map(entry => botSelection(entry).shipId)];

/** The status line after ships left the fleet. */
export function removalNotice(removed: readonly FleetRemoval[], name: (id: string) => string, replacement?: string): string {
  if (!removed.length) return '';
  const names = (access: FleetAccess) => [...new Set(removed.filter(entry => entry.access === access).map(entry => name(entry.id)))];
  const locked = names('locked'), enemy = names('enemy-only');
  const list = (items: string[]) => items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  const parts = [
    locked.length ? `${list(locked)} ${locked.length === 1 ? 'is' : 'are'} locked (unlock in the tech tree)` : '',
    enemy.length ? `${list(enemy)} ${enemy.length === 1 ? 'sails' : 'sail'} only with the enemy` : '',
  ].filter(Boolean);
  return `${parts.join('; ')}, so ${removed.length === 1 ? 'it left' : 'they left'} your fleet.${replacement ? ` You command ${name(replacement)}.` : ''}`;
}
