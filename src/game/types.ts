import type { Island, OceanMapId } from '../maps/catalog';
import type { CameraMode } from './CameraRig';
import type { ShipState } from '../simulation/ship';
import type { CombatTelemetry } from '../simulation/combat';
import type { ShellFollow } from './ShellFollow';
import type { HullDamageCue } from './HullDamageFeedback';

import { DEFAULT_GRAPHICS, type GraphicsSettings, type PerformanceReadoutMode } from './graphicsSettings';

/** Mesh density tier read by the harbor and island builders. */
export type Quality = 'medium' | 'high' | 'ultra';
export type GameSettings = GraphicsSettings;
export const DEFAULT_SETTINGS: GameSettings = DEFAULT_GRAPHICS;
/** Renderer telemetry for the FPS counter and the settings readout. */
export interface PerformanceReadout {
  mode: PerformanceReadoutMode;
  fps: number;
  frameMs: number;
  width: number;
  height: number;
  backend: string;
  detail?: { shipInstances: number; reducedInstances: number; particles: number; aircraft: number };
}
export interface Telemetry {
  mapId?: OceanMapId;
  islands?: Island[];
  ship: ShipState;
  shipDefinition?: import('../ships/blueprint').ShipDefinition;
  order: number;
  rudderOrder?: number;
  camera: CameraMode;
  binoculars?: boolean;
  magnification?: number;
  pointerLocked?: boolean;
  viewBearing?: number;
  chartSize?: number;
  shellFollow?: ShellFollow['phase'];
  followedAircraftId?: string;
  spectatedShipId?: string;
  airOperationsOpen?: boolean;
  fleetCommandMode?: boolean;
  selectedShipIds?: string[];
  controlledShipId?: string;
  tacticalPaused?: boolean;
  simulationSpeed?: 1 | 2 | 4;
  /** Simulated seconds per wall second actually reached at that setting. */
  achievedSpeed?: number;
  selectedFlightId?: string;
  selectedFlightIds?: string[];
  airMap?: import('../ui/airChart').ChartView;
  squadronMarkers?: (import('../simulation/airTelemetry').FlightSummary & { team: import('../simulation/battle').Team; ownerId: string; screen: { x: number; y: number } | null })[];
  fps: number;
  backend: string;
  performance?: PerformanceReadout;
  trail: { x: number; z: number }[];
  combat?: CombatTelemetry;
  playerDamage?: HullDamageCue;
  inspecting?: boolean;
  aimModule?: string;
  aimMarker?: { x: number; y: number; visible: boolean };
}
export interface GameCallbacks {
  progress(label: string, progress: number): void;
  ready(): void;
  telemetry(data: Telemetry): void;
  pause(paused: boolean): void;
  hud(): void;
  error(message: string): void;
}
