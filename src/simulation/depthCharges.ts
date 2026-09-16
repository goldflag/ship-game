import type { DepthChargePart, ShipDefinition, Vec3 } from '../ships/blueprint';

export type DepthChargeDefinition = NonNullable<ShipDefinition['depthChargeLaunchers']>[number];
export interface DepthChargeLauncherState {
  id: string; ammo: number; reload: number; status: 'ready' | 'reloading' | 'empty' | 'disabled';
}
export interface DepthCharge {
  id: number; ownerId: string; launcherId: string; position: Vec3; velocity: Vec3;
  age: number; submerged: boolean; weapon: DepthChargePart;
}
export const createDepthChargeLauncherState = (l: DepthChargeDefinition): DepthChargeLauncherState => ({ id: l.id, ammo: l.ammo, reload: 0, status: l.ammo ? 'ready' : 'empty' });