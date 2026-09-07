import { hullDepth } from './ship';
import { oceanMap, type OceanMapId } from '../maps/catalog';
import { battleEnvironment, type WeatherId } from '../maps/conditions';
import type { FleetActor } from './battle';
import { clamp, localToWorld } from './geometry';

export interface SeaState { amplitudeM: number; wavelengthM: number; direction: number; windMps: number; phase: number; }
/** Deterministic long-wave envelope. GPU detail never supplies combat samples.
 * Omitted weather keeps renderer-free fixtures in still water; the battle setup
 * explicitly passes its chosen weather, including Map default. */
export function createSeaState(mapId: OceanMapId, weather: WeatherId | undefined, seed: number, windSpeed?: number): SeaState {
  const map = oceanMap(mapId), waves = battleEnvironment(map, 'map', weather ?? 'clear', { windSpeed }).waves;
  return { amplitudeM: weather === undefined && windSpeed === undefined ? 0 : waves.amplitude * 4,
    wavelengthM: waves.peakWavelength * 4, direction: map.water.windDirection * Math.PI / 180,
    windMps: weather === undefined && windSpeed === undefined ? 0 : waves.windSpeed, phase: seed / 0xffffffff * Math.PI * 2 };
}
export function seaHeight(sea: SeaState, x: number, z: number, time: number): number {
  if (sea.amplitudeM === 0) return 0;
  const sample = (direction: number, wavelength: number, phase: number) => {
    const k = 2 * Math.PI / wavelength;
    return Math.sin(k * (x * Math.cos(direction) + z * Math.sin(direction)) - Math.sqrt(9.81 * k) * time + phase);
  };
  return sea.amplitudeM * (.7 * sample(sea.direction, sea.wavelengthM, sea.phase) + .3 * sample(sea.direction + .8, sea.wavelengthM * .57, sea.phase + 2));
}
export function seaResponse(actor: FleetActor, sea: SeaState, time: number) {
  const h = actor.definition.hull, p = actor.motion;
  const depth = actor.submarine ? hullDepth(p) : 0;
  const attenuation = Math.exp(-depth / 8);
  const at = (x: number, z: number) => {
    const point = localToWorld([x, 0, z], { ...p, y: 0, roll: 0, pitch: 0 });
    return seaHeight(sea, point[0], point[2], time) * attenuation;
  };
  let heave = 0;
  for (const z of [-.4, -.2, 0, .2, .4]) for (const x of [-.3, .3]) heave += at(x * h.beam, z * h.length) / 10;
  // Positive roll raises starboard: a starboard turn heels outward to port.
  const turnRoll = clamp(p.speed * p.yawRate / 9.81 * .3, -.06, .06);
  return { heave, roll: clamp((at(h.beam * .4, 0) - at(-h.beam * .4, 0)) / (h.beam * .8), -.18, .18) + turnRoll,
    pitch: clamp((at(0, -h.length * .4) - at(0, h.length * .4)) / (h.length * .8), -.08, .08) };
}
/** Added wave-making resistance depends on relative heading and hull size.
 * Wind produces gradual leeway, with sheltered/submerged hulls responding less. */
export function seaHandling(actor: FleetActor, sea: SeaState) {
  const p = actor.motion, submerged = actor.submarine && hullDepth(p) > .5;
  const encounter = (1 - Math.sin(p.heading - sea.direction)) / 2;
  return { resistance: submerged ? 0 : clamp(sea.amplitudeM / Math.sqrt(actor.definition.hull.length) * (.7 + 2.3 * encounter), 0, .35),
    drift: [Math.cos(sea.direction), Math.sin(sea.direction)].map(n => submerged ? 0 : n * sea.windMps * .015) as [number, number] };
}
