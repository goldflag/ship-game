import type { CameraMode } from './CameraRig';
import type { ShipState } from '../simulation/ship';

export type SeaState = 'Fair' | 'Atlantic' | 'Heavy';
export type Quality = 'medium' | 'high' | 'ultra';
export interface GameSettings { quality: Quality; sea: SeaState; resolution: number; }
export const DEFAULT_SETTINGS: GameSettings = { quality: 'high', sea: 'Atlantic', resolution: 1 };
export interface Telemetry {
  ship: ShipState;
  order: number;
  camera: CameraMode;
  fps: number;
  backend: string;
  trail: { x: number; z: number }[];
}
export interface GameCallbacks {
  progress(label: string, progress: number): void;
  ready(): void;
  telemetry(data: Telemetry): void;
  pause(paused: boolean): void;
  hud(): void;
  error(message: string): void;
}
