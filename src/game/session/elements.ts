/** The frame's element shapes, as the session holds them.
 *
 * Every shape is declared once, in Rust, on the simulation object the battle
 * streams (`naval_sim::vessel::Vessel`, `shell::Shell`, …) and generated into
 * `src/multiplayer/generated/`; the presentation filter's drops and
 * projections are declared on the same fields (`#[ts(skip)]`, `#[ts(as)]`),
 * and `crates/naval-sim/tests/frame_types.rs` walks real frames against the
 * declarations. What this module adds is only what the client knows and the
 * battle does not: the ship definition behind a hull, the local perspective
 * (`friendly`/`enemy` instead of stable team letters) and the previous pose a
 * renderer interpolates from. */
import type { ShipDefinition } from '../../ships/blueprint';
import type { Vessel } from '../../multiplayer/generated/Vessel';
import type { AiLevel } from '../../multiplayer/generated/AiLevel';
import type { Aircraft as WireAircraft } from '../../multiplayer/generated/Aircraft';
import type { AirWingState as WireAirWingState } from '../../multiplayer/generated/AirWingState';
import type { EndurancePolicy } from '../../multiplayer/generated/EndurancePolicy';
import type { Event } from '../../multiplayer/generated/Event';
import type { MountState as WireMountState } from '../../multiplayer/generated/MountState';
import type { Vec3 } from '../../ships/blueprint';
import type { SeaState } from './sea';

export type { Vessel } from '../../multiplayer/generated/Vessel';
/** `speed`, `swaySpeed` and `yawRate` are physical: what the HUD shows and hydrodynamics use. The hull moves
 * `SHIP_PACE` (src/ships/mobility.ts) times as far through the world; `motionVelocity` in ./motion gives that. */
export type { ShipState } from '../../multiplayer/generated/ShipState';
export type { HelmCommand } from '../../multiplayer/generated/HelmCommand';
export type { MountStatus } from '../../multiplayer/generated/MountStatus';
export type { DamageState } from '../../multiplayer/generated/DamageState';
export type { StabilityState } from '../../multiplayer/generated/StabilityState';
export type { VesselStatus } from '../../multiplayer/generated/VesselStatus';
export type { ControlState } from '../../multiplayer/generated/ControlState';
export type { FireState } from '../../multiplayer/generated/FireState';
export type { CompartmentState } from '../../multiplayer/generated/CompartmentState';
export type { ConnectionState } from '../../multiplayer/generated/ConnectionState';
export type { Breach } from '../../multiplayer/generated/Breach';
export type { RegionState } from '../../multiplayer/generated/RegionState';
export type { TubeState } from '../../multiplayer/generated/TubeState';
export type { DepthChargeLauncherState } from '../../multiplayer/generated/DepthChargeLauncherState';
export type { SubmarineState } from '../../multiplayer/generated/SubmarineState';
export type { DefeatCause } from '../../multiplayer/generated/DefeatCause';
export type { Shell } from '../../multiplayer/generated/Shell';
export type { ShellType } from '../../multiplayer/generated/ShellType';
export type { Torpedo } from '../../multiplayer/generated/Torpedo';
export type { DepthCharge } from '../../multiplayer/generated/DepthCharge';
export type { AirRelease } from '../../multiplayer/generated/AirRelease';
export type { AirFlight } from '../../multiplayer/generated/AirFlight';
export type { AircraftBehavior } from '../../multiplayer/generated/AircraftBehavior';
export type { DeckStatus } from '../../multiplayer/generated/DeckStatus';
export type { FlightPhase } from '../../multiplayer/generated/FlightPhase';
export type { CarrierWing } from '../../multiplayer/generated/CarrierWing';
export type { Records } from '../../multiplayer/generated/Records';
export type { ShellHistory } from '../../multiplayer/generated/ShellHistory';
export type { DamageLogEntry } from '../../multiplayer/generated/DamageLogEntry';
export type { ImpactRecord } from '../../multiplayer/generated/ImpactRecord';
export type { SurfaceImpact } from '../../multiplayer/generated/SurfaceImpact';
export type { EventKind } from '../../multiplayer/generated/EventKind';
export type { Controller } from '../../multiplayer/generated/Controller';
export type { Ammunition } from '../../multiplayer/generated/Ammunition';

/** A mount as the session holds it. `carrier` is the yaw frame of the mount
 * carrying this one, derived on the client from the trains the frame carries
 * (`mountFrames`); hull mounts have none. */
export interface MountState extends WireMountState { carrier?: { position: Vec3; heading: number } }
/** The local perspective on a stable team letter. */
export type Team = 'friendly' | 'enemy';
/** A combat event as the battle reports it; `sequence` orders the ring buffer. */
export type CombatEvent = Event;
/** An aircraft as the session holds it: the frame element seen from the local side. */
export interface Aircraft extends Omit<WireAircraft, 'team'> { team: Team; }
/** A carrier's wing as the session holds it. `operatingRules` is the setup's
 * air rules resolved for this hull, which the battle does not restate. */
export interface AirWingState extends Omit<WireAirWingState, 'planes'> {
  planes: Aircraft[];
  operatingRules?: { endurance: EndurancePolicy; activeFlightLimit: number | null };
}
/** A hull as the session holds it: the frame element plus the definition behind
 * it, the local perspective on its team, and the launcher trains keyed the way
 * the ship view articulates them. */
export interface FleetActor extends Omit<Vessel, 'team' | 'aiLevel' | 'launcherTrains' | 'mounts'> {
  definition: ShipDefinition;
  mounts: MountState[];
  team: Team;
  /** AI diagnostics are public; tracking, targeting caches and RNG stay private. */
  bot?: { aiLevel: AiLevel };
  torpedoLaunchers: { id: string; train: number }[];
  airWing?: AirWingState;
  /** The client's deterministic long-wave sea, for readiness readouts of
   * exposed fittings; not carried by the frame. */
  sea?: { state: SeaState; time: number };
}
/** The hull state a ship view, inspection or aiming helper reads. */
export type Combatant = Pick<FleetActor, 'motion' | 'mounts' | 'damage' | 'torpedoTubes' | 'torpedoLaunchers' | 'depthChargeLaunchers' | 'submarine' | 'airWing' | 'sea'>;
