import type { AtmospherePart, CloudPart, SkyPartContext } from '../contracts';
import { createCloudLayer } from './CloudLayer';

/** The volumetric cloud layer, cirrus, cloud shadows and rain shafts. */
export function createClouds(context: SkyPartContext, atmosphere: AtmospherePart): CloudPart | Promise<CloudPart> {
  return createCloudLayer(context, atmosphere);
}
