import bismarck from '../../public/models/bismarck.json';
import yamato from '../../public/models/yamato.json';
import baltimore from '../../public/models/baltimore.json';
import enterprise from '../../public/models/enterprise-cv6.json';
import type { ShipDefinition } from './blueprint';

/** Historical presets share the same compiled definition and renderer contract. */
export const shipPresets = { bismarck, yamato, baltimore, 'enterprise-cv6': enterprise };
export function shipPreset(id: string | null): ShipDefinition & { contentHash: string } {
  return (id && Object.hasOwn(shipPresets, id) ? shipPresets[id as keyof typeof shipPresets] : bismarck) as ShipDefinition & { contentHash: string };
}
export const selectedShip = shipPreset(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('ship'));

/** Published authoring evidence is optional preset metadata, independent of combat. */
export const shipReviewUrls: Partial<Record<string, string>> = Object.fromEntries(
  // Vite's SPA fallback serves the game for public directory URLs.
  Object.keys(shipPresets).map(id => [id, `/ship-reference/${id}/index.html`]),
);
