import type { AtmospherePart, SkyPartContext } from '../contracts';
import { Atmosphere } from './Atmosphere';
import { createStubAtmosphere } from '../stubs/atmosphere';

/** The atmosphere part: Hillaire's scattering tables, sky radiance, aerial perspective, light at any altitude. */
export function createAtmosphere(context: SkyPartContext): AtmospherePart | Promise<AtmospherePart> {
  if (new URLSearchParams(globalThis.location?.search).get('atmosphere') === 'stub') return createStubAtmosphere(context.uniforms);
  return new Atmosphere(context.uniforms);
}
