import type { BattleSession, DeckServiceAction } from '../../game/session/BattleSession';
import type { OrderReceipt } from '../../game/session/commandQueue';
import type { HelmWheelState } from '../../game/types';
import type { AirOrder } from '../../multiplayer/generated/AirOrder';
import type { FleetActor } from '../../game/session/elements';
import type { ControlPriority } from '../../multiplayer/generated/ControlPriority';
import type { Ammunition, Vec3 } from '../../ships/blueprint';
import type { ContactTrack } from '../../multiplayer/generated/ContactTrack';
import type { ObservedShip } from '../../multiplayer/generated/ObservedShip';
import type { ObservedAircraft } from '../../multiplayer/generated/ObservedAircraft';
import type { ReconCoverage } from '../../multiplayer/generated/ReconCoverage';
import type { MissionRules } from '../../multiplayer/generated/MissionRules';
import type { FleetOrderState } from '../../multiplayer/generated/FleetOrderState';
import type { FleetNotice } from '../../multiplayer/generated/FleetNotice';
import type { Formation } from '../../multiplayer/generated/Formation';
import type { FormationPolicy } from '../../multiplayer/generated/FormationPolicy';
import type { WeaponsPolicy } from '../../multiplayer/generated/WeaponsPolicy';
import type { DeckPolicy } from '../../multiplayer/generated/DeckPolicy';

/** The battle as fleet command reads it: the declared frame
 * (`SessionFrame<BattleFrame>`, generated from Rust) as the session holds it,
 * with the frame's `contacts` under the session's name `observationTracks`, plus
 * the session-only ledgers that only the client keeps: order receipts, the
 * score sheet, aircraft losses and the paused order queue. Every field is data;
 * a test hands over a literal, the desk hands over the live session. */
export interface FleetFrame {
  tick: number;
  phase?: string;
  networked?: boolean;
  connectionStatus?: string;
  /** The hull this seat holds the helm of, or last held. */
  ship: { id: string; x: number; z: number };
  actors: readonly FleetActor[];
  observationTracks?: readonly ContactTrack[];
  observedShips?: readonly ObservedShip[];
  observedAircraft?: readonly ObservedAircraft[];
  reconCoverage?: ReconCoverage;
  missionRules?: MissionRules;
  fleetOrders?: Readonly<Record<string, FleetOrderState>>;
  fleetNotices?: readonly FleetNotice[];
  orderReceipts?: readonly OrderReceipt[];
  queuedOrderCount?: number;
  shipScores?: Readonly<Record<string, { damageDealt: number; frags: number }>>;
  aircraftLosses?: { own: number; enemy: number };
}

/** One task group as fleet command holds it: its ships, its name and how it sails.
 * Structurally the group `Game` keeps; declared here so the fleet UI never names `Game`. */
export interface ControlGroup { name: string; shipIds: string[]; formation?: Formation }

/** The chart's camera: where a world point lands on screen this frame, and how the
 * player moves the view. Every projection reads the live camera, so callers ask on
 * every camera frame rather than caching. `Game` satisfies this structurally. */
export interface FleetChart {
  /** Changes whenever the camera or viewport moves; equal stamps mean equal projections. */
  readonly mapProjectionStamp: number;
  onCameraFrame(listener: () => void): () => void;
  projectAirMap(x: number, z: number, altitude?: number): [number, number] | null;
  /** An own hull anchored above its rendered top, so its label clears the model. */
  projectFleetShip(id: string): [number, number] | null;
  projectContact(id: string): [number, number] | null;
  projectContactGroup(ids: string[]): [number, number] | null;
  projectAircraft(id: string): [number, number] | null;
  projectAirMapPath(points: Vec3[], closed?: boolean, filled?: boolean): string;
  projectSquadron(ownerId: string, flightId: string): { x: number; y: number } | null;
  airMapWater(x: number, y: number): [number, number] | undefined;
  panAirMap(dx: number, dy: number, x?: number, y?: number): void;
  orbitAirMap(dx: number, dy: number): void;
  zoomAirMap(delta: number, x?: number, y?: number): void;
  fitAirMap(): void;
  resetAirMapAngle(): void;
  centerAirMapOn(x: number, z: number): void;
}

/** Every intent the HUD can express, through one door. The first groups travel
 * to the session as addressed commands; the rest change what the client itself
 * owns: selection, task groups, the camera subject and the helm seat's instruments. */
