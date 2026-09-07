import type { Island, OceanMapId } from '../maps/catalog';
import type { CameraMode } from './CameraRig';
import type { ShipState } from '../simulation/ship';
import type { CombatTelemetry } from '../simulation/combat';
import type { ShellFollow } from './ShellFollow';
import type { HullDamageCue } from './HullDamageFeedback';

export type SeaState = 'Fair' | 'Atlantic' | 'Heavy';
export type Quality = 'medium' | 'high' | 'ultra';
export interface GameSettings { quality: Quality; sea: SeaState; resolution: number; }
export const DEFAULT_SETTINGS: GameSettings = { quality: 'high', sea: 'Atlantic', resolution: 1 };
export interface Telemetry {
  mapId?: OceanMapId;
  islands?: Island[];
  ship: ShipState;
  order: number;
  rudderOrder?: number;
  camera: CameraMode;
  binoculars?: boolean;
  magnification?: number;
  pointerLocked?: boolean;
  viewBearing?: number;
  chartSize?: number;
  gunneryOpen?: boolean;
  shellFollow?: ShellFollow['phase'];
  followedAircraftId?: string;
  airOperationsOpen?: boolean;
  selectedFlightId?: string;
  fps: number;
  backend: string;
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
