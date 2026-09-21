/** Disposable derived data only; saved source and account ownership stay in the construction store. */
export const CONSTRUCTION_COMPILE_CACHE = 'naval-construction-compile-v1';
export const COMPILE_CACHE_ENTRIES = 8;
export const COMPILE_CACHE_MAX_BYTES = 32 * 1024 * 1024;

export async function cachedConstructionCompile(
  build: string, source: string, catalog: string, compile: () => string,
  storage: Pick<CacheStorage, 'open'> | undefined = globalThis.caches,
): Promise<string> {
  let cache: Cache | undefined, key: string | undefined;
  try {
    if (storage) {
      // Hash the complete inputs, not just author-controlled revision IDs. Cache keys are
      // synthetic URLs only: they are never fetched, and contain no source/account data.
      const bytes = new TextEncoder().encode(JSON.stringify([build, source, catalog]));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      key = 'https://construction-cache.invalid/' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      cache = await storage.open(CONSTRUCTION_COMPILE_CACHE);
      const hit = await cache.match(key);
      if (hit) {
        const body = hit.headers.get('X-Construction-Compression') === 'gzip'
          ? new Response(hit.body!.pipeThrough(new DecompressionStream('gzip'))) : hit;
        const output = await body.text();
        JSON.parse(output); // An unreadable entry falls back to the real compiler.
        return output;
      }
    }
  } catch { /* Disabled/evicted storage must never make a saved design unavailable. */ }

  const output = compile(); // Compiler errors propagate once and never enter the cache.
  try {
    const blob = new Blob([output], { type: 'application/json' });
    if (cache && key && blob.size <= COMPILE_CACHE_MAX_BYTES) {
      // Finish writing before replying: callers may immediately dispose the worker.
      let response = new Response(blob);
      if (blob.size >= 64 * 1024 && typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined') {
        try {
          const compressed = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
          if (compressed.byteLength < blob.size) response = new Response(compressed, {
            headers: { 'Content-Type': 'application/json', 'X-Construction-Compression': 'gzip' },
          });
        } catch { /* A compression failure still permits an ordinary cache entry. */ }
      }
      await cache.put(key, response);
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - COMPILE_CACHE_ENTRIES))) await cache.delete(old);
    }
  } catch { /* Quota pressure is only a cache miss on the next visit. */ }
  return output;
}
