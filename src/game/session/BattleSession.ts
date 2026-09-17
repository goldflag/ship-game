import type { DeckAction } from '../../multiplayer/generated/DeckAction';
import type { DeckPolicy } from '../../multiplayer/generated/DeckPolicy';
export type DeckServiceAction = Exclude<DeckAction, 'launch'>;
import type { Ammunition, Battery, ShipDefinition, Vec3 } from '../../ships/blueprint';
import type { Island, OceanMapId } from '../../maps/catalog';
import type { WeaponsPolicy } from '../../multiplayer/generated/WeaponsPolicy';
import type { FleetOrderState } from '../../multiplayer/generated/FleetOrderState';
import type { FleetNotice } from '../../multiplayer/generated/FleetNotice';
import type { OrderReceipt } from './commandQueue';
import type { Formation } from '../../multiplayer/generated/Formation';
import type { FormationPolicy } from '../../multiplayer/generated/FormationPolicy';
import type { AirOrder } from '../../multiplayer/generated/AirOrder';
import type { ContactTrack } from '../../multiplayer/generated/ContactTrack';
import type { ObservedShip } from '../../multiplayer/generated/ObservedShip';
import type { ObservedAircraft } from '../../multiplayer/generated/ObservedAircraft';
import type { MissionRules } from '../../multiplayer/generated/MissionRules';
import type { ReconCoverage } from '../../multiplayer/generated/ReconCoverage';
import type { BattleOutcome } from './battleRules';
import type { FleetActor, Aircraft, Shell, Torpedo, DepthCharge, AirRelease, CombatEvent, ShellHistory, ShipState, HelmCommand } from './elements';
import type { CombatIntent, CombatTelemetry } from './telemetry';
/** Observed contacts are declared with the frame, in Rust (`naval_sim::snapshot`). */
export type { ObservedShip } from '../../multiplayer/generated/ObservedShip';
export type { ObservedAircraft } from '../../multiplayer/generated/ObservedAircraft';
/** What a ship and an aircraft observation share: a sampled pose and who saw it. */
export type ObservedPose = Pick<ObservedShip, keyof ObservedShip & keyof ObservedAircraft>;
/** How the battle stands from the local side. */
export type BattleResult = 'active' | 'victory' | 'defeat' | 'draw';
export interface BattleDebrief {
 seed: number;
 tick: number;
 ships: { id: string; presetId: string; team: 'friendly' | 'enemy'; status: 'operational' | 'sunk' | 'incapacitated'; damageDealt: number; frags: number; aircraftRemaining: number }[];
}
/** The renderer/intent seam: everything a scene, HUD or audio consumer may
 * read of a battle, and every intent it may address to one. The state half is
 * the generated frame (`elements.ts`) held as stable presentation objects; the
 * intent half is the addressed commands `SnapshotSession` translates for Rust.
 * Neither ShipView nor Game owns collision, weapon or damage decisions. */
export interface BattleSession {
 /** The helm ship's definition; changes when the helm moves to another hull. */
 readonly definition: ShipDefinition;
 /** The helm ship's motion, the same object as `player.motion`. */
 readonly ship: ShipState;
 readonly player: FleetActor;
 /** The hull the sight and fire report address, when fully known. */
 target?: FleetActor;
 readonly actors: FleetActor[];
 /** Every plane of every wing, for the aircraft view and air contacts. */
 readonly aircraft: Aircraft[];
 /** False for the port, where nothing is stepped or scored. */
 readonly isBattle: boolean;
 readonly mapId: OceanMapId;
 readonly islands: Island[];
 readonly seed: number;
 readonly tick: number;
 readonly result: BattleResult;
 readonly outcome?: BattleOutcome;
 /** Whether the fire report's target has been seen moving. */
 readonly targetUnderway: boolean;
 readonly shells: Shell[];
 readonly torpedoes: Torpedo[];
 readonly depthCharges: DepthCharge[];
 readonly airReleases: AirRelease[];
 /** The battle's recent events, oldest first; `sequence` orders them across frames. */
 readonly events: CombatEvent[];
 readonly shellHistory: ShellHistory[];
 /** Fraction toward the next frame, for presentation between the last two poses. */
 readonly interpolationAlpha: number;
 /** Consume the elapsed wall time: apply the pending frame (after `beforeStep`
 * captured the previous poses) and forward the helm and sight as intent. */
 advance(dt: number, helm: HelmCommand, intent: CombatIntent, beforeStep?: () => void): void;
 /** Return every hull to its initial state while keeping renderer identities. */
 reset(): void;
 selectTarget(id: string): boolean;
 /** Where the selected battery should point to hit `moduleId` on the target, with lead. */
 aimAt(moduleId?: string, battery?: Battery, weaponGroupId?: string): Vec3;
 requestFire(): void;
 orderAmmunition(battery: Battery, type: Ammunition, immediate?: boolean, weaponGroupId?: string): void;
 /** Instrument readouts for `subject` (the helm ship by default) against the sight. */
 telemetry(battery: Battery, aim: Vec3, weaponGroupId?: string, subject?: FleetActor): CombatTelemetry;
 /** Planes launched, or 0 when the squadron cannot sortie. */
 launchAircraft(squadronId: string): number;
 recallAircraft(flightId?: string): void;
 commandSquadron(id: string, order: AirOrder): boolean;
 orderFlight(flightId: string, order: AirOrder): boolean;
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
 /** Simulated seconds per wall second actually reached; absent when unmeasured. */
 readonly achievedSpeed?: number;
 setSimulationSpeed?(speed: 1 | 2 | 4): void;
 /** Camera subject, so the transport can narrow damage-control detail to it. */
 setFollowedShip?(id?: string): void;
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
 setFormationPolicy?(id: string, policy: FormationPolicy): void;
 moveShip?(id: string, point: Vec3): void;
 focusShip?(id: string, targetId: string): void;
 holdShip?(id: string): void;
 automateShip?(id: string): void;
 surrender?(): void;
}

export function battleExitLabel(session?: Pick<BattleSession, 'networked' | 'phase' | 'result'>): string {
  return session?.networked && session.phase === 'running' && session.result === 'active' ? 'Forfeit and return to port' : 'Return to port';
}