export type FleetOrder =
  // Standing orders for owned hulls, validated by the session.
  | { kind: 'route'; shipId: string; point: [number, number]; speedMps: number; append: boolean }
  | { kind: 'hold-area'; shipId: string; position: [number, number]; radiusM: number }
  | { kind: 'escort'; shipId: string; leaderId: string; offset: [number, number]; radiusM: number; formation: Formation; slot: number }
  | { kind: 'focus'; shipId: string; targetId: string }
  | { kind: 'weapons'; shipId: string; policy: WeaponsPolicy }
  | { kind: 'formation-policy'; shipId: string; policy: FormationPolicy }
  | { kind: 'hold'; shipId: string }
  | { kind: 'autonomous'; shipId: string }
  | { kind: 'move'; shipId: string; point: Vec3 }
  // Air wing: flights and their decks.
  | { kind: 'squadron'; flightId: string; order: AirOrder }
  | { kind: 'deck-service'; flightId: string; action: DeckServiceAction }
  | { kind: 'deck-policy'; carrierId: string; policy: DeckPolicy }
  | { kind: 'deck-priority'; carrierId: string; requestId: number }
  | { kind: 'deck-cancel'; carrierId: string; requestId: number }
  | { kind: 'recall-all' }
  // Fleet command's own ledgers and camera subjects.
  | { kind: 'select-ships'; ids: string[] }
  | { kind: 'select-flights'; ids: string[] }
  | { kind: 'select-flight'; id: string; additive: boolean }
  | { kind: 'select-target'; id: string }
  | { kind: 'control-group'; index: number; group: ControlGroup }
  | { kind: 'fleet-command' }
  | { kind: 'follow-ship'; id: string }
  | { kind: 'take-fleet-helm'; id: string }
  | { kind: 'follow-aircraft'; id: string }
  | { kind: 'air-operations'; open: boolean }
  | { kind: 'tactical-pause' }
  | { kind: 'menu' }
  | { kind: 'simulation-speed'; speed: 1 | 2 | 4 }
  // The helm seat's instruments.
  | { kind: 'engine'; order: number }
  | { kind: 'rudder'; value: number }
  | { kind: 'weapon-group'; id: string }
  | { kind: 'ammunition'; type: Ammunition }
  | { kind: 'depth'; depthM: number; emergency?: boolean }
  | { kind: 'periscope' }
  | { kind: 'capture-pointer' }
  | { kind: 'return-to-ship' }
  | { kind: 'resize-chart'; direction: number }
  | { kind: 'chart-waypoint'; shipId: string }
  | { kind: 'waypoint'; x: number; z: number }
  | { kind: 'take-helm'; id: string }
  | { kind: 'helm-wheel'; reason: HelmWheelState['reason'] }
  | { kind: 'highlight-helm'; id?: string }
  | { kind: 'close-helm-wheel' }
  | { kind: 'spectate'; id: string }
  | { kind: 'cycle-spectator'; direction: number }
  | { kind: 'damage-control'; priority: ControlPriority; focus: string };

/** What the fleet UI holds instead of `Game`: the frame it reads, the chart it
 * projects on, the ledgers the client owns, and the one door every order goes
 * through. Reads are live getters, so a handler sees the same values a render
 * would. `issue` reports whether the order was taken up; orders the session
 * answers later are reported through `frame.orderReceipts`. */
export interface FleetDesk {
  readonly frame: FleetFrame;
  readonly chart: FleetChart;
  readonly selectedShipIds: readonly string[];
  readonly selectedFlightIds: readonly string[];
  readonly controlGroups: ReadonlyMap<number, ControlGroup>;
  readonly fleetCommandMode: boolean;
  /** The crew orders the damage-control panel shows and sets. */
  readonly damageControl: { priority: ControlPriority; focus: string };
  /** What this battle's session lets the seat do. */
  readonly can: { transferHelm: boolean; commandFleet: boolean; setSpeed: boolean };
  issue(order: FleetOrder): boolean;
}

/** The subset of `Game` the desk is built on, named structurally so only
 * `App.tsx` ever holds the class. Everything here is what a caller must know. */
export interface FleetAuthority extends FleetChart {
  readonly simulation: BattleSession;
  selectedShipIds: string[];
  readonly selectedFlightIds: string[];
  readonly controlGroups: Map<number, ControlGroup>;
  readonly fleetCommandMode: boolean;
  controlPriority: ControlPriority;
  controlFocus: string;
  fleetWaypointShipId?: string;
  readonly input: { setOrder(order: number): void; setRudder(rudder: number): void };
  selectFleetShips(ids: string[]): void;
  selectFlights(ids: string[]): void;
  selectFlight(id: string, additive?: boolean): void;
  selectTarget(id: string): void;
  enterFleetCommand(): void;
  followFleetShip(id: string): void;
  takeFleetHelm(id: string): void;
  followAircraft(id: string): void;
  setAirOperationsOpen(open: boolean): void;
  setPaused(paused: boolean): void;
  toggleTacticalPause(): void;
  commandSquadron(id: string, order: AirOrder): boolean;
  commandDeck(id: string, action: DeckServiceAction): boolean;
  setDeckPolicy(carrierId: string, policy: DeckPolicy): boolean;
  prioritizeDeckTask(carrierId: string, requestId: number): boolean;
  cancelDeckTask(carrierId: string, requestId: number): boolean;
  recallAircraft(flightId?: string): void;
  takeHelm(id: string): void;
  openHelmWheel(reason: HelmWheelState['reason']): void;
  highlightHelmCandidate(id: string | undefined): void;
  closeHelmWheel(): void;
  spectateTeammate(id: string): void;
  cycleSpectator(direction: number): void;
  selectWeaponGroup(id: string): void;
  selectAmmunition(type: Ammunition): void;
  setDepth(depthM: number, emergency?: boolean): void;
  togglePeriscope(): void;
  capturePointer(): void;
  returnToShip(): void;
  resizeChart(direction: number): void;
  fleetWaypoint(x: number, z: number): void;
}

