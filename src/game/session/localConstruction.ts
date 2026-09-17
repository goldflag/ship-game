import type { ConstructionSource } from '../../ships/blueprint';
import type { LocalShipRevision } from '../../ships/localShips';

export interface LocalConstructionInput {
  sources: ConstructionSource[];
  expected: Record<string, string>;
  trial: boolean;
}
/** `port`: the session is the port's, never stepped (see `LocalBattleSession.port`). */
export interface LocalBattleOptions { revisions?: readonly LocalShipRevision[]; trial?: boolean; port?: boolean; }
export type TrialAction = { kind: 'flood'; actorId: string; compartmentId: string; amount: number }
  | { kind: 'damage'; actorId: string; amount: number }
  | { kind: 'module-damage'; actorId: string; moduleId: string; amount: number };
export function localConstructionInput(options: LocalBattleOptions): LocalConstructionInput | undefined {
  if (!options.revisions?.length && !options.trial) return undefined;
  return structuredClone({ sources: (options.revisions ?? []).map(r => r.source), expected: Object.fromEntries((options.revisions ?? []).map(r => [r.definition.id, r.result.contentHash])), trial: options.trial === true });
}
