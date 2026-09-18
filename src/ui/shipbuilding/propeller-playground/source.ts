import type { ConstructionCatalog, ConstructionSource } from '../../../ships/blueprint';
import { createStarterSource } from '../../../ships/constructionStarter';

export const installations = ['Twin shafts', 'Staggered shafts', 'Compact screw'] as const;
export type Installation = typeof installations[number];
export type Settings = { installation: Installation; spacing: number; depth: number; aft: number; bearing: number };
export const defaults = (installation: Installation): Settings => ({ installation, spacing: installation === 'Compact screw' ? 0 : installation === 'Staggered shafts' ? 7 : 4.2, depth: installation === 'Compact screw' ? 1.6 : installation === 'Staggered shafts' ? 3.7 : 4.3, aft: installation === 'Compact screw' ? 14 : 28, bearing: 0 });

/** Disposable original test layouts in the real versioned custom-ship format. */
export function playgroundSource(catalog: ConstructionCatalog, settings: Settings): ConstructionSource {
  const small = settings.installation === 'Compact screw';
  const source = createStarterSource(catalog, small ? 'patrol-hull' : 'destroyer-hull');
  source.id = 'propeller-playground'; source.name = settings.installation;
  const hull = source.construction.primitives[0];
  hull.size = small ? [6, 5, 36] : [18, 12, 70];
  hull.customHull!.bilgeKeels = undefined;
  hull.customHull!.rake = 0; hull.customHull!.redPaintY = 0;
  // A broad afterbody rising to a shallow transom leaves exposed shaft runs.
  const stations = hull.customHull!.stations;
  for (const station of stations) {
    const keel = station.t < .6 ? -.5 : -.5 + .46 * (station.t - .6) / .4;
    const width = station.t < .54 ? Math.max(.02, Math.sin(station.t / .54 * Math.PI / 2)) : 1 - .3 * (station.t - .54) / .46;
    const half = [{ x: width, y: .45 }, { x: width * .96, y: keel + (.45 - keel) * .65 },
      { x: width * .78, y: keel + (.45 - keel) * .15 }, { x: width * .35, y: keel + .018 }];
    station.points = [...half.map(p => ({ ...p, x: -p.x })), { x: 0, y: keel }, ...half.slice().reverse()];
  }
  const prop = (id: string, x: number, z: number, side: 'port' | 'starboard') => source.construction.equipment.push({
    id, partId: small ? 'generic-propeller-1200' : 'fletcher-propeller-starboard', position: [x, -settings.depth, z], bearingDeg: settings.bearing,
  });
  if (small) prop('screw', settings.spacing, settings.aft, 'starboard');
  else for (const side of [-1, 1]) {
    const hand = side < 0 ? 'port' : 'starboard';
    prop(`${hand}-outer`, side * settings.spacing, settings.aft, hand);
    if (settings.installation === 'Staggered shafts') prop(`${hand}-inner`, side * Math.max(1.85, settings.spacing - 4.6), settings.aft + 6, hand);
  }
  return source;
}
