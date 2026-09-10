import type { ObservedAircraftType } from './fleetStats';

/** Nose-up airframe silhouettes about 14 px tall: a stubby fighter, a tapered
 * dive bomber, a wide torpedo bomber, and a plain chevron before the type is known. */
export const PLANE_GLYPHS: Record<ObservedAircraftType, string> = {
  fighter: 'M0 -7L1.2 -2.5 7 -1 7 .6 1.4 .3 1.1 4 3.2 5.6 3.2 6.6 0 5.8 -3.2 6.6 -3.2 5.6 -1.1 4 -1.4 .3 -7 .6 -7 -1 -1.2 -2.5Z',
  'dive-bomber': 'M0 -7.5L1.1 -3 9 -1.4 9 .4 1.3 0 1 4.5 3.4 6 3.4 7 0 6.2 -3.4 7 -3.4 6 -1 4.5 -1.3 0 -9 .4 -9 -1.4 -1.1 -3Z',
  'torpedo-bomber': 'M0 -7L1.2 -2.8 10 -1.8 10 .2 1.4 .2 1.1 4.6 3.6 6.2 3.6 7.2 0 6.3 -3.6 7.2 -3.6 6.2 -1.1 4.6 -1.4 .2 -10 .2 -10 -1.8 -1.2 -2.8Z',
  unknown: 'M0 -7L3 -1 8 3 8 5 2.2 3.6 2.2 7 -2.2 7 -2.2 3.6 -8 5 -8 3 -3 -1Z',
};
