import type { FleetOrderState } from '../multiplayer/generated/FleetOrderState';
import type { Formation } from '../multiplayer/generated/Formation';

export interface FormationShip { id: string; name: string }
export interface FormationGroup { name: string; shipIds: string[]; formation?: Formation }
/** A group on the chart: who sails with whom, under which guide, in what shape. */
export interface FleetFormation { index: number; name: string; leaderId: string; shipIds: string[]; formation: Formation }

const defaultGroupName = /^group \d+$/i;

/** The formation is the group: a leader plus every ship escorting it, directly
 * or through another escort. Setup groups seed the numbering, any custom
 * name and the cruising formation, so the opening order of battle and later
 * escort orders agree. */
export function fleetFormations(ships: readonly FormationShip[], orders: Record<string, FleetOrderState | undefined> = {}, groups: ReadonlyMap<number, FormationGroup> = new Map()): FleetFormation[] {
  const ids = new Set(ships.map(s => s.id));
  const order = new Map(ships.map((s, i) => [s.id, i]));
  const leaderOf = (id: string): string => {
    const path: string[] = [];
    let current = id;
    for (;;) {
      const movement = orders[current]?.movement;
      if (movement?.type !== 'escort' || !ids.has(movement.leaderId) || movement.leaderId === current) return current;
      const loop = path.indexOf(current);
      // Mutual escorts have no leader; the earliest listed ship stands in.
      if (loop >= 0) return path.slice(loop).reduce((a, b) => order.get(b)! < order.get(a)! ? b : a);
      path.push(current);
      current = movement.leaderId;
    }
  };
  const members = new Map<string, string[]>();
  for (const ship of ships) {
    const leader = leaderOf(ship.id);
    if (!members.has(leader)) members.set(leader, [leader]);
    if (leader !== ship.id) members.get(leader)!.push(ship.id);
  }
  const slots = [...groups].sort((a, b) => a[0] - b[0]);
  const used = new Set<number>();
  const numbered: { leaderId: string; shipIds: string[]; index?: number }[] = [...members].map(([leaderId, shipIds]) => {
    const slot = slots.find(([index, group]) => !used.has(index) && group.shipIds.includes(leaderId))?.[0];
    if (slot !== undefined) used.add(slot);
    return { leaderId, shipIds, index: slot };
  });
  let next = 1;
  const nameOf = (id: string) => ships.find(s => s.id === id)?.name ?? id;
  /** Escorts that were stationed without a group record still report how they sail. */
  const sailing = (leaderId: string, shipIds: readonly string[]): Formation | undefined => {
    for (const id of shipIds) {
      const movement = id === leaderId ? undefined : orders[id]?.movement;
      if (movement?.type === 'escort') return movement.formation;
    }
    return undefined;
  };
  return numbered.map(formation => {
    if (formation.index === undefined) { while (used.has(next)) next++; formation.index = next; used.add(next); }
    const group = groups.get(formation.index);
    const custom = group?.name;
    const name = custom && !defaultGroupName.test(custom.trim()) ? custom : formation.shipIds.length > 1 ? `${nameOf(formation.leaderId)} formation` : nameOf(formation.leaderId);
    return { index: formation.index, name, leaderId: formation.leaderId, shipIds: formation.shipIds, formation: group?.formation ?? sailing(formation.leaderId, formation.shipIds) ?? 'column' };
  }).sort((a, b) => a.index - b.index);
}
