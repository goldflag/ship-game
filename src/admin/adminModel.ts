/** Pure helpers for the admin page: player rows, the research ledger and the words for each change. */
import { applyAdminAction, MAX_ADMIN_XP, nodeState, type AdminProgressAction, type NodeState, type ProgressProfile } from '../progression/rules';
import { TECH_TREE, nodePlace, prerequisite, techNation, type NationId, type TechLine, type TechNation, type TechNode } from '../progression/techTree';

export const PAGE_SIZE = 25;
export const SEARCH_DEBOUNCE_MS = 300;
export type SearchField = 'email' | 'name';
export type PlayerRole = 'admin' | 'user';

export interface AdminPlayer { id: string; name: string; email: string; role: PlayerRole; createdAt?: Date }
/** A Better Auth user as the admin endpoints return it. Accounts made before the admin plugin have no role. */
export interface RawUser { id: string; name?: string | null; email: string; role?: string | null; createdAt?: Date | string | null }
export const playerRole = (role?: string | null): PlayerRole => (role?.split(',').map(part => part.trim()).includes('admin') ? 'admin' : 'user');
export function toPlayer(user: RawUser): AdminPlayer {
  const created = user.createdAt ? new Date(user.createdAt) : undefined;
  return { id: user.id, name: user.name?.trim() || '', email: user.email, role: playerRole(user.role), ...(created && !Number.isNaN(created.getTime()) ? { createdAt: created } : {}) };
}
/** The name a player goes by here: the display name, else the email. */
export const playerLabel = (player: Pick<AdminPlayer, 'name' | 'email'>) => player.name || player.email;

export const formatXp = (value: number) => value.toLocaleString('en-US');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "20 Sep 2026" in the viewer's time zone, the same in every browser's locale data. */
export const formatDate = (date?: Date) => (date ? `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}` : '—');
/** "26–50 of 1,234"; "No players" when empty. */
export function pageRange(page: number, pageSize: number, total: number) {
  if (!total) return 'No players';
  const first = page * pageSize + 1, last = Math.min(total, (page + 1) * pageSize);
  return `${formatXp(first)}–${formatXp(last)} of ${formatXp(total)}`;
}
export const pageCount = (pageSize: number, total: number) => Math.max(1, Math.ceil(total / pageSize));

export type GrantPool = NationId | 'free' | 'all';
export const GRANT_POOLS: { id: GrantPool; label: string }[] = [
  ...TECH_TREE.map(nation => ({ id: nation.id as GrantPool, label: nation.name })),
  { id: 'free', label: 'Free XP' },
  { id: 'all', label: 'Every pool' },
];
/** "5,000 Japan XP", "300 free XP". */
const poolXp = (amount: number, pool: Exclude<GrantPool, 'all'>) => `${formatXp(amount)} ${pool === 'free' ? 'free' : techNation(pool).name} XP`;

/** The Grant XP field: a whole number, negative to correct a balance, within the API's limit and not zero. */
export function parseXpAmount(text: string): { amount: number } | { error: string } {
  const value = text.trim().replace(/[,_\s]/g, '').replace(/^−/, '-');
  if (!value) return { error: 'Enter an amount.' };
  if (!/^[+-]?\d+$/.test(value)) return { error: 'Enter a whole number of XP; a negative amount takes XP away.' };
  const amount = Number(value);
  if (amount === 0) return { error: 'Enter an amount other than zero.' };
  if (Math.abs(amount) > MAX_ADMIN_XP) return { error: `Stay within ${formatXp(MAX_ADMIN_XP)} XP either way.` };
  return { amount };
}

