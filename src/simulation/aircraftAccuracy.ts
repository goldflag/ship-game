import type { Vec3 } from '../ships/blueprint';
import type { Aircraft } from './aircraft';
import { dispersedDirection, dispersedSpeed } from './ballistics';
import { add, length, normalize, scale, sub } from './geometry';

/** Stable per-aircraft sampling: telemetry and render frames never consume RNG. */
export function aircraftSeed(id: string, seed: number): number {
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  return seed >>> 0;
}

/** Provisional pilot errors in metres, held for the whole attack pass. Bombs
 * still inherit the aircraft's velocity; torpedoes still run a straight course. */
export function strikeAimError(p: Aircraft, heading: number, seed: number, sortie: number): Vec3 {
  const key = aircraftSeed(p.id, seed), pass = sortie * 17 + p.pilot.attempts;
  const across = (dispersedSpeed(1, 1, key, pass) - 1) * 24;
  const along = (dispersedSpeed(1, 1, key ^ 0xa53c9e17, pass) - 1) * (p.role === 'dive-bomber' ? 45 : 100);
  return [Math.cos(heading) * across + Math.sin(heading) * along, 0,
    Math.sin(heading) * across - Math.cos(heading) * along];
}

/** A burst samples aim error, then tests its miss distance. A valid firing
 * solution permits firing; it no longer guarantees damage. */
export function fighterBurst(p: Aircraft, aim: Vec3, seed: number, sortie: number) {
  const delta = sub(aim, p.position), distance = length(delta);
  const direction = dispersedDirection(normalize(delta), .014 + Math.abs(p.bank) * .008,
    aircraftSeed(p.id, seed), sortie * 31 + p.ammo);
  const end = add(p.position, scale(direction, distance));
  return { end, hit: length(sub(end, aim)) <= 7 };
}
