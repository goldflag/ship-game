import type { CombatSimulation } from '../../simulation/combat';
import type { Vec3 } from '../../ships/blueprint';
import type { WeaponsPolicy } from '../../multiplayer/generated/WeaponsPolicy';
import type { FleetOrderState } from '../../multiplayer/generated/FleetOrderState';
import type { OrderReceipt } from './commandQueue';
import type { FleetActor } from '../../simulation/battle';
import type { ContactTrack } from '../../multiplayer/generated/ContactTrack';
import type { MissionRules } from '../../multiplayer/generated/MissionRules';
export interface ObservedShip { id: string; presetId: string; position: Vec3; heading: number; velocity: Vec3; observedTick: number; observers: string[] }
export interface BattleDebrief {
 seed: number;
 tick: number;
 ships: { id: string; presetId: string; team: 'friendly' | 'enemy'; status: 'operational' | 'sunk' | 'incapacitated'; damageDealt: number; frags: number; aircraftRemaining: number }[];
}
/** Renderer-facing state and addressed intent. Neither ShipView nor Game owns
 * collision, weapon or damage decisions for a snapshot-backed session. */
export interface BattleSession extends Omit<Pick<CombatSimulation, keyof CombatSimulation>, 'target'> {
 target?: FleetActor;
 readonly targetContact?: ContactTrack;
 readonly observationTracks?: ContactTrack[];
 readonly observedShips?: ObservedShip[];
 readonly missionRules?: MissionRules;
 readonly debrief?: BattleDebrief;
 readonly networked?: boolean;
 readonly phase?: string;
 readonly connectionStatus?: string;
 dispose?(): void;
 setDepth?(depthM: number, emergency?: boolean): void;
 selectShip?(id: string): boolean;
 readonly controlledShipId?: string;
 readonly fleetOrders?: Record<string, FleetOrderState>;
 readonly orderReceipts?: OrderReceipt[];
 readonly queuedOrderCount?: number;
 releaseHelm?(): boolean;
 routeShip?(id: string, waypoints: [number, number][], speedMps: number, looped?: boolean, append?: boolean): void;
 holdShipArea?(id: string, position: [number, number], radiusM: number): void;
 escortShip?(id: string, leaderId: string, offset: [number, number], radiusM: number): void;
 setShipWeapons?(id: string, policy: WeaponsPolicy): void;
 moveShip?(id: string, point: Vec3): void;
 focusShip?(id: string, targetId: string): void;
 holdShip?(id: string): void;
 automateShip?(id: string): void;
 surrender?(): void;
}

export function battleExitLabel(session?: Pick<BattleSession, 'networked' | 'phase' | 'result'>): string {
  return session?.networked && session.phase === 'running' && session.result === 'active' ? 'Forfeit and return to port' : 'Return to port';
}
