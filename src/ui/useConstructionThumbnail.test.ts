import { expect, test } from 'bun:test';
import type { LocalShipRevision } from '../ships/localShips';
import { constructionThumbnail } from './useConstructionThumbnail';

test('cards share one bake per content hash and changed revisions read their own image', async () => {
  const previousCache = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const reads: string[] = [];
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://ships.test' } });
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: async () => ({
    match: async (url: string) => { reads.push(url); return new Response(url.endsWith('/edited') ? 'edited-image' : 'original-image'); },
  }) } });
  try {
    const ship = (contentHash: string) => ({ result: { contentHash } }) as LocalShipRevision;
    const garage = constructionThumbnail(ship('original'));
    const battle = constructionThumbnail(ship('original'));
    expect(garage).toBe(battle);
    expect(await garage).toBe('original-image');
    expect(await constructionThumbnail(ship('edited'))).toBe('edited-image');
    expect(reads).toEqual(['https://ships.test/__ship-thumbnails__/original', 'https://ships.test/__ship-thumbnails__/edited']);
  } finally {
    if (previousCache) Object.defineProperty(globalThis, 'caches', previousCache); else Reflect.deleteProperty(globalThis, 'caches');
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation); else Reflect.deleteProperty(globalThis, 'location');
  }
});
