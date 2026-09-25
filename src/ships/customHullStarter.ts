import { DEFAULT_HULL_PRESET, HULL_PRESETS } from './constructionHullPresets';
import { defaultBilgeKeels } from './constructionBilgeKeels';
import { clone, customHullPrimitive, uid, type Hull } from './customHullModel';

/* The editor's starter hulls, from the generated presets. They live apart from customHullModel so the
 * construction model, which only draws a design's own sections, does not depend on the presets. */
export const presets = HULL_PRESETS;
export function makeHull(index = presets.findIndex(p => p.id === DEFAULT_HULL_PRESET)): Hull {
  const p = presets[index];
  return {
    id: uid(), name: p.name, length: p.length, beam: p.beam, depth: p.depth, offset: 0,
    bilgeKeels: defaultBilgeKeels(p.beam),
    bulb: p.customHull.bulb, rake: p.customHull.rake, redPaintY: p.customHull.redPaintY,
    region: { enabled: false, start: .25, end: .75, low: .32, high: .7, armor: 200, color: '#9aac9b' },
    stations: clone(p.customHull.stations),
  };
}
/** The sections a custom hull draws with when a caller names none: the default starter's. */
export const defaultCustomHull = () => customHullPrimitive(makeHull()).customHull!;
