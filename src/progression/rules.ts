/** A player's research record and the rules that change it. Pure; shared with the accounts API. */
import { NATION_IDS, nodePlace, prerequisite, presetPlace, type NationId, type TechNode } from './techTree';
import type { XpAward } from './xp';

export interface ProgressProfile {
  version: 1;
  /** Unspent XP per nation. */
  xp: Record<NationId, number>;
  /** Unspent XP usable in any tree. */
  freeXp: number;
  /** Nodes unlocked with XP. Starters are owned without being listed. */
  unlocked: string[];
  /** Lifetime XP earned. */
  earned: number;
  /** Every modelled ship is owned (the account-free harness and developer grants). */
  allUnlocked?: boolean;
}
export class ProgressError extends Error {
  constructor(readonly code: 'unknown-node' | 'placeholder' | 'owned' | 'prerequisite' | 'insufficient-xp' | 'invalid', message: string) { super(message); }
}

const zeroXp = (): Record<NationId, number> => Object.fromEntries(NATION_IDS.map(id => [id, 0])) as Record<NationId, number>;
export const emptyProfile = (): ProgressProfile => ({ version: 1, xp: zeroXp(), freeXp: 0, unlocked: [], earned: 0 });
/** The account-free harness: everything open, nothing to spend. */
export const openProfile = (): ProgressProfile => ({ ...emptyProfile(), allUnlocked: true });

const whole = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
/** Repairs anything read from storage: unknown nodes and nations drop, amounts become non-negative integers. */
export function sanitizeProfile(value: unknown): ProgressProfile {
  const input = value && typeof value === 'object' ? value as Partial<ProgressProfile> : {};
  const xp = zeroXp();
  for (const id of NATION_IDS) xp[id] = whole(input.xp?.[id]);
  const unlocked = Array.isArray(input.unlocked)
    ? [...new Set(input.unlocked.filter((id): id is string => typeof id === 'string' && !!nodePlace(id)?.node.presetId))]
    : [];
  return { version: 1, xp, freeXp: whole(input.freeXp), unlocked, earned: whole(input.earned), ...(input.allUnlocked === true ? { allUnlocked: true } : {}) };
}

export function ownsNode(profile: ProgressProfile, id: string) {
  const node = nodePlace(id)?.node;
  if (!node?.presetId) return false;
  return !!node.starter || !!profile.allUnlocked || profile.unlocked.includes(id);
}
/** Whether this preset may join the player's own fleet. Player designs are allowed by the caller;
 * presets outside the trees (fictional ships, merchants) are enemy-only. */
export const ownsPreset = (profile: ProgressProfile, presetId: string) => {
  const place = presetPlace(presetId);
  return !!place && ownsNode(profile, place.node.id);
};
/** How much of each pool an unlock would draw: the nation's XP first, then free XP. */
export function unlockSpend(profile: ProgressProfile, node: TechNode, nation: NationId) {
  const fromNation = Math.min(profile.xp[nation], node.cost);
  const fromFree = node.cost - fromNation;
  return { nation: fromNation, free: fromFree, affordable: fromFree <= profile.freeXp };
}
export type NodeState = 'owned' | 'available' | 'short' | 'blocked' | 'placeholder';
/** owned; available (prerequisite owned, affordable); short (prerequisite owned, not enough XP);
 * blocked (prerequisite not owned); placeholder (not in the game yet). */
