import type { ShipDefinition } from './blueprint';
import { preset, loadShipPresets } from './presetLoading';
export { loadShipPreset, loadShipPresets } from './presetLoading';

/** Canonical roster; definitions are admitted on demand before simulation. */
export const shipPresets = {
  'kongo': preset('kongo'),
  "valiant": preset("valiant"),
  'resolute': preset('resolute'),
  'admiral-hipper': preset('admiral-hipper'),
  'cleveland': preset('cleveland'),
  'bismarck': preset('bismarck'),
  'yamato': preset('yamato'),
  'iowa': preset('iowa'),
  'alaska': preset('alaska'),
  'king-george-v': preset('king-george-v'),
  'hood': preset('hood'),
  'baltimore': preset('baltimore'),
  'mogami': preset('mogami'),
  'enterprise-cv6': preset('enterprise-cv6'),
  'shokaku': preset('shokaku'),
  'type-viic': preset('type-viic'),
  'liberty-cargo': preset('liberty-cargo'),
  'liberty-collier': preset('liberty-collier'),
  'victory-cargo': preset('victory-cargo'),
  'flower-corvette': preset('flower-corvette'),
  'fletcher': preset('fletcher'),
  'gleaves': preset('gleaves'),
  'yukikaze': preset('yukikaze'),
  'fubuki': preset('fubuki'),
};
export function shipPreset(id: string | null): ShipDefinition & { contentHash: string } {
  return (id && Object.hasOwn(shipPresets, id) ? shipPresets[id as keyof typeof shipPresets] : shipPresets.bismarck) as ShipDefinition & { contentHash: string };
}
// Preserve synchronous fixtures/CLI access. Browser admission belongs to App's
// retryable startup state, so a failed request cannot poison module evaluation.
if (typeof window === 'undefined') await loadShipPresets(Object.keys(shipPresets));
export const selectedShip = shipPreset(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('ship'));
