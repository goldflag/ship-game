import type { AtmospherePart, SkyPartContext } from '../contracts';
import { Atmosphere } from './Atmosphere';

/** The atmosphere part: Hillaire's scattering tables, sky radiance, aerial perspective, light at any altitude. */
export function createAtmosphere(context: SkyPartContext): AtmospherePart | Promise<AtmospherePart> {
  return new Atmosphere(context.uniforms);
}
