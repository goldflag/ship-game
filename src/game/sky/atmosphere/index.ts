import type { AtmospherePart, SkyPartContext } from '../contracts';
import { createStubAtmosphere } from '../stubs/atmosphere';

/** The atmosphere part. */
export function createAtmosphere(context: SkyPartContext): AtmospherePart | Promise<AtmospherePart> {
  return createStubAtmosphere(context.uniforms);
}