export function nodeState(profile: ProgressProfile, id: string): NodeState {
  const place = nodePlace(id);
  if (!place?.node.presetId) return 'placeholder';
  if (ownsNode(profile, id)) return 'owned';
  const before = prerequisite(id);
  if (before && !ownsNode(profile, before.id)) return 'blocked';
  return unlockSpend(profile, place.node, place.nation.id).affordable ? 'available' : 'short';
}
/** Spends XP on a node. Throws a ProgressError the API returns as 409. */
export function applyUnlock(profile: ProgressProfile, id: string) {
  const place = nodePlace(id);
  if (!place) throw new ProgressError('unknown-node', 'That ship is not in the research tree.');
  if (!place.node.presetId) throw new ProgressError('placeholder', `${place.node.name} is not in the game yet.`);
  const state = nodeState(profile, id);
  if (state === 'owned') throw new ProgressError('owned', `${place.node.name} is already unlocked.`);
  if (state === 'blocked') throw new ProgressError('prerequisite', `Unlock ${prerequisite(id)!.name} first.`);
  const spend = unlockSpend(profile, place.node, place.nation.id);
  if (!spend.affordable) throw new ProgressError('insufficient-xp', `${place.node.name} needs ${place.node.cost.toLocaleString('en-US')} XP.`);
  const next: ProgressProfile = {
    ...profile,
    xp: { ...profile.xp, [place.nation.id]: profile.xp[place.nation.id] - spend.nation },
    freeXp: profile.freeXp - spend.free,
    unlocked: [...profile.unlocked, id],
  };
  return { profile: next, spent: { nation: place.nation.id, fromNation: spend.nation, fromFree: spend.free } };
}
/** Adds a battle's award. */
export function applyAward(profile: ProgressProfile, award: XpAward): ProgressProfile {
  const xp = { ...profile.xp };
  for (const id of NATION_IDS) xp[id] += whole(award.nations[id]);
  return { ...profile, xp, freeXp: profile.freeXp + whole(award.free), earned: profile.earned + whole(award.total) };
}
/** Harness grant: XP to every nation and the free pool, or everything unlocked. */
export function applyGrant(profile: ProgressProfile, grant: { xp?: number; unlockAll?: boolean }): ProgressProfile {
  const amount = whole(grant.xp);
  const xp = { ...profile.xp };
  for (const id of NATION_IDS) xp[id] += amount;
  return { ...profile, xp, freeXp: profile.freeXp + amount, ...(grant.unlockAll ? { allUnlocked: true } : {}) };
}

/** What an administrator can do to a player's research. Gifts spend no XP; XP amounts may be negative to
 * correct a balance, which never drops below zero. */
export type AdminProgressAction =
  | { action: 'grant-xp'; amount: number; pool: NationId | 'free' | 'all' }
  | { action: 'unlock'; nodeId: string }
  | { action: 'lock'; nodeId: string }
  | { action: 'unlock-all'; value: boolean }
  | { action: 'reset' };
export const MAX_ADMIN_XP = 1_000_000;
/** Checks an admin request's shape. Throws ProgressError('invalid'). */
export function validateAdminAction(value: unknown): AdminProgressAction {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const invalid = (reason: string): never => { throw new ProgressError('invalid', `Invalid admin action: ${reason}.`); };
  switch (input.action) {
    case 'grant-xp': {
      const amount = input.amount, pool = input.pool;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || Math.abs(amount) > MAX_ADMIN_XP) invalid('amount');
      if (pool !== 'free' && pool !== 'all' && !NATION_IDS.includes(pool as NationId)) invalid('pool');
      return { action: 'grant-xp', amount: amount as number, pool: pool as NationId | 'free' | 'all' };
    }
    case 'unlock': case 'lock':
      if (typeof input.nodeId !== 'string' || !nodePlace(input.nodeId)?.node.presetId) invalid('ship');
      return { action: input.action, nodeId: input.nodeId as string };
    case 'unlock-all':
      if (typeof input.value !== 'boolean') invalid('value');
      return { action: 'unlock-all', value: input.value as boolean };
    case 'reset': return { action: 'reset' };
    default: return invalid('action');
  }
}
export function applyAdminAction(profile: ProgressProfile, action: AdminProgressAction): ProgressProfile {
  const add = (value: number, amount: number) => Math.max(0, value + amount);
  switch (action.action) {
    case 'grant-xp': {
      const xp = { ...profile.xp };
      for (const id of NATION_IDS) if (action.pool === id || action.pool === 'all') xp[id] = add(xp[id], action.amount);
      const freeXp = action.pool === 'free' || action.pool === 'all' ? add(profile.freeXp, action.amount) : profile.freeXp;
      return { ...profile, xp, freeXp };
    }
    case 'unlock':
      return profile.unlocked.includes(action.nodeId) || nodePlace(action.nodeId)?.node.starter ? profile : { ...profile, unlocked: [...profile.unlocked, action.nodeId] };
    case 'lock':
      if (nodePlace(action.nodeId)?.node.starter) throw new ProgressError('invalid', 'Starters cannot be locked.');
      return { ...profile, unlocked: profile.unlocked.filter(id => id !== action.nodeId) };
    case 'unlock-all': {
      const { allUnlocked: _, ...rest } = profile;
      return action.value ? { ...rest, allUnlocked: true } : rest;
    }
    case 'reset': return emptyProfile();
  }
}
