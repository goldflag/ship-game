import type { EnvironmentPart, EnvironmentSources, SkyPartContext } from '../contracts';
import { Environment } from './Environment';

/** The environment bake and the ocean's sky provider. */
export function createEnvironment(context: SkyPartContext, sources: EnvironmentSources): EnvironmentPart | Promise<EnvironmentPart> {
  return new Environment(context.renderer, sources, context.uniforms, context.quality);
}
