import { assetUrl } from '../assetUrl';
import kingGeorgeV from '../../public/models/king-george-v.json';
import bismarck from '../../public/models/bismarck.json';
import yamato from '../../public/models/yamato.json';
import baltimore from '../../public/models/baltimore.json';
import enterprise from '../../public/models/enterprise-cv6.json';
import viic from '../../public/models/type-viic.json';
import fletcher from '../../public/models/fletcher.json';
import libertyCargo from '../../public/models/liberty-cargo.json';
import libertyCollier from '../../public/models/liberty-collier.json';
import victoryCargo from '../../public/models/victory-cargo.json';
import flower from '../../public/models/flower-corvette.json';
import type { ShipDefinition } from './blueprint';

/** Historical presets share the same compiled definition and renderer contract. */
export const shipPresets = {
  bismarck,
  yamato,
  'king-george-v': kingGeorgeV,
  baltimore,
  'enterprise-cv6': enterprise,
  'type-viic': viic,
  'liberty-cargo': libertyCargo,
  'liberty-collier': libertyCollier,
  'victory-cargo': victoryCargo,
  'flower-corvette': flower,
  fletcher,
};
const retiredPresetAliases: Record<string, keyof typeof shipPresets> = {
  'liberty-deck-cargo': 'liberty-collier', 'liberty-troopship': 'victory-cargo',
};
export function shipPreset(id: string | null): ShipDefinition & { contentHash: string } {
  if (id && Object.hasOwn(retiredPresetAliases, id)) id = retiredPresetAliases[id];
  return (id && Object.hasOwn(shipPresets, id) ? shipPresets[id as keyof typeof shipPresets] : bismarck) as ShipDefinition & { contentHash: string };
}
export const selectedShip = shipPreset(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('ship'));

/** Review pages published under public/ship-reference when the build ran; injected by vite.config.ts. */
declare const __SHIP_REVIEW_IDS__: string[] | undefined;
export const availableShipReviews: ReadonlySet<string> = new Set(typeof __SHIP_REVIEW_IDS__ === 'undefined' ? [] : __SHIP_REVIEW_IDS__);
/** Published authoring evidence is optional preset metadata, independent of combat. The explicit filename avoids Vite's SPA fallback. */
export const shipReviewUrl = (id: string) => availableShipReviews.has(id) ? assetUrl(`ship-reference/${id}/index.html`) : undefined;
