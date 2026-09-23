import type { EnvironmentPart, EnvironmentSources, SkyPartContext } from '../contracts';
import { Environment } from './Environment';
import { createStubEnvironment } from '../stubs/environment';

/** The environment bake and the ocean's sky provider. */
export function createEnvironment(context: SkyPartContext, sources: EnvironmentSources): EnvironmentPart | Promise<EnvironmentPart> {
  if (new URLSearchParams(globalThis.location?.search).get('environment') === 'stub') return createStubEnvironment(context.renderer, sources, context.quality);
  return new Environment(context.renderer, sources, context.uniforms, context.quality);
}
