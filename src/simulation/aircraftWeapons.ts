import type { HEProjectile, TorpedoPart } from '../ships/blueprint';

export const DEFAULT_AIR_TORPEDO: TorpedoPart = {
  id: 'mark-13-game', name: 'Air-dropped torpedo', kind: 'torpedo', diameterM: .57, lengthM: 4.1,
  speed: 23, rangeM: 4500, armingDistanceM: 180, runningDepthM: 2, reloadSeconds: 35,
  launchIntervalSeconds: 3, damage: 160, breachAreaM2: .55,
};
const type91: TorpedoPart = {
  ...DEFAULT_AIR_TORPEDO, id: 'type91-mod2-game', name: 'Type 91 Mod 2 aerial torpedo',
  diameterM: .45, lengthM: 5.486, speed: 42 * 1852 / 3600, rangeM: 2000,
  // Nominal dimensions, speed and range from the retained weapons references.
  // Shared contact, arming, damage and breach behavior remains game calibration.
};
interface AirBomb { label: string; caliberM: number; he: HEProjectile; }
const defaultBomb: AirBomb = { label: '500 lb HE bomb', caliberM: .35,
  he: { explosiveKg: 120, fragmentPenetrationMm: 75, damage: 380, stockFraction: 1, basis: 'Provisional 500 lb gameplay bomb; contact fuze' } };
const type99: AirBomb = { label: 'Type 99 No. 25 250 kg bomb', caliberM: .30,
  he: { explosiveKg: 60, fragmentPenetrationMm: 50, damage: 330, stockFraction: 1,
    basis: 'Type 99 No. 25 nominal 250 kg bomb and 60 kg filling. Shared contact fuze and damage are game approximations; see Shokaku sources s07.' } };
const torpedoes: Readonly<Record<string, TorpedoPart>> = { 'b5n2-kate': type91 };
const bombs: Readonly<Record<string, AirBomb>> = { 'd3a1-val': type99 };
export const aircraftTorpedo = (modelId: string) => torpedoes[modelId] ?? DEFAULT_AIR_TORPEDO;
export const aircraftBomb = (modelId: string) => bombs[modelId] ?? defaultBomb;
