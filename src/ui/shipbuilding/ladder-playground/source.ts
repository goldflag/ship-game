import type { ConstructionCatalog, ConstructionSource } from '../../../ships/blueprint';
import { accessDefaults, type AccessSettings } from '../../../../assets/parts/construction/access_geometry';
import { createStarterSource } from '../../../ships/constructionStarter';
export type Variant = 'both' | 'stairs' | 'framed';
export type Settings = { variant: Variant; rise: number; run: number; stairs: AccessSettings; framed: AccessSettings };
export const defaults = (variant: Variant = 'both'): Settings => ({ variant, rise: 3, run: 2.5, stairs: accessDefaults('inclined-ladder'), framed: accessDefaults('framed-ladder') });
export function playgroundSource(catalog: ConstructionCatalog, s: Settings): ConstructionSource {
  const source = createStarterSource(catalog, 'blank', 'dark-gray');
  source.id = 'ladder-playground'; source.name = 'Ladder playground';
  const both = s.variant === 'both', stairsX = both ? -1.2 : 0, ladderX = both ? 1.2 : 0;
  source.construction.primitives = [
    { id: 'lower-deck', kind: 'box', size: [6,.3,s.run+4], position: [0,-.15,(s.run-1)/2], rotationDeg: 0 },
    { id: 'upper-deck', kind: 'box', size: [6,s.rise,1.8], position: [0,s.rise/2,-.8], rotationDeg: 0 },
  ];
  source.construction.surfaces = [{primitiveId:'upper-deck',face:'top',material:'steel',thicknessMm:0,paint:'deck-gray'}, {primitiveId:'lower-deck',face:'top',material:'steel',thicknessMm:0,paint:'deck-gray'}];
  if (s.variant !== 'framed') source.construction.equipment.push({ id:'stairs', partId:'generic-inclined-ladder', position:[stairsX,0,s.run], bearingDeg:0, paint:'light-gray', path:{ points:[[0,0,0],[0,s.rise,-s.run]], access:s.stairs } });
  if (s.variant !== 'stairs') source.construction.equipment.push({ id:'framed', partId:'generic-framed-ladder', position:[ladderX,.16,.1], bearingDeg:180, paint:'light-gray', path:{points:[[0,0,0],[0,s.rise-.32,0]],access:s.framed} });
  return source;
}
