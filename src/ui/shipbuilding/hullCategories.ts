import type { ConstructionPrimitive } from '../../ships/blueprint';

export const HULL_CATEGORIES = [
  { id: 'all', name: 'All' },
  { id: 'boxes', name: 'Boxes' },
  { id: 'slopes', name: 'Slopes & corners' },
  { id: 'curves', name: 'Curves' },
  { id: 'shells', name: 'Shells' },
  { id: 'bridges', name: 'Bridges' },
  { id: 'hulls', name: 'Hulls & decks' },
  { id: 'ballast', name: 'Ballast' },
] as const;
export type HullCategory = typeof HULL_CATEGORIES[number]['id'];

export const HULL_CATEGORY: Record<ConstructionPrimitive['kind'], Exclude<HullCategory, 'all'>> = {
  box: 'boxes', vertex: 'boxes', prism: 'boxes',
  wedge: 'slopes', corner: 'slopes', 'inverse-corner': 'slopes', pyramid: 'slopes', 'concave-corner': 'slopes',
  cylinder: 'curves', 'half-cylinder': 'curves', 'quarter-cylinder': 'curves', cone: 'curves',
  sphere: 'curves', hemisphere: 'curves', 'half-hemisphere': 'curves', 'quarter-hemisphere': 'curves', 'sphere-octant': 'curves',
  'quarter-cylinder-wall': 'shells', 'hemisphere-shell': 'shells', 'half-hemisphere-shell': 'shells',
  'quarter-hemisphere-shell': 'shells', 'parabolic-shell': 'shells', 'hollow-cube': 'shells',
  bridge: 'bridges', 'diagonal-bridge': 'bridges', 'rounded-bridge': 'bridges',
  'bridge-panel': 'bridges', 'diagonal-bridge-panel': 'bridges', 'rounded-bridge-panel': 'bridges',
  'custom-hull': 'hulls', balcony: 'hulls', breakwater: 'hulls', ballast: 'ballast',
};
