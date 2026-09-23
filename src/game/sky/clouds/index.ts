import type { AtmospherePart, CloudPart, SkyPartContext } from '../contracts';
import { createStubClouds } from '../stubs/clouds';

/** The volumetric cloud layer, cirrus, cloud shadows and rain shafts. */
export function createClouds(_context: SkyPartContext, _atmosphere: AtmospherePart): CloudPart | Promise<CloudPart> {
  return createStubClouds();
}
