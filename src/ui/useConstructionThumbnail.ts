import { useEffect, useState } from 'react';
import type { LocalShipRevision } from '../ships/localShips';

// Bump when framing, lighting or rendering changes. Geometry/paint/fittings are
// already covered by the compiler's content hash, including catalog identity.
const CACHE = 'construction-thumbnails-v2';
const tasks = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

export function constructionThumbnail(ship: LocalShipRevision): Promise<string> {
  const key = ship.result.contentHash;
  const existing = tasks.get(key);
  if (existing) return existing;
  // One offscreen GPU context at a time, even when a fleet has many custom ships.
  const task = queue.then(async () => {
    const url = new URL(`/__ship-thumbnails__/${encodeURIComponent(key)}`, location.origin).href;
    const cache = typeof caches === 'undefined' ? undefined : await caches.open(CACHE).catch(() => undefined);
    const saved = await cache?.match(url).catch(() => undefined);
    if (saved) return saved.text();
    const { bakeConstructionThumbnail } = await import('../game/constructionThumbnail');
    const image = await bakeConstructionThumbnail(ship);
    if (cache) {
      try {
        await cache.put(url, new Response(image));
        const keys = await cache.keys();
        await Promise.all(keys.slice(0, Math.max(0, keys.length - 100)).map(key => cache.delete(key)));
      } catch { /* Storage limits must not prevent showing the generated image. */ }
    }
    return image;
  });
  tasks.set(key, task); queue = task.catch(() => {});
  task.then(() => {
    if (tasks.size > 100) tasks.delete(tasks.keys().next().value!);
  }, () => { tasks.delete(key); });
  return task;
}

/** Ignore late images after edits, deletion, account changes or unmount. */
export function useConstructionThumbnail(ship?: LocalShipRevision): string | undefined {
  const key = ship?.result.contentHash;
  const [image, setImage] = useState<{ key: string; url: string }>();
  useEffect(() => {
    let active = true;
    if (ship && !ship.thumbnail) constructionThumbnail(ship).then(url => {
      if (active) setImage({ key: ship.result.contentHash, url });
    }).catch(() => { /* Keep the existing silhouette if rendering is unavailable. */ });
    return () => { active = false; };
  }, [ship]);
  return ship?.thumbnail ?? (image?.key === key ? image?.url : undefined);
}
