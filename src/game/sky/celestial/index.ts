import type { CelestialPart, SkyPartContext } from '../contracts';
import { CelestialBodies } from './CelestialBodies';

/** The celestial bodies: sun disc, moon, stars, Milky Way, shafts. */
export function createCelestial(context: SkyPartContext): CelestialPart | Promise<CelestialPart> {
  return new CelestialBodies(context);
}