/** The desk over a live `Game`: the session is the frame, the game is the chart,
 * and `issue` is the one switch that forwards each order to the session's
 * addressed command or the game-owned mutation it names. A session that does
 * not offer a command refuses the order. */
export function fleetDesk(game: FleetAuthority): FleetDesk {
  const session = () => game.simulation;
  const issue = (order: FleetOrder): boolean => {
    const s = session();
    switch (order.kind) {
      case 'route': if (!s.routeShip) return false; s.routeShip(order.shipId, [order.point], order.speedMps, false, order.append); return true;
      case 'hold-area': if (!s.holdShipArea) return false; s.holdShipArea(order.shipId, order.position, order.radiusM); return true;
      case 'escort': if (!s.escortShip) return false; s.escortShip(order.shipId, order.leaderId, order.offset, order.radiusM, order.formation, order.slot); return true;
      case 'focus': if (!s.focusShip) return false; s.focusShip(order.shipId, order.targetId); return true;
      case 'weapons': if (!s.setShipWeapons) return false; s.setShipWeapons(order.shipId, order.policy); return true;
      case 'formation-policy': if (!s.setFormationPolicy) return false; s.setFormationPolicy(order.shipId, order.policy); return true;
      case 'hold': if (!s.holdShip) return false; s.holdShip(order.shipId); return true;
      case 'autonomous': if (!s.automateShip) return false; s.automateShip(order.shipId); return true;
      case 'move': if (!s.moveShip) return false; s.moveShip(order.shipId, order.point); return true;
      case 'squadron': return game.commandSquadron(order.flightId, order.order);
      case 'deck-service': return game.commandDeck(order.flightId, order.action);
      case 'deck-policy': return game.setDeckPolicy(order.carrierId, order.policy);
      case 'deck-priority': return game.prioritizeDeckTask(order.carrierId, order.requestId);
      case 'deck-cancel': return game.cancelDeckTask(order.carrierId, order.requestId);
      case 'recall-all': game.recallAircraft(); return true;
      case 'select-ships': game.selectFleetShips(order.ids); return true;
      case 'select-flights': game.selectFlights(order.ids); return true;
      case 'select-flight': game.selectFlight(order.id, order.additive); return true;
      case 'select-target': game.selectTarget(order.id); return true;
      case 'control-group': game.controlGroups.set(order.index, order.group); return true;
      case 'fleet-command': game.enterFleetCommand(); return true;
      case 'follow-ship': game.followFleetShip(order.id); return true;
      case 'take-fleet-helm': game.takeFleetHelm(order.id); return true;
      case 'follow-aircraft': game.followAircraft(order.id); return true;
      case 'air-operations': game.setAirOperationsOpen(order.open); return true;
      case 'tactical-pause': game.toggleTacticalPause(); return true;
      case 'menu': game.setPaused(true); return true;
      case 'simulation-speed': if (!s.setSimulationSpeed) return false; s.setSimulationSpeed(order.speed); return true;
      case 'engine': game.input.setOrder(order.order); return true;
      case 'rudder': game.input.setRudder(order.value); return true;
      case 'weapon-group': game.selectWeaponGroup(order.id); return true;
      case 'ammunition': game.selectAmmunition(order.type); return true;
      case 'depth': game.setDepth(order.depthM, order.emergency); return true;
      case 'periscope': game.togglePeriscope(); return true;
      case 'capture-pointer': game.capturePointer(); return true;
      case 'return-to-ship': game.returnToShip(); return true;
      case 'resize-chart': game.resizeChart(order.direction); return true;
      case 'chart-waypoint': game.fleetWaypointShipId = order.shipId; return true;
      case 'waypoint': game.fleetWaypoint(order.x, order.z); return true;
      case 'take-helm': game.takeHelm(order.id); return true;
      case 'helm-wheel': game.openHelmWheel(order.reason); return true;
      case 'highlight-helm': game.highlightHelmCandidate(order.id); return true;
      case 'close-helm-wheel': game.closeHelmWheel(); return true;
      case 'spectate': game.spectateTeammate(order.id); return true;
      case 'cycle-spectator': game.cycleSpectator(order.direction); return true;
      case 'damage-control': game.controlPriority = order.priority; game.controlFocus = order.focus; return true;
    }
  };
  return {
    get frame() { return session(); },
    chart: game,
    get selectedShipIds() { return game.selectedShipIds; },
    get selectedFlightIds() { return game.selectedFlightIds; },
    get controlGroups() { return game.controlGroups; },
    get fleetCommandMode() { return game.fleetCommandMode; },
    get damageControl() { return { priority: game.controlPriority, focus: game.controlFocus }; },
    get can() { const s = session(); return { transferHelm: !!s.selectShip, commandFleet: !!s.releaseHelm, setSpeed: !!s.setSimulationSpeed }; },
    issue,
  };
}
