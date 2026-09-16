import { createStability, type StabilityState } from './stability';
import { createControl, type ControlState } from './damageControl';
import { HULL_HP_SCALE } from './durability';
import { createRegions, type LocalDamageEvidence, type RegionState } from './localDamage';
export { addBreach } from './breaches';
import type { Ammunition, APProjectile, FloodConnection, HEProjectile, ShipDefinition, Vec3 } from '../ships/blueprint';
import type { ShipState } from './ship';
import type { MountState } from './weapons';
import { scale } from './geometry';

/** Declared with the frame, in Rust (`naval_sim::damage`, `impact`, `shell`). */
export type { Breach, CompartmentState, ConnectionState, DefeatCause, ImpactRecord, ShellType, SurfaceImpact } from '../game/session/elements';
import type { Breach, CompartmentState, ConnectionState, DefeatCause, ImpactRecord, ShellType, SurfaceImpact, Shell as WireShell } from '../game/session/elements';
export const connectionId = (c: FloodConnection) => c.id ?? `${c.fromId}:${c.toId}`;
export interface DamageState {
  regions: RegionState[];
  control: ControlState; stability: StabilityState;
  /** Gameplay hull durability. Equipment HP and physical flooding are separate. */
  integrity: number; maxIntegrity: number; hullDamageRemainder: number; modules: { id: string; hp: number; detonated: boolean; ignition: number }[];
  compartments: CompartmentState[]; connections: ConnectionState[]; sunk: boolean; defeatCause?: DefeatCause;
}
export interface Combatant { sea?: { state: import('./sea').SeaState; time: number }; torpedoLaunchers: import('./torpedoes').TorpedoLauncherState[]; depthChargeLaunchers: import('./depthCharges').DepthChargeLauncherState[]; airWing?: import('./aircraft').AirWingState; motion: ShipState; mounts: MountState[]; damage: DamageState; torpedoTubes: import('./torpedoes').TubeState[]; submarine?: import('./submarine').SubmarineState; }
/** The engine's shell keeps the private ledger the frame drops (`#[ts(skip)]`
 * on `naval_sim::shell::Shell`); the published shape is the generated one. */
export interface Shell extends WireShell {
  penetrationMm: number; damage: number; visited: string[];
  remainingModuleDamage?: number;
  /** Per-victim hull damage already paid by this projectile. */
  hullDamage?: Record<string, number>;
  /** Precise authored-scale consumption for the shared projectile ceiling. */
  hullDamageConsumed?: Record<string, number>;
  hullRegionDamage?: Record<string, number>;
  equipmentDamage?: Record<string, number>;
  wreckageShips?: string[];
  detonateAtAge?: number;
  lastHitShipId?: string;
  /** Position is ship-local, or mount-local when attached to an articulated gunhouse. */
  lodged?: { shipId: string; position: Vec3; mountId?: string; moduleId?: string };
}
/** Serializable evidence for render-side effects; never feeds back into damage. */
export interface BallisticEffectData {
  shell?: Pick<Shell, 'id' | 'caliberM' | 'velocity' | 'ammunition' | 'type'>;
  surfaceImpact?: SurfaceImpact;
  normal?: Vec3;
  detonation?: boolean;
  blastRadiusM?: number;
  /** Exterior underwater burst: render a water column at this CPU sea height. */
  waterBurstY?: number;
}
export interface DamageEvent extends BallisticEffectData { kind: 'penetration' | 'contact' | 'ricochet' | 'stopped' | 'module' | 'sunk' | 'burst'; position: Vec3; message: string; shipId: string; impact?: ImpactRecord; defeatCause?: DefeatCause; }
/** Displacement-based gameplay durability, shared by every blueprint. */
export function maxHullIntegrity(def: ShipDefinition): number {
  // Gentle small-hull bonus (mass^0.8), anchored to Bismarck’s existing 50,750 HP.
  return Math.round((def.hull.massKg / 43_978_000) ** .8 * 1450 * HULL_HP_SCALE);
}
export function createDamage(def: ShipDefinition): DamageState {
  const rooms = new Map(def.compartments.map((room, i) => [room.id, i]));
  const integrity = maxHullIntegrity(def);
  return { hullDamageRemainder: 0, regions: createRegions(def, integrity), stability: createStability(), control: createControl(def), integrity, maxIntegrity: integrity, modules: def.modules.map(m => ({ id: m.id, hp: m.hp, detonated: false, ignition: 0 })), compartments: def.compartments.map(c => ({ id: c.id, waterM3: 0, breachAreaM2: 0, breaches: [] })), connections: def.connections.map(c => ({ id: connectionId(c), state: c.state ?? 'open', damageAreaM2: c.state === 'damaged' ? c.areaM2 : 0, fromIndex: rooms.get(c.fromId) ?? -1, toIndex: rooms.get(c.toId) ?? -1 })), sunk: false };
}
export { systemHealth } from './machinery';
