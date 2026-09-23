import type { CelestialPart, SkyPartContext } from '../contracts';
import { createStubCelestial } from '../stubs/celestial';

/** The celestial bodies: sun disc, moon, stars, Milky Way, shafts. */
export function createCelestial(context: SkyPartContext): CelestialPart | Promise<CelestialPart> {
  return createStubCelestial(context.uniforms);
}
