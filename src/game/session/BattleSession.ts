import type { DeckAction } from '../../multiplayer/generated/DeckAction';
import type { DeckPolicy } from '../../multiplayer/generated/DeckPolicy';
export type DeckServiceAction = Exclude<DeckAction, 'launch'>;
import type { CombatSimulation } from '../../simulation/combat';
import type { Vec3 } from '../../ships/blueprint';
import type { WeaponsPolicy } from '../../multiplayer/generated/WeaponsPolicy';
import type { FleetOrderState } from '../../multiplayer/generated/FleetOrderState';
import type { FleetNotice } from '../../multiplayer/generated/FleetNotice';
import type { OrderReceipt } from './commandQueue';
import type { Formation } from '../../multiplayer/generated/Formation';
import type { FleetActor } from '../../simulation/battle';
import type { ContactTrack } from '../../multiplayer/generated/ContactTrack';
import type { MissionRules } from '../../multiplayer/generated/MissionRules';
import type { ReconCoverage } from '../../multiplayer/generated/ReconCoverage';
/** Health is a sampled 0–1 fraction; absent on older snapshots. */
export interface ObservedPose { health?: number; id: string; position: Vec3; heading: number; pitch?: number; roll?: number; velocity: Vec3; observedTick: number; observers: string[] }
export interface ObservedShip extends ObservedPose { presetId: string }
/** A slung torpedo or bomb is visible from outside, so the observation carries it; rounds are not. Absent on older snapshots. */
export interface ObservedAircraft extends ObservedPose { modelId: string; controls: import('../../simulation/aircraftFlight').FlightControls; wingFold: number; payload?: boolean }
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
 readonly observedAircraft?: ObservedAircraft[];
 readonly reconCoverage?: ReconCoverage;
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
 /** Fleet news for the owner, oldest first: a lost guide's successor announces itself. `text` is rendered verbatim. */
 readonly fleetNotices?: readonly FleetNotice[];
 readonly orderReceipts?: OrderReceipt[];
 readonly queuedOrderCount?: number;
 /** Live score sheet for owned vessels: damage dealt and ships sunk. */
 readonly shipScores?: Record<string, { damageDealt: number; frags: number }>;
 /** Aircraft losses seen so far: own from the wing, enemy from observed loss events. */
 readonly aircraftLosses?: { own: number; enemy: number };
 readonly simulationSpeed?: 1 | 2 | 4;
 setSimulationSpeed?(speed: 1 | 2 | 4): void;
 releaseHelm?(): boolean;
 commandDeck?(flightId: string, action: DeckServiceAction): boolean;
 cancelDeckTask?(carrierId: string, requestId: number): boolean;
 setDeckPolicy?(carrierId: string, policy: DeckPolicy): boolean;
 prioritizeDeckTask?(carrierId: string, requestId: number): boolean;
 routeShip?(id: string, waypoints: [number, number][], speedMps: number, looped?: boolean, append?: boolean): void;
 holdShipArea?(id: string, position: [number, number], radiusM: number): void;
 /** Column slots follow the leader's track at the aft offset; screen and line-abreast slots turn together on a formation axis. `slot` orders guide succession. */
 escortShip?(id: string, leaderId: string, offset: [number, number], radiusM: number, formation?: Formation, slot?: number): void;
 setShipWeapons?(id: string, policy: WeaponsPolicy): void;
 setFormationPolicy?(id: string, policy: import('../../multiplayer/generated/FormationPolicy').FormationPolicy): void;
 moveShip?(id: string, point: Vec3): void;
 focusShip?(id: string, targetId: string): void;
 holdShip?(id: string): void;
 automateShip?(id: string): void;
 surrender?(): void;
}

export function battleExitLabel(session?: Pick<BattleSession, 'networked' | 'phase' | 'result'>): string {
  return session?.networked && session.phase === 'running' && session.result === 'active' ? 'Forfeit and return to port' : 'Return to port';
}