/** What a grant would leave, before it is sent. */
export function grantPreview(profile: ProgressProfile, amount: number, pool: GrantPool) {
  const after = applyAdminAction(profile, { action: 'grant-xp', amount, pool });
  if (pool === 'all') return `${amount > 0 ? 'Adds' : 'Takes'} ${formatXp(Math.abs(amount))} XP ${amount > 0 ? 'to' : 'from'} each nation and free XP${amount < 0 ? ', none below zero' : ''}.`;
  const [before, next] = pool === 'free' ? [profile.freeXp, after.freeXp] : [profile.xp[pool], after.xp[pool]];
  return `${GRANT_POOLS.find(entry => entry.id === pool)!.label}: ${formatXp(before)} → ${formatXp(next)} XP.`;
}

/** Starter: owned from the first visit and fixed. Owned: unlocked, gifted or opened by Every ship unlocked. Locked: anything else. */
export type ShipStanding = 'starter' | 'owned' | 'locked';
export interface LedgerShip {
  node: TechNode;
  standing: ShipStanding;
  /** Listed in the profile's unlocks (bought with XP or gifted), so Remove can take her back. */
  listed: boolean;
  /** A few words under the standing. */
  detail: string;
  /** What the row's toggle does; undefined for starters. */
  action?: 'unlock' | 'lock';
}
export interface LedgerLine { line: TechLine; ships: LedgerShip[] }
export interface LedgerNation { nation: TechNation; lines: LedgerLine[] }

const LOCKED_DETAIL: Record<Exclude<NodeState, 'owned' | 'placeholder'>, (node: TechNode) => string> = {
  available: () => 'Could unlock now',
  short: () => 'Not enough XP',
  blocked: node => `Needs ${prerequisite(node.id)?.name.toUpperCase() ?? 'the ship above'}`,
};
export function ledgerShip(profile: ProgressProfile, node: TechNode): LedgerShip {
  const state = nodeState(profile, node.id), listed = profile.unlocked.includes(node.id);
  if (node.starter) return { node, standing: 'starter', listed, detail: 'Owned from the start' };
  if (state === 'owned') return { node, standing: 'owned', listed, detail: listed ? 'Unlocked or gifted' : 'Open: every ship unlocked', action: listed ? 'lock' : 'unlock' };
  return { node, standing: 'locked', listed, detail: state === 'placeholder' ? 'Not in the game' : LOCKED_DETAIL[state](node), action: 'unlock' };
}
/** Every modelled ship, by nation and line in tree order; lines with none are left out. */
export function shipLedger(profile: ProgressProfile): LedgerNation[] {
  return TECH_TREE.map(nation => ({
    nation,
    lines: nation.lines
      .map(line => ({ line, ships: line.nodes.filter(node => node.presetId).map(node => ledgerShip(profile, node)) }))
      .filter(line => line.ships.length),
  }));
}
/** Owned ships of every modelled ship, for the ledger's heading. */
export function ownedCount(ledger: LedgerNation[]) {
  const ships = ledger.flatMap(nation => nation.lines.flatMap(line => line.ships));
  return { owned: ships.filter(ship => ship.standing !== 'locked').length, total: ships.length };
}

const shipName = (nodeId: string) => nodePlace(nodeId)?.node.name.toUpperCase() ?? nodeId;
/** The status line after a change is saved. */
export function actionMessage(action: AdminProgressAction, player: string): string {
  switch (action.action) {
    case 'grant-xp':
      if (action.pool === 'all') return action.amount > 0
        ? `Granted ${formatXp(action.amount)} XP to each of ${player}’s pools.`
        : `Took ${formatXp(-action.amount)} XP from each of ${player}’s pools.`;
      return action.amount > 0 ? `Granted ${poolXp(action.amount, action.pool)} to ${player}.` : `Took ${poolXp(-action.amount, action.pool)} from ${player}.`;
    case 'unlock': return `Gave ${shipName(action.nodeId)} to ${player}.`;
    case 'lock': return `Took ${shipName(action.nodeId)} back from ${player}.`;
    case 'unlock-all': return action.value ? `Every ship is open to ${player}.` : `${player} keeps only starters and unlocked or gifted ships.`;
    case 'reset': return `${player}’s research progress is reset.`;
  }
}
