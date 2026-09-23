import type { EnvironmentPart, EnvironmentSources, SkyPartContext } from '../contracts';
import { createStubEnvironment } from '../stubs/environment';

/** The environment bake and the ocean's sky provider. */
export function createEnvironment(context: SkyPartContext, sources: EnvironmentSources): EnvironmentPart | Promise<EnvironmentPart> {
  return createStubEnvironment(context.renderer, sources, context.quality);
}
